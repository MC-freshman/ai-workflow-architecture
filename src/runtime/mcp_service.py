"""Platform-owned MCP facade. Maintenance challenge is separate from business runs."""
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import uuid
import re


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def receipt(config_path, arguments):
    path = Path(config_path).resolve()
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    platform_root = Path(config['platformRoot']).resolve()
    if path.parent.parent != platform_root or config['platform'] != arguments.get('platformId'):
        raise ValueError('wrong platform')
    pins = {key: {'path': config[key], 'sha256': digest(Path(config[key]) / 'SHA256SUMS')} for key in ('runner', 'contracts', 'scannerRelease')}
    pin_sha = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    counts = {}
    for repo in ('tool', 'agent', 'software'):
        registry = json.loads((Path(config[repo + 'Root']) / 'registry.json').read_text(encoding='utf-8-sig'))
        counts[repo] = sum(len(value) for value in registry.values() if isinstance(value, list))
    return {'schema': 'architecture-client-receipt/v1', 'challenge': arguments['challenge'], 'platformId': config['platform'], 'configSha256': digest(path), 'versionsSha256': pin_sha, 'service': 'platform-owned-mcp-facade', 'registriesRead': counts, 'agent': None, 'workflow': None, 'businessRunExecuted': False}


def get_release(config_path, arguments):
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    repo, resource_id = arguments['repository'], arguments['id']
    if repo not in ('tool', 'agent', 'software') or not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', resource_id):
        raise ValueError('invalid shared resource')
    root = Path(config[repo + 'Root']).resolve()
    pointer = root / resource_id / 'current.json'
    bridge = json.loads((Path(config['platformRoot']) / 'bridge.json').read_text(encoding='utf-8-sig'))
    key = 'workflowVersions' if repo == 'tool' else 'agentVersions'
    local = bridge.get('defaults', {}).get(key, {}).get(resource_id) if repo in ('tool', 'agent') else None
    if local and '/' in local.replace('\\', '/'):
        local = local.replace('\\', '/').split('/')[-1]
    version = arguments.get('version') or local or json.loads(pointer.read_text(encoding='utf-8-sig'))['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('invalid frozen version')
    release = (root / resource_id / 'versions' / version).resolve()
    release.relative_to(root)
    sums = release / 'SHA256SUMS'
    files, total = {}, 0
    for line in sums.read_text(encoding='utf-8-sig').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            raise ValueError('invalid release seal')
        name = match[2]
        if '\\' in name or '..' in Path(name).parts or Path(name).is_absolute():
            raise ValueError('invalid frozen path')
        path = (release / name).resolve()
        path.relative_to(release)
        payload = path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != match[1]:
            raise ValueError('frozen resource changed')
        total += len(payload)
        if total > 2 * 1024 * 1024:
            raise ValueError('frozen release exceeds read limit')
        files[name] = payload.decode('utf-8-sig')
    return {'repository': repo, 'id': resource_id, 'version': version, 'hashManifestSha256': digest(sums), 'files': files, 'readOnly': True, 'businessRunExecuted': False}


def management_command(config_path, arguments, operation):
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    platform_root = Path(config['platformRoot']).resolve()
    descriptor = json.loads((platform_root / 'bridge' / 'client-adapter.json').read_text(encoding='utf-8-sig'))
    command = descriptor.get('management')
    if not command:
        raise ValueError('MANAGEMENT_SERVICE_UPDATE_REQUIRED')
    module = Path(__file__).resolve().parent / 'platform_defaults.mjs'
    executable = platform_root / 'runtime' / 'manager-node' / 'node.exe'
    expected_args = [str(module), str(Path(config_path).resolve())]
    if Path(command['executable']).resolve() != executable.resolve() or [str(Path(x).resolve()) for x in command['args']] != expected_args or digest(module) != command['moduleSha256'] or digest(executable) != command['executableSha256']:
        raise ValueError('MANAGEMENT_RUNTIME_DRIFT')
    payload = dict(arguments, operation=operation)
    child = subprocess.run([str(executable), *expected_args], input=json.dumps(payload).encode(), capture_output=True, timeout=90)
    response = json.loads(child.stdout.decode('utf-8'))
    if child.returncode != 0 or not response.get('ok'):
        raise ValueError(response.get('error', 'MANAGEMENT_COMMAND_FAILED'))
    return response['result']


def main():
    config_path = sys.argv[1]
    native_probe = None
    probe_called = False
    if len(sys.argv) > 2:
        if len(sys.argv) != 4 or sys.argv[2] != '--native-probe-file':
            raise ValueError('invalid native read-only probe mode')
        native_probe = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8-sig'))
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if 'id' not in request:
                continue
            method = request.get('method')
            if method == 'initialize':
                result = {'protocolVersion': '2024-11-05', 'serverInfo': {'name': 'architecture-platform', 'version': '0.4.0'}, 'capabilities': {'tools': {}}}
            elif method == 'tools/list':
                result = {'tools': [{'name': 'architecture_probe', 'description': 'Read-only onboarding challenge; no business run', 'inputSchema': {'type': 'object', 'required': ['challenge', 'platformId'], 'properties': {'challenge': {'type': 'string'}, 'platformId': {'type': 'string'}}}}, {'name': 'architecture_list', 'description': 'Read registered workflows, agents and software current pointers', 'inputSchema': {'type': 'object', 'properties': {}}}, {'name': 'architecture_run', 'description': 'Forward a pinned runner protocol request; prompt output is produced by the business client', 'inputSchema': {'type': 'object', 'required': ['request'], 'properties': {'request': {'type': 'object'}}}}]}
                result['tools'].append({'name': 'architecture_get_release', 'description': 'Read a frozen workflow, agent or software recipe with SHA256SUMS verification', 'inputSchema': {'type': 'object', 'required': ['repository', 'id'], 'properties': {'repository': {'enum': ['tool', 'agent', 'software']}, 'id': {'type': 'string'}, 'version': {'type': 'string'}}}})
                result['tools'].extend([
                    {'name': 'architecture_get_platform_versions', 'description': 'Read this platform tool/agent shared default, local choice and effective version.', 'inputSchema': {'type': 'object', 'additionalProperties': False, 'properties': {}}},
                    {'name': 'architecture_set_platform_default', 'description': 'On explicit user request, change ONLY this platform future tool/agent default. Does not change shared current, existing runs or agent dependency locks. version=null restores shared default. confirm=true is required.', 'inputSchema': {'type': 'object', 'additionalProperties': False, 'required': ['kind', 'resourceId', 'version', 'confirm'], 'properties': {'kind': {'enum': ['workflow', 'agent']}, 'resourceId': {'type': 'string'}, 'version': {'type': ['string', 'null']}, 'confirm': {'const': True}}}}
                ])
                if native_probe is not None:
                    result = {'tools': [{'name': 'architecture_verify', 'description': 'Call exactly once with the supplied challenge. Read and hash-verify three frozen repositories; cannot execute business runs or write shared files.', 'inputSchema': {'type': 'object', 'required': ['challenge', 'platformId'], 'additionalProperties': False, 'properties': {'challenge': {'type': 'string'}, 'platformId': {'type': 'string'}}}}]}
            elif native_probe is not None:
                arguments = request.get('params', {}).get('arguments', {})
                if method != 'tools/call' or request.get('params', {}).get('name') != 'architecture_verify' or probe_called:
                    raise ValueError('native read-only probe permits one verification call only')
                if any(arguments.get(key) != native_probe[key] for key in ('challenge', 'platformId')):
                    raise ValueError('native challenge mismatch')
                probe_called = True
                # Survives native-client server restarts; one authorized read per challenge.
                with Path(sys.argv[3] + '.called').open('x', encoding='utf-8') as marker:
                    marker.write('readonly verification claimed\n')
                value = receipt(config_path, arguments)
                releases = {}
                for repo in ('tool', 'agent', 'software'):
                    release = get_release(config_path, {'repository': repo, **native_probe['releases'][repo]})
                    releases[repo] = {key: release[key] for key in ('repository', 'id', 'version', 'hashManifestSha256', 'readOnly', 'businessRunExecuted')}
                    releases[repo]['filesRead'] = len(release['files'])
                    releases[repo]['manifestRead'] = 'manifest.json' in release['files']
                value['releases'] = releases
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_probe':
                value = receipt(config_path, request['params']['arguments'])
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_list':
                config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
                value = {repo: json.loads((Path(config[repo + 'Root']) / 'registry.json').read_text(encoding='utf-8-sig')) for repo in ('tool', 'agent', 'software')}
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_get_release':
                value = get_release(config_path, request['params']['arguments'])
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') in ('architecture_get_platform_versions', 'architecture_set_platform_default'):
                name = request['params']['name']
                value = management_command(config_path, request['params'].get('arguments', {}), 'get' if name.endswith('versions') else 'set')
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': False}
            elif method == 'tools/call' and request.get('params', {}).get('name') == 'architecture_run':
                config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
                protocol = request['params']['arguments']['request']
                if protocol.get('operation') not in ('prepare', 'next', 'submit', 'status', 'stop', 'delegate'):
                    raise ValueError('unsupported runner operation')
                if protocol.get('operation') == 'prepare' and protocol.get('payload', {}).get('platform') != config['platform']:
                    raise ValueError('wrong platform')
                directory = Path(config['platformRoot']) / 'runtime' / 'maintenance' / 'client-requests'
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / (uuid.uuid4().hex + '.json'); path.write_text(json.dumps(protocol), encoding='utf-8')
                child = subprocess.run([sys.executable, '-B', str(Path(config['runner']) / 'cli.py'), '--config', config_path, '--request', str(path)], capture_output=True, timeout=600)
                value = json.loads(child.stdout.decode('utf-8').strip().splitlines()[-1])
                result = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'isError': not value.get('ok')}
            else:
                raise ValueError('unsupported method')
            print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
        except Exception as exc:
            print(json.dumps({'jsonrpc': '2.0', 'id': request.get('id'), 'error': {'code': -32602, 'message': str(exc)}}), flush=True)


if __name__ == '__main__':
    main()
