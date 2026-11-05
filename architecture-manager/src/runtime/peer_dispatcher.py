"""A platform-owned peer protocol driver. Missing authored output is never fabricated."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time


class Dispatcher:
    def __init__(self, options):
        self.config_path = Path(__file__).with_name('dispatcher-config.json')
        self.config = json.loads(self.config_path.read_text(encoding='utf-8-sig'))
        self.runner_config_path = Path(self.config['runnerConfig'])
        self.runner_config = json.loads(self.runner_config_path.read_text(encoding='utf-8-sig'))
        if options.get('configPath'):
            alternative = Path(options['configPath']).resolve()
            if Path(self.runner_config['platformRoot']).resolve() not in alternative.parents:
                raise ValueError('probe config belongs to another platform')
            candidate = json.loads(alternative.read_text(encoding='utf-8-sig'))
            if any(candidate.get(key) != self.runner_config.get(key) for key in ('platform','platformRoot','toolRoot','agentRoot','softwareRoot','runner','contracts','scannerRelease','executionBackend','environmentManifest')):
                raise ValueError('probe config changes execution or release identity')
            self.runner_config_path = alternative; self.runner_config = candidate
        self.calls_log = Path(options['callsLog'])

    def request(self, body):
        root = Path(self.runner_config['platformRoot']) / 'runtime' / 'maintenance' / 'manager-peer'
        root.mkdir(parents=True, exist_ok=True)
        # AUD-D-009: requestId becomes a filename below; anything outside this flat
        # namespace (path separators, dot segments) would write outside manager-peer.
        request_id = body.get('requestId')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,180}', request_id):
            raise ValueError('PEER_REQUEST_ID_INVALID')
        request_path = root / (request_id + '.json')
        request_path.write_text(json.dumps(body), encoding='utf-8')
        result = subprocess.run([sys.executable, '-B', str(Path(self.runner_config['runner']) / 'cli.py'), '--config', str(self.runner_config_path), '--request', str(request_path)], capture_output=True, timeout=600)
        lines = result.stdout.decode('utf-8', 'replace').strip().splitlines()
        return json.loads(lines[-1])

    def dispatch(self, record):
        children = []
        probe = record.get('mode') == 'callable-probe'
        for peer in record['peers']:
            child_id = record['sequence'] + '-' + peer['id']
            child_root = Path(self.runner_config['runsRoot']) / child_id
            base = {'peerId': peer['id'], 'peerVersion': peer['version'], 'childRunId': child_id, 'requestSha256': record['requestSha256']}
            request = {'schemaVersion': 'ai-run-protocol/v1.2', 'kind': 'request', 'operation': 'prepare', 'runId': child_id, 'requestId': 'prepare-' + child_id, 'idempotencyKey': 'prepare-' + child_id, 'payload': {'platform': self.runner_config['platform'], 'parentRunId': record['parentRunId'], 'target': {'mode': 'agent', 'id': peer['id'], 'version': peer['version']}, 'parameters': {'brief': record['brief'], 'engagementId': 'PEER-' + record['sequence'], 'targets': [self.runner_config['agentRoot']]}, 'inputSources': []}}
            prepared = self.request(request)
            if not prepared.get('ok'):
                children.append({**base, 'status': 'rejected', 'reason': prepared.get('error', {})}); continue
            if probe:
                state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                stamp = str(time.time_ns())
                request = {'schemaVersion': 'ai-run-protocol/v1.1', 'kind': 'request', 'runId': child_id, 'expectedStateRevision': state['stateRevision'], 'payload': {}}
                answer = self.request({**request, 'operation': 'next', 'requestId': 'next-' + stamp, 'idempotencyKey': 'next-' + stamp})
                task = answer.get('result', {}).get('task') or {}
                state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                stopped = self.request({**request, 'operation': 'stop', 'requestId': 'stop-' + stamp, 'idempotencyKey': 'stop-' + stamp, 'expectedStateRevision': state['stateRevision'], 'payload': {'reason': 'Callable probe ended without business submission'}})
                state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                claimed = answer.get('ok') is True and bool(task.get('stageId'))
                stop_ok = stopped.get('ok') is True and state['status'] in ('stopped', 'cancelled')
                children.append({**base, 'status': 'callable' if claimed and stop_ok else 'failed', 'prepareOk': True, 'claimReached': claimed, 'stopOk': stop_ok, 'stageId': task.get('stageId'), 'businessExecuted': False})
                continue
            for _ in range(30):
                state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                if state['status'] == 'succeeded':
                    output = json.loads((child_root / state['finalOutput']).read_text(encoding='utf-8')) if isinstance(state.get('finalOutput'), str) else state.get('finalOutput')
                    # Callers test claimReached on every child, so the success branch must carry it too.
                    children.append({**base, 'status': 'completed', 'claimReached': True, 'resultSha256': hashlib.sha256(json.dumps(output, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}); break
                stamp = str(time.time_ns())
                next_request = {'schemaVersion': 'ai-run-protocol/v1.1', 'kind': 'request', 'operation': 'next', 'runId': child_id, 'requestId': 'next-' + stamp, 'idempotencyKey': 'next-' + stamp, 'expectedStateRevision': state['stateRevision'], 'payload': {}}
                answer = self.request(next_request)
                task = answer.get('result', {}).get('task') or {}
                source = Path(self.runner_config['peerContentRoot']) / peer['id'] / (str(task.get('stageId')) + '.json')
                if not answer.get('ok') or not task.get('stageId') or not source.is_file():
                    state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                    stopped = self.request({**next_request, 'operation': 'stop', 'requestId': 'stop-' + stamp, 'idempotencyKey': 'stop-' + stamp, 'expectedStateRevision': state['stateRevision'], 'payload': {'reason': 'Awaiting authored business content; onboarding does not fabricate it'}})
                    pending = answer.get('ok') is True and bool(task.get('stageId')) and stopped.get('ok') is True
                    children.append({**base, 'status': 'awaiting-input' if pending else 'failed', 'reason': 'authored business output required' if pending else 'peer protocol failed', 'claimReached': answer.get('ok') is True and bool(task.get('stageId')), 'stopOk': stopped.get('ok') is True, 'businessExecuted': False}); break
                data = source.read_bytes()
                relative_output = 'evidence/%s/%s/output.json' % (task['stageId'], task['attempt'])
                path = child_root / relative_output; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
                state = json.loads((child_root / 'state.json').read_text(encoding='utf-8'))
                submitted = self.request({**next_request, 'operation': 'submit', 'requestId': 'submit-' + stamp, 'idempotencyKey': 'submit-' + stamp, 'expectedStateRevision': state['stateRevision'], 'payload': {'stageId': task['stageId'], 'attempt': task['attempt'], 'inputSha256': task['inputSha256'], 'artifacts': task.get('artifacts', []), 'outputs': [{'path': relative_output, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}], 'gates': []}})
                if not submitted.get('ok'):
                    children.append({**base, 'status': 'failed', 'reason': submitted.get('error', {})}); break
            else:
                children.append({**base, 'status': 'timeout'})
        result = {'children': children, 'status': ('callable' if probe else 'completed') if children and all(c['status'] == ('callable' if probe else 'completed') for c in children) else 'partial', 'dispatcherVersion': 'architecture-manager-peer/0.5.6', 'proofScope': 'prepare-claim-stop' if probe else 'business-execution', 'businessExecuted': not probe and bool(children) and all(c['status'] == 'completed' for c in children)}
        self.calls_log.parent.mkdir(parents=True, exist_ok=True)
        with self.calls_log.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'parentRunId': record['parentRunId'], 'requestSha256': record['requestSha256'], 'result': result}) + '\n')
        return result


def create(options):
    return Dispatcher(options)
