#!/usr/bin/env python3
"""Read-only registry lint. No imports or execution from inspected releases."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Any, Optional

import jsonschema
import yaml

VERSION = '0.5.1'
ID = re.compile(r'^[a-z0-9][a-z0-9._-]*$')
SEMVER = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')
KINDS = {'workflows': 'workflow', 'agents': 'agent', 'skills': 'skill', 'packs': 'pack'}
# Profiles the pinned runner honours declaratively; anything else must live outside
# the lock (policies) until engine 0.6.0 makes profile sets declarative.
SUPPORTED_PROFILES = {'renderer': 'matplotlib-adapter-first'}
SCHEMAS = {'workflow': {'ai-workflow/v1', 'ai-workflow/v2', 'ai-workflow/v2.1'},
           'agent': {'ai-agent/v1', 'ai-agent/v2'}, 'skill': {'ai-skill/v1'}, 'pack': {'ai-pack/v1'}}
EXEC_SUFFIXES = {'.py', '.ps1', '.js', '.mjs', '.cmd', '.bat', '.sh', '.exe'}
CACHE_NAMES = {'__pycache__', 'node_modules', '.venv', '.pytest_cache', '.mypy_cache', '.cache'}
MAX_METADATA_BYTES = 8 * 1024 * 1024


class InvalidData(ValueError):
    pass


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidData('Duplicate object key')
        result[key] = value
    return result


class UniqueLoader(yaml.SafeLoader):
    pass


def yaml_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, (str, int, float, bool)) or key in result:
            raise InvalidData('Invalid or duplicate YAML key')
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, yaml_mapping)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def reparse(path: Path) -> bool:
    return path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400)


def inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError, RuntimeError):
        return False


def safe_path(root: Path, relative: str) -> Path:
    if any(p.exists() and reparse(p) for p in (root, *root.parents)):
        raise InvalidData('Root cannot be a reparse point')
    if not isinstance(relative, str) or not relative or '\x00' in relative or ':' in relative:
        raise InvalidData('Invalid relative path')
    parts = relative.replace('\\', '/').split('/')
    if PureWindowsPath(relative).is_absolute() or PureWindowsPath(relative).drive or relative.startswith('/'):
        raise InvalidData('Absolute path is forbidden')
    if any(p in {'', '.', '..'} or p.endswith((' ', '.')) for p in parts):
        raise InvalidData('Unsafe path component')
    current = root
    for part in parts:
        current = current / part
        if current.exists() and reparse(current):
            raise InvalidData('Reparse point is forbidden')
    if not inside(current, root):
        raise InvalidData('Path escapes root')
    return current


def read_text(path: Path):
    with path.open('rb') as stream:
        data = stream.read(MAX_METADATA_BYTES + 1)
    if len(data) > MAX_METADATA_BYTES:
        raise InvalidData('Metadata exceeds the 8 MiB inspection limit')
    return data.decode('utf-8-sig')


def bounded_tree(value):
    pending = [(value, 0)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if depth > 100 or count > 200000:
            raise InvalidData('Metadata structure exceeds inspection limits')
        if isinstance(node, dict):
            pending.extend((child, depth + 1) for child in node.values())
        elif isinstance(node, list):
            pending.extend((child, depth + 1) for child in node)
    return value


def invalid_constant(value):
    raise InvalidData('Non-finite JSON number is forbidden')


def read_json(path: Path):
    return bounded_tree(json.loads(read_text(path), object_pairs_hook=unique_object, parse_constant=invalid_constant))


def valid_version(value) -> bool:
    if not isinstance(value, str) or not SEMVER.fullmatch(value):
        return False
    prerelease = value.split('+')[0].partition('-')[2]
    build = value.partition('+')[2]
    return (not prerelease or all(p and not (p.isdigit() and len(p) > 1 and p[0] == '0') for p in prerelease.split('.'))) and (not build or all(build.split('.')))


class Scanner:
    def __init__(self, tool_root, agent_root, select=None, bridge=None):
        self.tool = Path(tool_root).absolute()
        self.agent = Path(agent_root).absolute()
        self.select = select
        self.bridge = Path(bridge) if bridge else None
        self.findings = []
        self.resources = {}
        self.registered = {k: {} for k in SCHEMAS}
        self.edges = {}
        self.current = {}
        self.checked_files = 0
        self.active = set()
        self.json_cache = {}
        self.catalog_count = 0
        self.extensions = {}
        self.extension_registry = None

    def add(self, rule, severity, code, message, key=None, path=None):
        kind, ident, version = key or ('repository', '', '')
        item = dict(rule=rule, severity=severity, code=code, kind=kind, id=ident,
                    version=version, path=str(path or ''), message=message)
        if item not in self.findings:
            self.findings.append(item)

    def note_extension(self, value, key, path, location=''):
        if isinstance(value, dict):
            for name, child in value.items():
                if isinstance(name, str) and name.startswith('x-'):
                    self.extensions.setdefault(name, []).append((key, str(path), location or str(name)))
                self.note_extension(child, key, path, location + '/' + str(name) if location else str(name))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                self.note_extension(child, key, path, location + '/' + str(index) if location else str(index))

    def declared_extensions(self):
        if self.extension_registry is None:
            self.extension_registry = set()
            registry_path = self.tool / '_registry' / 'x-fields.json'
            if registry_path.is_file():
                document = self.load(registry_path, 'R15')
                if isinstance(document, dict) and document.get('schema') == 'ai-x-field-registry/v1' and isinstance(document.get('fields'), list):
                    self.extension_registry = {name for name in document['fields'] if isinstance(name, str)}
                else:
                    self.add('R15','warning','extension-registry-shape','Extension registry must declare schema ai-x-field-registry/v1 and a fields array.',path=registry_path)
        return self.extension_registry

    def check_extensions(self):
        declared = self.declared_extensions()
        for name in sorted(self.extensions):
            key, path, location = self.extensions[name][0]
            count = len(self.extensions[name])
            if name in declared:
                self.add('R15','info','extension-registered','Registered extension field is recorded without relaxing core validation: '+name+' ('+str(count)+' occurrence(s), first at '+location+')',key,path)
            else:
                self.add('R15','warning','extension-undeclared','Unregistered extension field requires registration or promotion before the next contract revision: '+name+' ('+str(count)+' occurrence(s), first at '+location+')',key,path)

    def load(self, path, rule='R4', key=None):
        try:
            name = str(path)
            if name not in self.json_cache:
                self.json_cache[name] = read_json(path)
            return self.json_cache[name]
        except (OSError, ValueError, RecursionError):
            self.add(rule, 'error', 'invalid-json', 'JSON is missing, invalid or contains duplicate keys.', key, path)
            return None

    def path(self, root, relative, rule, key, required=True):
        try:
            path = safe_path(root, relative)
            if required and not path.is_file():
                self.add(rule, 'error', 'missing-file', 'Required referenced file does not exist.', key, path)
                return None
            return path
        except (OSError, ValueError, TypeError, RuntimeError):
            self.add(rule, 'error', 'unsafe-path', 'Reference is not a safe relative non-link path.', key, root)
            return None

    def base(self, kind, ident):
        if not isinstance(ident, str) or not ID.fullmatch(ident):
            raise InvalidData('Invalid resource id')
        root = self.agent if kind == 'agent' else self.tool
        relative = ident if kind in {'agent', 'workflow'} else kind + 's/' + ident
        return safe_path(root, relative)

    def discover(self):
        for root, schema, sections in [(self.tool, 'ai-tool-registry/v2', ['workflows', 'packs', 'skills']),
                                       (self.agent, 'ai-agent-registry/v2', ['agents'])]:
            registry_path = self.path(root, 'registry.json', 'R1', None)
            if not registry_path:
                continue
            registry = self.load(registry_path, 'R1')
            if not isinstance(registry, dict):
                self.add('R1','error','registry-shape','Registry root must be an object.',path=registry_path)
                continue
            if registry.get('schema') != schema:
                self.add('R1', 'error', 'registry-schema', 'Unsupported registry schema.', path=registry_path)
            for section in sections:
                entries = registry.get(section, [])
                if not isinstance(entries, list):
                    self.add('R1', 'error', 'registry-section', 'Registry section must be an array.', path=registry_path)
                    continue
                for entry in entries:
                    if not isinstance(entry, dict):
                        self.add('R1', 'error', 'registry-entry', 'Registry entry must be an object.', path=registry_path)
                        continue
                    if entry.get('enabled') is False:
                        # 3.1-A C-6: `enabled:false` never reaches register(), so the retirement-misuse
                        # check has to fire here too — otherwise marking a resource retired by hiding it
                        # (the exact failure mode D-69 describes) would pass lint silently.
                        if entry.get('deprecated') is True:
                            self.add('R1','error','deprecated-as-hide',
                                     'Retirement must not be expressed through `enabled:false`; that cuts '
                                     'resolution of runs already pinned to this release. Keep enabled:true '
                                     'and mark deprecated instead.', (KINDS.get(section,'repository'),
                                                                      entry.get('id',''), ''), registry_path)
                        continue
                    if section == 'skills' and entry.get('kind') == 'skill-catalog':
                        catalog_path = self.path(root, entry.get('path'), 'R1', None)
                        catalog = self.load(catalog_path, 'R1') if catalog_path else None
                        if not isinstance(catalog, dict) or catalog.get('schema') not in ('ai-skill-catalog/v1','ai-skill-registry/v1') or not isinstance(catalog.get('skills'), list):
                            self.add('R1','error','catalog-schema','Skill catalog schema or entries are invalid.',path=catalog_path)
                            continue
                        self.catalog_count += 1
                        for skill in catalog['skills']:
                            self.register('skill', skill, root, catalog_path, catalog=True)
                    else:
                        self.register(KINDS[section], entry, root, registry_path)
        # Pointers are read once, before dependency traversal.
        for kind, entries in self.registered.items():
            for ident, entry in entries.items():
                key = (kind, ident, '')
                try:
                    base = self.base(kind, ident)
                except (ValueError, OSError):
                    self.add('R1','error','invalid-id','Resource id is invalid.',key)
                    continue
                pointer_path = self.path(base, 'current.json', 'R1', key)
                pointer = self.load(pointer_path,'R1',key) if pointer_path else None
                if not isinstance(pointer, dict):
                    continue
                version = pointer.get('version')
                if pointer.get('id') != ident or not valid_version(version) or pointer.get('schema') != 'ai-' + kind + '-pointer/v1':
                    self.add('R2','error','pointer-mismatch','Pointer schema, id or semantic version is invalid.',key,pointer_path)
                    continue
                self.current[(kind,ident)] = version
                self.path(base, 'versions/' + version + '/manifest.json', 'R1', (kind,ident,version))
                if entry.get('version') and entry['version'] != version:
                    self.add('R13','warning','index-drift','Registry/catalog version differs from current pointer.',(kind,ident,version),pointer_path)

    def register(self, kind, entry, root, source, catalog=False):
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not ID.fullmatch(entry['id']):
            self.add('R1','error','invalid-id','Registry entry has an invalid id.',path=source)
            return
        ident = entry['id']
        # 3.1-A C-6 (D-69): retirement is a DESCRIPTION, never a switch. `enabled:false` is a hard
        # switch here (it drops the resource from `registered`, which makes any run pinned to it fail
        # with UNAUTHORIZED at resolution), so a merged-away release must stay enabled:true.
        # This block must stay BEFORE the `enabled:false` early return below, otherwise "retirement
        # expressed through enabled:false" is exactly the case the check cannot see.
        if 'deprecated' in entry and not isinstance(entry['deprecated'], bool):
            self.add('R1','error','deprecated-shape','`deprecated` must be a boolean registry flag.',
                     (kind, ident, ''), source)
        if entry.get('deprecated') is True and entry.get('enabled') is False:
            self.add('R1','error','deprecated-as-hide',
                     'Retirement must not be expressed through `enabled:false`; that cuts resolution of '
                     'runs already pinned to this release. Keep enabled:true and mark deprecated instead.',
                     (kind, ident, ''), source)
        if 'supersededBy' in entry and not isinstance(entry['supersededBy'], str):
            self.add('R1','error','supersededBy-shape','`supersededBy` must name a single resource id.',
                     (kind, ident, ''), source)
        if entry.get('enabled') is False:
            return
        if ident in self.registered[kind]:
            self.add('R1','error','duplicate-id','Duplicate enabled resource id.',(kind,ident,''),source)
            return
        if not catalog:
            expected = ident + '/current.json' if kind in {'agent','workflow'} else kind + 's/' + ident + '/current.json'
            pointer = self.path(root, entry.get('current'), 'R1',(kind,ident,''))
            if pointer is None:
                return
            if pointer.absolute() != (root / expected).absolute():
                self.add('R1','error','pointer-location','Pointer must use the canonical resource location.',(kind,ident,''),pointer)
                return
        self.registered[kind][ident] = entry

    def files(self, release, key):
        found = []
        def walk(directory):
            try:
                entries = sorted(directory.iterdir(), key=lambda p:p.name.casefold())
            except OSError:
                self.add('R3','error','unreadable-directory','Release directory cannot be read.',key,directory)
                return
            names = set()
            for entry in entries:
                folded = entry.name.casefold()
                if folded in names:
                    self.add('R3','error','path-alias','Case-insensitive path aliases exist.',key,directory)
                names.add(folded)
                try:
                    if reparse(entry):
                        self.add('R3','error','reparse-point','Published entries cannot be symbolic links or junctions.',key,entry)
                        continue
                    if entry.is_dir():
                        if entry.name in CACHE_NAMES:
                            self.add('R11','error','generated-cache','Generated dependency/cache directory in release.',key,entry)
                        walk(entry)
                    elif entry.is_file():
                        found.append(entry)
                        if entry.suffix.lower() in {'.pyc','.log'} or entry.name == '.env' or entry.name.startswith('.env.'):
                            self.add('R11','error','forbidden-file','Potential credential, log or generated cache file in release.',key,entry)
                except OSError:
                    self.add('R3','error','unreadable-entry','Release entry cannot be inspected.',key,entry)
        walk(release)
        return found

    def integrity(self, release, manifest, key):
        declared = manifest.get('integrity', {})
        if not isinstance(declared, dict) or declared.get('sha256Manifest') != 'SHA256SUMS':
            self.add('R4','error','integrity-declaration','Integrity must declare SHA256SUMS.',key,release/'manifest.json')
        files = self.files(release,key)
        sums = self.path(release,'SHA256SUMS','R3',key)
        listed = set()
        if sums:
            try:
                lines = read_text(sums).splitlines()
            except (OSError, ValueError):
                lines = []
                self.add('R3','error','unreadable-checksums','Checksum list cannot be read.',key,sums)
            for line in lines:
                if not line.strip():
                    continue
                match = re.fullmatch(r'([A-Fa-f0-9]{64})\s+\*?(.+)',line)
                if not match:
                    self.add('R3','error','checksum-format','Checksum entry is malformed.',key,sums)
                    continue
                name = match[2]
                target = self.path(release,name,'R3',key)
                alias = name.replace('\\','/').casefold()
                if alias in listed:
                    self.add('R3','error','duplicate-checksum','Duplicate or aliased checksum entry.',key,sums)
                listed.add(alias)
                if alias == 'sha256sums':
                    self.add('R3','error','checksum-self-reference','Checksum manifest cannot include itself.',key,sums)
                if target:
                    try:
                        self.checked_files += 1
                        if digest(target) != match[1].lower():
                            self.add('R3','error','hash-mismatch','File hash differs from the published checksum.',key,target)
                    except OSError:
                        self.add('R3','error','unreadable-file','File cannot be hashed.',key,target)
        for file in files:
            relative = file.relative_to(release).as_posix()
            if file != sums and relative.casefold() not in listed:
                self.add('R3','error','unlisted-file','File is absent from SHA256SUMS.',key,file)

    def schema_file(self, release, name, key):
        path = self.path(release,name,'R9',key)
        value = self.load(path,'R9',key) if path else None
        if value is None:
            return
        try:
            jsonschema.validators.validator_for(value).check_schema(value)
        except (jsonschema.SchemaError, TypeError, AttributeError):
            self.add('R9','error','invalid-schema','JSON Schema is structurally invalid.',key,path)
            return
        if value is True or value == {} or (isinstance(value, dict) and value.get('type') == 'object' and not value.get('properties') and value.get('additionalProperties',True) is True):
            strict=self.resources.get(key,{}).get('manifestSchema')=='ai-workflow/v2.1'
            self.add('R9','error' if strict else 'warning','placeholder-schema','Schema has no meaningful field constraints.',key,path)
        def check_refs(node):
            if isinstance(node, dict):
                ref=node.get('$ref')
                if isinstance(ref,str) and not ref.startswith('#'):
                    filename=ref.partition('#')[0]
                    if '://' in filename or filename.startswith('urn:'):
                        self.add('R9','error','remote-schema-reference','Remote schema references are not fetched or trusted.',key,path)
                    else:
                        self.path(path.parent,filename,'R9',key)
                for child in node.values():
                    check_refs(child)
            elif isinstance(node,list):
                for child in node: check_refs(child)
        check_refs(value)

    def entries(self, value, key, field):
        if value is None:
            return []
        if isinstance(value,dict):
            pairs=list(value.items())
        elif isinstance(value,list):
            pairs=[]
            for item in value:
                if isinstance(item,str):
                    ident, sep, version = item.rpartition('@')
                    pairs.append((ident if sep else item,version if sep else None))
                elif isinstance(item,dict):
                    pairs.append((item.get('id'),item.get('version')))
                else:
                    self.add('R12','error','lock-shape','Dependency entries must be id/version objects or exact mappings.',key)
        else:
            self.add('R12','error','lock-shape','Dependency section has an unsupported shape.',key)
            return []
        result=[]
        seen=set()
        for ident,version in pairs:
            if not isinstance(ident,str) or not ID.fullmatch(ident) or not valid_version(version):
                self.add('R12','error','unlocked-dependency','Dependency id and exact semantic version are required.',key)
                continue
            if ident in seen:
                self.add('R12','error','duplicate-dependency','Dependency id appears more than once.',key)
            seen.add(ident)
            result.append((ident,version))
        return result

    def dependency(self, parent, kind, ident, version):
        child=(kind,ident,version)
        self.edges.setdefault(parent,set()).add(child)
        if ident not in self.registered[kind]:
            alternatives=[k for k in SCHEMAS if ident in self.registered[k]]
            code='dependency-kind-mismatch' if alternatives else 'unregistered-dependency'
            self.add('R12','error',code,'Locked resource is not enabled in the declared resource namespace.',parent)
            return
        self.path(self.base(kind,ident),'versions/'+version+'/manifest.json','R12',parent)
        self.release(kind,ident,version)

    def dependency_sections(self, value, parent):
        if not isinstance(value,dict):
            if isinstance(value,list):
                for item in value:
                    if isinstance(item,str) and '@' in item:
                        ident, _, version = item.rpartition('@')
                        matches=[kind for kind in SCHEMAS if ident in self.registered[kind]]
                        if len(matches)==1 and valid_version(version):
                            self.dependency(parent,matches[0],ident,version)
                        else:self.add('R12','error','ambiguous-legacy-dependency','Legacy internal dependency cannot be uniquely typed and exactly locked.',parent)
                    else:self.add('R12','info','external-requirements','Legacy external requirements require an independently pinned platform environment.',parent)
            elif value:
                self.add('R12','info','external-requirements','Legacy external requirements require an independently pinned platform environment.',parent)
            return
        for section,kind in KINDS.items():
            if section == 'agents': continue
            for ident,version in self.entries(value.get(section),parent,section):
                self.dependency(parent,kind,ident,version)

    def validate_definition(self, release, manifest, key):
        path=self.path(release,manifest.get('entry'),'R5',key)
        if not path: return
        try:
            source=read_text(path)
            if any(isinstance(token,yaml.tokens.AliasToken) for token in yaml.scan(source)):
                raise InvalidData('YAML aliases are outside the supported inspection profile')
            definition=bounded_tree(yaml.load(source,Loader=UniqueLoader))
        except (OSError,ValueError,yaml.YAMLError,RecursionError):
            self.add('R5','error','invalid-yaml','Workflow YAML is invalid or has duplicate keys.',key,path)
            return
        if not isinstance(definition,dict):
            self.add('R5','error','definition-shape','Workflow definition must be an object.',key,path)
            return
        if definition.get('id') != key[1] or str(definition.get('version')) != key[2]:
            self.add('R2','error','definition-mismatch','Definition id/version differs from manifest.',key,path)
        schema=definition.get('schema')
        new=schema in ('ai-workflow-definition/v2','ai-workflow-definition/v3')
        if schema not in (None,'ai-workflow-definition/v1','ai-workflow-definition/v2','ai-workflow-definition/v3'):
            self.add('R5','error','definition-schema','Unsupported definition schema.',key,path)
            return
        if schema=='ai-workflow-definition/v3':
            # 3.1-A F-3 guards for the scenario generation (C-1 / C-2 / C-4).
            stage_ids=[s.get('id') for s in definition.get('stages',[]) if isinstance(s,dict)]
            default=definition.get('defaultScenario')
            if not isinstance(default,str) or not default:
                self.add('R5','error','scenario-default-missing',
                         'A v3 definition must declare a non-empty `defaultScenario`; an omitted scenario '
                         'parameter may never be guessed from the request.',key,path)
            required=definition.get('requiredStages')
            if not isinstance(required,list):
                self.add('R5','error','required-stages-missing',
                         'A v3 definition must declare `requiredStages` (possibly empty) so that a '
                         'scenario cannot silently drop a mandatory stage.',key,path)
            else:
                for sid in required:
                    if sid not in stage_ids:
                        self.add('R5','error','required-stage-unknown',
                                 '`requiredStages` names a stage that is not in the stage list: '+str(sid),key,path)
            scenarios=definition.get('scenarios')
            if not isinstance(scenarios,dict) or not scenarios:
                self.add('R5','error','scenario-map-missing',
                         'A v3 definition must carry a non-empty `scenarios` map.',key,path)
            else:
                if isinstance(default,str) and default and default not in scenarios:
                    self.add('R5','error','scenario-default-unknown',
                             '`defaultScenario` names a scenario absent from `scenarios`: '+default,key,path)
                for name,body in sorted(scenarios.items()):
                    if not isinstance(body,dict):
                        self.add('R5','error','scenario-shape','Each scenario must be an object.',key,path)
                        continue
                    for field in ('add','replace','remove','order','gates','skills','defaults'):
                        for value in (body.get(field) or []) if isinstance(body.get(field),(list,dict)) else []:
                            pass
                    for ref in (body.get('skills') or []):
                        ref_id=ref.split('@')[0] if isinstance(ref,str) else None
                        if not ref_id or ref_id not in self.registered.get('skill',{}):
                            self.add('R5','error','scenario-skill-ghost',
                                     'Scenario "'+str(name)+'" references a skill that is not registered: '+str(ref),key,path)
                        elif '@' not in str(ref) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',str(ref).split('@')[-1]):
                            self.add('R5','error','scenario-skill-unpinned',
                                     'Scenario "'+str(name)+'" must pin an exact skill version (skill@semver): '+str(ref),key,path)
                    for sid in (body.get('remove') or []):
                        if sid in (required or []):
                            self.add('R5','error','scenario-drops-required-stage',
                                     'Scenario "'+str(name)+'" removes a mandatory stage: '+str(sid),key,path)
        if schema is None and definition.get('mode') not in ('prompt','executable-with-evidence'):
            self.add('R5','error','legacy-definition','Unrecognized legacy workflow format.',key,path)
        if new:
            try:
                # T-P4: v3 has its own contract, derived from the v2 file so a stage item means the
                # same thing in both generations. 0.5.0's interim stripped the three new keys and
                # re-labelled the document as v2, which let a malformed scenario block pass schema
                # validation; that path is gone. Cross-key rules (a scenario naming a stage, skill or
                # gate that does not exist) stay in the R5 guards, where JSON Schema cannot reach.
                contract_file = ('workflow-definition-v3.schema.json'
                                 if schema == 'ai-workflow-definition/v3'
                                 else 'workflow-definition-v2.schema.json')
                contract=read_json(Path(__file__).resolve().parents[1]/'schemas'/contract_file)
                payload = dict(definition)
                jsonschema.Draft202012Validator(contract).validate(payload)
            except (OSError,ValueError,jsonschema.ValidationError,jsonschema.SchemaError):
                self.add('R5','error','definition-contract','New definition does not satisfy the v2 contract.',key,path)
                return
            if definition.get('mode') != manifest.get('mode'):
                self.add('R5','error','mode-mismatch','Manifest and definition modes must agree.',key,path)
        else:
            self.add('R5','info','legacy-definition','Supported legacy definition is inspected without assuming runner capability.',key,path)
        self.note_extension(definition,key,path)
        stages=definition.get('stages')
        if not isinstance(stages,list) or not stages:
            self.add('R5','error','missing-stages','Definition requires a nonempty stages array.',key,path)
            return
        ids=[]
        graph={}
        for stage in stages:
            if not isinstance(stage,dict) or not isinstance(stage.get('id'),str):
                self.add('R5','error','stage-shape','Stage requires a string id.',key,path)
                continue
            sid=stage['id'];ids.append(sid)
            deps=stage.get('dependsOn',[])
            if not isinstance(deps,list) or not all(isinstance(d,str) for d in deps):
                self.add('R5','error','dependency-shape','Stage dependencies must be string ids.',key,path)
                deps=[]
            graph[sid]=deps
            if new:
                worker=stage.get('worker')
                roles=definition.get('roles',[])
                if worker != 'none' and worker not in roles and worker not in self.registered['agent']:
                    self.add('R6','error','unknown-worker','Worker is not a declared role or registered Agent.',key,path)
                action=stage.get('action')
                if action=='script':
                    self.path(release,stage.get('script'),'R7',key)
                elif action=='prompt':
                    self.prompt_ref(release,stage.get('promptRef'),key)
                elif action=='peer-agent':
                    self.peer_stage(stage,key,path)
                elif action=='subworkflow':
                    self.subworkflow_stage(stage,key,path)
                elif action=='software-call':
                    self.software_stage(stage,key,path)
                elif action not in {'script','prompt'}:
                    self.add('R7','error','unknown-action','Action is not supported by the Phase 0 contract.',key,path)
                for field in ['inputs','outputs']:
                    if field in stage: self.schema_file(release,stage[field],key)
                if stage.get('onFail')=='repair' and not (stage.get('repairScript') or stage.get('repairPromptRef')):
                    self.add('R8','error','missing-repair','Repair requires a bounded implementation entry.',key,path)
                if stage.get('repairScript'):self.path(release,stage['repairScript'],'R8',key)
                if stage.get('repairPromptRef'):self.prompt_ref(release,stage['repairPromptRef'],key)
                for gate in stage.get('gates',[]):
                    declarations=definition.get('gateDefinitions',{})
                    if not declarations.get(gate):
                        self.add('R8','error','missing-gate','Required gate has no versioned local definition.',key,path)
                    elif (release/'tests'/'contract.json').is_file():
                        self.add('R8','info','gate-execution-evidenced','Gate execution is evidenced by the release contract test (tests/contract.json); runtime capability still depends on the runner.',key,path)
                    else:
                        self.add('R8','warning','gate-unverified','Gate declaration exists; actual execution capability is not validated by lint.',key,path)
            elif not stage.get('workers'):
                self.add('R6','warning','legacy-empty-workers','Legacy stage has no worker binding; no execution semantics are inferred.',key,path)
        if len(set(ids))!=len(ids):self.add('R5','error','duplicate-stage','Stage ids are not unique.',key,path)
        active=set();done=set()
        def visit(sid):
            if sid in active:
                self.add('R5','error','stage-cycle','Stage graph contains a cycle.',key,path);return
            if sid in done:return
            active.add(sid)
            for dep in graph.get(sid,[]):
                if dep not in graph:self.add('R5','error','missing-stage-dependency','Stage dependency does not exist.',key,path)
                else:visit(dep)
            active.discard(sid);done.add(sid)
        for sid in graph:visit(sid)
        self.dependency_sections(definition.get('requires'),key)

    def software_stage(self,stage,key,path):
        """3.0 R7: a software-call stage names a recipe and one of its capabilities, maps its
        arguments by name, and carries neither a script nor a prompt. The gate chain that decides
        whether the platform may actually run it lives in the engine, not here."""
        software=stage.get('software')
        if not isinstance(software,str) or not ID.fullmatch(software):
            self.add('R7','error','software-target','software-call stage must name one software recipe id.',key,path)
        capability=stage.get('capability')
        if not isinstance(capability,str) or not ID.fullmatch(capability):
            self.add('R7','error','software-capability','software-call stage must name one capability of that recipe.',key,path)
        if stage.get('script') or stage.get('promptRef'):
            self.add('R7','error','software-mixed-entry','software-call stage carries neither a script nor a prompt reference.',key,path)
        arguments=stage.get('arguments') or {}
        if not isinstance(arguments,dict):
            self.add('R7','error','software-arguments','software-call arguments must be a mapping.',key,path)
            return
        if 'argv' in arguments:
            self.add('R7','error','software-argv','software-call arguments are mapped by name, never as argv.',key,path)
        for name,value in sorted(arguments.items()):
            if name=='timeoutSeconds':
                continue
            if not isinstance(name,str) or not ID.fullmatch(name) or not isinstance(value,str) or not ID.fullmatch(value):
                self.add('R7','error','software-argument-mapping',
                         'software-call argument mapping is parameter name -> capability argument name.',key,path)
        boundary=stage.get('externalBoundary')
        if boundary is not None:
            if not isinstance(boundary,dict) or not boundary or set(boundary)-{'hosts','ports','pathRoots'}:
                self.add('R7','error','software-boundary','externalBoundary declares hosts, ports or pathRoots only.',key,path)
            else:
                for dimension,values in sorted(boundary.items()):
                    if not isinstance(values,list) or not values or any(not values[0] or (isinstance(values[0],str) and ('*' in values[0] or values[0]=='0.0.0.0/0')) for value in values):
                        self.add('R7','error','software-boundary-unbounded',
                                 'an unbounded value is not a boundary declaration: '+dimension,key,path)

    def peer_stage(self,stage,key,path):
        peers=stage.get('peers')
        if not isinstance(peers,list) or not peers or not all(isinstance(item,str) and ID.fullmatch(item) for item in peers):
            self.add('R7','error','peer-list','peer-agent stage requires a nonempty peers array of Agent ids.',key,path)
            peers=[]
        if stage.get('worker')!='none':
            self.add('R7','error','peer-worker','peer-agent stage must declare worker: none; the peer runs under its own lock.',key,path)
        if not stage.get('outputs'):
            self.add('R7','error','missing-aggregate-outputs','peer-agent stage requires an aggregate outputs schema.',key,path)
        self.resources[key].setdefault('peerStages',[]).append(dict(stage=stage.get('id'),peers=list(peers)))
        for peer in peers:
            if peer not in self.registered['agent']:
                self.add('R7','warning','peer-unregistered','Declared peer is not an enabled Agent release: '+peer,key,path)
        self.add('R7','warning','peer-stage-registered','peer-agent syntax is accepted conditionally; execution needs a platform capability declaration and future engine support.',key,path)

    def subworkflow_stage(self,stage,key,path):
        target=stage.get('subworkflow')
        if not isinstance(target,dict) or not isinstance(target.get('id'),str) or not isinstance(target.get('version'),str):
            self.add('R7','error','subworkflow-shape','subworkflow stage requires an explicit {id, version}.',key,path)
            return
        if not ID.fullmatch(target['id']) or not valid_version(target['version']):
            self.add('R7','error','subworkflow-shape','subworkflow id/version must be an exact resource id and semantic version.',key,path)
            return
        try:
            child=safe_path(self.base('workflow',target['id']),'versions/'+target['version'])
        except (OSError,ValueError):
            self.add('R7','error','subworkflow-unresolved','subworkflow target path is invalid or traverses a link.',key,path)
            return
        if not child.is_dir():
            self.add('R7','error','subworkflow-unresolved','subworkflow version cannot be resolved from the shared repository.',key,path)
        else:
            self.dependency(key,'workflow',target['id'],target['version'])
        if stage.get('worker')!='none':
            self.add('R7','error','subworkflow-worker','subworkflow stage must declare worker: none.',key,path)
        if not stage.get('outputs'):
            self.add('R7','error','missing-aggregate-outputs','subworkflow stage requires an aggregate outputs schema.',key,path)
        self.add('R7','warning','subworkflow-stage-registered','subworkflow syntax is accepted conditionally; execution needs future engine support.',key,path)

    def check_peer_coverage(self):
        for key,record in sorted(self.resources.items()):
            if key[0]!='agent':continue
            locked=record.get('lockedWorkflows')
            if not locked:continue
            covered=record.get('peerLockEntries')
            for _,child,child_version in locked:
                target=self.resources.get(('workflow',child,child_version))
                if not target:continue
                for stage in target.get('peerStages',[]):
                    for peer in stage['peers']:
                        if covered is None:
                            self.add('R7','error','peer-not-covered','Agent mode requires an R14 peerLock covering the peer-agent stages of its locked Workflows.',key)
                        elif peer not in covered:
                            self.add('R7','error','peer-not-covered','Agent peerLock does not cover a peer declared by its locked Workflow: '+peer,key)

    def prompt_ref(self,release,ref,key):
        if not isinstance(ref,str) or '#stage:' not in ref:
            self.add('R7','error','prompt-reference','Prompt reference requires file#stage:ID.',key,release);return
        filename,anchor=ref.split('#stage:',1)
        path=self.path(release,filename,'R7',key)
        if not path:return
        try:text=path.read_text(encoding='utf-8-sig')
        except (OSError,UnicodeError):
            self.add('R7','error','prompt-unreadable','Prompt file cannot be read.',key,path);return
        tokens=re.findall(r'<!--\s*(/?)stage:([A-Za-z0-9_-]+)\s*-->',text)
        open_id=None;seen=set();valid=True
        for closing,ident in tokens:
            if closing:
                if open_id != ident:valid=False
                open_id=None
            else:
                if open_id or ident in seen:valid=False
                open_id=ident;seen.add(ident)
        if open_id or anchor not in seen or not valid:
            self.add('R7','error','prompt-anchor','Prompt anchors are missing, duplicated, nested or unbalanced.',key,path)

    def release(self, kind, ident, version):
        key=(kind,ident,version)
        if key in self.active:
            self.add('R12','error','resource-cycle','Dependency graph contains a resource cycle.',key)
            return
        if key in self.resources:return
        self.resources[key]=dict(kind=kind,id=ident,version=version,path='',manifestSchema=None)
        if not valid_version(version):
            self.add('R2','error','invalid-version','Resource version must be exact semantic version.',key);return
        try:release=safe_path(self.base(kind,ident),'versions/'+version)
        except (OSError,ValueError):
            self.add('R2','error','unsafe-release','Release path is invalid or traverses a link.',key);return
        self.resources[key]['path']=str(release)
        path=self.path(release,'manifest.json','R4',key)
        manifest=self.load(path,'R4',key) if path else None
        if not isinstance(manifest,dict):return
        self.note_extension(manifest,key,path)
        self.active.add(key)
        try:
            self.resources[key]['manifestSchema']=manifest.get('schema')
            if manifest.get('schema') not in SCHEMAS[kind]:self.add('R4','error','manifest-schema','Unsupported resource manifest schema.',key,path)
            if manifest.get('schema')=='ai-workflow/v2.1':
                contract=read_json(Path(__file__).resolve().parents[1]/'schemas'/'manifest-v2.1.schema.json')
                errors=list(jsonschema.Draft202012Validator(contract).iter_errors(manifest))
                if errors:
                    self.add('R4','error','manifest-contract','New manifest does not satisfy the v2.1 contract.',key,path)
                    return
                if 'runtime' in manifest:
                    self.path(release,manifest['runtime']['entry'],'R4',key)
                    self.path(release,manifest['runtime']['environmentLock'],'R4',key)
            if manifest.get('id') != ident or manifest.get('version') != version:self.add('R2','error','manifest-mismatch','Manifest id/version does not match requested release.',key,path)
            self.integrity(release,manifest,key)
            if kind=='workflow':
                for field in ['entry','inputSchema','outputSchema','permissions','dependencies']:
                    if field not in manifest:self.add('R4','error','missing-field','Required Workflow field is absent: '+field,key,path)
                for field in ['inputSchema','outputSchema']:
                    if field in manifest:self.schema_file(release,manifest[field],key)
                self.validate_definition(release,manifest,key)
                self.dependency_sections(manifest.get('dependencies'),key)
            elif kind=='agent':
                for field in ['prompt','toolLock','workflows']:
                    if field not in manifest:self.add('R4','error','missing-field','Required Agent field is absent: '+field,key,path)
                self.path(release,manifest.get('prompt'),'R4',key)
                policies=manifest.get('policies',[])
                if not isinstance(policies,list):
                    self.add('R4','error','policy-shape','Agent policies must be an array of labels or local file references.',key,path)
                else:
                    for policy in policies:
                        if not isinstance(policy,str) or not policy:
                            self.add('R4','error','policy-shape','Agent policy must be a nonempty string.',key,path)
                        elif ID.fullmatch(policy) and '.' not in policy:
                            self.add('R4','info','legacy-policy-label','Legacy policy label retained as a requirement, without claiming enforcement: '+policy,key,path)
                        else:self.path(release,policy,'R4',key)
                lock_path=self.path(release,manifest.get('toolLock'),'R12',key)
                lock=self.load(lock_path,'R12',key) if lock_path else None
                if not isinstance(lock,dict) or lock.get('schema') not in {'ai-tool-lock/v1','ai-tool-lock/v2'}:
                    self.add('R12','error','tool-lock-schema','Agent requires a supported exact tool lock.',key,lock_path)
                else:
                    locked=dict(self.entries(lock.get('workflows'),key,'workflows'))
                    self.resources[key]['lockedWorkflows']=[['workflow',child,child_version] for child,child_version in locked.items()]
                    self.resources[key]['allowedDependencies'] = [list((kind,child,child_version)) for section,kind in KINDS.items() if section != 'agents' for child,child_version in self.entries(lock.get(section),key,section)]
                    declared=manifest.get('workflows',[])
                    if isinstance(declared,dict):declared=list(declared)
                    if not isinstance(declared,list) or not all(isinstance(item,str) and item in locked for item in declared):
                        self.add('R12','error','workflow-not-locked','Agent manifest Workflow declarations are not covered by tool-lock.',key,path)
                    self.dependency_sections(lock,key)
                    if lock.get('profiles'):self.add('R12','warning','profile-selection-required','Profiles need explicit runtime selection and conflict validation; lint does not select one.',key,lock_path)
                    if not manifest.get('runnerWorkflow') and ident not in locked:
                        self.add('R12','warning','agent-without-main-workflow','Agent declares no runnerWorkflow and locks no same-named workflow, so runner mode cannot select a main workflow.',key,path)
                    for profile,value in sorted((lock.get('profiles') or {}).items()):
                        if SUPPORTED_PROFILES.get(profile) != value:
                            self.add('R12','warning','agent-profile-unsupported','Locked profile is not honoured declaratively by the pinned runner: '+str(profile)+'='+str(value)+'.',key,lock_path)
                    for child,child_version in sorted(locked.items()):
                        pointer_path=self.base('workflow',child)/'current.json'
                        shared=self.load(pointer_path,'R12',key) if pointer_path.is_file() else None
                        if isinstance(shared,dict) and shared.get('version') and shared['version'] != child_version:
                            self.add('R12','warning','lock-lag','Agent pins '+child+' at '+str(child_version)+' while the shared default is '+str(shared['version'])+'.',key,lock_path)
                if manifest.get('peerLock'):
                    peer_path=self.path(release,manifest['peerLock'],'R14',key)
                    peer=self.load(peer_path,'R14',key) if peer_path else None
                    if not isinstance(peer,dict) or peer.get('schema')!='ai-peer-lock/v1' or not isinstance(peer.get('peers'),dict):
                        self.add('R14','error','peer-lock-schema','Peer lock schema is invalid.',key,peer_path)
                    else:
                        entries=list(self.entries(peer['peers'],key,'peers'))
                        self.resources[key]['peerLockEntries']={child:child_version for child,child_version in entries}
                        for child,child_version in entries:self.dependency(key,'agent',child,child_version)
                    self.add('R14','warning','peer-capability-unverified','Peer execution remains disabled until platform capability is tested.',key,peer_path)
            elif kind=='skill':
                self.path(release,manifest.get('entry'),'R4',key)
                self.dependency_sections(manifest.get('dependencies'),key)
                if manifest.get('requires'):self.add('R12','info','skill-requires','Skill requirements need a separately pinned platform environment.',key,path)
            else:
                ids=manifest.get('skillIds',[])
                versions=manifest.get('skillVersions',{})
                if not isinstance(ids,list) or not isinstance(versions,dict):
                    self.add('R12','error','pack-shape','Pack skillIds/skillVersions are invalid.',key,path)
                else:
                    self.resources[key]['selectorIds'] = [item for item in ids if isinstance(item,str)]
                    for child in ids:
                        if not isinstance(child,str) or child not in self.registered['skill']:
                            self.add('R12','error','pack-skill-missing','Pack references an unregistered Skill.',key,path);continue
                        child_version=versions.get(child)
                        if not child_version:
                            self.add('R12','warning','pack-selector-unpinned','Legacy Pack selects Skill ids without exact versions; a consuming lock must supply versions.',key,path)
                        elif valid_version(child_version):self.dependency(key,'skill',child,child_version)
                        else:self.add('R12','error','unlocked-dependency','Pack Skill version is not exact semantic version.',key,path)
                self.resources[key]['conflicts']=manifest.get('conflicts',[])
        except (TypeError,ValueError,AttributeError,RecursionError,OSError) as error:
            self.add('R4','error','invalid-resource-structure','Resource metadata cannot be safely interpreted: '+type(error).__name__,key,path)
        finally:self.active.discard(key)

    def closure(self,key):
        seen=set();todo=[key]
        while todo:
            item=todo.pop()
            if item in seen:continue
            seen.add(item);todo.extend(self.edges.get(item,[]))
        return seen

    def check_closures(self):
        for root in list(self.resources):
            if root[0] not in {'agent','workflow'}:continue
            closure=self.closure(root)
            groups={}
            for kind,ident,version in closure:groups.setdefault((kind,ident),set()).add(version)
            if any(len(versions)>1 for versions in groups.values()):self.add('R12','error','version-conflict','Dependency closure selects conflicting versions of one resource.',root)
            if root[0]=='agent':
                allowed={tuple(item) for item in self.resources[root].get('allowedDependencies',[])}
                if any(item[0] in {'workflow','skill','pack'} and item not in allowed for item in closure):
                    self.add('R12','error','closure-not-authorized','A transitive resource is not authorized by the consuming Agent exact tool-lock.',root)
            pack_ids={ident for kind,ident,version in closure if kind=='pack'}
            for key in closure:
                conflicts=self.resources.get(key,{}).get('conflicts',[])
                if isinstance(conflicts,list) and any(c in pack_ids for c in conflicts if isinstance(c,str)):
                    self.add('R12','error','pack-conflict','Selected Pack closure contains explicitly conflicting Packs.',root)
                for selector in self.resources.get(key,{}).get('selectorIds',[]):
                    if ('skill',selector) not in groups:
                        self.add('R12','error','pack-selector-not-locked','Selected Pack Skill selector has no exact version in the consuming dependency closure: '+selector,root)

    def governance(self):
        for root in [self.tool,self.agent]:
            try:safe_path(root,'registry.json')
            except (ValueError,OSError,RuntimeError):continue
            if not root.is_dir():continue
            for entry in sorted(root.iterdir()):
                if not entry.is_dir() or reparse(entry):continue
                if entry.name=='_registry':
                    for file in entry.iterdir():
                        if file.is_file() and file.suffix.lower() in EXEC_SUFFIXES:self.add('R10','warning','metadata-script','Historical metadata script is classified only; it is not executed.',path=file)
                elif entry.name=='_sources':
                    self.add('R10','info','source-snapshots','Source snapshots are classified separately; their content is not executed or release-audited.',path=entry)
                elif (entry/'current.json').is_file():
                    extras=[p for p in entry.iterdir() if p.name not in {'versions','current.json'}]
                    if extras:self.add('R10','warning','unversioned-root-items','Resource has '+str(len(extras))+' unversioned root items; references and ownership need review.',path=entry)

    def run(self):
        self.discover()
        for (kind,ident),version in sorted(self.current.items()):self.release(kind,ident,version)
        if self.bridge:
            config=self.load(self.bridge,'R1')
            section=config.get('defaults',{}) if isinstance(config,dict) else {}
            defaults=section.get('agentVersions',{}) if isinstance(section,dict) else None
            if isinstance(defaults,dict):
                for ident,version in defaults.items():
                    if ident in self.registered['agent'] and valid_version(version):
                        self.release('agent',ident,version)
                        self.add('R13','info','platform-default','Explicit platform default is tracked independently of shared current.',('agent',ident,version),self.bridge)
                    else:self.add('R13','error','invalid-platform-default','Platform default must identify a registered exact Agent release.',path=self.bridge)
            else:self.add('R13','error','invalid-platform-default','Platform defaults must be an object.',path=self.bridge)
            peer_workflows=[key for key,record in self.resources.items() if record.get('peerStages')]
            if peer_workflows:
                capabilities=config.get('capabilities') if isinstance(config,dict) else None
                checks=config.get('checks') if isinstance(config,dict) else None
                declared=(isinstance(capabilities,dict) and capabilities.get('peerDispatch') is True) or \
                         (isinstance(checks,dict) and checks.get('peerDispatch') is True)
                if not declared:
                    for key in peer_workflows:
                        self.add('R7','error','peer-capability-undeclared','Peer delegation needs an explicit peerDispatch capability declaration in the supplied platform configuration.',key,self.bridge)
        selected=None
        if self.select:
            match=re.fullmatch(r'(workflow|agent|skill|pack):([a-z0-9][a-z0-9._-]*)@(.+)',self.select)
            if match and valid_version(match[3]) and match[2] in self.registered[match[1]]:
                selected=(match[1],match[2],match[3]);self.release(*selected)
            else:self.add('R1','error','invalid-selection','Selection must name an enabled resource and exact version.')
        self.check_extensions();self.check_peer_coverage();self.check_closures();self.governance()
        closure=self.closure(selected) if selected else set(self.resources)
        # 3.1-A F-3 (T-P2): R2 definition/id-version drift is ALWAYS a blocker, selected or not.
        # Historically it only bit when a release was explicitly selected, which is exactly how the
        # 0.7.0..0.7.7 self-declared-version drift stayed invisible for a whole generation (D-66 family).
        blockers=[f for f in self.findings if f['severity']=='error' and
                  (f['rule']=='R2' or not selected or f['kind']=='repository'
                   or (f['kind'],f['id'],f['version']) in closure
                   or (not f['version'] and any(k==f['kind'] and i==f['id'] for k,i,v in closure)))]
        counts=Counter(f['severity'] for f in self.findings)
        exit_code=1 if blockers else 2 if counts['warning'] else 0
        return dict(schema='ai-repo-lint-report/v1',version=VERSION,generatedAt=datetime.now(timezone.utc).isoformat(),
                    roots=dict(tool=str(self.tool),agent=str(self.agent)),selection=self.select,
                    summary=dict(errors=counts['error'],warnings=counts['warning'],infos=counts['info'],
                                 resourceCount=len(self.resources),checkedFiles=self.checked_files,catalogCount=self.catalog_count,
                                 registeredCounts={k:len(v) for k,v in self.registered.items()},exitCode=exit_code),
                    decision=dict(scope='selection' if self.select else 'inventory',status='blocked' if blockers else 'static-pass',
                                  runtimeStatus='not-validated',blockingFindings=blockers),
                    coverage=dict(releases='enabled current releases, exact dependencies, requested explicit release and supplied platform defaults',
                                  historicalVersions='not exhaustive',sourceSnapshots='classified only',execution='none',
                                  pointers='loaded once before dependency traversal'),
                    resources=[self.resources[k] for k in sorted(self.resources)],findings=self.findings)


def software_lint_merge(report: dict, findings: list) -> dict:
    """Fold a companion linter's findings into the same report and decision (no parallel surface)."""
    counts_key = {'error': 'errors', 'warning': 'warnings', 'info': 'infos'}
    for finding in findings:
        if finding not in report['findings']:
            report['findings'].append(finding)
            report['summary'][counts_key[finding['severity']]] += 1
    blockers = [f for f in findings if f['severity'] == 'error']
    for f in blockers:
        if f not in report['decision']['blockingFindings']:
            report['decision']['blockingFindings'].append(f)
    if blockers:
        report['decision']['status'] = 'blocked'
        report['summary']['exitCode'] = 1
    elif report['summary']['warnings'] and report['summary']['exitCode'] == 0:
        report['summary']['exitCode'] = 2
    return report


def check_new_release(report: dict, args) -> None:
    """F-3: a release that is being staged must carry SOURCE.json and agree with its own bytes."""
    m = re.fullmatch(r'(workflow|agent|skill|pack):([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+)',
                     args.new_release or '')
    finding = None
    if not m:
        finding = dict(rule='R16', severity='error', code='new-release-selector', kind='repository',
                       id='', version='', path='', message='--new-release must name kind:id@exact-semver.')
    else:
        kind, ident, version = m.group(1), m.group(2), m.group(3)
        root = args.agent_root if kind == 'agent' else args.tool_root
        folder = {'workflow': '', 'agent': '', 'skill': 'skills/', 'pack': 'packs/'}.get(kind, '')
        release = root / (folder + ident) / 'versions' / version
        for name, code in (('SOURCE.json', 'new-release-source-missing'),
                          ('SHA256SUMS', 'new-release-manifest-missing')):
            if not (release / name).is_file():
                finding = dict(rule='R16', severity='error', code=code, kind=kind, id=ident, version=version,
                               path=str(release / name),
                               message='A staged release must carry ' + name + ' (provenance and two-way seal).')
                break
        if finding is None:
            try:
                manifest = read_json(release / 'manifest.json')
                if manifest.get('id') != ident or manifest.get('version') != version:
                    finding = dict(rule='R2', severity='error', code='new-release-manifest-mismatch', kind=kind,
                                   id=ident, version=version, path=str(release / 'manifest.json'),
                                   message='Staged release manifest id/version differs from the selector.')
            except (OSError, ValueError, RecursionError):
                finding = dict(rule='R2', severity='error', code='new-release-manifest-unreadable', kind=kind,
                               id=ident, version=version, path=str(release / 'manifest.json'),
                               message='Staged release manifest cannot be read.')
    if finding:
        report['findings'].append(finding)
        report['summary']['errors'] += 1
        report['decision']['blockingFindings'].append(finding)
        report['decision']['status'] = 'blocked'
        report['summary']['exitCode'] = 1


def scan(tool_root: Path, agent_root: Path, select: Optional[str]=None, bridge: Optional[Path]=None):
    return Scanner(tool_root,agent_root,select,bridge).run()


def markdown(report):
    summary=report['summary']
    lines=['# Repository Health Report','',f"Generated: {report['generatedAt']}",'',
           f"Resources: {summary['resourceCount']}; hashed files: {summary['checkedFiles']}; errors: {summary['errors']}; warnings: {summary['warnings']}.",'',
           f"Static decision: {report['decision']['status']}. Runtime capability: not validated. No resource code was executed.",'',
           '| Rule | Severity | Resource | Code | Path |','|---|---|---|---|---|']
    for f in report['findings']:
        values=[f['rule'],f['severity'],f"{f['kind']}:{f['id']}@{f['version']}",f['code'],f['path']]
        lines.append('| '+' | '.join(str(v).replace('|','\\|').replace('\n',' ') for v in values)+' |')
    return '\n'.join(lines)+'\n'




def canonical(value):
    return str(Path(value)).replace('\\', '/').rstrip('/')


def root_parts(value):
    return [part for part in canonical(value).split('/') if part]


def snapshot_root(value, expected):
    parts = root_parts(value)
    return len(parts) >= 3 and parts[-1] == expected and parts[-2] == 'snapshot' and parts[-3] == 'work'


def write_probe(root):
    """D04 enforcement probe: the platform-declared shared mounts must be read-only.
    A successful write means the bind is not read-only -> blocking violation."""
    probe = Path(root) / '.repo-lint-write-probe'
    try:
        with probe.open('x', encoding='utf-8') as stream:
            stream.write('probe')
    except FileExistsError:
        return 'violation-stale-probe'
    except OSError:
        return 'denied'
    try:
        probe.unlink()
    except OSError:
        pass
    return 'violation-writable'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tool-root',type=Path,required=True)
    parser.add_argument('--agent-root',type=Path,required=True)
    parser.add_argument('--software-root',type=Path)
    parser.add_argument('--software-new-release',action='store_true')
    parser.add_argument('--governance-root',type=Path,
                        help='Governance repository root; enables the R16 restatement-vs-authority check (D-66).')
    parser.add_argument('--new-release',
                        help='kind:id@version of a release being staged; it must carry SOURCE.json (F-3).')
    parser.add_argument('--select')
    parser.add_argument('--bridge',type=Path)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--markdown',type=Path)
    parser.add_argument('--scope',choices=['live','snapshot'],required=True)
    args=parser.parse_args()
    outputs=[p for p in [args.report,args.markdown] if p]
    if len({str(p.resolve()).casefold() for p in outputs}) != len(outputs):
        parser.error('Report outputs must be distinct physical paths')
    for output in outputs:
        if any(inside(output,root) for root in [args.tool_root,args.agent_root,args.software_root] if root):
            parser.error('Reports must be outside the inspected shared repositories')
        if output.exists():parser.error('Refusing to overwrite an existing report')
    if args.scope=='live':
        if canonical(args.tool_root)!='/shared/tool' or canonical(args.agent_root)!='/shared/agent' or (
                args.software_root and canonical(args.software_root)!='/shared/software'):
            parser.error("live scope requires the platform's read-only jail mounts for every root it is "
                         "given: /shared/tool, /shared/agent and, when a software root is passed, "
                         "/shared/software (D04 declaration; BP-1: one binding set for all three roots)")
    else:
        if canonical(args.tool_root)=='/shared/tool' or canonical(args.agent_root)=='/shared/agent':
            parser.error("snapshot scope cannot point at the live jail shared mounts; use scope=live")
    probes={'tool':write_probe(args.tool_root),'agent':write_probe(args.agent_root)} if args.scope=='live' else {}
    report=scan(args.tool_root,args.agent_root,args.select,args.bridge)
    if args.governance_root:
        # 3.1-A F-3 (T-P2, D-66): the five restatements must not drift from the authority block.
        import governance_lint
        report = software_lint_merge(report, governance_lint.lint_governance(args.governance_root))
    if args.new_release:
        check_new_release(report, args)
    if args.software_root:
        # 3.0 S-P3a: the third shared repository joins the same decision, not a parallel one.
        import software_lint
        report = software_lint.merge(report, software_lint.lint_software_root(
            args.software_root, new_release=args.software_new_release), args.software_root)
    report['scope']=args.scope
    report['processExitPolicy']='blockers-only'
    report['sharedWriteProbe']=dict(applied=args.scope=='live',**probes)
    for name,probe_result in probes.items():
        if str(probe_result).startswith('violation'):
            finding=dict(rule='R1',severity='error',code='shared-write-enabled',kind='repository',id='',version='',
                         path='/shared/'+name,message='Declared read-only shared mount accepted a write probe ('+str(probe_result)+'); D04 read-only enforcement failed.')
            if finding not in report['findings']:
                report['findings'].append(finding);report['summary']['errors']+=1
            if finding not in report['decision']['blockingFindings']:
                report['decision']['blockingFindings'].append(finding)
            report['decision']['status']='blocked';report['summary']['exitCode']=1
    for output in outputs:output.parent.mkdir(parents=True,exist_ok=True)
    with args.report.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2);stream.write('\n')
    if args.markdown:
        with args.markdown.open('x',encoding='utf-8') as stream:stream.write(markdown(report))
    print(json.dumps(dict(report=str(args.report),summary=report['summary'],decision=report['decision']['status'],scope=report['scope'])))
    # 0.3.0 executable-via-runner policy: only blockers fail the process; warnings
    # remain report data (classic exitCode 0/1/2 is preserved in summary.exitCode).
    return 1 if report['summary']['exitCode']==1 else 0


if __name__=='__main__':
    raise SystemExit(main())
