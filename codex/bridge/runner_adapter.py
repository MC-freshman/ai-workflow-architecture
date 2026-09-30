"""Codex platform adapter; JSON input is data, never shell command text."""
import json
from pathlib import Path
import sys
import uuid

config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
sys.path.insert(0, config['runner'])
from engine import Engine
from runtime_core import Rejected, file_hash


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def normalize_input(value):
    if value is None:
        return {'parameters': {}, 'inputSources': []}
    if not isinstance(value, dict):
        raise Rejected('INVALID_REQUEST', 'Runner input must be a JSON object')
    if 'parameters' in value or 'inputSources' in value:
        if set(value) - {'parameters', 'inputSources'}:
            raise Rejected('INVALID_REQUEST', 'Normalized runner input only permits parameters and inputSources')
        parameters = value.get('parameters', {})
        sources = value.get('inputSources', [])
    else:
        parameters, sources = value, []
    if not isinstance(parameters, dict) or not isinstance(sources, list):
        raise Rejected('INVALID_REQUEST', 'parameters must be an object and inputSources must be an array')
    return {'parameters': parameters, 'inputSources': sources}


def select_version(kind, ident, explicit):
    bridge_path = Path(config['bridge'])
    bridge = read_json(bridge_path)
    key = 'workflowVersions' if kind == 'workflow' else 'agentVersions'
    if explicit:
        return str(explicit), 'explicit', None
    override = (bridge.get('defaults', {}).get(key, {}) or {}).get(ident)
    if override:
        return str(override), 'platform-default', file_hash(bridge_path)
    root = Path(config['toolRoot'] if kind == 'workflow' else config['agentRoot'])
    pointer = root / ident / 'current.json'
    current = read_json(pointer)
    if current.get('id') != ident or not current.get('version'):
        raise Rejected('UNAUTHORIZED', 'Shared current pointer is invalid for ' + ident)
    return str(current['version']), 'shared-current', file_hash(pointer)


def dispatch(value):
    engine = Engine(config)
    action = value['action']
    args = value['args']
    if action == 'request':
        return engine.dispatch(args['request'])
    if action == 'execute':
        return engine.execute_claimed(args['runId'], args.get('tool'), args.get('review'))
    if action == 'seal':
        return engine.seal(args['runId'], args['outputPaths'], args['gatePaths'])
    if action not in ('workflow', 'agent'):
        raise Rejected('INVALID_REQUEST', 'Unsupported adapter action')
    normalized = normalize_input(args.get('input'))
    ident = args['workflowId'] if action == 'workflow' else args['agentId']
    explicit = args.get('version') if action == 'workflow' else args.get('agentVersion')
    version, version_source, source_sha256 = select_version(action, ident, explicit)
    run_id = ('wf-' if action == 'workflow' else 'wfa-') + ident + '-' + uuid.uuid4().hex
    request = {'schemaVersion': 'ai-run-protocol/v1.1', 'kind': 'request', 'requestId': 'prepare-' + run_id, 'idempotencyKey': 'prepare-' + run_id, 'operation': 'prepare', 'runId': run_id, 'payload': {'platform': config['platform'], 'parentRunId': None, 'target': {'mode': action, 'id': ident, 'version': version}, **normalized}}
    result = engine.dispatch(request)
    selection = {'kind': action, 'id': ident, 'version': version, 'source': version_source,
                 'sourceSha256': source_sha256}
    engine.store(run_id).write('reports/platform-selection.json', selection, exclusive=True)
    return {'protocol': result, 'runId': run_id, 'runRoot': str(engine.store(run_id).root),
            'executionStatus': 'prepared', 'nextOperation': 'next', 'selection': selection}


try:
    print(json.dumps(dispatch(json.load(sys.stdin)), ensure_ascii=True))
except Exception as error:
    print(json.dumps({'ok': False, 'error': {'code': getattr(error, 'code', 'INVALID_REQUEST'), 'message': str(error)}}, ensure_ascii=True))
    sys.exit(1)
