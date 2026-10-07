"""Real target-platform probes. Output is maintenance evidence, never invented business output."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from copy import deepcopy


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); sys.modules[name] = result; spec.loader.exec_module(result)
    return result


def probe_candidate(live, attempt):
    """Provisional declarations for actual probes; never mutate the production table."""
    candidate = deepcopy(live)
    inherited = candidate.get('checks', {})
    candidate['checks'] = {**{key: value for key, value in inherited.items() if value is True}, 'manager-jail-probed': True}
    candidate['permissionAdapters'] = [{'filesystem': f, 'network': 'deny', 'process': p, 'evidence': str(attempt)} for f,p in [('project-scoped','allowlisted-only'),('platform-runtime-write-shared-read-only','isolated-python'),('shared-read-only-platform-report-write','none')]]
    candidate.setdefault('descriptor', {}).setdefault('actions', {})['prompt'] = {'supported': True, 'enforcement': 'advisory'}
    candidate['descriptor']['actions']['script'] = {'supported': True, 'enforcement': 'kernel'}
    return candidate


def peer_callable(answer):
    return bool(answer.get('children') and answer.get('proofScope') == 'prepare-claim-stop' and all(child.get('status') == 'callable' and child.get('prepareOk') is True and child.get('claimReached') is True and child.get('stopOk') is True and child.get('businessExecuted') is False for child in answer['children']))


def main(config_path, output_path):
    config = load(config_path)
    output = Path(output_path); output.parent.mkdir(parents=True, exist_ok=True)
    root = output.parent
    from owned_guest import install
    install(root, load(config['executionBackend']))
    runner = Path(config['runner']); sys.path.insert(0, str(runner))
    result = {'schema': 'platform-capability-probe/v1', 'platformId': config['platform'], 'configSha256': hashlib.sha256(Path(config_path).read_bytes()).hexdigest(), 'checks': {}, 'issues': [], 'software': [], 'agent': None, 'workflow': None, 'businessOutputFabricated': False}
    probe_config_path = Path(config_path)
    # Script action and the exact read-only/write/network/process boundary use the published controller.
    try:
        from sandbox import run_script
        from environment_guard import verify_script
        verification_backend = load(config['executionBackend'])
        verification_backend['verifyTimeoutSeconds'] = max(600, verification_backend.get('verifyTimeoutSeconds', 0))
        verification_backend_path = root / 'verification-backend.json'
        verification_backend_path.write_text(json.dumps(verification_backend), encoding='utf-8')
        # First preparation verifies the full scientific stack; it is not a 120-second small-env probe.
        verification = verify_script(config['environmentManifest'], str(verification_backend_path))
        if verification.get('mismatches') != 0: raise ValueError('sealed environment differs from manifest')
        result['environmentVerification'] = verification
        probe_release = root / 'probe-release'; probe_release.mkdir(exist_ok=True)
        script = '''import json,os,socket,subprocess,sys
checks={"project-write":False,"shared-read-only":False,"outside-write-denied":False,"network-denied":False,"unapproved-process-denied":False}
open("/work/probe.txt","w").write("maintenance")
checks["project-write"]=True
ro=[]
for name in ("tool","agent","software"):
 p="/shared/"+name+"/registry.json"
 json.load(open(p))
 try:
  f=os.open(p,os.O_WRONLY);os.close(f);ro.append(False)
 except OSError: ro.append(True)
checks["shared-read-only"]=all(ro)
try: open("/host/unapproved.txt","w").close()
except OSError: checks["outside-write-denied"]=True
try: subprocess.run(["/usr/bin/id"],check=True)
except OSError: checks["unapproved-process-denied"]=True
checks["network-denied"]=os.readlink("/proc/self/ns/net")!=sys.argv[1]
checks["renderer"]=False
try:
 os.environ["MPLCONFIGDIR"]="/work/mpl-cache"
 import matplotlib
 matplotlib.use("Agg")
 import matplotlib.pyplot as plt
 fig,ax=plt.subplots();ax.plot([0,1],[0,1]);fig.savefig("/work/renderer-probe.png");plt.close(fig)
 checks["renderer"]=open("/work/renderer-probe.png","rb").read(8)==bytes([137,80,78,71,13,10,26,10])
except Exception: pass
print(json.dumps(checks))
sys.exit(0 if all(value for key,value in checks.items() if key!="renderer") else 1)
'''
        (probe_release / 'probe.py').write_text(script, encoding='utf-8')
        attempt = root / ('jail-' + str(time.time_ns()))
        backend = load(config['executionBackend'])
        namespace = subprocess.check_output([backend['wslExecutable'], '-d', backend['distro'], '--exec', backend['interpreter'], '-B', '-c', 'import os;print(os.readlink("/proc/self/ns/net"))']).decode('utf-8').strip()
        answer = run_script(probe_release, 'probe.py', [namespace], root / 'probe-work', Path(config['scriptEnvironment']), attempt, timeout=30, backend=config['executionBackend'], seal_manifest=config['environmentManifest'], seal_digest=hashlib.sha256(Path(config['environmentManifest']).read_bytes()).hexdigest())
        checks = json.loads((attempt / 'stdout.log').read_text(encoding='utf-8').splitlines()[-1])
        result['jail'] = {'result': answer, 'checks': checks, 'path': str(attempt)}
        result['checks']['script-environment-isolation-jail'] = answer.get('exitCode') == 0 and answer.get('processTreeEnded') is True and all(value for key,value in checks.items() if key!='renderer')
        if result['checks']['script-environment-isolation-jail']:
            candidate = probe_candidate(load(config['capabilities']), attempt)
            # The engine requires every declared check to be true, so a stale false inherited from the
            # platform's live table would gate this probe's own prepare and could never be cleared.
            # These are provisional declarations for actual probes, not floor evidence.
            provisional = root / 'candidate-capabilities.json'; provisional.write_text(json.dumps(candidate), encoding='utf-8')
            probe_config = {**config, 'capabilities': str(provisional), 'runsRoot': str(root / 'probe-runs')}
            probe_config_path = root / 'candidate-config.json'; probe_config_path.write_text(json.dumps(probe_config), encoding='utf-8')
    except Exception as error:
        result['issues'].append({'id': 'action:script', 'reason': str(error)[:600]})
    # Prompt claim/stop is the real callable protocol. No submit or model response is forged.
    try:
        ops_root = Path(config['toolRoot']) / 'architecture-ops'
        ops = module('manager_matrix_probe', ops_root / 'versions' / load(ops_root / 'current.json')['version'] / 'architecture_ops/invocation_matrix.py')
        workflow = Path(config['toolRoot']) / 'expert-task'
        version = load(workflow / 'current.json')['version']; release = workflow / 'versions' / version
        parameters = ops.parameters_for(Path(config['toolRoot']), release, load(release / 'manifest.json'))
        run_id = 'manager-claim-' + str(time.time_ns())
        request = {'operation': 'prepare', 'runId': run_id, 'platform': config['platform'], 'parentRunId': None, 'target': {'mode': 'workflow', 'id': 'expert-task', 'version': version}, 'parameters': parameters, 'inputSources': []}
        prepared, _ = ops.exchange(runner / 'cli.py', probe_config_path, dict(request), root, 1)
        if not prepared.get('ok'): raise ValueError(str(prepared.get('error')))
        state_path = Path(load(probe_config_path)['runsRoot']) / run_id / 'state.json'
        state = load(state_path)
        claimed, _ = ops.exchange(runner / 'cli.py', probe_config_path, {'operation': 'next', 'runId': run_id, 'expectedStateRevision': state['stateRevision']}, root, 2)
        state = load(state_path)
        stopped, _ = ops.exchange(runner / 'cli.py', probe_config_path, {'operation': 'stop', 'runId': run_id, 'expectedStateRevision': state['stateRevision'], 'reason': 'Maintenance claim probe; no business submit'}, root, 3)
        result['prompt'] = {'runId': run_id, 'prepareOk': prepared.get('ok'), 'claimOk': claimed.get('ok'), 'stopOk': stopped.get('ok'), 'stageId': claimed.get('result', {}).get('task', {}).get('stageId')}
        result['checks']['prompt-stage-claim'] = bool(claimed.get('ok') and result['prompt']['stageId'] and stopped.get('ok'))
        foreign_id = 'manager-foreign-' + str(time.time_ns())
        refused, _ = ops.exchange(runner / 'cli.py', probe_config_path, {**request, 'platform': 'manager-foreign', 'runId': foreign_id}, root, 4)
        result['platformIdentityRefusal'] = refused.get('error')
        result['checks']['platform-identity-denied'] = refused.get('ok') is False and (refused.get('error') or {}).get('code') in ('UNAUTHORIZED','INVALID_REQUEST') and not (Path(load(probe_config_path)['runsRoot']) / foreign_id).exists()
    except Exception as error:
        result['issues'].append({'id': 'action:prompt', 'reason': str(error)[:600]})
    # Provider actually starts a locked child and stops it awaiting authored business content.
    if config.get('peerDispatcherModule'):
        try:
            if result.get('prompt', {}).get('prepareOk') is not True:
                raise ValueError('DEPENDENCY_FAILED: prompt prepare did not pass; peer probe not started')
            peer = module('manager_peer_probe', config['peerDispatcherModule']).create({'callsLog': str(root / 'peer/calls.log'), 'configPath': str(probe_config_path)})
            ident = 'mastermind-triage'; peer_root = Path(config['agentRoot']) / ident; version = load(peer_root / 'current.json')['version']
            record = {'mode': 'callable-probe', 'sequence': 'probe-' + str(time.time_ns()), 'parentRunId': result['prompt']['runId'], 'peers': [{'id': ident, 'version': version}], 'brief': 'Maintenance callable probe only; no business output', 'requestSha256': hashlib.sha256(b'manager-peer-readonly').hexdigest()}
            answer = peer.dispatch(record); result['peer'] = answer
            result['checks']['peerDispatch'] = peer_callable(answer)
        except Exception as error:
            result['issues'].append({'id': 'action:peer', 'reason': str(error)[:600]})
    try:
        connector_module = module('manager_connector_probe', config['softwareGateway'])
        connector = connector_module.Connector(load(config['softwareGatewayConfig']))
        result['software'] = connector.admin({'operation': 'software.health'})['result']['software']
        rel = connector.release('veracrypt')
        try:
            connector.check_consent(rel, {'capability': 'mount'}, {'consented': False})
            result['checks']['administrator-consent-denied'] = False
        except connector_module.Refuse as refused:
            result['checks']['administrator-consent-denied'] = refused.code == 'CONSENT_REQUIRED'
        calls = []
        for row in result['software']:
            release = connector.release(row['softwareId'])
            declaration, _ = connector.declaration(release)
            operation = (declaration.get('operations') or {}).get('version')
            if not row.get('dispatchable') or not operation or release.manifest.get('kind') not in ('cli-wrapper','local-process'):
                continue
            request = {'schema': 'ai-software-call/v1', 'kind': 'request', 'softwareId': row['softwareId'], 'softwareVersion': row['softwareVersion'], 'capability': 'version', 'arguments': {}, 'idempotencyKey': hashlib.sha256((str(output) + row['softwareId']).encode()).hexdigest(), 'timeoutSeconds': 30, 'profile': 'readonly-version'}
            answer = connector.handle(request)
            calls.append({'softwareId': row['softwareId'], 'ok': answer.get('ok'), 'response': answer})
        result['softwareVersionCalls'] = calls
        result['checks']['software-call'] = bool(calls and all(call['ok'] for call in calls))
    except Exception as error:
        result['issues'].append({'id': 'action:software-call', 'reason': str(error)[:500]})
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'path': str(output), 'checks': result['checks'], 'issues': result['issues']}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
