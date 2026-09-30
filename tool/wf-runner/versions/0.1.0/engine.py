"""Phase 1 serial prepare/next/submit/status/stop implementation."""
import copy
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from resolution import Resolver, source
from runtime_core import Contracts, Rejected, Store, event_for, file_hash, now, record, relative_path, unlinked, verify_files, write_bytes


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


def compile_plan(c, root, parameters):
    manifest = c.lint.read_json(root / 'manifest.json')
    local_schema(c, root, manifest['inputSchema'], parameters)
    definition = c.lint.yaml.load((root / manifest['entry']).read_text(encoding='utf-8-sig'), Loader=c.lint.UniqueLoader)
    if manifest['id'] == 'game-code-review' and manifest['version'] == '2.0.1':
        if definition.get('mode') != 'prompt' or definition.get('entry') != 'workflow.md' or len(definition.get('stages', [])) != 1:
            raise Rejected('UNSUPPORTED_SCHEMA', 'Legacy single-step contract changed')
        if parameters.get('requestedActions'):
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Legacy implicit command mappings are unavailable')
        schema = {'type': 'object', 'required': ['scope', 'findings', 'unavailableChecks'], 'properties': {'scope': {'const': 'static-local-review'}, 'findings': {'type': 'array', 'items': {'type': 'object', 'required': ['file', 'line', 'severity', 'reason'], 'properties': {'file': {'type': 'string'}, 'line': {'type': 'integer', 'minimum': 1}, 'severity': {'enum': ['critical', 'major', 'minor']}, 'reason': {'type': 'string', 'minLength': 1}}}}, 'unavailableChecks': {'type': 'array', 'minItems': 1, 'items': {'type': 'string'}}}, 'additionalProperties': False}
        prompt = relative_path(root, 'workflow.md').read_text(encoding='utf-8-sig')
        prompt += '\n\nConsumer adapter: perform a static local review only. Treat worker names as roles. Engine, GitHub, Context7 and implicit commands are unavailable; record those checks as NOT_RUN. Do not dispatch Agents or commands.\n'
        return {'workflowRoot': str(root), 'manifest': manifest, 'legacyOutputSchema': schema, 'stages': [{'id': 'execute', 'action': 'prompt', 'worker': 'reviewer', 'dependsOn': [], 'outputs': 'consumer-game-review-v1', 'gates': ['schema'], 'prompt': prompt}], 'gateDefinitions': {'schema': {'type': 'output-schema'}}}
    schema = c.lint.read_json(c.release / 'schemas/workflow-definition-v2.schema.json')
    Draft202012Validator(schema).validate(definition)
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
        if stage['action'] not in {'prompt', 'script'} or stage.get('onFail', 'stop') != 'stop':
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Action or repair is outside the serial Phase 1 profile')
        if 'outputs' not in stage:
            raise Rejected('REQUIRED_GATE_MISSING', 'Every stage requires a real output schema')
        gates = stage.get('gates', [])
        for gate in gates:
            declaration = definition.get('gateDefinitions', {}).get(gate)
            if not declaration or declaration.get('type') not in {'output-schema', 'math-stage'}:
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Required gate adapter is unavailable')
        bound = copy.deepcopy(stage)
        if stage['action'] == 'prompt':
            filename, anchor = stage['promptRef'].split('#stage:', 1)
            text = relative_path(root, filename).read_text(encoding='utf-8-sig')
            match = re.findall(r'<!--\s*stage:' + re.escape(anchor) + r'\s*-->(.*?)<!--\s*/stage:' + re.escape(anchor) + r'\s*-->', text, re.S)
            if len(match) != 1 or not match[0].strip():
                raise Rejected('INVALID_REQUEST', 'Prompt anchor is missing or ambiguous')
            bound['prompt'] = match[0].strip()
        else:
            relative_path(root, stage['script'])
            args = stage.get('arguments', {})
            if set(args) - {'argv', 'timeoutSeconds'} or not isinstance(args.get('argv', []), list) or not all(isinstance(a, str) for a in args.get('argv', [])):
                raise Rejected('INVALID_REQUEST', 'Script requires structured argv')
            if not isinstance(args.get('timeoutSeconds', 30), int) or not 1 <= args.get('timeoutSeconds', 30) <= 3600:
                raise Rejected('INVALID_REQUEST', 'Invalid timeout')
        stages.append(bound)
    return {'workflowRoot': str(root), 'manifest': manifest, 'stages': stages, 'gateDefinitions': definition.get('gateDefinitions', {})}


class Engine:
    def __init__(self, config, fault=None):
        self.config = config  # supplied by the trusted platform adapter
        self.c = Contracts(config['contracts'])
        self.runs = unlinked(config['runsRoot'])
        platform = unlinked(config['platformRoot'])
        self.runs.relative_to(platform)
        self.fault = fault
        if config.get('hostEnvironmentManifest'):
            from environment_guard import verify_host
            verify_host(config['hostEnvironmentManifest'])

    def store(self, run_id):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', run_id):
            raise Rejected('UNAUTHORIZED', 'Unsafe run id')
        return Store(relative_path(self.runs, run_id), self.c, self.fault)

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
        return {'schemaVersion': 'ai-run-transaction/v1.1', 'transactionId': request['requestId'], 'platform': 'codex', 'runId': request['runId'], 'idempotencyKey': request['idempotencyKey'], 'requestSha256': self.c.hash({k: v for k, v in request.items() if k != 'requestId'}), 'request': request, 'phase': 'committed', 'effectBoundaryCrossed': False, 'eventSequences': [e['sequence'] for e in events], 'response': response}

    def receipt_path(self, request):
        return 'transactions/' + self.c.hash(request['idempotencyKey']) + '.json'

    def replay(self, store, request):
        path = self.receipt_path(request)
        if (store.root / path).exists():
            prior = store.read(path)
            if prior['requestSha256'] != self.c.hash({k: v for k, v in request.items() if k != 'requestId'}):
                raise Rejected('IDEMPOTENCY_CONFLICT', 'Same key has a different complete request')
            return prior['response']

    def prepare(self, request):
        self.c.validate('protocol', request)
        payload = request['payload']
        if payload['platform'] != 'codex' or payload['parentRunId'] == request['runId']:
            raise Rejected('UNAUTHORIZED', 'Platform or parent run is invalid')
        store = self.store(request['runId'])
        if store.root.exists():
            with store.lease():
                replay = self.replay(store, request)
                if replay:
                    return replay
            raise Rejected('UNAUTHORIZED', 'Run directory already exists')
        resolver = Resolver(self.c, self.config['toolRoot'], self.config['agentRoot'], self.config['bridge'], self.config['runner'], self.config['environmentManifest'])
        target = payload['target']
        selected, origin = resolver.choose(target['mode'], target['id'], target['version'])
        store.root.mkdir(parents=True, exist_ok=False)
        store.write('prepare-request.json', request, exclusive=True)
        resolved = resolver.resolve(selected, origin or source('explicit', store.root / 'prepare-request.json'))
        if self.config.get('hostEnvironmentManifest'):
            host_path = Path(self.config['hostEnvironmentManifest'])
            host = self.c.read(host_path)
            resolved['resources'].append({'key': 'interpreter:runner-python', 'kind': 'interpreter', 'id': 'runner-python', 'version': host['pythonVersion'], 'path': str(host_path), 'manifestSha256': file_hash(host_path), 'contentManifestSha256': file_hash(host_path), 'resolvedFrom': source('environment-snapshot', host_path), 'dependencies': []})
            resolved['selection']['environment'].append('interpreter:runner-python')
        plan = compile_plan(self.c, resolved['target'], payload['parameters'])
        permissions = plan['manifest'].get('permissions', {})
        expected = {'filesystem': 'project-scoped', 'network': 'deny', 'process': 'allowlisted-only'}
        if permissions != expected:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Required permission policy has no verified adapter')
        capabilities = self.c.read(self.config['capabilities'])
        if not capabilities.get('checks') or not all(capabilities['checks'].values()):
            raise Rejected('CAPABILITY_UNAVAILABLE', 'Isolation acceptance has not passed')
        files, aliases = [], set()
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
        store.write('plan.json', plan, exclusive=True)
        files.sort(key=lambda row: row['path'])
        inp = {'parameters': payload['parameters'], 'parametersSha256': self.c.hash(payload['parameters']), 'files': files, 'manifestSha256': self.c.hash(files)}
        inp['snapshotSha256'] = self.c.hash({k: inp[k] for k in ('parametersSha256', 'manifestSha256')})
        lock = {'schemaVersion': 'ai-run-lock/v1.1', 'recordType': 'execution', 'runId': request['runId'], 'parentRunId': payload['parentRunId'], 'platform': 'codex', 'createdAt': now(), 'runRoot': str(store.root), 'canonicalization': 'sha256-cjson-safe-v1', 'selection': resolved['selection'], 'resources': resolved['resources'], 'input': inp, 'execution': {'maxParallel': 1, 'resume': False, 'stages': [{'id': s['id'], 'action': s['action'], 'dependsOn': s.get('dependsOn', []), 'requiredGates': s.get('gates', [])} for s in plan['stages']]}}
        self.c.validate('run-lock', lock)
        store.write('run-lock.json', lock, exclusive=True)
        for item in files:
            if item['path'].startswith('inputs/project/'):
                dest = relative_path(store.root, 'work/project/' + item['path'][len('inputs/project/'):])
                write_bytes(dest, relative_path(store.root, item['path']).read_bytes(), exclusive=True)
        store.write('reports/prepare-diagnostics.json', {'findings': resolved['findings'], 'permissions': permissions, 'capabilitiesSha256': file_hash(self.config['capabilities'])}, exclusive=True)
        state = {'schemaVersion': 'ai-run-state/v1.1', 'runId': request['runId'], 'lockSha256': self.c.hash(lock), 'stateRevision': 0, 'lastEventSequence': 1, 'lastEventSha256': '0' * 64, 'status': 'prepared', 'outcome': 'known', 'stopRequested': False, 'activeAttempt': None, 'completed': [], 'managedProcesses': [], 'finalOutput': [], 'error': None, 'updatedAt': now()}
        event = event_for(self.c, lock, state, None, request['requestId'], 'prepared')
        response = self.response(request, state)
        with store.lease():
            store.commit(None, state, [event], self.receipt(request, response, [event]), self.receipt_path(request))
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
            if resource['kind'] in {'workflow', 'agent', 'skill', 'pack', 'runner'}:
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

    def plan(self, store, lock):
        resource = next(r for r in lock['resources'] if r['key'] == lock['selection']['workflow'])
        expected = compile_plan(self.c, Path(resource['path']), lock['input']['parameters'])
        if store.read('plan.json') != expected:
            raise Rejected('HASH_MISMATCH', 'Derived plan differs from locked source')
        return expected

    def dispatch(self, request):
        self.c.validate('protocol', request)
        if request['operation'] == 'prepare':
            return self.prepare(request)
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
            def change(kind):
                prior = copy.deepcopy(before if not events else last[0])
                events.append(event_for(self.c, lock, state, prior, request['requestId'], kind))
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
                        if state['status'] != 'waiting-for-input':
                            raise Rejected('REVISION_CONFLICT', 'A managed attempt is already running')
                        extra = {'task': None, 'reason': 'waiting'}
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
                        task = dict(attempt, initialInputSha256=lock['input']['snapshotSha256'], allowedTools=allowed if stage['action'] == 'prompt' else ['isolated-python'])
                        if stage['action'] == 'prompt':
                            task['prompt'] = stage['prompt']
                            if lock['selection']['agent']:
                                resource = next(r for r in lock['resources'] if r['key'] == lock['selection']['agent'])
                                agent_root = Path(resource['path'])
                                manifest = self.c.read(agent_root / 'manifest.json')
                                context = [relative_path(agent_root, manifest['prompt']).read_text(encoding='utf-8-sig')]
                                context += [relative_path(agent_root, name).read_text(encoding='utf-8-sig') for name in manifest.get('policies', [])]
                                task['prompt'] = '\n\n'.join(context + [stage['prompt']])
                            state['status'] = 'waiting-for-input'
                            change('prompt-delivered')
                        else:
                            arguments = stage.get('arguments', {})
                            task['script'] = {'resourceKey': lock['selection']['workflow'], 'entry': stage['script'], 'argv': arguments.get('argv', []), 'timeoutSeconds': arguments.get('timeoutSeconds', 30)}
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
                    self.check_submission(store, plan, stage, payload)
                    state['completed'].append(copy.deepcopy(payload))
                    state.update(activeAttempt=None, status='running')
                    change('result-accepted')
                    if len(state['completed']) == len(plan['stages']):
                        if not payload['outputs']:
                            raise Rejected('REQUIRED_GATE_MISSING', 'Final output is empty')
                        state.update(status='succeeded', finalOutput=payload['outputs'])
                        change('succeeded')
                    extra = {'accepted': True}
                response = self.response(request, state, **extra)
            except Rejected as error:
                state, events = copy.deepcopy(before), []
                response = self.response(request, error=error)
            store.commit(before, state, events, self.receipt(request, response, events), self.receipt_path(request))
            return response

    def check_submission(self, store, plan, stage, payload):
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
        for gate in gates.values():
            if gate['status'] != 'pass' or gate['inputSha256'] != payload['inputSha256'] or gate['outputManifestSha256'] != self.c.hash(outputs):
                raise Rejected('GATE_FAILED', 'Gate failed or evidence binding is stale')
            if not gate['evidence']['path'].startswith(prefix):
                raise Rejected('UNAUTHORIZED', 'Gate evidence is outside this attempt')
            verify_files(store.root, [gate['evidence']])
            declaration = plan['gateDefinitions'].get(gate['gateId'])
            if declaration is None:
                raise Rejected('REQUIRED_GATE_MISSING', 'Undeclared gate')
            if declaration['type'] == 'math-stage':
                from math_gates import validate_evidence
                validate_evidence(self.c, store.root, payload, gate, declaration)
            elif declaration['type'] != 'output-schema':
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Unknown gate executor')

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
            entry = stage.get('script')
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
            from environment_guard import verify_script
            environment = self.c.read(self.config['environmentManifest'])
            if not environment.get('files'):
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Actual script environment inventory is required')
            from sandbox import linux
            if linux(self.config['scriptEnvironment']) != environment['environment']:
                raise Rejected('HASH_MISMATCH', 'Script interpreter root differs from pinned snapshot')
            if self.config.get('hostEnvironmentManifest'):
                capabilities = self.c.read(self.config['capabilities'])
                if capabilities.get('controllerSha256') != file_hash(Path(__file__).with_name('sandbox_linux.py')):
                    raise Rejected('CAPABILITY_UNAVAILABLE', 'Isolation controller differs from accepted implementation')
            verify_script(self.config['environmentManifest'])
            store.write(intent, {'stageId': active['stageId'], 'attempt': active['attempt'], 'inputSha256': active['inputSha256'], 'boundary': 'dispatch-intent', 'entry': entry, 'argv': argv, 'controlRoot': process_relative, 'at': now()}, exclusive=True)
            if self.fault:
                self.fault('before-script-launch')
            process = start_script(release, entry, argv, store.root / 'work/project', Path(self.config['scriptEnvironment']), process_root, arguments.get('timeoutSeconds', 30), gated=True)
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
