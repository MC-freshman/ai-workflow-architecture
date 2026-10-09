"""Bounded maintenance interface: prepare -> claim -> stop using one Engine.

Every inner request uses the existing protocol and all of its ordinary version,
integrity, permission, revision and idempotency guards. No task is executed or
submitted. A previously existing run is never initialized or adopted.
"""
import copy
import time


def invocation_smoke(engine, request, reject):
    if not isinstance(request, dict) or request.get('operation') != 'prepare':
        raise ValueError('Invocation smoke requires one prepare request')
    payload = request.get('payload') or {}
    target = payload.get('target') or {}
    if target.get('mode') not in ('workflow', 'agent') or payload.get('resume'):
        raise ValueError('Invocation smoke only creates a fresh workflow or agent maintenance run')
    steps, timings = {}, {}
    run_id = request.get('runId')

    def dispatch(name, value):
        started = time.perf_counter()
        try:
            result = engine.dispatch(value)
        except Exception as error:
            result = reject(error, value)
        timings[name + 'Ms'] = round((time.perf_counter()-started)*1000, 3)
        steps[name] = result
        return result

    prepared = dispatch('prepare', copy.deepcopy(request))
    if prepared.get('ok'):
        revision = prepared['result']['state']['stateRevision']

        def child(operation, revision, payload):
            return {'schemaVersion': request['schemaVersion'], 'kind': 'request',
                    'requestId': str(request.get('requestId') or 'smoke') + '-' + operation,
                    'idempotencyKey': str(request.get('idempotencyKey') or 'smoke') + '-' + operation,
                    'runId': run_id, 'operation': operation,
                    'expectedStateRevision': revision, 'payload': payload}

        claimed = dispatch('next', child('next', revision, {}))
        revision = (claimed.get('result') or {}).get('state', {}).get('stateRevision', revision)
        # A rejected next can still have committed a revision before delivery.
        # Observe only this run created by the successful prepare; stop itself
        # re-validates its lock, lease and revision. Never dispatch next twice.
        if not claimed.get('ok'):
            try:
                revision = engine.store(run_id).observe()['stateRevision']
            except Exception:
                pass
        dispatch('stop', child('stop', revision, {'reason': 'invocation matrix smoke'}))
    ok = all(steps.get(name, {}).get('ok') for name in ('prepare', 'next', 'stop'))
    first_error = next((value.get('error') for value in steps.values() if not value.get('ok')), None)
    return {'schema': 'ai-invocation-smoke/v1', 'ok': bool(ok), 'runId': run_id,
            'steps': steps, 'error': first_error, 'timings': timings,
            'runnerStarts': 1, 'businessStagesExecuted': False}
