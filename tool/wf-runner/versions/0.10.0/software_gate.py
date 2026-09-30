"""Architecture 3.0 (proposal v2, section 6.2): the software-call gate chain.

One place holds the order, so the order is machine-judgeable instead of folklore:

    declared -> snapshot -> profile -> boundary -> consent -> arguments -> idempotency -> dispatch

Every gate appends to the trail before it raises, and the caller persists the trail in a
finally-block, so a refusal leaves the same auditable shape as a pass. Nothing in here knows
a platform's name, a path layout or an interpreter: facts are handed in by the engine, and the
first dispatching action is the only thing allowed to touch the gateway.
"""
from runtime_core import Rejected

CHAIN = ('declared', 'snapshot', 'profile', 'boundary', 'consent', 'arguments', 'idempotency')

# An unbounded boundary declaration is not a boundary. Rejected at the schema layer too
# (section 7.3); kept here because the schema cannot see what the *request* supplied.
UNBOUNDED = ('*', 'any', 'all', '0.0.0.0/0', '::/0', '')

CONSENT_STRENGTH = {'auto': 0, 'confirm-stage': 1, 'confirm-call': 2}


class Trail(list):
    """The ordered record of what the chain actually asked, in the order it asked."""

    def step(self, gate, result, code=None, named=None):
        self.append({'gate': gate, 'result': result, 'code': code, 'named': named or {}})


def _brief(named):
    import json
    return '; '.join(k + '=' + json.dumps(v, sort_keys=True, ensure_ascii=False)
                     for k, v in sorted(named.items()))


def _refuse(trail, gate, code, message, named):
    trail.step(gate, 'refused', code, named)
    # The envelope carries code + message only, so what the gate looked at goes into the text.
    raise Rejected(code, 'software gate ' + gate + ': ' + message + ' [' + _brief(named) + ']')


def _pass(trail, gate, named=None):
    trail.step(gate, 'passed', None, named)


def request_digest(hasher, call):
    """The exact bytes of this call, canonically. A confirmation authorises this and nothing else."""
    return hasher({'softwareId': call['softwareId'], 'softwareVersion': call['softwareVersion'],
                   'capability': call['capability'], 'arguments': call['arguments'],
                   'stageId': call['stageId'], 'attempt': call['attempt']})


def identity_digest(hasher, call):
    """The call *site*: stable when the same attempt is replayed, even if the recipe is later
    re-resolved. Compared against request_digest to tell a replay from a conflicting reuse."""
    return hasher({'stageId': call['stageId'], 'attempt': call['attempt'],
                   'inputSha256': call.get('inputSha256'), 'softwareId': call['softwareId'],
                   'capability': call['capability']})


def evaluate(facts, hasher, trail):
    """Run the chain for one software-call.

    facts keys: stage (the compiled plan binding), dependencies (the workflow manifest's
    dependencies.software map), platform (the software declarations the config carries), inventory (the
    gateway's answer to an inventory message), capability (the manifest capability record),
    argumentSchema, consent (token or None), priorCalls (the run's software-call ledger).

    Returns {'idempotencyKey': ..., 'replay': record or None}; raises Rejected otherwise.
    """
    stage = facts['stage']
    call = dict(stage, stageId=stage['stageId'], attempt=stage.get('attempt', 1))
    software_id = call['softwareId']
    capability_name = call['capability']

    # 1. declared: the workflow pinned this software, and the platform gave the engine a
    #    gateway and a recipe root to resolve it through.
    pinned = (facts.get('dependencies') or {}).get(software_id)
    if not pinned:
        _refuse(trail, 'declared', 'INVALID_REQUEST',
                'the workflow manifest does not list this software in dependencies.software',
                {'softwareId': software_id, 'manifestKey': 'dependencies.software'})
    platform = facts.get('platform') or {}
    for key in ('softwareRoot', 'softwareGateway'):
        if not platform.get(key):
            _refuse(trail, 'declared', 'CAPABILITY_UNAVAILABLE',
                    'the platform declares no ' + key + ', so no software can be resolved here',
                    {'configKey': key, 'softwareId': software_id})
    inventory = facts.get('inventory') or {}
    version = inventory.get('installedVersion')
    if version != pinned:
        _refuse(trail, 'declared', 'VERSION_CONFLICT',
                'the manifest pins ' + str(pinned) + ' but the release resolves as ' + str(version),
                {'softwareId': software_id, 'pinned': pinned, 'resolved': version})
    call['softwareVersion'] = version
    _pass(trail, 'declared', {'softwareId': software_id, 'softwareVersion': version})

    # 2. capability in the frozen snapshot (section 4.4 / C-4).
    if not inventory.get('frozen'):
        _refuse(trail, 'snapshot', 'CAPABILITY_UNAVAILABLE',
                'the capability snapshot is not frozen, so membership cannot be judged; this is '
                'not reported as drift because there is no baseline to drift from',
                {'softwareId': software_id, 'field': 'capabilities.snapshot.json#frozen'})
    names = sorted(c['name'] for c in inventory['capabilities'])
    if capability_name not in names:
        _refuse(trail, 'snapshot', 'CAPABILITY_UNAVAILABLE',
                'the frozen capability snapshot does not contain this capability',
                {'softwareId': software_id, 'capability': capability_name, 'frozen': names})
    capability = facts.get('capability')
    if not capability:
        # The frozen snapshot lists the capability but the release manifest does not describe it:
        # the recipe's own two texts disagree, which is drift, not a missing install.
        _refuse(trail, 'snapshot', 'SOFTWARE_DRIFT',
                'the snapshot lists this capability but the release manifest does not describe it',
                {'softwareId': software_id, 'capability': capability_name,
                 'field': 'manifest.json#capabilities'})
    _pass(trail, 'snapshot', {'capability': capability_name, 'snapshotSha256': facts['snapshotSha256']})

    # 3. the platform profile must be able to honour what the capability asks for.
    requests = dict(capability.get('permissionRequests') or {})
    requests['sideEffects'] = capability.get('sideEffects')
    allowed = platform.get('softwareProfiles') or {}
    profile_name = None
    for name in sorted(allowed):
        grants = allowed[name] or {}
        if all(_honours(grants.get(dimension), value) for dimension, value in requests.items()):
            profile_name = name
            break
    if profile_name is None:
        _refuse(trail, 'profile', 'PROFILE_NOT_DECLARED',
                'no declared software profile covers this capability request',
                {'softwareId': software_id, 'capability': capability_name,
                 'requested': requests, 'declaredProfiles': sorted(allowed)})
    _pass(trail, 'profile', {'profile': profile_name, 'requested': requests})

    # 4. external interaction boundary (section 7.3): needed whenever the capability leaves
    #    the machine or writes, unbounded values never count as a boundary.
    needs_boundary = requests.get('network') not in (None, 'none') or \
        requests.get('filesystem') not in (None, 'none') or requests['sideEffects'] == 'external'
    boundary = facts.get('boundary')
    if needs_boundary:
        if not boundary:
            _refuse(trail, 'boundary', 'EGRESS_DENIED',
                    'the capability asks for ' + repr(sorted(requests.items())) + ' and the request '
                    'declared no external boundary',
                    {'softwareId': software_id, 'capability': capability_name})
        grants = allowed[profile_name] or {}
        for dimension, values in sorted(boundary.items()):
            if not values or any(v in UNBOUNDED for v in values):
                _refuse(trail, 'boundary', 'EGRESS_DENIED',
                        'an unbounded value is not a boundary declaration',
                        {'dimension': dimension, 'declared': values})
            if dimension not in grants:
                _refuse(trail, 'boundary', 'PROFILE_NOT_DECLARED',
                        'the profile says nothing about ' + dimension + ', so it cannot grant it',
                        {'profile': profile_name, 'dimension': dimension})
            extra = sorted(set(values) - set(grants[dimension]), key=repr)
            if extra:
                _refuse(trail, 'boundary', 'EGRESS_DENIED',
                        'the request asks for targets the platform profile does not grant',
                        {'dimension': dimension, 'notGranted': extra})
    _pass(trail, 'boundary', {'declared': boundary or 'not-required'})

    # 5. consent gate: the stricter of what the recipe suggests and what the profile insists on.
    suggested = CONSENT_STRENGTH.get(capability.get('consent', 'auto'), 2)
    insisted = CONSENT_STRENGTH.get((allowed[profile_name] or {}).get('consent', 'auto'), 2)
    required_consent = 'auto' if suggested == 0 and insisted == 0 else \
        ('confirm-call' if max(suggested, insisted) == 2 else 'confirm-stage')
    request_sha = request_digest(hasher, call)
    if required_consent != 'auto':
        token = facts.get('consent') or {}
        if token.get('requestSha256') != request_sha:
            _refuse(trail, 'consent', 'CONSENT_REQUIRED',
                    'this call needs confirmation for exactly this request digest; approving one '
                    'request never authorises another',
                    {'softwareId': software_id, 'capability': capability_name,
                     'consent': required_consent, 'expectedRequestSha256': request_sha,
                     'gotRequestSha256': token.get('requestSha256')})
        if token.get('expiresAt') and token['expiresAt'] < facts.get('now', ''):
            _refuse(trail, 'consent', 'CONSENT_REQUIRED',
                    'the confirmation has expired', {'expiresAt': token['expiresAt']})
    _pass(trail, 'consent', {'consent': required_consent})

    # 6. argument schema.
    from jsonschema import Draft202012Validator
    errors = sorted(Draft202012Validator(facts['argumentSchema']).iter_errors(call['arguments']),
                    key=lambda e: list(e.path))
    if errors:
        _refuse(trail, 'arguments', 'INVALID_REQUEST',
                'the mapped arguments violate the capability input schema: ' + errors[0].message,
                {'softwareId': software_id, 'capability': capability_name,
                 'path': '/'.join(str(p) for p in errors[0].path)})
    _pass(trail, 'arguments', {'count': len(call['arguments'])})

    # 7. idempotency: the same call site with the same bytes is a replay, never a second
    #    dispatch; the same site with different bytes is a conflict, not a retry.
    key = identity_digest(hasher, call)
    for prior in facts.get('priorCalls') or []:
        if prior.get('idempotencyKey') == key:
            if prior.get('requestSha256') != request_sha:
                _refuse(trail, 'idempotency', 'IDEMPOTENCY_CONFLICT',
                        'this call site already dispatched different bytes',
                        {'softwareId': software_id, 'idempotencyKey': key,
                         'priorRequestSha256': prior.get('requestSha256'),
                         'requestSha256': request_sha})
            _pass(trail, 'idempotency', {'replay': prior.get('sequence')})
            return {'idempotencyKey': key, 'requestSha256': request_sha, 'replay': prior}
    _pass(trail, 'idempotency', {'replay': None})
    return {'idempotencyKey': key, 'requestSha256': request_sha, 'replay': None}


def _honours(granted, value):
    """A profile grants a dimension by listing the values it can honour; '*' is never a grant."""
    if value in (None, 'none'):
        return True
    if granted is None:
        return False
    return value in (granted if isinstance(granted, list) else [granted])
