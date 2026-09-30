"""Phase 1 serial prepare/next/submit/status/stop implementation; 3.0 adds the software-call action."""
import copy
import json
import os
from pathlib import Path
import re
import shutil

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

import hashlib
import gate_exec
import software_gate
from permissions import PermissionDenied, effective as effective_permissions
from resolution import Resolver, source
from runtime_core import Contracts, Rejected, Store, event_for, file_hash, load_module, now, record, relative_path, unlinked, verify_files, write_bytes


TERMINAL = {"succeeded", "failed", "stopped"}


def local_schema(c, root, reference, value):
    path = relative_path(root, reference)
    schema = c.lint.read_json(path)
    resources = []
    todo, seen = [path], set()
    while todo:
        item = todo.pop()
        if item in seen:
            continue
        seen.add(item)
        document = c.lint.read_json(item)
        Draft202012Validator.check_schema(document)
        resources.append((item.as_uri(), Resource.from_contents(document, default_specification=__import__('referencing.jsonschema', fromlist=['DRAFT202012']).DRAFT202012)))
        def refs(node):
            if isinstance(node, dict):
                if '$ref' in node and not node['$ref'].startswith('#'):
                    target = node['$ref'].partition('#')[0]
                    todo.append(relative_path(item.parent, target))
                for child in node.values():
                    refs(child)
            elif isinstance(node, list):
                for child in node:
                    refs(child)
        refs(document)
    registry = Registry().with_resources(resources)
    Draft202012Validator(schema, registry=registry, _resolver=registry.resolver(path.as_uri()), format_checker=FormatChecker()).validate(value)


def render_stage_arguments(root, stage, mapping, parameters, lint):
    """⑤ Render a declarative argument mapping (name -> CLI flag) into a literal argv list.

    The mapping keys name properties of the stage's own input schema; a key is emitted only
    when the parameter is present. The form is limited to the entry stage, whose input is the
    prepared parameter set -- a later stage's input is an upstream artifact and therefore not
    knowable at compile time, so those stages keep the literal argv form.
    """
    if stage.get('dependsOn'):
        raise Rejected('INVALID_REQUEST', 'Declarative arguments are only supported on the entry stage')
    inputs = stage.get('inputs')
    if not inputs:
        raise Rejected('INVALID_REQUEST', 'Declarative arguments require a stage input schema')
    schema = lint.read_json(relative_path(root, inputs))
    properties = schema.get('properties') or {}
    for name, flag in sorted(mapping.items()):
        if name not in properties:
            raise Rejected('INVALID_REQUEST', 'Unknown argument mapping key: ' + str(name))
        if not isinstance(flag, str) or not flag.startswith('-') or ' ' in flag:
            raise Rejected('INVALID_REQUEST', 'Argument mapping value must be a CLI flag: ' + str(name))
    argv = []
    for name, flag in sorted(mapping.items()):
        if name not in parameters:
            continue
        value = parameters[name]
        if isinstance(value, bool):
            if value:
                argv.append(flag)
        elif value is None:
            continue
        elif isinstance(value, list):
            argv.append(flag)
            argv += [str(item) for item in value]
        else:
            argv += [flag, str(value)]
    return argv


def render_software_arguments(root, stage, mapping, parameters, lint):
    """3.0 §6.1: render a declarative mapping (run parameter -> capability argument name).

    Same discipline as the script form: the keys must be properties of this stage's own input
    schema, and a parameter that is absent is simply not sent. Unlike a CLI argv, the value
    here is a name, so the capability's input schema (gate 6) is what judges the types.
    """
    if stage.get('dependsOn'):
        raise Rejected('INVALID_REQUEST', 'Declarative software arguments are only supported on the entry stage')
    inputs = stage.get('inputs')
    if not inputs:
        raise Rejected('INVALID_REQUEST', 'Declarative software arguments require a stage input schema')
    properties = lint.read_json(relative_path(root, inputs)).get('properties') or {}
    for name, argument in sorted(mapping.items()):
        if name not in properties:
            raise Rejected('INVALID_REQUEST', 'Unknown software argument mapping key: ' + str(name))
        if not isinstance(argument, str) or not re.match(r'^[A-Za-z0-9_.-]+$', argument):
            raise Rejected('INVALID_REQUEST', 'Software argument mapping value must be a name: ' + str(name))
    arguments = {}
    for name, argument in sorted(mapping.items()):
        if name not in parameters or parameters[name] is None:
            continue
        arguments[argument] = parameters[name]
    return arguments


SCENARIO_STAGE_FIELDS = ('id', 'action', 'worker', 'dependsOn', 'onFail', 'promptRef', 'repairPromptRef',
                        'script', 'repairScript', 'outputs', 'gates', 'software', 'capability',
                        'externalBoundary', 'arguments', 'maxIterations')


def expand_scenario(definition, scenario, declared_skills=None):
    """Apply one scenario to the base stage graph (F-2).

    A v2 document has no scenarios: it passes through untouched and answers scenario=None, so the
    expansion step cannot change what today's 113 releases compile to. `declared_skills` is the
    manifest's dependency set -- the same source the version pipes resolve from, so a scenario can
    only pick a skill this run already pins a version for.
    """
    base = copy.deepcopy(definition['stages'])
    required = list(definition.get('requiredStages') or [])
    if definition.get('schema') != 'ai-workflow-definition/v3':
        if scenario:
            raise Rejected('INVALID_REQUEST',
                           'This workflow declares no scenarios, so it accepts no scenario parameter: '
                           + str(scenario) + ' (definition schema: ' + str(definition.get('schema')) + ')')
        return base, {'scenario': None, 'requiredStages': required, 'skills': [], 'defaults': {}}
    scenarios = definition.get('scenarios') or {}
    name = scenario or definition.get('defaultScenario')
    if name is None:
        raise Rejected('INVALID_REQUEST', 'A v3 workflow must declare defaultScenario; refusing to invent one')
    if name not in scenarios:
        raise Rejected('INVALID_REQUEST', 'Unknown scenario "' + str(name) + '" for this workflow; declared '
                       'scenarios: ' + (', '.join(sorted(scenarios)) or '(none)'))
    body = scenarios[name] or {}
    stages = base
    by_id = {stage['id']: stage for stage in stages}
    for ident in (body.get('remove') or []):
        if ident in required:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" removes a mandatory stage: ' + str(ident))
        if ident not in by_id:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" removes an unknown stage: ' + str(ident))
        stages = [stage for stage in stages if stage['id'] != ident]
        by_id.pop(ident)
    for patch in (body.get('replace') or []):
        ident = patch.get('id')
        if ident not in by_id:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" replaces an unknown stage: ' + str(ident))
        if patch.get('dependsOn'):
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" cannot rewire dependsOn through '
                           'replace; add the stage and remove the old one so the DAG stays reviewable')
        merged = copy.deepcopy(by_id[ident])
        merged.update({key: value for key, value in copy.deepcopy(patch).items() if key != 'id'})
        by_id[ident] = merged
        stages = [merged if stage['id'] == ident else stage for stage in stages]
    for stage in (body.get('add') or []):
        ident = stage.get('id')
        if ident in by_id:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" adds a stage the workflow already '
                           'has: ' + str(ident))
        by_id[ident] = stage
        stages.append(copy.deepcopy(stage))
    for ident, gate_names in (body.get('gates') or {}).items():
        if ident not in by_id:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" sets gates on an unknown stage: '
                           + str(ident))
        by_id[ident]['gates'] = list(gate_names or [])
    order = body.get('order')
    if order:
        if sorted(order) != sorted(by_id) or len(order) != len(set(order)):
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" order is not a permutation of the '
                           'expanded stages: ' + ', '.join(sorted(set(by_id) ^ set(order))))
        slots = {stage['id']: stage for stage in stages}
        stages = [slots[ident] for ident in order]
    declared_skills = declared_skills or {}
    skills = []
    for reference in (body.get('skills') or []):
        ident = str(reference).split('@')[0]
        if ident not in declared_skills:
            raise Rejected('INVALID_REQUEST', 'Scenario "' + str(name) + '" selects a skill the workflow does '
                           'not declare: ' + str(reference) + ' (declared: '
                           + (', '.join(sorted(declared_skills)) or 'none') + ')')
        skills.append(ident)
    return stages, {'scenario': name, 'requiredStages': required, 'skills': sorted(set(skills)),
                    'defaults': copy.deepcopy(body.get('defaults') or {})}


def expanded_graph_hash(c, manifest, definition, meta):
    """A digest of the graph this run will actually execute, scenario included.

    It names promptRef targets and gate names, not just stage ids: the T-P1 structural diff over the
    12 game workflows showed stage sets that are near-identical while their prompt bodies and gate
    declarations differ, so an id-only digest would let two different scenarios collide on one hash
    -- which is exactly the silent version swap 红线 2 forbids.
    """
    rows = []
    for stage in definition['stages']:
        rows.append({key: copy.deepcopy(stage[key]) for key in SCENARIO_STAGE_FIELDS if key in stage})
    used = {gate for stage in definition['stages'] for gate in (stage.get('gates') or [])}
    gates = {name: {'type': (decl or {}).get('type'), 'schema': (decl or {}).get('schema')}
             for name, decl in (definition.get('gateDefinitions') or {}).items() if name in used}
    return c.hash({'kind': 'ai-expanded-graph/v1', 'workflow': str(manifest.get('id')) + '@' + str(manifest.get('version')),
                   'scenario': meta['scenario'], 'requiredStages': sorted(meta['requiredStages']),
                   'skills': meta['skills'], 'roles': sorted(definition.get('roles') or []),
                   'stages': rows, 'gateDefinitions': gates})


def compile_plan(c, root, parameters, scenario=None):
    manifest = c.lint.read_json(root / 'manifest.json')
    local_schema(c, root, manifest['inputSchema'], parameters)
    definition = c.lint.yaml.load((root / manifest['entry']).read_text(encoding='utf-8-sig'), Loader=c.lint.UniqueLoader)
    schema = c.lint.read_json(c.definition_schema_for(definition.get('schema')))
    Draft202012Validator(schema).validate(definition)
    # F-2: expand before anything binds, then let every existing per-stage check bite on the
    # expanded graph. Scenario defaults sit *under* the request's own parameters.
    expanded, meta = expand_scenario(definition, scenario,
                                      (manifest.get('dependencies') or {}).get('skills'))
    definition = dict(definition, stages=expanded)
    parameters = dict(meta['defaults'], **parameters)
    graph_sha256 = expanded_graph_hash(c, manifest, definition, meta)
    ids = [s['id'] for s in definition['stages']]
    if len(set(ids)) != len(ids):
        raise Rejected('INVALID_REQUEST', 'Duplicate stage id')
    visiting, visited = set(), set()
    by_id = {s['id']: s for s in definition['stages']}
    def visit(ident):
        if ident in visiting or ident not in by_id:
            raise Rejected('INVALID_REQUEST', 'Invalid stage DAG')
        if ident in visited:
            return
        visiting.add(ident)
        for dependency in by_id[ident].get('dependsOn', []):
            visit(dependency)
        visiting.remove(ident)
        visited.add(ident)
    stages = []
    for stage in definition['stages']:
        visit(stage['id'])
        if stage['worker'] not in ['none'] + definition.get('roles', []):
            raise Rejected('UNAUTHORIZED', 'Worker must be a declared role, never an implicit Agent')
        if stage['action'] not in {'prompt', 'script', 'software-call'}:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Action is outside the serial runner profile')
        if 'outputs' not in stage:
            raise Rejected('REQUIRED_GATE_MISSING', 'Every stage requires a real output schema')
        on_fail = stage.get('onFail', 'stop')
        repair_keys = set(stage) & {'maxIterations', 'repairPromptRef', 'repairScript'}
        if on_fail == 'repair':
            if stage['action'] == 'software-call':
                # A repair entry would re-dispatch an external effect behind a new attempt. The
                # replay rule (gate 7) is the honest answer for this generation; named in SOURCE.
                raise Rejected('INVALID_REQUEST', 'A software-call stage cannot declare onFail repair')
            iterations = stage.get('maxIterations')
            if not isinstance(iterations, int) or not 0 <= iterations <= 10:
                raise Rejected('INVALID_REQUEST', 'Repair requires an integer maxIterations within 0..10')
            expected_key = 'repairPromptRef' if stage['action'] == 'prompt' else 'repairScript'
            if not stage.get(expected_key):
                raise Rejected('INVALID_REQUEST', 'Repair requires an explicit ' + expected_key)
            if repair_keys - {expected_key, 'maxIterations'}:
                raise Rejected('INVALID_REQUEST', 'Repair entries do not match the stage action')
        elif on_fail == 'stop':
            if repair_keys:
                raise Rejected('INVALID_REQUEST', 'Repair entries require onFail repair')
        else:
            raise Rejected('INVALID_REQUEST', 'onFail must be stop or repair')
        gates = stage.get('gates', [])
        gate_contract = json.loads((Path(__file__).resolve().parent / 'schemas/gate.schema.json').read_text(encoding='utf-8-sig'))
        for gate in gates:
            declaration = definition.get('gateDefinitions', {}).get(gate)
            if not declaration or declaration.get('type') not in {'output-schema', 'math-stage', *gate_exec.GENERIC_TYPES}:
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Required gate adapter is unavailable')
            if declaration['type'] in gate_exec.GENERIC_TYPES:
                try:
                    Draft202012Validator({'$ref': '#/$defs/declaration', '$defs': gate_contract['$defs']}).validate(declaration)
                except ValidationError as exc:
                    raise Rejected('INVALID_REQUEST', 'Gate declaration violates the gate contract: ' + str(exc.message)) from exc
                if declaration['type'] == 'json-schema':
                    relative_path(root, declaration['schema'])
        def anchor_text(reference):
            filename, anchor = reference.split('#stage:', 1)
            text = relative_path(root, filename).read_text(encoding='utf-8-sig')
            matches = re.findall(r'<!--\s*stage:' + re.escape(anchor) + r'\s*-->(.*?)<!--\s*/stage:' + re.escape(anchor) + r'\s*-->', text, re.S)
            if len(matches) != 1 or not matches[0].strip():
                raise Rejected('INVALID_REQUEST', 'Prompt anchor is missing or ambiguous')
            return matches[0].strip()
        bound = copy.deepcopy(stage)
        if stage['action'] == 'prompt':
            bound['prompt'] = anchor_text(stage['promptRef'])
            if on_fail == 'repair':
                bound['repairPrompt'] = anchor_text(stage['repairPromptRef'])
        elif stage['action'] == 'script':
            relative_path(root, stage['script'])
            if on_fail == 'repair':
                relative_path(root, stage['repairScript'])
            args = stage.get('arguments', {})
            timeout = args.get('timeoutSeconds', 30)
            if not isinstance(timeout, int) or not 1 <= timeout <= 3600:
                raise Rejected('INVALID_REQUEST', 'Invalid timeout')
            if 'argv' in args:
                if set(args) - {'argv', 'timeoutSeconds'}:
                    raise Rejected('INVALID_REQUEST', 'Script argv and a declarative mapping cannot be combined')
                if not isinstance(args['argv'], list) or not all(isinstance(a, str) for a in args['argv']):
                    raise Rejected('INVALID_REQUEST', 'Script requires structured argv')
                bound['arguments'] = {'argv': list(args['argv']), 'timeoutSeconds': timeout}
            elif set(args) - {'timeoutSeconds'}:
                mapping = {name: value for name, value in args.items() if name != 'timeoutSeconds'}
                bound['arguments'] = {'argv': render_stage_arguments(root, stage, mapping, parameters, c.lint), 'timeoutSeconds': timeout}
            else:
                # No arguments declared at all: 0.5.2 accepted this as an empty argv, and
                # argument-less script stages depend on it (for example wf-runner's own
                # cli.py stage). Keep that behaviour exactly.
                bound['arguments'] = {'argv': [], 'timeoutSeconds': timeout}
        else:
            for key in ('software', 'capability'):
                if not isinstance(stage.get(key), str) or not stage[key]:
                    raise Rejected('INVALID_REQUEST', 'A software-call stage must name ' + key)
            if stage.get('script') or stage.get('promptRef'):
                raise Rejected('INVALID_REQUEST', 'A software-call stage carries neither a script nor a prompt')
            args = stage.get('arguments', {})
            timeout = args.get('timeoutSeconds', 60)
            if not isinstance(timeout, int) or not 1 <= timeout <= 3600:
                raise Rejected('INVALID_REQUEST', 'Invalid timeout')
            if 'argv' in args:
                raise Rejected('INVALID_REQUEST', 'Software arguments are mapped by name, never as argv')
            mapping = {name: value for name, value in args.items() if name != 'timeoutSeconds'}
            bound['softwareCall'] = {'softwareId': stage['software'], 'capability': stage['capability'],
                                     'arguments': render_software_arguments(root, stage, mapping,
                                                                            parameters, c.lint),
                                     'timeoutSeconds': timeout,
                                     'externalBoundary': copy.deepcopy(stage.get('externalBoundary'))}
            bound.pop('arguments', None)
        stages.append(bound)
    return {'workflowRoot': str(root), 'manifest': manifest, 'stages': stages,
            'gateDefinitions': definition.get('gateDefinitions', {}),
            'scenario': meta['scenario'], 'scenarioSkills': meta['skills'],
            'requiredStages': meta['requiredStages'], 'expandedGraphSha256': graph_sha256}


def plan_capability_gap(stages, manifest, descriptor):
    """ADR-1 / gate 2 / CAP-01: expand required plan capabilities and intersect with a
    platform's v2 descriptor facets. Pure and platform-literal-free. Returns a sorted
    gap list; empty means every required capability is declared supported. Only invoked
    when a platform declares an ai-platform-descriptor/v2; legacy `checks` platforms keep
    the prior all(checks) gate (this must not change their behavior)."""
    if not isinstance(descriptor, dict) or descriptor.get("schema") != "ai-platform-descriptor/v2":
        return []
    gaps = []
    facets = descriptor.get("actions", {}) if isinstance(descriptor.get("actions"), dict) else {}
    required_actions = sorted({s.get("action") for s in stages if s.get("action")})
    for action in required_actions:
        facet = facets.get(action)
        if not (isinstance(facet, dict) and facet.get("supported") is True):
            gaps.append("action:" + str(action))
    required_profiles = sorted(set(manifest.get("requiredProfiles") or []))
    profiles = descriptor.get("profiles", {}) if isinstance(descriptor.get("profiles"), dict) else {}
    for prof in required_profiles:
        entry = profiles.get(prof)
        if not (isinstance(entry, dict) and entry.get("declared") is True):
            gaps.append("profile:" + str(prof))
    operations = set(descriptor.get("operations") or [])
    for op in ("prepare", "next", "submit", "stop"):
        if op not in operations:
            gaps.append("operation:" + op)
    return sorted(set(gaps))


def context_resources(lock):
    """(kind, id) -> locked release row for every skill/pack this run pinned."""
    rows = {}
    for resource in lock.get('resources', []):
        if resource.get('kind') in ('skill', 'pack'):
            rows[(resource['kind'], resource['id'])] = resource
    return rows


def pack_member_skills(lock):
    """Skills contributed by the packs this run pinned: a pack is a set, not a document.

    Reading a pack as prose used to fail closed with CONTEXT_UNRESOLVED because no pack release has
    a body file. What a pack actually carries is skillVersions, so referencing one has to mean the
    member skills join the injected set -- otherwise declaring it is bookkeeping with no effect.
    """
    members = {}
    for resource in lock.get('resources', []):
        if resource.get('kind') != 'pack':
            continue
        try:
            manifest = json.loads(Path(resource['path'], 'manifest.json').read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            raise Rejected('CONTEXT_UNRESOLVED', 'Pack release manifest cannot be read: ' + str(resource.get('id')))
        versions = manifest.get('skillVersions') or {}
        for ident in (manifest.get('skillIds') or []):
            members.setdefault(ident, versions.get(ident))
    return members


def declared_context(lock):
    """What this run must read into every prompt: the locked selection, not a re-parse of files.

    Skills come from ``execution.contextSkills`` (prepare already resolved workflow-vs-scenario). An
    older lock without that key falls back to the workflow manifest, which is the same set.
    Packs are not scenario-selectable in this generation."""
    selected = lock['selection']['workflow']
    workflow = next((r for r in lock.get('resources', []) if r.get('key') == selected), None)
    if workflow is None:
        raise Rejected('CONTEXT_UNRESOLVED', 'Run lock does not carry the selected workflow release: ' + str(selected))
    root = unlinked(workflow['path'])
    try:
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        raise Rejected('CONTEXT_UNRESOLVED', 'Selected workflow manifest cannot be read: ' + str(selected))
    dependencies = manifest.get('dependencies') or {}
    declared = dependencies.get('skills') or {}
    pinned = (lock.get('execution') or {}).get('contextSkills')
    if pinned is None:
        skills = dict(declared)
    else:
        skills = {ident: declared.get(ident) for ident in pinned}
    # A scenario that names skills narrows the skill set; packs still widen it with their members,
    # but only members this run actually pinned a release row for (红线 2: never resolve at run time).
    locked_rows = {row.get('id') for row in lock.get('resources', []) if row.get('kind') == 'skill'}
    for ident, version in pack_member_skills(lock).items():
        if ident in locked_rows:
            skills.setdefault(ident, version)
    return {'packs': dependencies.get('packs') or {}, 'skills': skills}


def verify_context(lock):
    """Called before the lock is committed: a declared dependency the pipes could not resolve
    must stop the run here, not silently deliver a prompt without its context."""
    rows = context_resources(lock)
    declared = declared_context(lock)
    for kind in ('pack', 'skill'):
        for ident in sorted(declared.get(kind + 's') or {}):
            row = rows.get((kind, ident))
            if row is None:
                raise Rejected('CONTEXT_UNRESOLVED',
                               'Declared ' + kind + ' dependency is not resolved in this run lock: '
                               + '@' + str((declared.get(kind + 's') or {}).get(ident)))
            if file_hash(unlinked(row['path']) / 'manifest.json') != row.get('manifestSha256'):
                raise Rejected('INTEGRITY_MISMATCH',
                               'Locked ' + kind + ' manifest digest changed: ' + ident)


def context_documents(lock):
    """F-1: read the skill/pack documents this run's workflow declared, in lock order.

    Nothing here resolves versions -- the lock already froze them; this is the reader that was
    missing. Digests are re-checked on the way in so a stale file on disk is never delivered as
    "the skill was attached" (红线 3: 不谎报), and a missing one is a structured rejection rather
    than a quietly shorter prompt.
    """
    rows = context_resources(lock)
    declared = declared_context(lock)
    documents = []
    for kind in ('skill',):                   # packs have no body; their members joined the skill set above
        for ident in sorted(declared.get(kind + 's') or {}):
            row = rows.get((kind, ident))
            if row is None:
                raise Rejected('CONTEXT_UNRESOLVED',
                               'Declared ' + kind + ' dependency is not resolved in this run lock: ' + ident)
            root = unlinked(row['path'])
            try:
                manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
            except (OSError, ValueError):
                raise Rejected('CONTEXT_UNRESOLVED',
                               kind.capitalize() + ' release manifest cannot be read: ' + ident)
            if file_hash(root / 'manifest.json') != row.get('manifestSha256'):
                raise Rejected('INTEGRITY_MISMATCH',
                               'Locked ' + kind + ' manifest digest changed: ' + ident)
            entry = manifest.get('entry') or (kind.upper() + '.md')
            try:
                body = (root / entry).read_text(encoding='utf-8-sig')
            except (OSError, UnicodeError):
                raise Rejected('CONTEXT_UNRESOLVED',
                               kind.capitalize() + ' entry document cannot be read: ' + ident)
            documents.append('<!-- ' + kind + ' ' + ident + '@' + str(row['version'])
                             + ' manifestSha256=' + str(row['manifestSha256'])[:16] + ' -->\n\n' + body)
    return documents


def policy_documents(agent_root, manifest):
    """Read only real policy file references for the agent prompt context (F4).

    The contracts state that policies may be symbolic labels (for example
    'project-scoped') or explicit file references, and that only file
    references must exist; a profile/label string is never a path.  Entries
    with a path separator are treated as file references (and must exist);
    single-segment entries are read when a matching file exists and otherwise
    skipped as labels.
    """
    documents = []
    for name in manifest.get('policies', []):
        if not isinstance(name, str) or not name.strip():
            continue
        if '/' in name.replace('\\', '/') or (agent_root / name).is_file():
            documents.append(relative_path(agent_root, name).read_text(encoding='utf-8-sig'))
    return documents


class Engine:
    def __init__(self, config, fault=None):
        self.config = config  # supplied by the trusted platform adapter
        self.platform = self.config.get('platform', 'codex')
        self.c = Contracts(config['contracts'], config.get('scannerRelease'))
        self.runs = unlinked(config['runsRoot'])
        platform = unlinked(config['platformRoot'])
        self.runs.relative_to(platform)
        self.fault = fault
        # F3 / defect ④ family: an inconsistent declaration is a configuration fault, and it
        # is cheapest to catch where it is written. A platform may not claim the peerDispatch
        # capability without naming the module that implements it (defect ①'s trigger), and a
        # top-level `permissions` block that the closed vocabulary rejects is reported at
        # config phase instead of on the first real delegation. A missing or unreadable
        # capabilities document is deliberately left to the existing resolution path -- this
        # check must not add a new failure mode to a configuration that used to initialize.
        if config.get('capabilities') and Path(str(config['capabilities'])).is_file():
            try:
                declared = self.c.read(config['capabilities'])
            except Exception:
                declared = {}
            if (declared.get('checks') or {}).get('peerDispatch') and not config.get('peerDispatcherModule'):
                raise Rejected('CAPABILITY_UNAVAILABLE',
                               'capabilities.checks.peerDispatch requires config.peerDispatcherModule')
            if 'permissions' in declared:
                from permissions import normalize as normalize_permissions
                normalize_permissions('platform', declared['permissions'])
        if config.get('hostEnvironmentManifest'):
            from environment_guard import verify_host
            verify_host(config['hostEnvironmentManifest'])
        # D-12 (2.0.x repair, classification half): the resolution path consumed
        # config['environmentManifest'] unconditionally, so a platform without a sealed script
        # environment got a bare KeyError (key absent) or FileNotFoundError (file absent) on
        # *every* cell - including prompt-only workflows - and both surfaced as INTERNAL_ERROR
        # with no usable error code. Report it where it is written, as a machine-readable
        # capability fault naming the key. Making the key genuinely optional needs a contract
        # generation (run-lock requires selection.environment minItems 1), registered as D-27
        # and handed to 2.1 P3/P6; this release deliberately does not fake an environment the
        # platform does not have.
        _sealed = config.get('environmentManifest')
        # 2.1.0 P6 closes D-27's semantic half: declaring no sealed script environment is a
        # capability shape, not a block on every call. Prompt-only workflows resolve and run; a
        # script dispatch answers a structured CAPABILITY_UNAVAILABLE naming the key. A pointer
        # to a file that is not there stays a hard configuration fault.
        if _sealed and not Path(str(_sealed)).is_file():
            raise Rejected('CAPABILITY_UNAVAILABLE',
                           'config.environmentManifest names a file that does not exist: ' + str(_sealed))

    def _select_rung(self, consent):
        """§3.2: the strongest rung this run may honestly take, decided once at prepare.

        A sealed-environment rung is unavailable to a platform that declared none, and the host
        rung is unavailable without this run's own consent. A rung whose backend document cannot
        be read is skipped rather than half-trusted.
        """
        sealed = bool(self.config.get('environmentManifest'))
        for rung in (self.config.get('scriptEnvironmentRungs') or []):
            if rung.get('requiresSealedEnvironment') and not sealed:
                continue
            if rung.get('execPath') == 'host-controlled' and not consent:
                continue
            backend = rung.get('executionBackend')
            if not backend or not Path(str(backend)).is_file():
                continue
            return rung
        return None

    def store(self, run_id):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', run_id):
            raise Rejected('UNAUTHORIZED', 'Unsafe run id')
        return Store(relative_path(self.runs, run_id), self.c, self.fault)

    # ------------------------------------------------------------------ 3.0 software surface

    SOFTWARE_CALLS_ROOT = 'evidence/software-calls'

    def _software_paths(self):
        for key in ('softwareRoot', 'softwareGateway', 'softwareGatewayConfig'):
            if not self.config.get(key):
                raise Rejected('CAPABILITY_UNAVAILABLE',
                               'a software-call needs the platform to declare config.' + key)
        gateway = unlinked(self.config['softwareGateway'])
        if not gateway.is_file():
            raise Rejected('CAPABILITY_UNAVAILABLE',
                           'config.softwareGateway names no program: ' + str(gateway))
        return unlinked(self.config['softwareRoot']), gateway

    def _gateway_argv(self, store):
        """The gateway is a separate program, so a wrong capability claim cannot hide inside the
        engine. Its evidence root is pointed at this run; its lock root stays platform-wide,
        because that is the only way two runs of one platform can collide."""
        root, gateway = self._software_paths()
        interpreter = (self.config.get('interpreters') or {}).get(gateway.suffix.lower())
        if not interpreter:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'the platform config declares no interpreter for the '
                           'gateway program (config.interpreters.' + gateway.suffix.lower()
                           + '); the runner will not guess one')
        config = dict(self.c.read(self.config['softwareGatewayConfig']))
        config['softwareRoot'] = str(root)
        config['evidenceRoot'] = str(store.root / self.SOFTWARE_CALLS_ROOT)
        path = store.root / 'software-gateway.json'
        write_bytes(path, json.dumps(config, ensure_ascii=False, indent=1).encode('utf-8') + b'\n')
        return [str(interpreter), '-B', str(gateway), '--config', str(path)]

    def _gateway_message(self, store, message):
        import subprocess
        process = subprocess.run(self._gateway_argv(store),
                                 input=json.dumps(message, ensure_ascii=False).encode('utf-8'),
                                 capture_output=True, timeout=180,
                                 env=dict(os.environ, PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1'))
        lines = [line for line in process.stdout.decode('utf-8', 'replace').splitlines() if line.startswith('{')]
        if not lines:
            raise Rejected('SOFTWARE_CALL_FAILED', 'the software gateway answered without a protocol '
                           'document: ' + (process.stdout + process.stderr).decode('utf-8', 'replace')[-400:])
        return json.loads(lines[-1])

    def _gateway_refusal(self, action, software_id, answer):
        error = answer.get('error') or {}
        raise Rejected(error.get('code', 'SOFTWARE_CALL_FAILED'),
                       'the software gateway refused to ' + action + ' ' + software_id + ': '
                       + str(error.get('message')) + ' ' + json.dumps(error.get('named') or {}, sort_keys=True,
                                                                      ensure_ascii=False))

    def _software_resolution(self, store, plan, stage, attempt=None, ledger=None):
        """Ask the gateway what this recipe is, then read what it promises, then run the chain.

        The inventory round trip is pure file resolution on the gateway side: no body is started
        here, so prepare can judge a software plan without touching any of the software at all.
        """
        root, _ = self._software_paths()
        call = dict(stage['softwareCall'], stageId=stage['id'])
        call['attempt'] = (attempt or {}).get('attempt', 1)
        call['inputSha256'] = (attempt or {}).get('inputSha256')
        pinned = ((plan['manifest'].get('dependencies') or {}).get('software') or {}).get(call['softwareId'])
        answer = self._gateway_message(store, {'schema': 'ai-software-inventory/v1',
                                              'softwareId': call['softwareId'], 'softwareVersion': pinned})
        if not answer.get('ok'):
            self._gateway_refusal('inventory', call['softwareId'], answer)
        version = answer['installedVersion']
        call['softwareVersion'] = version
        directory = root / call['softwareId'] / 'versions' / version
        manifest = self.c.read(directory / 'manifest.json')
        capability = next((item for item in manifest['capabilities'] if item['name'] == call['capability']), None)
        grants = [grant for grant in (self.config.get('softwareConsentGrants') or [])
                  if grant.get('softwareId') == call['softwareId'] and grant.get('capability') == call['capability']]
        # A grant that carries no expiry is a standing authorisation; the gate still binds it to the
        # exact request digest, so "approve ffmpeg" can never turn into "approve anything".
        token = grants[-1] if grants else None
        facts = {'stage': call, 'dependencies': {call['softwareId']: pinned} if pinned else {},
                 'platform': {'softwareRoot': str(root), 'softwareGateway': str(self.config['softwareGateway']),
                              'softwareProfiles': self.config.get('softwareProfiles') or {}},
                 'inventory': {'installedVersion': version, 'frozen': bool(answer['frozen']),
                               'capabilities': answer['capabilities']},
                 'capability': capability,
                 'argumentSchema': self.c.read(relative_path(directory, capability['inputSchemaRef']))
                 if capability and capability.get('inputSchemaRef') else {},
                 'snapshotSha256': file_hash(directory / manifest['snapshot']),
                 'boundary': call.get('externalBoundary'), 'consent': token,
                 'priorCalls': ledger or [], 'now': now()}
        return {'call': call, 'facts': facts, 'version': version, 'manifest': manifest,
                'capability': capability, 'directory': directory,
                'consented': bool(token) or (capability or {}).get('consent') == 'auto'}

    def _software_gate(self, store, resolution, label):
        """Run the chain and always keep the trail, including the step that refused."""
        trail = software_gate.Trail()
        try:
            verdict = software_gate.evaluate(resolution['facts'], self.c.hash, trail)
        finally:
            store.write('evidence/gate-chain/' + label + '.json',
                        {'schema': 'ai-software-gate-trail/v1', 'gates': list(trail), 'chain': list(software_gate.CHAIN)})
        return verdict, trail

    def _execute_software(self, store, before, lock, plan, stage, active):
        """Dispatch one software-call, or say why it will not be dispatched.

        Order matters and is the same order the gate chain records: claim the call site first with
        an exclusive intent, because after that point an unclear outcome must be diagnosed, never
        retried. The gateway writes the replay anchor; the ledger is what makes a second identical
        execute answer "replayed" instead of calling the software twice.
        """
        ledger = self._software_ledger(store)
        resolution = self._software_resolution(store, plan, stage, active, ledger)
        verdict, _ = self._software_gate(store, resolution, active['stageId'] + '-' + str(active['attempt']))
        intent = 'software-intents/' + active['stageId'] + '-' + str(active['attempt']) + '.json'
        after_refusal = False
        if (store.root / intent).exists():
            prior = store.read(intent)
            if prior.get('completed') and prior.get('requestSha256') == verdict['requestSha256']:
                return {'ok': True, 'stageId': active['stageId'], 'attempt': active['attempt'], 'replayed': True,
                        'sequence': prior.get('sequence'), 'evidencePath': prior.get('evidencePath'),
                        'result': prior.get('result')}
            # D-51: an anchor left by a refusal (SOFTWARE_BUSY and friends) records that nothing was
            # ever sent. Saying "unknown outcome, stop and open a new run" for that case pointed the
            # operator at a call that never happened. Same call site, same request, never dispatched
            # => re-dispatch it; the gateway stays the arbiter through the idempotency key.
            if prior.get('dispatchState') == 'not-dispatched' and prior.get('requestSha256') == verdict['requestSha256']:
                after_refusal = True
            else:
                raise Rejected('UNKNOWN_OUTCOME', 'A dispatched software call is never replayed: the intent '
                               'for ' + active['stageId'] + ' attempt ' + str(active['attempt']) +
                               ' exists without a completed result, so inspect it and stop before a new run')
        if verdict['replay']:
            prior = verdict['replay']
            return {'ok': True, 'stageId': active['stageId'], 'attempt': active['attempt'], 'replayed': True,
                    'sequence': prior.get('sequence'), 'evidencePath': prior.get('evidencePath'),
                    'result': prior.get('result')}
        anchor = {'schema': 'ai-software-intent/v1', 'stageId': active['stageId'],
                  'attempt': active['attempt'], 'idempotencyKey': verdict['idempotencyKey'],
                  'requestSha256': verdict['requestSha256'], 'softwareId': resolution['call']['softwareId'],
                  'softwareVersion': resolution['version'], 'capability': resolution['call']['capability'],
                  'completed': False, 'dispatchState': 'dispatched-uncertain', 'at': now()}
        if after_refusal:
            # Overwrite the not-dispatched anchor with a live one; the refusal itself stays readable
            # from the previous ledger entry and from this record's retry marker.
            store.write(intent, dict(anchor, retriedAfterRefusal=prior.get('refused') or {}), exclusive=False)
        else:
            store.write(intent, anchor, exclusive=True)
        answer = self._gateway_message(store, {'schema': 'ai-software-call/v1',
                                               'softwareId': resolution['call']['softwareId'],
                                               'softwareVersion': resolution['version'],
                                               'capability': resolution['call']['capability'],
                                               'arguments': resolution['call']['arguments'],
                                               'runId': lock['runId'], 'holder': lock['runId'],
                                               'consented': resolution['consented'],
                                               'idempotencyKey': verdict['idempotencyKey'],
                                               'timeoutSeconds': resolution['call']['timeoutSeconds']})
        if not answer.get('ok'):
            # The gateway said no before anything reached the software: record it as not-dispatched
            # so the next claim of this same attempt can replay cleanly instead of being diagnosed.
            store.write(intent, dict(anchor, dispatched=False, completed=False, retriedAfterRefusal=True,
                                     dispatchState='not-dispatched', refused=(answer.get('error') or {})),
                        exclusive=False)
            self._gateway_refusal('call', resolution['call']['softwareId'], answer)
        result = answer['result']
        entry = {'idempotencyKey': verdict['idempotencyKey'], 'requestSha256': verdict['requestSha256'],
                 'stageId': active['stageId'], 'attempt': active['attempt'],
                 'sequence': int(result['evidencePath'].split('/')[2]),
                 'evidencePath': result['evidencePath'], 'softwareId': resolution['call']['softwareId'],
                 'softwareVersion': resolution['version'], 'capability': resolution['call']['capability'],
                 'result': {key: result[key] for key in ('outputSha256', 'exitCode', 'instanceMode')
                            if key in result}, 'at': now()}
        store.write('reports/software-calls.json', ledger + [entry])
        store.write(intent, dict(anchor, dispatched=True, completed=True, dispatchState='dispatched-completed',
                                 sequence=entry['sequence'],
                                 evidencePath=entry['evidencePath'], result=entry['result']))
        state = copy.deepcopy(before)
        evidence = [record(store.root, store.root / path) for path in
                    (entry['evidencePath'], entry['evidencePath'].replace('request.json', 'response.json'))
                    if (store.root / path).is_file()]
        event = event_for(self.c, lock, state, before,
                          'software-' + active['stageId'] + '-' + str(active['attempt']),
                          'software-called', evidence)
        store.commit(before, state, [event])
        return {'ok': True, 'stageId': active['stageId'], 'attempt': active['attempt'], 'replayed': False,
                'sequence': entry['sequence'], 'evidencePath': entry['evidencePath'],
                'result': entry['result']}

    def _software_task(self, store, stage, lock, attempt):
        ledger = self._software_ledger(store)
        resolution = self._software_resolution(store, self.plan(store, lock), stage, attempt, ledger)
        verdict, _ = self._software_gate(store, resolution, stage['id'] + '-' + str(attempt['attempt']) + '-claim')
        return {'softwareId': resolution['call']['softwareId'],
                'softwareVersion': resolution['version'],
                'capability': resolution['call']['capability'],
                'arguments': resolution['call']['arguments'],
                'idempotencyKey': verdict['idempotencyKey'],
                'evidencePath': self.SOFTWARE_CALLS_ROOT + '/' + str(len(ledger) + 1) + '/request.json',
                'timeoutSeconds': resolution['call']['timeoutSeconds'],
                'inputSchemaRef': (resolution['capability'] or {}).get('inputSchemaRef'),
                'outputSchemaRef': stage['outputs']}

    @staticmethod
    def _software_ledger(store):
        if not (store.root / 'reports' / 'software-calls.json').exists():
            return []
        return store.read('reports/software-calls.json')

    def _software_layer(self, store, plan):
        """Prepare-time resolution: the chain runs for every software stage before any of them can
        be claimed, and only what those answers back up may enter the lock."""
        root, gateway = self._software_paths()
        declared, pins = {}, {}
        for stage in plan['stages']:
            if stage['action'] != 'software-call':
                continue
            resolution = self._software_resolution(store, plan, stage)
            self._software_gate(store, resolution, 'prepare-' + stage['id'])
            call = resolution['call']
            declared[call['softwareId']] = {'softwareId': call['softwareId'],
                                            'softwareVersion': resolution['version'],
                                            'snapshotSha256': resolution['facts']['snapshotSha256']}
            concurrency = resolution['manifest']['concurrency']
            pins[stage['id']] = {'softwareId': call['softwareId'], 'softwareVersion': resolution['version'],
                                 'capability': call['capability'],
                                 'instanceMode': concurrency['instanceMode'],
                                 'exclusiveResources': list(concurrency.get('exclusiveResources') or [])}
        return {'block': {'gateway': {'path': str(gateway), 'sha256': file_hash(gateway)},
                          'declared': [declared[key] for key in sorted(declared)],
                          'callsRoot': self.SOFTWARE_CALLS_ROOT}, 'pins': pins}

    def response(self, request, state=None, error=None, **extra):
        response = {k: request[k] for k in ('schemaVersion', 'requestId', 'operation', 'runId')}
        response.update(kind='response', ok=error is None)
        if error:
            response['error'] = {'code': error.code, 'message': str(error), 'retryable': error.code == 'REVISION_CONFLICT'}
        else:
            response['result'] = dict(lockSha256=state['lockSha256'], state=state, **extra)
        self.c.validate('protocol', response)
        return response

    def receipt(self, request, response, events):
        return {'schemaVersion': 'ai-run-transaction/v1.1', 'transactionId': request['requestId'], 'platform': self.platform, 'runId': request['runId'], 'idempotencyKey': request['idempotencyKey'], 'requestSha256': self.c.hash({k: v for k, v in request.items() if k != 'requestId'}), 'request': request, 'phase': 'committed', 'effectBoundaryCrossed': False, 'eventSequences': [e['sequence'] for e in events], 'response': response}

    def receipt_path(self, request):
        return 'transactions/' + self.c.hash(request['idempotencyKey']) + '.json'

    def replay(self, store, request):
        path = self.receipt_path(request)
        if (store.root / path).exists():
            prior = store.read(path)
            if prior['requestSha256'] != self.c.hash({k: v for k, v in request.items() if k != 'requestId'}):
                raise Rejected('IDEMPOTENCY_CONFLICT', 'Same key has a different complete request')
            return prior['response']

    def _resolver(self):
        return Resolver(self.c, self.config['toolRoot'], self.config['agentRoot'], self.config['bridge'], self.config['runner'], self.config.get('environmentManifest'), self.config.get('capabilities'))

    def _entry_resolution(self, request):
        """G-A (requirement #3): a prepare request may omit target.version or pass the
        entry alias "current". The engine then resolves the entry selection once, in the
        documented order explicit > platform-default override > shared current, and
        rewrites the request with the resolved EXACT semver plus an x-resolvedFrom
        provenance record. Validation, persistence, receipts and the run lock all see
        only the normalized request: the version-freeze invariant holds because the
        resolution happens exactly once and the exact version is then pinned.
        Returns (request, (selected, origin)) or (request, None) when no entry
        resolution applies (explicit exact version / malformed / foreign platform)."""
        payload = request.get('payload') if isinstance(request, dict) else None
        if not isinstance(payload, dict) or payload.get('platform') != self.platform:
            return request, None
        target = payload.get('target')
        if not isinstance(target, dict) or target.get('mode') not in ('workflow', 'agent') or not isinstance(target.get('id'), str):
            return request, None
        if 'version' in target and target.get('version') != 'current':
            return request, None
        selected, origin = self._resolver().choose(target['mode'], target['id'], None)
        normalized = copy.deepcopy(request)
        t = normalized['payload']['target']
        t['version'] = selected[2]
        t['x-resolvedFrom'] = origin or source('explicit', Path(self.config['bridge']))
        return normalized, (selected, t['x-resolvedFrom'])

    def _after_commit(self, request, store, lock, state):
        """The two writes that must never race the ledger: they happen after the commit, and a
        failure here is reported by the absence of the file, never by pretending success."""
        export_to = ((request['payload'] or {}).get('x-handoff') or {}).get('exportTo')
        root = self.config.get('handoffRoot')
        if not root:
            return
        from handoff import Handoff
        layer = Handoff(root)
        if request['operation'] == 'stop' and export_to and state['status'] in TERMINAL:
            try:
                summary = layer.export(store.root, lock, state, export_to)
            except (FileNotFoundError, FileExistsError) as exc:
                store.write('reports/handoff-export-failed.json',
                            {'schema': 'ai-handoff-export/v1', 'error': type(exc).__name__,
                             'detail': str(exc), 'requestedTo': str(export_to)}, exclusive=False)
                raise
            store.write('reports/handoff-export.json', dict(summary, schema='ai-handoff-export/v1',
                                                            requestedTo=str(export_to)), exclusive=False)
        held = (state.get('x-arbitration') or {}).get('key')
        if held and state['status'] in TERMINAL:
            layer.release(held, request['runId'])

    def _acquire_project_locks(self, input_sources):
        """C5 / ADR-4: declared project write targets (config['projectWriteRoots']) are
        serialized with the platform writeback helper through the same normalized
        project mutex. The runner holds each touched project's lock for the exact
        window it reads project files into a run; a held target rejects with
        RESOURCE_BUSY before any business side effect. Different projects never
        contend. Without the declaration the behavior is identical to 0.7.5."""
        roots = self.config.get('projectWriteRoots') or []
        if not roots:
            return []
        from project_lock import ProjectLock, normalize_project_path
        wanted = {}
        for root in roots:
            canonical, key = normalize_project_path(root)
            wanted[key] = canonical
        holding = []
        try:
            claimed = set()
            for item in input_sources:
                original = unlinked(item['sourcePath'])
                ocanon, _ = normalize_project_path(original)
                for key, canonical in wanted.items():
                    if key not in claimed and (ocanon == canonical or ocanon.startswith(canonical + "/")):
                        holding.append(ProjectLock(canonical).acquire())
                        claimed.add(key)
        except BaseException:
            for lock in holding:
                lock.release()
            raise
        return holding

    def prepare(self, request, entry=None):
        if entry is None:
            request, entry = self._entry_resolution(request)
        self.c.validate('protocol', request)
        payload = request['payload']
        if payload['platform'] != self.platform or payload['parentRunId'] == request['runId']:
            raise Rejected('UNAUTHORIZED', 'Platform or parent run is invalid')
        store = self.store(request['runId'])
        if store.root.exists():
            with store.lease():
                replay = self.replay(store, request)
                if replay:
                    return replay
            raise Rejected('UNAUTHORIZED', 'Run directory already exists')
        resolver = self._resolver()
        target = payload['target']
        if entry is not None:
            # Entry version was already resolved and pinned above; provenance travels
            # with the selection so run-lock resources carry platform-default /
            # shared-current origin instead of a misleading 'explicit'.
            selected, origin = entry
        else:
            selected, origin = resolver.choose(target['mode'], target['id'], target['version'])
        handoff_request = payload.get('x-handoff') or {}
        arbitration_key = payload.get('x-arbitration-key') or handoff_request.get('arbitrationKey')
        handoff_layer = None
        if handoff_request or arbitration_key:
            root = self.config.get('handoffRoot')
            if not root:
                raise Rejected('CAPABILITY_UNAVAILABLE',
                               'config.handoffRoot is not declared by this platform: a handoff bundle '
                               'or an exclusive arbitration key has nowhere neutral to live (2.1.0 '
                               '§3.6 / BP-4 §4.5 - the location itself needs its own authorisation)')
            from handoff import Handoff
            handoff_layer = Handoff(root)
        if arbitration_key and handoff_layer:
            def _terminal(other):
                if not other:
                    return True
                candidate_state = self.runs / other / 'state.json'
                if not candidate_state.is_file():
                    return True  # its directory is gone: the claim is stale by definition
                try:
                    return json.loads(candidate_state.read_text(encoding='utf-8')).get('status') in (
                        'succeeded', 'stopped', 'failed')
                except ValueError:
                    return False
            if handoff_layer.claim(arbitration_key, request['runId'], _terminal) is None:
                raise Rejected('RESOURCE_BUSY', 'Another live run holds the exclusive key ' + str(arbitration_key))
        store.root.mkdir(parents=True, exist_ok=False)
        store.write('prepare-request.json', request, exclusive=True)
        resolved = resolver.resolve(selected, origin or source('explicit', store.root / 'prepare-request.json'))
        imported = None
        if handoff_layer and handoff_request.get('bundle'):
            try:
                bundle, bundle_dir = handoff_layer.read(handoff_request['bundle'], self.c)
            except FileNotFoundError:
                raise Rejected('INVALID_REQUEST', 'Handoff bundle not found: ' + str(handoff_request['bundle']))
            except ValueError as exc:
                code = str(exc).split(':')[0] or 'HANDOFF_INTEGRITY'
                raise Rejected(code if code.isupper() else 'HANDOFF_MANIFEST_MISMATCH',
                               'Handoff bundle failed its own integrity check: ' + str(exc))
            problems, environment_delta = handoff_layer.check_versions(
                bundle, handoff_layer.version_view(resolved['selection'], resolved['resources']))
            if problems:
                # BP-4 §4.5② and red line 2: a continuing run re-pins its own versions or does not
                # start. Silently carrying on against a different chain is the failure mode here.
                raise Rejected('HANDOFF_VERSION_MISMATCH',
                               'This run resolves different versions than the bundle was exported '
                               'from; refuse to continue rather than switch versions mid-project: '
                               + ' | '.join(problems[:6]))
            imported = {'bundle': bundle, 'directory': bundle_dir, 'environmentDelta': environment_delta}
        if self.config.get('hostEnvironmentManifest'):
            host_path = Path(self.config['hostEnvironmentManifest'])
            host = self.c.read(host_path)
            resolved['resources'].append({'key': 'interpreter:runner-python', 'kind': 'interpreter', 'id': 'runner-python', 'version': host['pythonVersion'], 'path': str(host_path), 'manifestSha256': file_hash(host_path), 'contentManifestSha256': file_hash(host_path), 'resolvedFrom': source('environment-snapshot', host_path), 'dependencies': []})
            resolved['selection']['environment'].append('interpreter:runner-python')
        plan = compile_plan(self.c, resolved['target'], payload['parameters'],
                            scenario=payload.get('scenario'))
        permissions = plan['manifest'].get('permissions', {})
        capabilities = self.c.read(self.config['capabilities'])
        # CAP-01 (ADR-1 / gate 2): when a platform declares an ai-platform-descriptor/v2,
        # expand the plan's required capabilities and reject BEFORE committing a business run
        # if any required action/profile/operation is not declared supported. Legacy platforms
        # (no v2 descriptor) are unaffected and keep the checks-based gate below.
        _gap = plan_capability_gap(plan['stages'], plan['manifest'], capabilities.get('descriptor'))
        if _gap:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Plan requires capabilities the platform does not declare supported: ' + ','.join(_gap))
        # ⑦ Declarative permission adapters: the engine knows no policy literal. The platform
        # declares the exact policies it holds a verified adapter for; the demand must equal one
        # of them exactly (no relaxation, no subset match). An undeclared policy is refused.
        adapters = [{key: value for key, value in adapter.items() if key != 'evidence'}
                    for adapter in (capabilities.get('permissionAdapters') or []) if isinstance(adapter, dict)]
        if permissions not in adapters:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Required permission policy has no verified adapter')
        if not capabilities.get('checks') or not all(capabilities['checks'].values()):
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Isolation acceptance has not passed')
        files, aliases = [], set()
        project_locks = self._acquire_project_locks(payload['inputSources'])
        try:
            for item in payload['inputSources']:
                name = item['snapshotPath']
                if not name.startswith('inputs/') or name.startswith('inputs/_runner/'):
                    raise Rejected('UNAUTHORIZED', 'Input must use an unreserved inputs/ path')
                alias = name.casefold()
                if alias in aliases:
                    raise Rejected('UNAUTHORIZED', 'Input paths alias')
                aliases.add(alias)
                original = unlinked(item['sourcePath'])
                if not any(original.is_relative_to(unlinked(root)) for root in self.config['inputRoots']):
                    raise Rejected('UNAUTHORIZED', 'Input source was not authorized by the platform')
                data = original.read_bytes()
                dest = relative_path(store.root, name)
                write_bytes(dest, data, exclusive=True)
                if original.read_bytes() != data:
                    raise Rejected('INPUT_MISMATCH', 'Input changed while copying')
                files.append(record(store.root, dest))
        finally:
            for lock in project_locks:
                lock.release()
        store.write('plan.json', plan, exclusive=True)
        files.sort(key=lambda row: row['path'])
        inp = {'parameters': payload['parameters'], 'parametersSha256': self.c.hash(payload['parameters']), 'files': files, 'manifestSha256': self.c.hash(files)}
        inp['snapshotSha256'] = self.c.hash({k: inp[k] for k in ('parametersSha256', 'manifestSha256')})
        rigor = payload.get('rigor') or self.config.get('defaultRigor') or 'balanced'
        if rigor not in ('fast', 'balanced', 'full'):
            raise Rejected('INVALID_REQUEST', 'Unknown rigor tier: ' + str(rigor))
        consent = payload.get('consent')
        tier_execution = {'rigor': rigor, 'gated': rigor != 'fast', 'frozen': False,
                          # D-62: "no tier written = draft" was only self-discipline in the prompt.
                          # The lock now says whether the tier was declared or defaulted, so the
                          # claim text and any reader can tell a defaulted balanced from an asked one.
                          'rigorSource': 'declared' if payload.get('rigor') else 'default'}
        if consent:
            # red line 5 in D-c: the agreement itself is hashed into the lock, so a later reader
            # can prove which consent this run ran on without the platform keeping the text
            tier_execution['hostConsent'] = {'agreementSha256': hashlib.sha256(
                consent['agreement'].encode('utf-8')).hexdigest()}
            tier_execution['execPath'] = 'host-controlled'
        rung = self._select_rung(consent)
        if rung is None or not rung.get('requiresSealedEnvironment'):
            # No attestation is made about an unsealed root, so the lock must not imply one:
            # it names no environment (the tie-rule contract 1.2.0 added for D-27).
            resolved['selection']['environment'] = []
        tier_execution['environmentSealed'] = bool(resolved['selection']['environment'])
        if rung:
            tier_execution['execPath'] = rung['execPath']
        else:
            # Nothing on this platform's ladder may be taken: the lock names no path at all, and
            # a script dispatch then refuses with a code instead of pretending a rung ran.
            tier_execution.pop('execPath', None)
        software_layer = self._software_layer(store, plan) if any(
            stage['action'] == 'software-call' for stage in plan['stages']) else None
        stage_items = []
        for stage in plan['stages']:
            item = {'id': stage['id'], 'action': stage['action'], 'dependsOn': stage.get('dependsOn', []),
                    'requiredGates': stage.get('gates', [])}
            if stage['action'] == 'software-call':
                item['software'] = software_layer['pins'][stage['id']]
            stage_items.append(item)
        declared_skills = sorted(set((plan['manifest'].get('dependencies') or {}).get('skills') or []))
        # Selector semantics: a scenario that names skills decides the set; one that names none falls
        # back to what the workflow itself declares, which is every release on disk today.
        context_skills = sorted(set(plan['scenarioSkills'])) if plan['scenarioSkills'] else declared_skills
        tier_execution['scenario'] = plan['scenario']
        tier_execution['expandedGraphSha256'] = plan['expandedGraphSha256']
        tier_execution['contextSkills'] = context_skills
        lock = {'schemaVersion': 'ai-run-lock/v1.3' if software_layer else 'ai-run-lock/v1.2',
                'recordType': 'execution', 'runId': request['runId'], 'parentRunId': payload['parentRunId'],
                'platform': self.platform, 'createdAt': now(), 'runRoot': str(store.root),
                'canonicalization': 'sha256-cjson-safe-v1', 'selection': resolved['selection'],
                'resources': resolved['resources'], 'input': inp,
                'execution': dict({'maxParallel': 1, 'resume': False, 'stages': stage_items,
                                   **({'software': software_layer['block']} if software_layer else {})},
                                  **tier_execution)}
        lock['execution']['contextSkills'] = sorted(
            set(lock['execution'].get('contextSkills') or []) | set(declared_context(lock)['skills']))
        verify_context(lock)
        self.c.validate('run-lock', lock)
        store.write('run-lock.json', lock, exclusive=True)
        for item in files:
            if item['path'].startswith('inputs/project/'):
                dest = relative_path(store.root, 'work/project/' + item['path'][len('inputs/project/'):])
                write_bytes(dest, relative_path(store.root, item['path']).read_bytes(), exclusive=True)
        store.write('reports/prepare-diagnostics.json', {'findings': resolved['findings'], 'permissions': permissions, 'capabilitiesSha256': file_hash(self.config['capabilities'])}, exclusive=True)
        state = {'schemaVersion': 'ai-run-state/v1.1', 'runId': request['runId'], 'lockSha256': self.c.hash(lock), 'stateRevision': 0, 'lastEventSequence': 1, 'lastEventSha256': '0' * 64, 'status': 'prepared', 'outcome': 'known', 'stopRequested': False, 'activeAttempt': None, 'completed': [], 'managedProcesses': [], 'finalOutput': [], 'error': None, 'updatedAt': now()}
        if imported:
            state['completed'] = handoff_layer.seed(imported['bundle'], imported['directory'], store.root)
            state['x-handoff'] = {'fromRun': imported['bundle']['runId'],
                                  'exportedLockSha256': imported['bundle']['lockSha256'],
                                  'manifestSha256': imported['bundle']['integrity']['manifestSha256'],
                                  'stages': [s['stageId'] for s in imported['bundle']['stages']],
                                  'environmentDelta': imported['environmentDelta']}
            store.write('reports/handoff-import.json', {
                'schema': 'ai-handoff-import/v1', 'sourceRun': imported['bundle']['runId'],
                'sourcePlatform': imported['bundle']['platform'],
                'bundleManifestSha256': imported['bundle']['integrity']['manifestSha256'],
                'exportedLockSha256': imported['bundle']['lockSha256'],
                'versionsCheckedEqual': True,
                'environmentDelta': imported['environmentDelta'],
                'stages': [s['stageId'] for s in imported['bundle']['stages']]}, exclusive=True)
        if arbitration_key:
            state['x-arbitration'] = {'key': str(arbitration_key)}
        event = event_for(self.c, lock, state, None, request['requestId'], 'prepared')
        response = self.response(request, state)
        with store.lease():
            store.commit(None, state, [event], self.receipt(request, response, [event]), self.receipt_path(request))
        if rigor == 'fast' and request.get('schemaVersion') == 'ai-run-protocol/v1.3':
            # 单趟往返 (§1.2). The claim runs in this same interpreter, so a fast run starts one
            # process and discovers once instead of twice. The prepare receipt is rewritten with
            # the merged envelope so an idempotent replay returns byte-identically what the
            # caller already saw; if the claim is refused the plain prepare envelope stands.
            claim = {'schemaVersion': 'ai-run-protocol/v1.3', 'kind': 'request',
                     'requestId': request['requestId'] + '-claim', 'operation': 'next',
                     'runId': request['runId'], 'idempotencyKey': request['idempotencyKey'] + '-claim',
                     'expectedStateRevision': state['stateRevision'], 'payload': {}}
            try:
                claimed = self.dispatch(claim)
            except Exception:  # noqa: BLE001 - a refused claim must not unmake a committed prepare
                claimed = None
            if claimed and claimed.get('ok') and (claimed.get('result') or {}).get('task'):
                response = self.response(request, claimed['result']['state'],
                                         task=claimed['result']['task'],
                                         reason=claimed['result'].get('reason', 'claimed'))
                with store.lease():
                    store.write(self.receipt_path(request), self.receipt(request, response, [event]),
                                exclusive=False)
        return response

    def verify(self, store, state, lock):
        self.c.validate('run-lock', lock)
        self.c.validate('state', state)
        if self.c.hash(lock) != state['lockSha256']:
            raise Rejected('HASH_MISMATCH', 'Immutable execution lock changed')
        verify_files(store.root, lock['input']['files'])
        for completed in state['completed']:
            verify_files(store.root, completed['outputs'] + [g['evidence'] for g in completed['gates']])
        for resource in lock['resources']:
            root = unlinked(resource['path'])
            if resource['kind'] in {'workflow', 'agent', 'skill', 'pack', 'runner', 'contracts'}:
                if file_hash(root / 'manifest.json') != resource['manifestSha256'] or file_hash(root / 'SHA256SUMS') != resource['contentManifestSha256']:
                    raise Rejected('HASH_MISMATCH', 'Locked release identity changed')
                scanner = self.c.lint.Scanner(self.config['toolRoot'], self.config['agentRoot'])
                scanner.integrity(root, self.c.lint.read_json(root / 'manifest.json'), (resource['kind'], resource['id'], resource['version']))
                if scanner.findings:
                    raise Rejected('HASH_MISMATCH', 'Locked release content changed')
            elif file_hash(root) != resource['manifestSha256']:
                raise Rejected('HASH_MISMATCH', 'Environment snapshot changed')
        if self.config.get('hostEnvironmentManifest'):
            runner = next(r for r in lock['resources'] if r['key'] == lock['selection']['runner'])
            if Path(__file__).resolve().parent != Path(runner['path']).resolve():
                raise Rejected('HASH_MISMATCH', 'Consumer loaded a different runner implementation')

    @staticmethod
    def tier_claim(lock):
        """The effective tier, as it must be visible on the claim (D-62)."""
        execution = lock.get('execution') or {}
        rigor = execution.get('rigor', 'balanced')
        source = execution.get('rigorSource', 'default')
        gated = execution.get('gated', rigor != 'fast')
        frozen = execution.get('frozen', False)
        origin = ('declared by the request' if source == 'declared'
                  else 'defaulted, and no tier written means draft')
        notice = ('effective tier=' + rigor + ' (' + origin + '); gates=' + ('on' if gated else 'off')
                  + '; frozen=' + str(bool(frozen)))
        if not frozen:
            notice += '; not a submission-grade or frozen result'
        return {'rigor': rigor, 'rigorSource': source, 'gated': bool(gated), 'frozen': bool(frozen),
                'tierNotice': notice}

    def plan(self, store, lock):
        recorded = next((r for r in lock['resources'] if r.get('key') == 'contracts:runtime-contracts'), None)
        if recorded is not None:
            current = self.c.read(self.c.release / 'manifest.json')['version']
            if recorded.get('version') != current:
                raise Rejected('VERSION_CONFLICT',
                               'This run was prepared under runtime-contracts ' + str(recorded.get('version'))
                               + ' but the platform config now resolves ' + str(current)
                               + '; stop and open a run against the new generation (D-97)')
        resource = next(r for r in lock['resources'] if r['key'] == lock['selection']['workflow'])
        expected = compile_plan(self.c, Path(resource['path']), lock['input']['parameters'],
                                scenario=lock['execution'].get('scenario'))
        # Resume must see the graph it was prepared with. A definition that moved under a pinned run
        # is refused here rather than silently changing the stages this run executes.
        pinned = lock['execution'].get('expandedGraphSha256')
        if pinned and pinned != expected['expandedGraphSha256']:
            raise Rejected('VERSION_CONFLICT',
                           'This run is pinned to expanded graph ' + str(pinned)[:16] + ' but the workflow '
                           'release now resolves ' + str(expected['expandedGraphSha256'])[:16] + ' for scenario '
                           + str(expected['scenario']) + '; stop and open a run against the new bytes')
        if store.read('plan.json') != expected:
            raise Rejected('HASH_MISMATCH', 'Derived plan differs from locked source')
        return expected

    def discard_uncommitted_run_dir(self, request):
        """F2: a prepare that never committed must not leave its run directory behind.

        The directory is removed only when it belongs to this request (its
        prepare-request.json carries this requestId) and no run-lock was
        committed, so a concurrent prepare for the same id is never disturbed.
        """
        run_id = request.get('runId')
        if not isinstance(run_id, str):
            return
        try:
            store = self.store(run_id)
        except Rejected:
            return
        root = store.root
        if not root.exists() or (root / 'run-lock.json').exists():
            return
        record_path = root / 'prepare-request.json'
        if not record_path.is_file():
            return
        try:
            prior = self.c.read(record_path)
        except Exception:
            return
        if prior.get('requestId') != request.get('requestId'):
            return
        shutil.rmtree(root, ignore_errors=True)

    def dispatch(self, request):
        entry = None
        if isinstance(request, dict) and request.get('operation') == 'prepare':
            request, entry = self._entry_resolution(request)
        self.c.validate('protocol', request)
        if request['operation'] == 'prepare':
            try:
                return self.prepare(request, entry)
            except BaseException:
                self.discard_uncommitted_run_dir(request)
                raise
        store = self.store(request['runId'])
        if request['operation'] == 'status':
            state = store.observe()
            self.verify(store, state, store.read('run-lock.json'))
            if state['status'] not in TERMINAL and self.unobserved_processes(store):
                try:
                    with store.lease(name='.executor.lock', recover=False):
                        pass
                except Rejected:
                    pass
                else:
                    return self.response(request, error=Rejected('UNKNOWN_OUTCOME', 'Interrupted dispatch requires diagnosis by next or stop; status performed no recovery writes'))
            return self.response(request, state)
        # F05 / P6: the delegate protocol operation is now explicitly routed instead of
        # falling through. Delegation runs only from a live parent stage (dispatch_delegation
        # inside next()); a top-level delegate op is a structured, side-effect-free rejection.
        if request['operation'] == 'delegate':
            if not self.config.get('peerDispatcherModule'):
                return self.response(request, error=Rejected('CAPABILITY_UNAVAILABLE',
                    'Peer dispatch is not declared/verified on this platform; no child task created'))
            # F1 / gate 4: the protocol operation is real now. It is handled inside the
            # leased state machine below, so a platform that declares a dispatcher drives
            # delegation over the documented wire instead of reaching into engine internals.
        with store.lease():
            replay = self.replay(store, request)
            if replay:
                return replay
            self.reconcile_processes(store)
            before = store.read('state.json')
            state = copy.deepcopy(before)
            lock = store.read('run-lock.json')
            events = []
            extra = {}
            def change(kind, evidence=None):
                prior = copy.deepcopy(before if not events else last[0])
                events.append(event_for(self.c, lock, state, prior, request['requestId'], kind, evidence))
                last[:] = [copy.deepcopy(state)]
            last = []
            try:
                self.verify(store, state, lock)
                if request['expectedStateRevision'] != state['stateRevision']:
                    raise Rejected('REVISION_CONFLICT', 'Expected state revision is stale')
                if state['status'] in TERMINAL:
                    raise Rejected('TERMINAL_RUN', 'Run is terminal')
                if request['operation'] != 'stop' and state['stopRequested']:
                    raise Rejected('STOP_REQUESTED', 'Stop was requested')
                plan = self.plan(store, lock)
                if request['operation'] == 'stop':
                    state['stopRequested'] = True
                    change('stop-requested')
                    if state['managedProcesses'] or self.unobserved_processes(store):
                        active = state['activeAttempt']
                        for intent in self.unobserved_processes(store):
                            cancel = relative_path(store.root, intent['controlRoot'] + '/cancel.flag')
                            write_bytes(cancel, b'stop\n', exclusive=not cancel.exists())
                    else:
                        state['status'], state['activeAttempt'] = 'stopped', None
                        change('stopped')
                elif state['status'] == 'blocked':
                    raise Rejected('TERMINAL_RUN', 'Blocked run requires explicit stop and a new run')
                elif request['operation'] == 'next':
                    if state['activeAttempt']:
                        if state['status'] == 'waiting-for-input':
                            extra = {'task': None, 'reason': 'waiting'}
                        elif state['status'] == 'running' and state['activeAttempt']['attempt'] > 1:
                            stage = next(s for s in plan['stages'] if s['id'] == state['activeAttempt']['stageId'])
                            if stage['action'] != 'prompt':
                                # D-64 (second site): a script/software attempt the host took down
                                # is not "already running". Read-only probe, no reclaim, no replay.
                                if self.dispatch_alive(store, state) is False:
                                    raise Rejected('UNKNOWN_OUTCOME',
                                                   'The managed dispatch for stage '
                                                   + str(state['activeAttempt']['stageId'])
                                                   + ' is no longer alive, so its outcome is unknown. The engine '
                                                   'does not reclaim or replay it: stop this run explicitly and open '
                                                   + 'a new one.')
                                raise Rejected('REVISION_CONFLICT', 'A managed attempt is already running')
                            attempt = state['activeAttempt']
                            task = dict(attempt, initialInputSha256=lock['input']['snapshotSha256'], allowedTools=['submit-evidence'], prompt=stage['prompt'] if attempt['attempt'] == 1 else stage['repairPrompt'])
                            if lock['selection']['agent']:
                                resource = next(r for r in lock['resources'] if r['key'] == lock['selection']['agent'])
                                agent_root = Path(resource['path'])
                                manifest = self.c.read(agent_root / 'manifest.json')
                                context = [relative_path(agent_root, manifest['prompt']).read_text(encoding='utf-8-sig')]
                                context += policy_documents(agent_root, manifest)
                                task['prompt'] = '\n\n'.join(context + [task['prompt']])
                            documents = context_documents(lock)
                            if documents:
                                task['prompt'] = '\n\n'.join(documents + [task['prompt']])
                            task.update(self.tier_claim(lock))
                            state['status'] = 'waiting-for-input'
                            change('prompt-delivered')
                            extra = {'task': task, 'reason': 'claimed'}
                        else:
                            # D-64: after the host killed the managed process, "already running" was
                            # a lie that blocked every operator move. Probe it (read-only) and name
                            # the outcome as unknown instead -- still no auto-reclaim, no replay.
                            if self.dispatch_alive(store, state) is False:
                                raise Rejected('UNKNOWN_OUTCOME',
                                               'The managed dispatch for stage ' + str(state['activeAttempt']['stageId'])
                                               + ' is no longer alive, so its outcome is unknown. The engine does not '
                                               'reclaim or replay it: stop this run explicitly and open a new one.')
                            raise Rejected('REVISION_CONFLICT', 'A managed attempt is already running')
                    else:
                        done = {s['stageId'] for s in state['completed']}
                        stage = next((s for s in plan['stages'] if s['id'] not in done and set(s.get('dependsOn', [])).issubset(done)), None)
                        if stage is None:
                            raise Rejected('INVALID_REQUEST', 'No ready stage')
                        artifacts = sorted([o for s in state['completed'] for o in s['outputs']], key=lambda x: x['path'])
                        attempt = {'stageId': stage['id'], 'attempt': 1, 'action': stage['action'], 'inputSha256': self.c.hash({'initialInputSha256': lock['input']['snapshotSha256'], 'artifacts': artifacts}), 'artifacts': artifacts}
                        state.update(status='running', activeAttempt=attempt)
                        change('stage-claimed')
                        allowed = ['submit-evidence']
                        if stage.get('script'):
                            allowed.append('isolated-stage-tool')
                        if stage['id'] == 'FIGURES' and plan['manifest']['id'] == 'math-modeling-programmer':
                            allowed += ['render-figure', 'record-visual-review']
                        task = dict(attempt, initialInputSha256=lock['input']['snapshotSha256'],
                                    allowedTools=allowed if stage['action'] == 'prompt' else
                                    (['isolated-software-call'] if stage['action'] == 'software-call'
                                     else ['isolated-python']))
                        if stage['action'] == 'prompt':
                            task['prompt'] = stage['prompt']
                            if lock['selection']['agent']:
                                resource = next(r for r in lock['resources'] if r['key'] == lock['selection']['agent'])
                                agent_root = Path(resource['path'])
                                manifest = self.c.read(agent_root / 'manifest.json')
                                context = [relative_path(agent_root, manifest['prompt']).read_text(encoding='utf-8-sig')]
                                context += policy_documents(agent_root, manifest)
                                task['prompt'] = '\n\n'.join(context + [stage['prompt']])
                            documents = context_documents(lock)
                            if documents:
                                task['prompt'] = '\n\n'.join(documents + [task['prompt']])
                            task.update(self.tier_claim(lock))
                            state['status'] = 'waiting-for-input'
                            change('prompt-delivered')
                        elif stage['action'] == 'script':
                            arguments = stage.get('arguments', {})
                            task['script'] = {'resourceKey': lock['selection']['workflow'], 'entry': stage['script'], 'argv': arguments.get('argv', []), 'timeoutSeconds': arguments.get('timeoutSeconds', 30)}
                        else:
                            task['software'] = self._software_task(store, stage, lock, attempt)
                        extra = {'task': task, 'reason': 'claimed'}
                elif request['operation'] == 'submit':
                    active = state['activeAttempt']
                    payload = request['payload']
                    if not active or payload['stageId'] != active['stageId'] or payload['attempt'] != active['attempt']:
                        raise Rejected('STALE_ATTEMPT', 'Submission is for another attempt')
                    if payload['inputSha256'] != active['inputSha256'] or payload['artifacts'] != active['artifacts']:
                        raise Rejected('INPUT_MISMATCH', 'Attempt inputs do not match')
                    if state['managedProcesses']:
                        raise Rejected('UNAUTHORIZED', 'Managed script has not ended')
                    stage = next(s for s in plan['stages'] if s['id'] == active['stageId'])
                    failures, tierReport = self.check_submission(
                        store, plan, stage, payload, lock['execution'].get('rigor', 'balanced'))
                    prior = {}
                    if (store.root / 'reports/rigor-counters.json').is_file():
                        prior = self.c.read(store.root / 'reports/rigor-counters.json')
                    # cumulative per run, because "how much ceremony did this tier pay for" is a
                    # property of the run, not of its last submission
                    tierReport = {
                        'schema': 'ai-rigor-counters/v1',
                        'tier': lock['execution'].get('rigor', 'balanced'),
                        'stagesSubmitted': prior.get('stagesSubmitted', 0) + 1,
                        'gatesRequired': prior.get('gatesRequired', 0) + len(stage.get('gates', [])),
                        'gatesExecuted': prior.get('gatesExecuted', 0) + tierReport['gatesExecuted'],
                        'processGatesSkipped': prior.get('processGatesSkipped', 0)
                        + tierReport['processGatesSkipped'],
                        'skippedGateIds': list(prior.get('skippedGateIds', [])) + tierReport['skippedGateIds'],
                        'evidenceItems': prior.get('evidenceItems', 0) + len(payload['outputs']),
                        'sealDocuments': len(list((store.root / 'reports').glob('stage-seal-*.json')))
                        + (1 if lock['execution'].get('rigor') == 'full' and not failures else 0)}
                    store.write('reports/rigor-counters.json', tierReport, exclusive=False)
                    if failures and stage.get('onFail') != 'repair':
                        raise Rejected('GATE_FAILED', 'Required gate failed: ' + failures[0]['gateId'])
                    if failures:
                        failed_records = [g['evidence'] for g in payload['gates'] if g['gateId'] in {f['gateId'] for f in failures}]
                        detail = '; '.join(f['gateId'] + ': ' + f['reason'] for f in failures)
                        if active['attempt'] >= 1 + stage['maxIterations']:
                            state.update(activeAttempt=None, status='failed', error={'code': 'GATE_FAILED', 'message': 'Repair exhausted after ' + str(active['attempt']) + ' attempt(s): ' + detail, 'retryable': False})
                            change('failed', failed_records)
                            extra = {'accepted': True}
                        else:
                            state['activeAttempt'] = {'stageId': active['stageId'], 'attempt': active['attempt'] + 1, 'action': active['action'], 'inputSha256': self.c.hash({'initialInputSha256': lock['input']['snapshotSha256'], 'artifacts': active['artifacts'], 'previousAttempt': active['attempt'], 'failures': failures}), 'artifacts': active['artifacts']}
                            state['status'] = 'running'
                            change('failed', failed_records)
                            extra = {'accepted': True}
                    else:
                        if lock['execution'].get('rigor') == 'full':
                            store.write('reports/stage-seal-' + active['stageId'] + '.json',
                                        {'schema': 'ai-stage-seal/v1', 'stageId': active['stageId'],
                                         'attempt': payload['attempt'], 'tier': 'full',
                                         'outputs': [o['path'] for o in payload['outputs']],
                                         'gates': [g['gateId'] for g in payload['gates']],
                                         'inputSha256': payload['inputSha256']}, exclusive=False)
                        state['completed'].append(copy.deepcopy(payload))
                        state.update(activeAttempt=None, status='running')
                        change('result-accepted')
                        if len(state['completed']) == len(plan['stages']):
                            if not payload['outputs']:
                                raise Rejected('REQUIRED_GATE_MISSING', 'Final output is empty')
                            state.update(status='succeeded', finalOutput=payload['outputs'])
                            change('succeeded')
                        extra = {'accepted': True}
                elif request['operation'] == 'delegate':
                    payload = request['payload']
                    active = state['activeAttempt']
                    if not active or payload['stageId'] != active['stageId']:
                        raise Rejected('STALE_ATTEMPT', 'Delegation does not target the active stage of this run')
                    inner = payload.get('request')
                    if not isinstance(inner, dict):
                        raise Rejected('INVALID_REQUEST', 'delegate payload.request must be an object')
                    brief = inner.get('brief')
                    if not isinstance(brief, str) or not brief:
                        raise Rejected('INVALID_REQUEST', 'delegate payload.request must carry a non-empty brief')
                    delegation = {'peers': [{'id': payload['peer']}], 'brief': brief,
                                  'idempotencyKey': request['idempotencyKey'],
                                  'timeoutSeconds': inner.get('timeoutSeconds', 120)}
                    if inner.get('requiredPermissions') is not None:
                        delegation['requiredPermissions'] = inner['requiredPermissions']
                    outcome = self.dispatch_delegation(request['runId'], delegation)
                    children = (outcome.get("results") or {}).get("children") or []
                    child_ids = [row.get("childRunId") for row in children if row.get("childRunId")]
                    response_path = relative_path(store.root, "peer-dispatch/" + str(outcome.get("sequence")) + "/response.json")
                    delegated = {'peer': payload['peer'], 'stageId': payload['stageId'],
                                 'sequence': outcome.get('ordinal'),
                                 'requestSha256': (outcome.get('results') or {}).get('requestSha256'),
                                 'verdict': 'accepted' if outcome.get('ok') else 'rejected',
                                 'peerRunId': child_ids[0] if len(child_ids) == 1 else None}
                    if response_path.is_file():
                        delegated['response'] = {'path': 'peer-dispatch/' + str(outcome.get("sequence")) + '/response.json',
                                                 'sha256': file_hash(response_path), 'size': response_path.stat().st_size}
                    # the closed schema allows only ^x- extensions, so the full evidence travels there
                    delegated['x-dispatchReport'] = outcome
                    extra = {'delegation': delegated}
                response = self.response(request, state, **extra)
            except Rejected as error:
                state, events = copy.deepcopy(before), []
                response = self.response(request, error=error)
            store.commit(before, state, events, self.receipt(request, response, events), self.receipt_path(request))
            self._after_commit(request, store, lock, state)
            return response

    def check_submission(self, store, plan, stage, payload, rigor='balanced'):
        prefix = f"evidence/{stage['id']}/{payload['attempt']}/"
        outputs = payload['outputs']
        if not outputs or outputs != sorted(outputs, key=lambda row: row['path']) or any(not o['path'].startswith(prefix) for o in outputs):
            raise Rejected('UNAUTHORIZED', 'Output must be ordered immutable attempt evidence')
        verify_files(store.root, outputs)
        document = next((o for o in outputs if o['path'] == prefix + 'output.json'), None)
        if document is None:
            raise Rejected('REQUIRED_GATE_MISSING', 'Missing output.json evidence')
        try:
            value = self.c.lint.read_json(store.root / document['path'])
            if 'legacyOutputSchema' in plan:
                Draft202012Validator(plan['legacyOutputSchema']).validate(value)
            else:
                local_schema(self.c, Path(plan['workflowRoot']), stage['outputs'], value)
        except Exception as exc:
            raise Rejected('GATE_FAILED', 'Stage output does not satisfy its schema') from exc
        if plan['manifest']['id'] == 'math-modeling-programmer':
            names = {o['path'][len(prefix):] for o in outputs}
            if value['stage'] != stage['id'] or set(value['artifacts']) != names - {'output.json'} or len(value['artifacts']) != len(set(value['artifacts'])):
                raise Rejected('GATE_FAILED', 'Declared stage artifacts differ from sealed evidence')
        gates = {g['gateId']: g for g in payload['gates']}
        if len(gates) != len(payload['gates']) or not set(stage.get('gates', [])).issubset(gates):
            raise Rejected('REQUIRED_GATE_MISSING', 'Required gate is absent or duplicated')
        failures = []
        skipped = []
        evidence_contract = gate_exec.evidence_validator()
        for gate in gates.values():
            if gate['inputSha256'] != payload['inputSha256'] or gate['outputManifestSha256'] != self.c.hash(outputs):
                raise Rejected('GATE_FAILED', 'Gate evidence binding is stale')
            if not gate['evidence']['path'].startswith(prefix):
                raise Rejected('UNAUTHORIZED', 'Gate evidence is outside this attempt')
            verify_files(store.root, [gate['evidence']])
            declaration = plan['gateDefinitions'].get(gate['gateId'])
            if declaration is None:
                raise Rejected('REQUIRED_GATE_MISSING', 'Undeclared gate')
            if declaration['type'] == 'math-stage':
                from math_gates import validate_evidence
                validate_evidence(self.c, store.root, payload, gate, declaration)
            elif declaration['type'] == 'output-schema':
                if gate['status'] != 'pass':
                    raise Rejected('GATE_FAILED', 'Required gate failed: ' + gate['gateId'])
            elif declaration['type'] in gate_exec.GENERIC_TYPES:
                if declaration['type'] == 'process' and rigor == 'fast':
                    skipped.append(gate['gateId'])
                    continue
                submitted = self.c.read(store.root / gate['evidence']['path'])
                try:
                    evidence_contract.validate(submitted)
                except ValidationError as exc:
                    raise Rejected('INVALID_REQUEST', 'Gate evidence violates the gate contract: ' + str(exc.message)) from exc
                execution_identity = None
                if declaration['type'] == 'process':
                    execution_identity = {
                        'runId': store.root.name,
                        'stageId': payload['stageId'],
                        'attempt': payload['attempt'],
                        'gateId': gate['gateId'],
                        'inputSha256': payload['inputSha256'],
                        'outputManifestSha256': self.c.hash(outputs),
                    }
                derived = gate_exec.evaluate(self.c, store.root, Path(plan['workflowRoot']), declaration,
                                             prefix, gate['gateId'], local_schema,
                                             execution_identity=execution_identity)
                if declaration['type'] == 'process':
                    if submitted.get('targets'):
                        raise Rejected('INVALID_REQUEST', 'Process gate evidence must not declare targets')
                elif submitted.get('targets', []) != derived['targets'] or submitted.get('hits', []) != derived['hits']:
                    raise Rejected('HASH_MISMATCH', 'Stale gate evidence binding')
                if gate['status'] != 'pass' or derived['status'] != 'pass':
                    failures.append({'gateId': gate['gateId'], 'reason': derived.get('reason') or 'session-reported failure'})
            else:
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Unknown gate executor')
        return failures, {'gatesExecuted': len(gates) - len(skipped),
                          'processGatesSkipped': len(skipped), 'skippedGateIds': skipped}

    def dispatch_delegation(self, parent_run_id, delegation):
        """M5-04..06: peer delegation mechanism (internal capability; workflow syntax stays rejected).

        Every rejection happens before the dispatcher is invoked: zero dispatch
        records and zero business side effects. The dispatcher is platform
        supplied (config['peerDispatcherModule']); without a verified platform
        capability the delegation is refused.
        """
        capabilities = self.c.read(self.config["capabilities"])
        checks = capabilities.get("checks", {})
        if not checks.get("peerDispatch"):
            raise Rejected("CAPABILITY_UNAVAILABLE", "Platform peer dispatch capability is not verified")
        if not isinstance(delegation, dict) or not isinstance(delegation.get("peers"), list) or not delegation["peers"]:
            raise Rejected("INVALID_REQUEST", "Delegation requires a nonempty peers list")
        if set(delegation) - {"peers", "brief", "requiredPermissions", "timeoutSeconds", "idempotencyKey"}:
            raise Rejected("INVALID_REQUEST", "Unknown delegation fields")
        idempotency = delegation.get("idempotencyKey")
        if not isinstance(idempotency, str) or not idempotency:
            raise Rejected("INVALID_REQUEST", "Delegation idempotencyKey required")
        brief = delegation.get("brief")
        if not isinstance(brief, str) or not brief:
            raise Rejected("INVALID_REQUEST", "Delegation brief required")
        store = self.store(parent_run_id)
        sequence_id = "d" + self.c.hash({"key": idempotency})[:12]
        dispatch_dir = relative_path(store.root, "peer-dispatch/" + sequence_id)
        if (dispatch_dir / "response.json").exists():
            return self.c.read(dispatch_dir / "response.json")
        # The contract's delegation member carries an integer sequence. Deriving it at read time
        # would make a replay answer with a different number than the original did, so it is
        # assigned here, once, and sealed into the dispatch record with everything else.
        peers_root = dispatch_dir.parent
        ordinal = 1 + sum(1 for prior in peers_root.iterdir()
                          if prior.is_dir() and prior.name != sequence_id) if peers_root.is_dir() else 1
        lock = store.read("run-lock.json")
        agent_resource = next((r for r in lock["resources"] if r["kind"] == "agent" and r["id"] == lock["selection"]["agent"].split(":", 1)[1]), None)
        if agent_resource is None:
            raise Rejected("UNAUTHORIZED", "Delegation requires an agent-run parent")
        parent_root = unlinked(agent_resource["path"])
        parent_manifest = self.c.read(parent_root / "manifest.json")
        peer_lock = self.c.read(parent_root / parent_manifest["peerLock"]) if parent_manifest.get("peerLock") else None
        if not isinstance(peer_lock, dict) or not isinstance(peer_lock.get("peers"), dict):
            raise Rejected("UNAUTHORIZED", "Parent agent has no valid peer lock")
        scanner = self.c.lint.Scanner(self.config["toolRoot"], self.config["agentRoot"])
        scanner.discover()
        requested = []
        peer_sources = []
        for peer in delegation["peers"]:
            if not isinstance(peer, dict) or set(peer) - {"id", "version"} or not isinstance(peer.get("id"), str):
                raise Rejected("INVALID_REQUEST", "Malformed peer entry")
            ident = peer["id"]
            locked = peer_lock["peers"].get(ident)
            if locked is None:
                raise Rejected("UNAUTHORIZED", "Peer is not locked by the parent: " + ident)
            requested_version = peer.get("version", locked)
            if requested_version != locked:
                raise Rejected("UNAUTHORIZED", "Peer version does not match the exact lock: " + ident + " " + repr(requested_version) + " != " + locked)
            peer_root = Path(scanner.base("agent", ident) if hasattr(scanner, "base") else Path(self.config["agentRoot"]) / ident) / "versions" / locked
            if not peer_root.exists():
                raise Rejected("UNAUTHORIZED", "Locked peer version is missing: " + ident + "@" + locked)
            peer_manifest = self.c.read(peer_root / "manifest.json")
            verifier = self.c.lint.Scanner(self.config["toolRoot"], self.config["agentRoot"])
            verifier.integrity(peer_root, peer_manifest, ("agent", ident, locked))
            if verifier.findings:
                raise Rejected("HASH_MISMATCH", "Locked peer content changed: " + ident)
            requested.append({"id": ident, "version": locked, "manifestSha256": file_hash(peer_root / "manifest.json")})
            peer_sources.append((ident + "@peer-manifest", peer_manifest.get("permissions")))
        try:
            # F3: `requiredPermissions` is part of the accepted delegation shape, so it must
            # actually drive the intersection. The deny/allowlisted-only/project-scoped triple
            # stays the default only when the caller declares nothing.
            demanded = delegation.get("requiredPermissions")
            if demanded is None:
                demanded = {"network": "deny", "process": "allowlisted-only", "filesystem": "project-scoped"}
            permission_report = effective_permissions(
                "delegation", demanded,
                [("platform", capabilities.get("permissions")), (agent_resource["id"], parent_manifest.get("permissions"))] + peer_sources)
        except PermissionDenied as error:
            # error.code is a permissions-vocabulary subcode; only protocol enum members may
            # reach a response, otherwise the rejection itself fails schema validation.
            raise Rejected('UNAUTHORIZED', 'Delegation permission check failed (' + error.code + '): ' + str(error)) from error
        timeout_seconds = delegation.get("timeoutSeconds", 120)
        if not isinstance(timeout_seconds, int) or not 1 <= timeout_seconds <= 3600:
            raise Rejected("INVALID_REQUEST", "Delegation timeoutSeconds out of range")
        request_sha = self.c.hash({"peers": requested, "brief": brief, "parentRunId": parent_run_id})
        dispatch_dir = relative_path(store.root, "peer-dispatch/" + sequence_id)
        record = {"parentRunId": parent_run_id, "sequence": sequence_id, "ordinal": ordinal, "agent": agent_resource["id"],
                  "peers": requested, "brief": brief, "requestSha256": request_sha,
                  "permissions": permission_report["effective"], "permissionsReport": permission_report, "at": now(), "timeoutSeconds": timeout_seconds}
        # F1 / defect ①: resolve the dispatcher BEFORE the first dispatch record lands.
        # Loading it afterwards left a bare KeyError after request.json existed, and every
        # retry under the same idempotency key then hit FileExistsError -- the sequence was
        # wedged permanently with no way to recover the run.
        try:
            module = load_module(self.config["peerDispatcherModule"], "peer_dispatcher")
            dispatcher = module.create({"callsLog": str(dispatch_dir / "calls.log"), "scenario": self.config.get("peerDispatcherScenario", "success")})
        except Rejected:
            raise
        except Exception as error:
            raise Rejected("CAPABILITY_UNAVAILABLE", "Declared peer dispatcher cannot be loaded: " + repr(error))
        dispatch_dir.mkdir(parents=True, exist_ok=False)
        write_bytes(dispatch_dir / "request.json", self.c.canonical(record) + b"\n", exclusive=True)
        outcome = dispatcher.dispatch(record)
        children = outcome.get("children", [])
        seen_ids, seen_peers = set(), set()
        for child in children:
            if child.get("childRunId") in seen_ids:
                raise Rejected("UNAUTHORIZED", "Dispatcher returned a duplicate child run id: " + str(child.get("childRunId")))
            seen_ids.add(child.get("childRunId"))
            if (child.get("peerId"), child.get("peerVersion")) not in {(p["id"], p["version"]) for p in requested}:
                raise Rejected("UNAUTHORIZED", "Dispatcher returned an unrequested peer: " + repr(child.get("peerId")))
            if child.get("requestSha256") != request_sha:
                raise Rejected("HASH_MISMATCH", "Child request hash mismatch for " + str(child.get("peerId")))
            if child.get("status") not in {"completed", "failed", "timeout", "rejected"}:
                raise Rejected("INVALID_REQUEST", "Unknown child status: " + repr(child.get("status")))
            if child["status"] == "completed" and not isinstance(child.get("resultSha256"), str):
                raise Rejected("INVALID_REQUEST", "Completed child lacks a result hash")
        results = {"children": children, "status": outcome.get("status", "completed"), "dispatcherVersion": outcome.get("dispatcherVersion"), "requestSha256": request_sha}
        results_sha = self.c.hash(results)
        response = {"schema": "ai-peer-dispatch/v1", "sequence": sequence_id, "ordinal": ordinal, "peer": [row["id"] for row in requested], "results": results, "resultsSha256": results_sha, "permissions": permission_report, "ok": True}
        write_bytes(dispatch_dir / "results.json", self.c.canonical({"results": results, "resultsSha256": results_sha}) + b"\n", exclusive=True)
        write_bytes(dispatch_dir / "response.json", self.c.canonical(response) + b"\n", exclusive=True)
        return response

    def history(self, path):
        value = self.c.lint.read_json(unlinked(path))
        return {'classification': self.c.reference.history_classification(value), 'sourceSha256': file_hash(path), 'businessStatus': 'information-insufficient', 'changed': False}

    def seal(self, run_id, output_paths, gate_paths):
        store = self.store(run_id)
        with store.lease():
            state = store.read('state.json')
            active = state['activeAttempt']
            if not active or state['stopRequested'] or state['status'] in TERMINAL | {'blocked'}:
                raise Rejected('TERMINAL_RUN', 'No active attempt accepts evidence')
            work = relative_path(store.root, 'work/project')
            prefix = f"evidence/{active['stageId']}/{active['attempt']}/"
            outputs = []
            aliases = set()
            def snapshot(relative, target):
                src = relative_path(work, relative)
                data = src.read_bytes()
                dest = relative_path(store.root, prefix + target)
                if dest.exists():
                    if dest.read_bytes() != data:
                        raise Rejected('HASH_MISMATCH', 'Immutable attempt evidence already exists')
                else:
                    write_bytes(dest, data, exclusive=True)
                if src.read_bytes() != data:
                    raise Rejected('INPUT_MISMATCH', 'Output changed while sealing evidence')
                return record(store.root, dest)
            for path in sorted(output_paths):
                if path.casefold() in aliases:
                    raise Rejected('UNAUTHORIZED', 'Duplicate output alias')
                aliases.add(path.casefold())
                outputs.append(snapshot(path, path))
            gates = []
            for gate_id, path in sorted(gate_paths.items()):
                if not re.fullmatch(r'[A-Za-z0-9_-]+', gate_id):
                    raise Rejected('UNAUTHORIZED', 'Invalid gate identity')
                evidence = snapshot(path, '_gates/' + gate_id + '.json')
                gates.append({'gateId': gate_id, 'status': 'pass', 'inputSha256': active['inputSha256'], 'outputManifestSha256': self.c.hash(outputs), 'evidence': evidence})
            return {k: active[k] for k in ('stageId', 'attempt', 'inputSha256', 'artifacts')} | {'outputs': outputs, 'gates': gates}

    def execute_claimed(self, run_id, tool=None, review=None):
        store = self.store(run_id)
        with store.lease(name='.executor.lock', recover=False):
            return self._execute_claimed(run_id, tool, review)

    @staticmethod
    def pid_alive(pid):
        """Is this host pid still running? Read-only probe, never a kill.

        Windows has no signal 0: `os.kill(pid, 0)` there goes through TerminateProcess, so the
        probe must not use it. Answer None when the platform offers no safe probe at all, so a
        caller can never read "unknown" as "dead".
        """
        if pid is None:
            return None
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return None
        if os.name == 'nt':
            try:
                import ctypes
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
                if not handle:
                    return False
                code = ctypes.c_ulong()
                ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
                kernel32.CloseHandle(handle)
                return bool(ok) and code.value == 259  # STILL_ACTIVE
            except Exception:
                return None
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def dispatch_alive(self, store, state):
        """Liveness of the dispatch this run is holding, from its own records."""
        pids = [m.get('pid') for m in (state.get('managedProcesses') or [])]
        for intent in self.unobserved_processes(store):
            record = relative_path(store.root, str(intent.get('controlRoot', '')) + '/process.json')
            if record.is_file():
                try:
                    pids.append(self.c.read(record).get('pid'))
                except (Rejected, ValueError, OSError):
                    pass
        pids = [x for x in pids if x]
        if not pids:
            return None
        return any(self.pid_alive(pid) for pid in pids)

    def unobserved_processes(self, store):
        events = (store.root / 'events.jsonl').read_text(encoding='utf-8').splitlines()
        observed = {json.loads(line)['transactionId'] for line in events if json.loads(line)['type'] == 'process-exited'}
        return [store.c.read(p) for p in sorted((store.root / 'process-intents').glob('*.json')) if 'exit-' + p.stem not in observed]

    def reconcile_processes(self, store):
        pending = self.unobserved_processes(store)
        if not pending:
            return
        try:
            with store.lease(name='.executor.lock', recover=False):
                pass
        except Rejected:
            return
        before = store.read('state.json')
        if before['status'] in TERMINAL:
            return
        state = copy.deepcopy(before)
        ended = True
        for intent in pending:
            root = relative_path(store.root, intent['controlRoot'])
            write_bytes(root / 'cancel.flag', b'orphaned dispatch\n')
            result = store.c.read(root / 'result.json') if (root / 'result.json').exists() else {}
            ended = ended and result.get('processTreeEnded') is True
        if ended:
            state['managedProcesses'] = []
        state.update(status='stopped' if ended and state['stopRequested'] else 'blocked', outcome='unknown-outcome', error={'code': 'UNKNOWN_OUTCOME', 'message': 'Interrupted script dispatch; cancellation requested, no replay permitted', 'retryable': False})
        if state['status'] == 'stopped':
            state['activeAttempt'] = None
        if state == before:
            return
        event = event_for(self.c, store.read('run-lock.json'), state, before, 'recover-process-' + str(before['stateRevision']), 'stopped' if state['status'] == 'stopped' else 'unknown-outcome')
        store.commit(before, state, [event])

    def _execute_claimed(self, run_id, tool=None, review=None):
        from sandbox import start_script, wait_script
        store = self.store(run_id)
        process = None
        with store.lease():
            before = store.read('state.json')
            lock = store.read('run-lock.json')
            self.verify(store, before, lock)
            active = before['activeAttempt']
            if not active or before['status'] not in {'running', 'waiting-for-input'} or before['stopRequested']:
                raise Rejected('UNAUTHORIZED', 'No script is claimed')
            plan = self.plan(store, lock)
            stage = next(s for s in plan['stages'] if s['id'] == active['stageId'])
            if active['action'] == 'software-call':
                if tool:
                    raise Rejected('UNAUTHORIZED', 'Figure tools require a claimed math FIGURES prompt')
                return self._execute_software(store, before, lock, plan, stage, active)
            label = tool or 'stage'
            if label not in {'stage', 'render-figure', 'record-visual-review'}:
                raise Rejected('UNAUTHORIZED', 'Unknown stage tool')
            process_relative = 'processes/' + active['stageId'] + '/' + label
            process_root = relative_path(store.root, process_relative)
            intent = 'process-intents/' + active['stageId'] + '-' + label + '.json'
            if (store.root / intent).exists():
                raise Rejected('UNKNOWN_OUTCOME', 'A dispatched script is never replayed')
            release = Path(plan['workflowRoot'])
            verifier = self.c.lint.Scanner(self.config['toolRoot'], self.config['agentRoot'])
            verifier.integrity(release, plan['manifest'], ('workflow', plan['manifest']['id'], plan['manifest']['version']))
            if verifier.findings:
                raise Rejected('HASH_MISMATCH', 'Script release changed since prepare')
            arguments = stage.get('arguments', {})
            entry = stage.get('script') if active['attempt'] == 1 else stage.get('repairScript')
            argv = arguments.get('argv', [])
            if tool:
                if plan['manifest']['id'] != 'math-modeling-programmer' or active['stageId'] != 'FIGURES' or active['action'] != 'prompt':
                    raise Rejected('UNAUTHORIZED', 'Figure tools require a claimed math FIGURES prompt')
                config = self.c.lint.read_json(store.root / 'work/project/phase1.json')
                if tool == 'render-figure':
                    entry = 'scripts/run_figure_qa.py'
                    argv = ['--project', '/work', '--source', config['figureSource'], '--contract', config['figureContract'], '--output-dir', config['qaDirectory'], '--strict']
                else:
                    if not review or not review.get('observations') or review.get('decision') not in ('PASS', 'REWORK', 'BLOCKED') or review.get('reviewerType') not in ('human', 'multimodal-agent'):
                        raise Rejected('INVALID_REQUEST', 'Actual visual review is required')
                    entry = 'scripts/record_visual_review.py'
                    argv = ['--project', '/work', '--preview', config['qaDirectory'] + '/preview.png', '--qa-report', config['qaDirectory'] + '/figure_qa.json', '--output', config['visualReview'], '--decision', review['decision'], '--reviewer-type', review['reviewerType'], '--reviewer', review['reviewer']]
                    for observation in review['observations']:
                        argv += ['--observation', observation]
                    for check in review.get('checks', []):
                        argv += ['--check', check]
            if not entry:
                raise Rejected('CAPABILITY_UNAVAILABLE', 'No locked script entry for this prompt')
            # C2d + 2.1.0 P6: the rung this run was pinned to at prepare is the only one it may
            # use. A ladder that no longer offers it is a fail-closed refusal, never a silent
            # substitution, and it happens before any dispatch intent exists on disk.
            rung = next((r for r in (self.config.get('scriptEnvironmentRungs') or [])
                         if r.get('execPath') == lock['execution'].get('execPath')), None)
            if not rung:
                raise Rejected('CAPABILITY_UNAVAILABLE',
                               'This run is pinned to execPath ' + str(lock['execution'].get('execPath'))
                               + ', which the platform ladder does not currently offer (sealed script '
                               'environment declared: ' + str(bool(self.config.get('environmentManifest')))
                               + '; the host rung needs consent carried by this run itself)')
            backend = rung['executionBackend']
            sealed_rung = bool(rung.get('requiresSealedEnvironment'))
            script_environment = rung.get('scriptEnvironment') or self.config['scriptEnvironment']
            # D-56: a mistyped environment root used to surface only after the kernel failed to
            # mount it. Answer it here, as an input problem naming the config key, before any
            # dispatch intent exists.
            if not Path(str(script_environment)).is_dir():
                raise Rejected('INVALID_REQUEST',
                               'The pinned script environment root does not exist: ' + str(script_environment)
                               + ' (declared by scriptEnvironmentRungs[].scriptEnvironment for execPath='
                               + str(rung['execPath']) + '; executionBackend=' + str(backend) + ')')
            verification = None
            if sealed_rung:
                from environment_guard import verify_script
                if Path(str(backend)).is_file() and json.loads(
                        Path(str(backend)).read_text(encoding='utf-8-sig')).get('kind') != 'wsl2':
                    raise Rejected('CAPABILITY_UNAVAILABLE',
                                   'A sealed rung verifies its environment through a jail backend; this '
                                   'rung document declares kind=' + str(backend))
                environment = self.c.read(self.config['environmentManifest'])
                if not environment.get('files'):
                    raise Rejected('CAPABILITY_UNAVAILABLE', 'Actual script environment inventory is required')
                from sandbox import linux
                if linux(script_environment, backend) != environment['environment']:
                    raise Rejected('HASH_MISMATCH', 'Script interpreter root differs from pinned snapshot')
                if self.config.get('hostEnvironmentManifest'):
                    capabilities = self.c.read(self.config['capabilities'])
                    if capabilities.get('controllerSha256') != file_hash(Path(__file__).with_name('sandbox_linux.py')):
                        raise Rejected('CAPABILITY_UNAVAILABLE', 'Isolation controller differs from accepted implementation')
                verification = verify_script(self.config['environmentManifest'], backend,
                                             store_root=None if lock['execution'].get('rigor') == 'full'
                                             else store.root)
            store.write(intent, {'stageId': active['stageId'], 'attempt': active['attempt'], 'inputSha256': active['inputSha256'], 'boundary': 'dispatch-intent', 'entry': entry, 'argv': argv, 'controlRoot': process_relative, 'at': now(), 'execPath': rung['execPath'],
                                       'rungBackend': str(backend),
                                       'rungBackendSha256': file_hash(Path(str(backend))),
                                       'scriptEnvironment': str(script_environment),
                                       'environmentSealed': sealed_rung,
                                       'environmentVerification': verification}, exclusive=True)
            if self.fault:
                self.fault('before-script-launch')
            # D-53: the dispatch carries the file that attests its environment and the digest it
            # was pinned to; the sandbox re-checks both before it creates anything.
            seal_manifest = self.config['environmentManifest'] if sealed_rung else str(backend)
            process = start_script(release, entry, argv, store.root / 'work/project', Path(script_environment), process_root, arguments.get('timeoutSeconds', 30), gated=True, backend=backend,
                                   seal_manifest=seal_manifest, seal_digest=file_hash(Path(str(seal_manifest))))
            store.write('managed-script.json', {'root': process_relative})
            state = copy.deepcopy(before)
            state['status'] = 'running'
            state['managedProcesses'] = [{'pid': process.pid, 'startedAt': now(), 'identitySha256': file_hash(process_root / 'config.json')}]
            event = event_for(self.c, lock, state, before, 'process-' + active['stageId'] + '-' + label, 'stage-claimed')
            try:
                store.commit(before, state, [event])
                write_bytes(process_root / 'authorize.flag', b'committed\n', exclusive=True)
            except BaseException:
                write_bytes(process_root / 'cancel.flag', b'commit failure\n')
                wait_script(process, process_root)
                raise
        try:
            result = wait_script(process, process_root)
        except Rejected:
            self.block_uncertain(run_id)
            raise
        with store.lease(wait_seconds=10):
            before = store.read('state.json')
            state = copy.deepcopy(before)
            state['managedProcesses'] = []
            state['status'] = 'waiting-for-input' if active['action'] == 'prompt' else 'running'
            events = [event_for(self.c, lock, state, before, 'exit-' + active['stageId'] + '-' + label, 'process-exited')]
            prior = copy.deepcopy(state)
            if state['stopRequested']:
                state.update(status='stopped', activeAttempt=None)
                events.append(event_for(self.c, lock, state, prior, 'exit-' + active['stageId'] + '-' + label, 'stopped'))
            elif result['reason'] == 'timeout' or result['exitCode'] != 0:
                state.update(status='failed', activeAttempt=None, error={'code': 'TIMEOUT' if result['reason'] == 'timeout' else 'EXECUTION_FAILED', 'message': 'Managed script ended without success', 'retryable': False})
                events.append(event_for(self.c, lock, state, prior, 'exit-' + active['stageId'] + '-' + label, 'failed'))
            store.commit(before, state, events)
        return result

    def block_uncertain(self, run_id):
        """Explicit diagnosis never dispatches or replays uncertain side effects."""
        store = self.store(run_id)
        with store.lease():
            before = store.read('state.json')
            if before['status'] in TERMINAL:
                return before
            state = copy.deepcopy(before)
            state.update(status='blocked', outcome='unknown-outcome', error={'code': 'UNKNOWN_OUTCOME', 'message': 'Process side effects cannot be reconstructed; inspect and stop before a new run', 'retryable': False})
            event = event_for(self.c, store.read('run-lock.json'), state, before, 'diagnose-unknown', 'unknown-outcome')
            store.commit(before, state, [event])
            return state
