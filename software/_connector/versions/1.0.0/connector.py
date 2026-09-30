"""Shared software connector (architecture 3.2, step P3).

One JSON object in on stdin, one JSON object out on stdout - the dispatch shape the engine already
uses. It replaces the reference gateway's role for a platform that adopts it, and it keeps the three
published engine-facing shapes (`ai-software-call/v1`, `ai-software-inventory/v1`,
`ai-software-instance/v1`) byte-for-byte as the engine knows them, so adopting this component asks
nothing of `wf-runner`. The five read-facing entries (`software.list`, `software.describe`,
`software.health`, `software.artifact`, `software.evidence`) ride one new envelope defined beside this
file, and long-lived GUI/MCP sessions answer to `ai-software-session/v1` - the only 3.2 shape that was
genuinely missing. No new error code appears anywhere: the vocabulary is the published eleven.

What it does instead of asking a CLI body a question it cannot answer (D-60): a frozen capability
snapshot is the baseline, and every answer says which attestation it used. `snapshot-only` proves
"declared + frozen + body present with the recipe's digest"; it never claims "the body advertised
this tool". A body is asked for its capability list only where the recipe's transport is native MCP
and the release declares `native-tools-list`.

Every refusal happens before a body is started, and names the key that caused it.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CALL = 'ai-software-call/v1'
INVENTORY = 'ai-software-inventory/v1'
INSTANCE = 'ai-software-instance/v1'
SESSION = 'ai-software-session/v1'
ADMIN = 'ai-software-admin/v1'
ENVELOPES = (CALL, INVENTORY, INSTANCE, SESSION, ADMIN)
CALL_ROOT_NAME = 'software-calls'
SESSION_ROOT_NAME = 'software-sessions'
ARTIFACT_CAP = 200
STALE_AFTER_SECONDS = 3600
FORBIDDEN_ARGV_FLAGS = ('--tools',)
ENGINE_ADDED_CALL_KEYS = ('consented', 'holder')
URL_LIKE = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]*://')
PLACEHOLDER = re.compile(r'\$\{([A-Za-z0-9._-]+)\}')
SEMVER = re.compile(r'^[0-9]+\.[0-9]+\.[0-9]+$')
KIND_ADAPTER = {'cli-wrapper': 'generic-cli', 'mcp-stdio': 'mcp-proxy', 'mcp-http': 'http-adapter',
                'local-process': 'generic-cli'}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def file_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


class Refuse(Exception):
    """A structured refusal. `named` always points at the recipe or config key at fault, because a
    refusal the operator cannot act on is not a refusal."""

    def __init__(self, code, message, named=None, retryable=False, state=None):
        Exception.__init__(self, message)
        self.code, self.message = code, message
        self.named = dict(named or {})
        self.retryable = retryable
        self.state = state


class Release(object):
    """One pinned release of one recipe: its directory, manifest, frozen-or-not snapshot and overlay."""

    def __init__(self, software_id, version, directory, manifest, snapshot):
        self.software_id = software_id
        self.version = version
        self.directory = directory
        self.manifest = manifest
        self.snapshot = snapshot

    @property
    def frozen(self):
        return bool(self.snapshot.get('frozen'))

    @property
    def snapshot_names(self):
        return sorted(str(c.get('name')) for c in self.snapshot.get('capabilities') or [])

    def capability(self, name):
        return next((c for c in self.manifest.get('capabilities') or [] if c.get('name') == name), None)

    def snapshot_capability(self, name):
        return next((c for c in self.snapshot.get('capabilities') or [] if c.get('name') == name), None)

    def recipe(self, platform):
        path = self.directory / 'recipes' / ('%s.json' % platform)
        if not path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'this release carries no recipe for the running OS, so '
                         'the connector will not guess an install layout',
                         {'softwareId': self.software_id, 'missing': 'recipes/%s.json' % platform})
        return read_json(path)


class Connector(object):
    def __init__(self, config):
        self.config = config or {}
        missing = [k for k in ('softwareRoot', 'lockRoot', 'evidenceRoot') if not self.config.get(k)]
        if missing:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the connector config declares no ' + ', '.join(missing),
                         {'configKeys': missing})
        self.root = pathlib.Path(self.config['softwareRoot'])
        self.lock_root = pathlib.Path(self.config['lockRoot'])
        self.call_root = pathlib.Path(self.config['evidenceRoot'])
        if self.call_root.name != CALL_ROOT_NAME:
            self.call_root = self.call_root / CALL_ROOT_NAME
        self.session_root = pathlib.Path(self.config.get('sessionRoot') or
                                         (self.call_root.parent / SESSION_ROOT_NAME))
        self.bodies = {k: pathlib.Path(v) for k, v in (self.config.get('bodies') or {}).items()}
        self.suffix_interpreters = self.config.get('interpreters') or {}
        self.alias_interpreters = self.config.get('interpreterAliases') or {}
        self.profiles = self.config.get('softwareProfiles') or {}
        self.allowed_hosts = self.config.get('allowedHosts')
        self.project_roots = [pathlib.Path(p) for p in (self.config.get('projectWriteRoots') or [])]
        self.artifact_roots = [pathlib.Path(p) for p in (self.config.get('artifactRoots') or [])] or \
            list(self.project_roots)
        self.allow_gui_launch = bool(self.config.get('allowGuiLaunch'))
        self.platform = (self.config.get('platform') or
                         ('windows' if os.name == 'nt' else 'linux'))

    # ------------------------------------------------------------------ resolution

    def registry(self):
        path = self.root / 'registry.json'
        if not path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the software registry is missing',
                         {'configKey': 'softwareRoot', 'expected': str(path)})
        return read_json(path)

    def pinned_version(self, software_id):
        entry = next((e for e in self.registry().get('software') or [] if e.get('id') == software_id), None)
        if entry is None:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'no such recipe in the registry',
                         {'registry': 'software/registry.json', 'softwareId': software_id})
        pointer_path = self.root / entry['current']
        if not pointer_path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the registry points at a pointer that does not exist',
                         {'softwareId': software_id, 'pointer': entry['current']})
        return read_json(pointer_path).get('version')

    def release(self, software_id, version=None):
        """`version` is resolved, never trusted from the caller: a connector only serves the release the
        pointer pins, so a stale stage claim cannot reach a body the platform never adopted."""
        pinned = self.pinned_version(software_id)
        if version not in (None, 'current', '', pinned):
            raise Refuse('SOFTWARE_NOT_INSTALLED', 'the connector only serves the pinned release of a recipe',
                         {'softwareId': software_id, 'asked': version, 'pinned': pinned})
        if not SEMVER.match(str(pinned or '')):
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the pointer for this recipe names no semantic version',
                         {'softwareId': software_id, 'pointerVersion': pinned})
        directory = self.root / software_id / 'versions' / str(pinned)
        manifest_path = directory / 'manifest.json'
        if not manifest_path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the pinned release carries no manifest',
                         {'softwareId': software_id, 'missing': str(manifest_path.relative_to(self.root))})
        manifest = read_json(manifest_path)
        snapshot_path = directory / manifest.get('snapshot', 'capabilities.snapshot.json')
        if not snapshot_path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the manifest names a snapshot that is not in the release',
                         {'softwareId': software_id, 'field': 'manifest.json#snapshot',
                          'expected': str(snapshot_path.name)})
        return Release(software_id, str(pinned), directory, manifest, read_json(snapshot_path))

    # ------------------------------------------------------------------ per-release overlay (connector.json)

    def declaration(self, rel):
        """The 3.2 overlay, or a derivation of the published manifest when a release carries none.

        Derived rather than required: the six published recipes are immutable (red line 1) and P2's
        judgement is that they stay usable byte-for-byte. A derived overlay claims nothing the
        manifest and snapshot do not already say, and every answer names itself `derived`.
        """
        path = rel.directory / 'connector.json'
        if path.is_file():
            doc = read_json(path)
            if doc.get('schema') != 'ai-software-connector/v1':
                raise Refuse('CAPABILITY_UNAVAILABLE', 'connector.json is not an ai-software-connector/v1 '
                             'document', {'softwareId': rel.software_id, 'field': 'connector.json#schema'})
            if doc.get('softwareId') != rel.software_id or doc.get('softwareVersion') != rel.version:
                raise Refuse('SOFTWARE_DRIFT', 'connector.json names a different release than the manifest '
                             'beside it', {'softwareId': rel.software_id, 'asked': '%s/%s' %
                                           (doc.get('softwareId'), doc.get('softwareVersion')),
                                           'pinned': '%s/%s' % (rel.software_id, rel.version)})
            return doc, 'declared'
        operations = {}
        for cap in rel.manifest.get('capabilities') or []:
            requests = cap.get('permissionRequests') or {}
            operations[cap['name']] = {
                'capability': cap['name'],
                'inputSchemaRef': cap.get('inputSchemaRef'),
                'outputSchemaRef': cap.get('outputSchemaRef'),
                'credentials': [requests.get('credentials') or 'none'],
                'interactive': False,
            }
        runtime = rel.snapshot.get('runtime') or {}
        doc = {
            'schema': 'ai-software-connector/v1',
            'softwareId': rel.software_id,
            'softwareVersion': rel.version,
            'adapter': KIND_ADAPTER.get(rel.manifest.get('kind'), 'generic-cli'),
            'transports': [rel.manifest.get('kind') or 'cli-wrapper'],
            'connectorRuntime': 'python-3.9',
            'interpreterAlias': runtime.get('interpreter'),
            'userModes': ['direct-cli', 'mediated-call'],
            'sessionModel': (rel.manifest.get('concurrency') or {}).get('instanceMode') or 'per-run',
            'requiresConsent': any((c.get('consent') or 'auto') != 'auto'
                                   for c in rel.manifest.get('capabilities') or []),
            'exclusiveResources': (rel.manifest.get('concurrency') or {}).get('exclusiveResources') or [],
            'operations': operations,
        }
        return doc, 'derived'

    def operation(self, rel, decl, name):
        item = (decl.get('operations') or {}).get(name)
        if item is None:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the release does not offer that operation',
                         {'softwareId': rel.software_id, 'operation': name,
                          'offered': sorted((decl.get('operations') or {}).keys())})
        if rel.capability(item.get('capability')) is None:
            raise Refuse('SOFTWARE_DRIFT', 'the operation names a capability the manifest does not declare',
                         {'softwareId': rel.software_id, 'operation': name,
                          'capability': item.get('capability')})
        return item

    def permissions(self, rel, operation):
        """What a call may touch comes from the published capability, not from the overlay: a
        `connector.json` has no axis for network or filesystem reach (D-84), so it can narrow which
        credential references a call carries but it cannot widen what the manifest already declares."""
        capability = rel.capability(operation.get('capability')) or {}
        requests = dict(capability.get('permissionRequests') or {})
        requests['network'] = requests.get('network') or 'none'
        requests['credentials'] = list(operation.get('credentials') or
                                       [requests.get('credentials') or 'none'])
        return requests

    # ------------------------------------------------------------------ bodies, interpreters, digests

    def body(self, rel):
        path = self.bodies.get(rel.software_id)
        expected = (self.config.get('bodies') or {}).get(rel.software_id, '')
        if path is None or not path.is_file():
            raise Refuse('SOFTWARE_NOT_INSTALLED', 'this platform has no installed body for the recipe',
                         {'configKey': 'bodies.%s' % rel.software_id, 'expectedPath': str(expected)})
        return path

    def interpreter_for(self, rel, decl, body):
        """Two different things are resolved here and the 3.2 ruling keeps them apart: the connector's
        own runtime, and the interpreter the software body needs (which comes from the frozen
        snapshot's alias, not from whatever python the platform happens to have)."""
        alias = decl.get('interpreterAlias') or (rel.snapshot.get('runtime') or {}).get('interpreter')
        suffix = body.suffix.lower()
        resolved = self.alias_interpreters.get(alias or '') or self.suffix_interpreters.get(suffix)
        needs = suffix in ('.py', '')
        if not needs:
            return None, alias
        if not resolved:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the platform config resolves no interpreter for this '
                         'body, and the connector will not guess one',
                         {'configKey': 'interpreterAliases.%s' % (alias or '<none>'),
                          'fallbackKey': 'interpreters.%s' % suffix})
        if not pathlib.Path(resolved).is_file():
            raise Refuse('SOFTWARE_NOT_INSTALLED', 'the interpreter the platform resolves does not exist',
                         {'configKey': 'interpreterAliases.%s' % alias, 'expectedPath': str(resolved)})
        return str(resolved), alias

    def body_digest_state(self, rel):
        """`ok` / `missing` / `mismatch` / `unverifiable`: the recipe's own verify.files list is the
        only baseline, and a malformed digest is reported as unverifiable rather than as a pass."""
        body = self.bodies.get(rel.software_id)
        if body is None:
            return 'missing', {'configKey': 'bodies.%s' % rel.software_id}
        if not body.is_file():
            return 'missing', {'configKey': 'bodies.%s' % rel.software_id, 'expectedPath': str(body)}
        try:
            recipe = rel.recipe(self.platform)
        except Refuse as refusal:
            return 'unverifiable', dict(refusal.named, reason='no-recipe-for-platform')
        wanted = [e for e in (recipe.get('verify') or {}).get('files') or []
                  if pathlib.Path(str(e.get('path', ''))).name.lower() == body.name.lower()]
        if not wanted:
            return 'unverifiable', {'reason': 'recipe.verify.files names no entry for the body',
                                    'body': body.name}
        entry = wanted[0]
        expected = str(entry.get('sha256') or '')
        if not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
            return 'unverifiable', {'reason': 'recipe digest is not 64 hex characters',
                                    'length': len(expected)}
        if file_sha256(body) != expected.lower():
            return 'mismatch', {'configKey': 'bodies.%s' % rel.software_id, 'expected': expected.lower(),
                                'actual': file_sha256(body)}
        return 'ok', {}

    def variables(self, rel, recipe, body):
        """`softwareRoot` in a recipe means the *install* root, not the shared repository: that is what
        the published recipes' own `verify.versionCall` lines assume (D-48 was never about the repo).
        The release directory gets its own key so a declaration can name schemas without a body path."""
        install = recipe.get('install') or {}
        detected = str(install.get('detectedPath') or (body.parent if body else ''))
        vars_ = {'softwareRoot': detected, 'detectedPath': detected,
                 'recipeRoot': str(rel.directory), 'platformRuntime':
                 str(self.config.get('softwareRuntimeRoot') or ''),
                 'pythonPath': str(install.get('pythonPath') or ''),
                 'bodyPath': str(body), 'bodyDir': str(body.parent if body else detected),
                 'bodyName': body.name if body else ''}
        for key, value in (self.config.get('recipeVariables') or {}).items():
            vars_.setdefault(key, str(value))
        return vars_

    def resolve_program(self, rel, name, vars_, where):
        """A bare program name in a recipe (`mysql.exe`, `mysqldump.exe`, `editcap.exe`) is resolved
        against the install directory or the platform's tool map, and never against PATH: a connector
        that searches PATH can dispatch a different program than the one the recipe pinned."""
        text = self.interpolate(name, vars_, where)
        candidate = pathlib.Path(text)
        if candidate.is_absolute() or str(candidate.parent) != '.':
            resolved = candidate
        else:
            tools = self.config.get('tools') or {}
            if text in tools:
                resolved = pathlib.Path(str(tools[text]))
            else:
                resolved = pathlib.Path(vars_['bodyDir']) / text
                if not resolved.is_file():
                    resolved = pathlib.Path(vars_['detectedPath']) / text
        if not resolved.is_file():
            raise Refuse('SOFTWARE_NOT_INSTALLED', 'the program the capability names cannot be resolved on '
                         'this platform, and the connector will not search PATH for a substitute',
                         {'softwareId': rel.software_id, 'program': text, 'tried': str(resolved),
                          'configKey': 'tools.%s' % text})
        return str(resolved)

    def interpolate(self, text, vars_, where):
        def take(match):
            key = match.group(1)
            value = vars_.get(key)
            if not value:
                raise Refuse('CAPABILITY_UNAVAILABLE', 'a launch path names %s, which nothing on this '
                             'platform resolves; the connector will not substitute a guess' % key,
                             {'field': where, 'placeholder': '${%s}' % key,
                              'configKey': 'recipeVariables.%s' % key})
            return value

        out = PLACEHOLDER.sub(take, str(text))
        if PLACEHOLDER.search(out):
            raise Refuse('INVALID_REQUEST', 'an unresolvable placeholder is still in %s' % where,
                         {'field': where})
        return out

    # ------------------------------------------------------------------ locks (platform-internal, C-8)

    def lock_file(self, key):
        return self.lock_root / (hashlib.sha256(key.encode('utf-8')).hexdigest() + '.json')

    def claim(self, key, holder):
        self.lock_root.mkdir(parents=True, exist_ok=True)
        path = self.lock_file(key)
        record = {'key': key, 'holder': holder, 'claimedAt': now()}
        try:
            with path.open('x', encoding='utf-8') as stream:
                json.dump(record, stream, ensure_ascii=False)
            return True
        except FileExistsError:
            try:
                current = json.loads(path.read_text(encoding='utf-8'))
            except ValueError:
                current = {}
            stale = path.stat().st_mtime < time.time() - STALE_AFTER_SECONDS
            if not current.get('holder') or stale:
                self._write(path, record)
                return True
            return False

    def release_lock(self, key, holder):
        path = self.lock_file(key)
        if not path.is_file():
            return
        try:
            owner = json.loads(path.read_text(encoding='utf-8')).get('holder')
        except ValueError:
            owner = None
        if owner in (None, holder):
            try:
                path.unlink()
            except OSError:
                pass

    def instance_keys(self, rel, decl):
        mode = decl.get('sessionModel') or (rel.manifest.get('concurrency') or {}).get('instanceMode') or 'per-run'
        if mode == 'per-run':
            return mode, []
        if mode == 'pooled':
            size = max(1, int((rel.manifest.get('concurrency') or {}).get('poolSize') or 1))
            return mode, ['%s:pooled:%d' % (rel.software_id, int(digest('adhoc'), 16) % size)]
        return mode, ['%s:singleton' % rel.software_id]

    def exclusive_keys(self, rel, decl):
        return ['%s:%s' % (rel.software_id, r) for r in decl.get('exclusiveResources') or []]

    @staticmethod
    def _write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(json.dumps(value, ensure_ascii=False, indent=1).encode('utf-8') + b'\n')

    @staticmethod
    def _write_line(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(json.dumps(value, ensure_ascii=False).encode('utf-8') + b'\n')

    # ------------------------------------------------------------------ evidence and idempotency

    def next_sequence(self, root):
        """Numbered, exclusive, and never `len(dirs) + 1` over a glob that also sees index files: the
        sequence is what the engine indexes its ledger by, so a collision would overwrite evidence."""
        root.mkdir(parents=True, exist_ok=True)
        taken = {int(p.name) for p in root.iterdir() if p.is_dir() and p.name.isdigit()}
        n = max(taken) + 1 if taken else 1
        while True:
            try:
                (root / str(n)).mkdir()
                return n
            except FileExistsError:
                n += 1

    def index_path(self):
        return self.call_root.parent / 'software-call-index.json'

    def read_index(self):
        path = self.index_path()
        if path.is_file():
            return read_json(path)
        return {'schema': 'ai-software-call-index/v1', 'byIdempotencyKey': {}}

    def remember(self, key, entry):
        path = self.index_path()
        index = self.read_index()
        entry = dict(entry, at=now())
        index['byIdempotencyKey'][key] = entry
        self._write(path, index)
        return entry

    def evidence_answer(self, call_dir, response):
        self._write_line(call_dir / 'response.json', response)
        return response

    # ------------------------------------------------------------------ arguments: validate, then build argv

    def validate_arguments(self, rel, operation, arguments):
        """A refusal has to name the field, so each document is checked against its own $def rather
        than the root oneOf (the P2 observation). Schema validation is fail-closed: without the
        validator the connector will not dispatch an argument set it could not read."""
        ref = operation.get('inputSchemaRef')
        if not ref:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the operation declares no input schema, so its '
                         'arguments cannot be checked',
                         {'softwareId': rel.software_id, 'operation': operation.get('capability'),
                          'field': 'operations.*.inputSchemaRef'})
        path = rel.directory / ref
        if not path.is_file():
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the input schema the operation names is not in the '
                         'release', {'softwareId': rel.software_id, 'missing': ref})
        schema = read_json(path)
        try:
            from jsonschema import Draft202012Validator
        except ImportError:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the connector cannot validate arguments because no '
                         'JSON Schema validator is importable in its runtime; it will not dispatch an '
                         'unchecked argument set',
                         {'configKey': 'interpreters..py', 'module': 'jsonschema'})
        errors = sorted(Draft202012Validator(schema).iter_errors(arguments), key=lambda e: list(e.path))
        if errors:
            first = errors[0]
            raise Refuse('INVALID_REQUEST', 'the arguments do not match the operation input schema',
                         {'softwareId': rel.software_id, 'jsonPointer': '/' + '/'.join(str(p) for p in first.path),
                          'message': first.message[:300], 'count': len(errors)})
        for name, value in sorted((arguments or {}).items()):
            if isinstance(value, str) and (value.startswith('-') or any(c in value for c in '\r\n\x00')):
                raise Refuse('INVALID_REQUEST', 'an argument value would be read by the body as a flag or '
                             'carries a control character',
                             {'softwareId': rel.software_id, 'argument': name, 'reason': 'flag-or-control-char'})
        return schema

    def build_argv(self, rel, recipe, invocation, interpreter, body, arguments, decl):
        vars_ = self.variables(rel, recipe, body)
        executable = invocation.get('executable')
        base = [self.resolve_argument_path(rel, item, vars_) for item in invocation.get('baseArgv') or []]
        if executable:
            launcher = self.resolve_program(rel, executable, vars_, 'manifest.invocation.executable')
            needs_runtime = body.suffix.lower() in ('.py', '')
            if needs_runtime and not any(os.path.realpath(str(p)) == os.path.realpath(str(body))
                                         for p in base):
                argv = [launcher, str(body)]
            else:
                argv = [launcher]
        elif interpreter:
            argv = [str(interpreter), str(body)]
        else:
            argv = [str(body)]
        argv += base
        self.check_interpreter_alias(rel, decl, argv[0])
        given = dict(arguments or {})
        for spec in invocation.get('argMapping') or []:
            param = spec.get('param')
            if param not in given:
                if spec.get('required'):
                    raise Refuse('INVALID_REQUEST', 'a required parameter is missing from the arguments',
                                 {'softwareId': rel.software_id, 'parameter': param})
                continue
            value = given.pop(param)
            flag = spec.get('flag') or ''
            style = spec.get('style') or 'repeat'
            values = value if isinstance(value, list) else [value]
            for single in values:
                text = str(single)
                if style == 'positional':
                    argv.append(text)
                elif style == 'equals':
                    argv.append('%s=%s' % (flag, text))
                else:
                    argv.extend([flag, text] if flag else [text])
        if given:
            raise Refuse('INVALID_REQUEST', 'the arguments carry parameters this capability does not map',
                         {'softwareId': rel.software_id, 'unmapped': sorted(given),
                          'mapped': sorted(spec.get('param') for spec in invocation.get('argMapping') or [])})
        for item in argv:
            if str(item) in FORBIDDEN_ARGV_FLAGS:
                raise Refuse('CAPABILITY_UNAVAILABLE', 'the connector never asks a body for a tool list it '
                             'does not advertise (D-60)', {'softwareId': rel.software_id, 'flag': item})
        return argv

    PATHISH = re.compile(r'([/\\]|\.[A-Za-z0-9]{1,5}$)')

    def resolve_argument_path(self, rel, item, vars_):
        """An argument position that names a file (a script entry, a capture fixture) has to exist
        before the body is started; a flag stays a flag."""
        text = self.interpolate(item, vars_, 'manifest.invocation.baseArgv')
        if not self.PATHISH.search(text) or text.startswith('-'):
            return text
        candidate = pathlib.Path(text)
        if not candidate.is_absolute():
            for base in (vars_['bodyDir'], vars_['detectedPath']):
                if (pathlib.Path(base) / text).is_file():
                    candidate = pathlib.Path(base) / text
                    break
        if not candidate.is_file():
            raise Refuse('SOFTWARE_NOT_INSTALLED', 'a launch path in the recipe does not exist on this '
                         'platform', {'softwareId': rel.software_id, 'path': text, 'tried': str(candidate)})
        return str(candidate)

    def check_interpreter_alias(self, rel, decl, launcher):
        """The 3.2 ruling separates the connector's own runtime from the body's interpreter, and P4 has
        to prove the body's interpreter is the one the frozen snapshot recorded - so a recipe that
        resolves to a different program than the alias is refused rather than quietly run."""
        alias = decl.get('interpreterAlias') or (rel.snapshot.get('runtime') or {}).get('interpreter')
        declared = self.alias_interpreters.get(str(alias))
        if not declared:
            return
        if os.path.realpath(str(declared)).lower() != os.path.realpath(str(launcher)).lower():
            raise Refuse('SOFTWARE_DRIFT', 'the recipe launches a different interpreter than the one the '
                         'frozen snapshot names',
                         {'softwareId': rel.software_id, 'alias': alias, 'snapshotInterpreter': str(declared),
                          'recipeLauncher': str(launcher)})

    # ------------------------------------------------------------------ boundary checks

    def check_consent(self, rel, operation, message):
        capability = rel.capability(operation.get('capability')) or {}
        consent = capability.get('consent') or 'auto'
        if consent == 'auto' or message.get('consented'):
            return
        raise Refuse('CONSENT_REQUIRED', 'this capability needs confirmation for this call',
                     {'softwareId': rel.software_id, 'capability': capability.get('name'), 'consent': consent})

    def check_credentials(self, rel, perms, message):
        given = list(message.get('credentialReferences') or [])
        for bad in [g for g in given if not re.fullmatch(r'reference:[A-Za-z0-9._-]+', str(g))]:
            raise Refuse('INVALID_REQUEST', 'a credential reference must be `reference:<name>`; the '
                         'connector accepts no other form and never a literal, whatever the operation '
                         'needs', {'softwareId': rel.software_id, 'value': str(bad)[:40]})
        wanted = [c for c in perms.get('credentials') or [] if c and c != 'none']
        if not wanted:
            return
        missing = [w for w in wanted if w not in given]
        if missing:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the operation needs credential references the request '
                         'does not carry', {'softwareId': rel.software_id, 'required': missing,
                                            'carried': given})

    REACH_ORDER = {'filesystem': ['none', 'read', 'workspace', 'system'],
                   'network': ['none', 'loopback', 'scoped', 'public']}

    @classmethod
    def _rank(cls, axis, value):
        base = str(value or 'none').split(':', 1)[0]
        order = cls.REACH_ORDER[axis]
        return order.index(base) if base in order else len(order)

    def check_profile(self, rel, perms, message):
        """A profile the platform declares is a ceiling, so a capability that reaches further than it
        is refused before anything starts. A profile that stays silent on an axis polices nothing."""
        name = message.get('profile')
        if not name:
            return
        profile = self.profiles.get(name)
        if profile is None:
            raise Refuse('PROFILE_NOT_DECLARED', 'this platform declares no such software profile',
                         {'configKey': 'softwareProfiles.%s' % name,
                          'declared': sorted(self.profiles)})
        for axis, key in (('filesystem', 'filesystem'), ('network', 'network')):
            allowed = profile.get(key) or []
            needed = perms.get(key) or 'none'
            if not allowed:
                continue
            worst = max(self._rank(axis, a) for a in allowed)
            if self._rank(axis, needed) > worst:
                raise Refuse('PROFILE_NOT_DECLARED', 'the profile this call names does not declare the '
                             '%s reach the capability asks for' % axis,
                             {'softwareId': rel.software_id, 'profile': name, axis: needed,
                              'declared': allowed})

    def check_network(self, rel, perms, arguments):
        if perms.get('network') == 'none':
            for name, value in sorted((arguments or {}).items()):
                if isinstance(value, str) and URL_LIKE.match(value):
                    raise Refuse('EGRESS_DENIED', 'the capability declares no network egress but the '
                                 'arguments carry a URL',
                                 {'softwareId': rel.software_id, 'argument': name})
        if not self.allowed_hosts:
            return
        for value in (arguments or {}).values():
            if not isinstance(value, str) or not URL_LIKE.match(value):
                continue
            host = urllib.parse.urlparse(value).hostname or ''
            if host and host not in self.allowed_hosts:
                raise Refuse('EGRESS_DENIED', 'the target host is not in the platform allow list',
                             {'softwareId': rel.software_id, 'host': host,
                              'configKey': 'allowedHosts'})

    def check_paths(self, rel, arguments):
        if not self.project_roots:
            return
        for name, value in sorted((arguments or {}).items()):
            if not isinstance(value, str) or URL_LIKE.match(value) or not re.search(r'[\\/]', value):
                continue
            path = pathlib.Path(value)
            if path.is_absolute() and not any(self._within(root, path) for root in self.project_roots):
                raise Refuse('INVALID_REQUEST', 'an absolute path argument escapes the roots this platform '
                             'opens for the connector',
                             {'softwareId': rel.software_id, 'argument': name,
                              'roots': [str(r) for r in self.project_roots]})

    @staticmethod
    def _within(root, path):
        try:
            pathlib.Path(os.path.realpath(str(path))).relative_to(os.path.realpath(str(root)))
            return True
        except ValueError:
            return False

    # ------------------------------------------------------------------ attestation (D-60)

    def attest(self, rel, capability_name, decl):
        """Say what was actually verified. A CLI body is never asked for a tool list; only native MCP
        transports have that question, and only when the release says so."""
        if not rel.frozen:
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the capability snapshot is not frozen, so the connector '
                         'cannot verify anything against a baseline',
                         {'softwareId': rel.software_id,
                          'field': 'capabilities.snapshot.json#frozen'})
        if capability_name not in rel.snapshot_names:
            raise Refuse('SOFTWARE_DRIFT', 'the requested capability is not in the frozen snapshot',
                         {'softwareId': rel.software_id, 'capability': capability_name,
                          'snapshot': rel.snapshot_names})
        if decl.get('attestation') != 'native-tools-list':
            return {'mode': 'snapshot-only', 'frozenAt': rel.snapshot.get('generatedAt')}
        if rel.manifest.get('kind') not in ('mcp-stdio', 'mcp-http'):
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the release asks for a native capability list but its '
                         'transport is not native MCP; the connector will not fake the question',
                         {'softwareId': rel.software_id, 'kind': rel.manifest.get('kind'),
                          'field': 'connector.json#attestation'})
        live = sorted(self.native_tools(rel))
        if live != rel.snapshot_names:
            raise Refuse('SOFTWARE_DRIFT', 'the live capability list differs from the frozen snapshot',
                         {'softwareId': rel.software_id, 'added': [n for n in live if n not in rel.snapshot_names],
                          'removed': [n for n in rel.snapshot_names if n not in live]})
        return {'mode': 'native-tools-list', 'frozenAt': rel.snapshot.get('generatedAt')}

    def native_tools(self, rel):
        transport = rel.manifest.get('transport') or {}
        url = transport.get('baseUrl') or transport.get('endpoint')
        if url:
            return list(self.post(url, {'method': 'tools/list'}).get('tools') or [])
        raise Refuse('CAPABILITY_UNAVAILABLE', 'native attestation was declared but the recipe names no '
                     'endpoint to ask', {'softwareId': rel.software_id, 'field': 'manifest.transport'})

    def post(self, url, body):
        request = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                         headers={'content-type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode('utf-8'))

    # ------------------------------------------------------------------ the eight steps, in order

    def call(self, message):
        rel = self.release(message['softwareId'], message.get('softwareVersion'))
        decl, provenance = self.declaration(rel)
        operation = self.operation(rel, decl, message['capability'])
        perms = self.permissions(rel, operation)
        attested = self.attest(rel, operation['capability'], decl)
        self.check_profile(rel, perms, message)
        self.check_paths(rel, message.get('arguments') or {})
        self.check_network(rel, perms, message.get('arguments') or {})
        self.check_credentials(rel, perms, message)
        self.check_consent(rel, operation, message)
        self.validate_arguments(rel, operation, message.get('arguments') or {})
        key = message['idempotencyKey']
        prior = self.read_index()['byIdempotencyKey'].get(key)
        if prior:
            return dict(prior['result'], replayed=True, evidencePath=prior['evidencePath'])
        return self.dispatch(rel, decl, operation, message, attested, provenance, key)

    def dispatch(self, rel, decl, operation, message, attested, provenance, key):
        mode, keys = self.instance_keys(rel, decl)
        keys = keys + self.exclusive_keys(rel, decl)
        holder = message.get('runId') or message.get('holder') or 'adhoc'
        claimed = []
        try:
            for lock_key in keys:
                if not self.claim(lock_key, holder):
                    raise Refuse('SOFTWARE_BUSY', 'another holder owns %s; nothing was dispatched' % lock_key,
                                 {'key': lock_key, 'mode': mode, 'holder': holder}, retryable=True)
                claimed.append(lock_key)
            return self.invoke(rel, decl, operation, message, mode, attested, provenance, key)
        finally:
            for lock_key in claimed:
                self.release_lock(lock_key, holder)

    def invoke(self, rel, decl, operation, message, mode, attested, provenance, key):
        adapter = decl.get('adapter') or 'generic-cli'
        if adapter == 'desktop-session':
            raise Refuse('INVALID_REQUEST', 'this release is driven through a session; open one instead of '
                         'a one-shot call', {'softwareId': rel.software_id, 'adapter': adapter,
                                             'operation': operation['capability'],
                                             'use': 'software.session'})
        capability = rel.capability(operation['capability']) or {}
        invocation = capability.get('invocation') or {}
        body = self.body(rel)
        state, detail = self.body_digest_state(rel)
        if state == 'mismatch':
            raise Refuse('SOFTWARE_DRIFT', 'the installed body does not match the digest the recipe pins',
                         detail)
        if state == 'unverifiable':
            raise Refuse('CAPABILITY_UNAVAILABLE', 'the connector cannot verify the body against the recipe, '
                         'so it will not dispatch through an unchecked install',
                         dict(detail, softwareId=rel.software_id))
        interpreter, alias = self.interpreter_for(rel, decl, body)
        recipe = rel.recipe(self.platform)
        argv = self.build_argv(rel, recipe, invocation, interpreter, body,
                               message.get('arguments') or {}, decl)
        timeout = max(1, min(int(message.get('timeoutSeconds') or invocation.get('timeout') or 300), 3600))
        before = self.snapshot_files()
        sequence = self.next_sequence(self.call_root)
        call_dir = self.call_root / str(sequence)
        evidence_path = 'evidence/%s/%d/request.json' % (CALL_ROOT_NAME, sequence)
        request_doc = {'schema': CALL, 'kind': 'request', 'softwareId': rel.software_id,
                       'softwareVersion': rel.version, 'capability': operation['capability'],
                       'arguments': message.get('arguments') or {}, 'idempotencyKey': key,
                       'runId': message.get('runId'), 'adapter': adapter, 'argv': argv,
                       'timeoutSeconds': timeout, 'cwd': str(body.parent),
                       'attestation': attested, 'declaration': provenance,
                       'interpreterAlias': alias, 'bodyDigestState': state, 'at': now()}
        self._write_line(call_dir / 'request.json', request_doc)
        try:
            process = subprocess.run(argv, capture_output=True, timeout=timeout, cwd=str(body.parent))
        except subprocess.TimeoutExpired:
            self._write_line(call_dir / 'response.json',
                             {'schema': CALL, 'kind': 'response', 'ok': False,
                              'error': {'code': 'SOFTWARE_TIMEOUT', 'retryable': False,
                                        'message': 'the body did not answer within %ds' % timeout,
                                        'named': {'softwareId': rel.software_id, 'timeoutSeconds': timeout}}})
            raise Refuse('SOFTWARE_TIMEOUT', 'the body did not answer within the timeout',
                         {'softwareId': rel.software_id, 'timeoutSeconds': timeout})
        except OSError as error:
            self._write_line(call_dir / 'response.json',
                             {'schema': CALL, 'kind': 'response', 'ok': False,
                              'error': {'code': 'SOFTWARE_CALL_FAILED', 'retryable': False,
                                        'message': 'the body could not be started: %s' % error,
                                        'named': {'softwareId': rel.software_id, 'errno': getattr(error, 'errno', None)}}})
            raise Refuse('SOFTWARE_CALL_FAILED', 'the body could not be started',
                         {'softwareId': rel.software_id, 'reason': str(error)[:200]})
        payload = {'stdout': process.stdout.decode('utf-8', 'replace'),
                   'stderr': process.stderr.decode('utf-8', 'replace'),
                   'exitCode': process.returncode, 'argvSha256': digest(argv)}
        allowed = invocation.get('successExitCodes') or [0]
        output_digest = digest(payload)
        artifacts = self.record_artifacts(call_dir, before)
        # `ai-software-call/v1`'s result is additionalProperties:false over eight keys, so everything
        # the connector additionally knows goes next to the answer, into the evidence directory - and
        # `software.artifact` / `software.evidence` are how a later reader gets it back.
        self._write(call_dir / 'connector.json',
                    {'schema': 'ai-software-call-context/v1', 'sequence': sequence, 'adapter': adapter,
                     'declaration': provenance, 'attestation': attested,
                     'capabilitySucceeded': process.returncode in allowed, 'argv': argv,
                     'cwd': str(body.parent), 'artifactIndex': 'artifacts.json', 'at': now()})
        result = {'outputSha256': output_digest, 'exitCode': int(process.returncode),
                  'instanceMode': mode, 'output': payload, 'replayed': False,
                  'evidencePath': evidence_path,
                  'requestSha256': file_sha256(call_dir / 'request.json')}
        self.evidence_answer(call_dir, {'schema': CALL, 'kind': 'response', 'ok': True, 'result': result})
        self.remember(key, {'sequence': sequence, 'evidencePath': evidence_path,
                            'result': {k: result[k] for k in ('outputSha256', 'exitCode', 'instanceMode',
                                                              'requestSha256')}})
        return result

    # ------------------------------------------------------------------ artifacts

    def snapshot_files(self):
        seen = {}
        skip = [os.path.realpath(str(p)) for p in (self.call_root, self.session_root, self.lock_root)]
        for root in self.artifact_roots:
            if not root.is_dir():
                continue
            for path in root.rglob('*'):
                if len(seen) >= ARTIFACT_CAP * 10:
                    break
                try:
                    if not path.is_file() or path.is_symlink():
                        continue
                    if any(self._under(path, s) for s in skip):
                        continue
                    stat = path.stat()
                    seen[path.as_posix()] = (int(stat.st_mtime_ns), stat.st_size)
                except OSError:
                    continue
        return seen

    @staticmethod
    def _under(path, real_parent):
        try:
            pathlib.Path(os.path.realpath(str(path))).relative_to(real_parent)
            return True
        except ValueError:
            return False

    def record_artifacts(self, call_dir, before):
        after = self.snapshot_files()
        changed = [p for p, meta in sorted(after.items()) if before.get(p) != meta]
        rows = []
        for raw in changed[:ARTIFACT_CAP]:
            path = pathlib.Path(raw)
            try:
                rows.append({'path': raw, 'size': path.stat().st_size, 'sha256': file_sha256(path)})
            except OSError:
                continue
        self._write(call_dir / 'artifacts.json', {'schema': 'ai-software-artifacts/v1',
                                                  'files': rows, 'at': now()})
        return rows

    # ------------------------------------------------------------------ inventory / instance

    def inventory(self, message):
        rel = self.release(message['softwareId'], message.get('softwareVersion'))
        capabilities = []
        for item in rel.manifest.get('capabilities') or []:
            snapshot = rel.snapshot_capability(item['name']) or {}
            row = {'name': item['name']}
            if item.get('nativeName'):
                row['description'] = '%s (frozen %s)' % (item['nativeName'], 'yes' if rel.frozen else 'no')
            if snapshot.get('inputSchemaRef'):
                row['inputSchema'] = read_json(rel.directory / snapshot['inputSchemaRef'])
            capabilities.append(row)
        # `frozen` is a registered deviation (D-85): ai-run-lock/v1.3 records `inventory.frozen` and
        # wf-runner 0.10.1 reads it (engine.py:660), but the published inventoryResponse is
        # additionalProperties:false without that key - so `_gateway` 1.0.0 was never schema-valid
        # either. Dropping it would break the engine that is already shipped; the connector keeps
        # answering it and the selftest names this as the one documented excess key.
        return {'schema': INVENTORY, 'kind': 'response', 'ok': True, 'softwareId': rel.software_id,
                'installedVersion': rel.version, 'frozen': rel.frozen, 'capabilities': capabilities}

    def instance(self, message):
        operation, software_id = message['operation'], message['softwareId']
        rel = self.release(software_id)
        decl, _ = self.declaration(rel)
        mode, keys = self.instance_keys(rel, decl)
        keys = keys + self.exclusive_keys(rel, decl)
        key = '%s:%s' % (software_id, message['key'])
        holder = message.get('holder')
        if operation == 'status':
            owners = []
            for lock_key in [key] + keys:
                path = self.lock_file(lock_key)
                if path.is_file():
                    owners.append(json.loads(path.read_text(encoding='utf-8')).get('holder'))
            return {'schema': INSTANCE, 'kind': 'response', 'ok': True,
                    'state': 'claimed' if owners else 'idle',
                    'holder': next((o for o in owners if o), None), 'queued': 0}
        if operation == 'claim':
            if not holder:
                raise Refuse('INVALID_REQUEST', 'a claim names its holder', {'missing': 'holder'})
            if not keys and mode == 'per-run':
                keys = [key]
            claimed = []
            for lock_key in keys or [key]:
                if not self.claim(lock_key, holder):
                    for done in claimed:
                        self.release_lock(done, holder)
                    return {'schema': INSTANCE, 'kind': 'response', 'ok': False,
                            'state': 'busy', 'holder': holder, 'queued': 0,
                            'error': {'code': 'SOFTWARE_BUSY', 'retryable': True,
                                      'message': 'another holder owns %s' % lock_key,
                                      'named': {'key': lock_key, 'mode': mode}}}
                claimed.append(lock_key)
            return {'schema': INSTANCE, 'kind': 'response', 'ok': True, 'state': 'claimed',
                    'holder': holder, 'queued': 0}
        if operation == 'release':
            for lock_key in keys or [key]:
                self.release_lock(lock_key, holder)
            return {'schema': INSTANCE, 'kind': 'response', 'ok': True, 'state': 'idle',
                    'holder': None, 'queued': 0}
        raise Refuse('INVALID_REQUEST', 'unknown instance operation', {'operation': operation})

    # ------------------------------------------------------------------ sessions

    def session_dir(self, key):
        return self.lock_root / 'sessions' / (hashlib.sha256(key.encode('utf-8')).hexdigest() + '.json')

    def session(self, message):
        operation = message['operation']
        rel = self.release(message['softwareId'], message.get('softwareVersion'))
        decl, provenance = self.declaration(rel)
        key = '%s/%s' % (rel.software_id, message['sessionKey'])
        holder = message.get('holder') or message.get('runId') or 'adhoc'
        record_path = self.session_dir(key)
        if operation == 'status':
            if not record_path.is_file():
                return {'schema': SESSION, 'kind': 'response', 'ok': True, 'state': 'SESSION_CLOSED',
                        'sessionKey': message['sessionKey']}
            record = read_json(record_path)
            if record.get('holder') != holder:
                return {'schema': SESSION, 'kind': 'response', 'ok': False, 'state': 'SESSION_BUSY',
                        'error': {'code': 'SOFTWARE_BUSY', 'retryable': True,
                                  'message': 'this session belongs to another holder',
                                  'named': {'sessionKey': message['sessionKey'], 'mode': decl.get('sessionModel')}}}
            return self.session_answer(record)
        if operation == 'close':
            if record_path.is_file():
                record = read_json(record_path)
                if record.get('holder') not in (None, holder):
                    raise Refuse('SOFTWARE_BUSY', 'this session belongs to another holder',
                                 {'sessionKey': message['sessionKey'], 'mode': decl.get('sessionModel')},
                                 retryable=True)
                self.release_lock('session:' + key, holder)
                try:
                    record_path.unlink()
                except OSError:
                    pass
            sequence = self.next_sequence(self.session_root)
            directory = self.session_root / str(sequence)
            self._write_line(directory / 'request.json',
                             {'schema': SESSION, 'kind': 'request', 'operation': 'close',
                              'softwareId': rel.software_id, 'softwareVersion': rel.version,
                              'sessionKey': message['sessionKey'], 'holder': holder, 'at': now()})
            answer = {'schema': SESSION, 'kind': 'response', 'ok': True, 'state': 'SESSION_CLOSED',
                      'sessionKey': message['sessionKey'],
                      'evidencePath': 'evidence/%s/%d/request.json' % (SESSION_ROOT_NAME, sequence)}
            self._write_line(directory / 'response.json', answer)
            return answer
        if operation != 'open':
            raise Refuse('INVALID_REQUEST', 'unknown session operation', {'operation': operation})
        profile = message.get('profile')
        if profile and self.profiles.get(profile) is None:
            raise Refuse('PROFILE_NOT_DECLARED', 'this platform declares no such software profile',
                         {'configKey': 'softwareProfiles.%s' % profile, 'declared': sorted(self.profiles)})
        if decl.get('requiresConsent') and not message.get('consentToken') and not message.get('consented'):
            raise Refuse('CONSENT_REQUIRED', 'opening a session against this software needs confirmation',
                         {'softwareId': rel.software_id, 'adapter': decl.get('adapter')})
        lock_key = 'session:' + key
        if not self.claim(lock_key, holder):
            return {'schema': SESSION, 'kind': 'response', 'ok': False, 'state': 'SESSION_BUSY',
                    'error': {'code': 'SOFTWARE_BUSY', 'retryable': True,
                              'message': 'a session for this key is already held',
                              'named': {'sessionKey': message['sessionKey'], 'mode': decl.get('sessionModel')}}}
        body = self.bodies.get(rel.software_id)
        if body is None or not body.is_file():
            self.release_lock(lock_key, holder)
            return {'schema': SESSION, 'kind': 'response', 'ok': False, 'state': 'NOT_INSTALLED',
                    'sessionKey': message['sessionKey'],
                    'error': {'code': 'SOFTWARE_NOT_INSTALLED', 'retryable': False,
                              'message': 'this platform has no installed body for the recipe',
                              'named': {'configKey': 'bodies.%s' % rel.software_id}}
                    }
        record = {'schema': 'ai-software-session-record/v1', 'sessionKey': message['sessionKey'],
                  'softwareId': rel.software_id, 'softwareVersion': rel.version, 'holder': holder,
                  'adapter': decl.get('adapter'), 'profile': profile, 'declaration': provenance,
                  'openedAt': now()}
        if decl.get('adapter') == 'desktop-session' and not self.allow_gui_launch:
            record['state'] = 'INTERACTIVE_REQUIRED'
            record['interactivePrompt'] = {
                'reason': 'the connector does not pretend a GUI opened',
                'instructions': list(decl.get('sessionInstructions') or
                                     ['start %s natively, then ask session.status with sessionKey %s'
                                      % (rel.software_id, message['sessionKey'])])}
        else:
            record['state'] = 'SESSION_READY'
            endpoint = self.declared_endpoint(rel)
            if endpoint:
                record['endpoint'] = endpoint
        self._write(record_path, record)
        sequence = self.next_sequence(self.session_root)
        directory = self.session_root / str(sequence)
        self._write_line(directory / 'request.json',
                         dict(message, schema=SESSION, kind='request', at=now()))
        answer = self.session_answer(record)
        answer['evidencePath'] = 'evidence/%s/%d/request.json' % (SESSION_ROOT_NAME, sequence)
        self._write_line(directory / 'response.json', answer)
        return answer

    def declared_endpoint(self, rel):
        transport = rel.manifest.get('transport') or {}
        url = transport.get('baseUrl') or transport.get('endpoint')
        if not url:
            return None
        parsed = urllib.parse.urlparse(str(url))
        if not parsed.hostname or not parsed.port:
            return None
        kind = rel.manifest.get('kind')
        return {'host': parsed.hostname, 'port': int(parsed.port),
                'transport': kind if kind in ('mcp-stdio', 'mcp-http') else 'mcp-http'}

    def session_answer(self, record):
        """The session response is additionalProperties:false, so what the connector knows beyond the
        contract (declaration provenance, adapter) stays in the platform-side session record."""
        answer = {'schema': SESSION, 'kind': 'response', 'ok': True, 'state': record['state'],
                  'sessionKey': record['sessionKey']}
        if record.get('endpoint'):
            answer['endpoint'] = record['endpoint']
        if record['state'] == 'INTERACTIVE_REQUIRED':
            answer['interactivePrompt'] = record['interactivePrompt']
        return answer

    # ------------------------------------------------------------------ admin entries

    def row(self, software_id, with_health=False):
        rel = self.release(software_id)
        decl, provenance = self.declaration(rel)
        body = self.bodies.get(software_id)
        row = {'softwareId': software_id, 'softwareVersion': rel.version, 'kind': rel.manifest.get('kind'),
               'adapter': decl.get('adapter'), 'transports': decl.get('transports'),
               'sessionModel': decl.get('sessionModel'), 'requiresConsent': decl.get('requiresConsent'),
               'snapshotFrozen': rel.frozen, 'capabilities': rel.snapshot_names,
               'declaration': provenance, 'installed': bool(body and body.is_file()),
               'interpreterAlias': decl.get('interpreterAlias'),
               'attestation': decl.get('attestation', 'snapshot-only')}
        if with_health:
            state, detail = self.body_digest_state(rel)
            row['bodyDigest'] = state
            row['bodyDigestDetail'] = detail
            blockers = []
            if not rel.frozen:
                blockers.append({'code': 'CAPABILITY_UNAVAILABLE',
                                 'named': {'field': 'capabilities.snapshot.json#frozen'},
                                 'what': 'the capability snapshot is not frozen'})
            if state == 'missing':
                blockers.append({'code': 'SOFTWARE_NOT_INSTALLED', 'named': detail,
                                 'what': 'no installed body'})
            elif state == 'mismatch':
                blockers.append({'code': 'SOFTWARE_DRIFT', 'named': detail,
                                 'what': 'the body digest differs from the recipe'})
            elif state == 'unverifiable':
                blockers.append({'code': 'CAPABILITY_UNAVAILABLE', 'named': detail,
                                 'what': 'the body cannot be verified against the recipe'})
            row['dispatchable'] = not blockers
            row['blocking'] = blockers
        return row

    def admin(self, message):
        operation = message['operation']
        ids = [message['softwareId']] if message.get('softwareId') else \
            sorted(e.get('id') for e in self.registry().get('software') or [] if e.get('id'))
        if operation == 'software.list':
            return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                    'result': {'software': [self.row(i) for i in ids]}}
        if operation == 'software.health':
            rows = []
            for software_id in ids:
                try:
                    rows.append(self.row(software_id, with_health=True))
                except Refuse as refusal:
                    rows.append({'softwareId': software_id, 'dispatchable': False,
                                 'blocking': [{'code': refusal.code, 'named': refusal.named,
                                               'what': refusal.message}]})
            return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                    'result': {'software': rows, 'lockScope': 'platform-internal'}}
        if operation == 'software.describe':
            rel = self.release(ids[0], message.get('softwareVersion'))
            decl, provenance = self.declaration(rel)
            operations = {}
            for name, item in sorted((decl.get('operations') or {}).items()):
                entry = dict(item)
                if message.get('withSchemas'):
                    for ref_key in ('inputSchemaRef', 'outputSchemaRef'):
                        if entry.get(ref_key):
                            entry[ref_key.replace('Ref', '')] = read_json(rel.directory / entry[ref_key])
                operations[name] = entry
            return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                    'result': {'softwareId': rel.software_id, 'softwareVersion': rel.version,
                               'declaration': provenance, 'adapter': decl.get('adapter'),
                               'connectorRuntime': decl.get('connectorRuntime'),
                               'upstreamVersion': rel.manifest.get('upstreamVersion'),
                               'snapshotRuntime': (rel.snapshot.get('runtime') or {}),
                               'operations': operations}}
        if operation == 'software.evidence':
            root = self.session_root if message.get('kindOfRecord') == 'session' else self.call_root
            sequences = sorted(int(p.name) for p in root.iterdir() if p.is_dir() and p.name.isdigit()) \
                if root.is_dir() else []
            if message.get('sequence') is not None:
                wanted = int(message['sequence'])
                if wanted not in sequences:
                    raise Refuse('INVALID_REQUEST', 'no such evidence sequence on this run',
                                 {'sequence': wanted, 'known': sequences})
                directory = root / str(wanted)
                documents = {}
                for path in sorted(directory.glob('*.json')):
                    documents[path.name] = {'document': read_json(path), 'sha256': file_sha256(path)}
                return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                        'result': {'root': root.name, 'sequence': wanted, 'documents': documents}}
            return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                    'result': {'root': root.name, 'sequences': sequences}}
        if operation == 'software.artifact':
            root = self.call_root
            if message.get('sequence') is None:
                raise Refuse('INVALID_REQUEST', 'an artifact read names the call sequence it belongs to',
                             {'missing': 'sequence'})
            path = root / str(int(message['sequence'])) / 'artifacts.json'
            if not path.is_file():
                raise Refuse('INVALID_REQUEST', 'that call recorded no artifact index',
                             {'sequence': message['sequence'], 'expected': str(path)})
            files = read_json(path).get('files') or []
            if message.get('path') is not None:
                hits = [f for f in files if f['path'] == message['path']]
                if not hits:
                    raise Refuse('INVALID_REQUEST', 'that path is not in the recorded artifacts',
                                 {'sequence': message['sequence'], 'path': message['path'],
                                  'recorded': [f['path'] for f in files]})
                return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                        'result': {'artifact': hits[0]}}
            return {'schema': ADMIN, 'kind': 'response', 'ok': True, 'operation': operation,
                    'result': {'sequence': int(message['sequence']), 'files': files}}
        raise Refuse('INVALID_REQUEST', 'unknown admin operation',
                     {'operation': operation, 'offered': ['software.list', 'software.describe',
                                                          'software.health', 'software.call',
                                                          'software.session', 'software.artifact',
                                                          'software.evidence']})

    # ------------------------------------------------------------------ envelope

    REQUIRED_KEYS = {INVENTORY: ('softwareId',), INSTANCE: ('operation', 'softwareId', 'key'),
                     SESSION: ('operation', 'softwareId', 'sessionKey', 'timeoutSeconds'),
                     ADMIN: ('operation',)}

    def check_envelope(self, message):
        if not isinstance(message, dict):
            raise Refuse('INVALID_REQUEST', 'a connector message is one JSON object',
                         {'got': type(message).__name__})
        schema = message.get('schema')
        if schema not in ENVELOPES:
            raise Refuse('INVALID_REQUEST', 'unknown connector request schema',
                         {'schema': schema, 'known': list(ENVELOPES)})
        if message.get('kind') != 'request':
            raise Refuse('INVALID_REQUEST', 'a connector request carries kind "request"',
                         {'schema': schema, 'kind': message.get('kind')})
        if schema == CALL:
            required = ('softwareId', 'capability', 'arguments', 'idempotencyKey', 'timeoutSeconds')
        else:
            required = self.REQUIRED_KEYS[schema]
        missing = [key for key in required if key not in message]
        if missing:
            raise Refuse('INVALID_REQUEST', 'the request is missing keys the contract requires',
                         {'schema': schema, 'missing': missing})
        if schema == CALL and not re.fullmatch(r'[0-9a-f]{64}', str(message.get('idempotencyKey') or '')):
            raise Refuse('INVALID_REQUEST', 'an idempotency key is the 64-character digest the engine '
                         'computes; the connector will not invent one',
                         {'softwareId': message.get('softwareId'), 'key': 'idempotencyKey'})
        if schema == CALL:
            extra = [k for k in message if k not in
                     ('schema', 'kind', 'softwareId', 'softwareVersion', 'capability', 'arguments',
                      'idempotencyKey', 'timeoutSeconds', 'runId', 'credentialReferences', 'profile') +
                     ENGINE_ADDED_CALL_KEYS]
            if extra:
                raise Refuse('INVALID_REQUEST', 'the request carries keys the published call contract does '
                             'not define', {'schema': schema, 'keys': sorted(extra)})
        if schema == SESSION:
            if message['operation'] not in ('open', 'status', 'close'):
                raise Refuse('INVALID_REQUEST', 'unknown session operation',
                             {'operation': message['operation'], 'offered': ['open', 'status', 'close']})
            if message['operation'] == 'open' and not message.get('profile'):
                raise Refuse('INVALID_REQUEST', 'opening a session names the profile it opens under',
                             {'schema': schema, 'missing': 'profile'})
        return message

    def handle(self, message):
        schema = message.get('schema') if isinstance(message, dict) else None
        try:
            message = self.check_envelope(message)
            schema = message['schema']
            if schema == CALL:
                return {'schema': CALL, 'kind': 'response', 'ok': True, 'result': self.call(message)}
            if schema == INVENTORY:
                return self.inventory(message)
            if schema == INSTANCE:
                return self.instance(message)
            if schema == SESSION:
                return self.session(message)
            return self.admin(message)
        except Refuse as refusal:
            error = {'code': refusal.code, 'message': refusal.message, 'retryable': refusal.retryable,
                     'named': refusal.named}
            if schema == SESSION:
                return {'schema': SESSION, 'kind': 'response', 'ok': False,
                        'state': refusal.state or 'SESSION_CLOSED', 'error': error}
            return {'schema': schema or CALL, 'kind': 'response', 'ok': False, 'error': error}
        except json.JSONDecodeError as error:
            return {'schema': schema or CALL, 'kind': 'response', 'ok': False,
                    'error': {'code': 'INVALID_REQUEST', 'retryable': False,
                              'message': 'the request is not valid JSON: %s' % error, 'named': {}}}
        except (ValueError, KeyError) as error:
            return {'schema': schema or CALL, 'kind': 'response', 'ok': False,
                    'error': {'code': 'SOFTWARE_CALL_FAILED', 'retryable': False,
                              'message': 'the connector could not read a recipe document: %s' % error,
                              'named': {}}}


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description='shared software connector (architecture 3.2)')
    parser.add_argument('--config', required=True, help='platform connector config (JSON)')
    parser.add_argument('--request', help='a file holding one message; stdin otherwise')
    args = parser.parse_args(argv)
    try:
        config = read_json(pathlib.Path(args.config))
    except (OSError, ValueError) as error:
        print(json.dumps({'schema': ADMIN, 'kind': 'response', 'ok': False,
                          'error': {'code': 'GATEWAY_UNREACHABLE', 'retryable': False,
                                    'message': 'the connector config could not be read: %s' % error,
                                    'named': {'configKey': 'softwareGatewayConfig'}}}, ensure_ascii=False))
        return 1
    try:
        connector = Connector(config)
    except Refuse as refusal:
        print(json.dumps({'schema': ADMIN, 'kind': 'response', 'ok': False,
                          'error': {'code': refusal.code, 'retryable': refusal.retryable,
                                    'message': refusal.message, 'named': refusal.named}}, ensure_ascii=False))
        return 1
    raw = pathlib.Path(args.request).read_text(encoding='utf-8') if args.request else sys.stdin.read()
    try:
        message = json.loads(raw)
    except ValueError:
        message = None
    print(json.dumps(connector.handle(message), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
