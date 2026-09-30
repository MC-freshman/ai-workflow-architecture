# -*- coding: utf-8 -*-
"""One command that answers "what does this platform still not carry?" (2.1.0 §3.3 / §3.5).

The **union** is computed here, on the shared side, from the three shared registries and the
release each registry pointer selects -- once, from bytes that no platform config can influence.
Every platform therefore sees the same ``unionSha256`` and the same item list; only the
*verdicts* differ, because a verdict is this platform's own declaration read back against the
bytes it names.

    python -B -m conformance.conform --config <platform-config.json> [--out report.json]
                                     [--union-out union.json] [--strict]

Union axes (each one is something the engine actually refuses on, not a description):

    action:prompt|script|peer        descriptor facets; a missing one blocks whole stage types
    permission-triple:<f>/<n>/<p>    the exact triple a release asserts; ``permissions.py``
                                     matches it against the platform's declared adapters
    python-package:<dist>            pinned by a release's ``runtime.environmentLock`` and needed
                                     inside the sealed script environment
    profile:<name>                   a software recipe's ``requiredProfiles``

Verdicts:

    pass            declared by this platform and the named evidence is present
    declaredAbsent  the platform says it does not carry this -- allowed only together with a
                    remediation path and a cost, so "本平台不支持" is not an exit
    unverified      declared, but the evidence it points at is not on disk

A non-pass item with no ``gapPlan[<id>].path`` / ``.costMinutes`` is listed under
``remediationMissing`` and makes ``floorReached`` false: a gap without a way out is a claim, not
a plan. This command does not decide whether a platform is 接入完成 -- that judgement reads this
report, and per BP-2 §2.6 a platform's own run of it is the only admissible conclusion for it.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import time

UNION_SCHEMA = 'ai-capability-union/v1'
REPORT_SCHEMA = 'ai-conformance-floor/v1'
REPOS = ('tool', 'agent', 'software')
TRIPLE_FIELDS = ('filesystem', 'network', 'process')
EVIDENCE_FOR_ACTION = {'prompt': 'prompt-stage-claim', 'script': 'script-environment-isolation-jail',
                       'peer': 'peerDispatch'}
SCRIPT_EXEC_PATHS = {'kernel-sandbox', 'platform-venv', 'host-controlled'}


def _load(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))


def _releases(root):
    """(group, id, version, directory, manifest) for every current pointer in one registry."""
    registry = pathlib.Path(root) / 'registry.json'
    if not registry.is_file():
        return None  # no registry means the repo's requirements cannot enter the union: a gap
    entries = _load(registry)
    out = []
    for group, items in entries.items():
        if not isinstance(items, list):
            continue
        for item in items:
            ident = item.get('id')
            if not ident:
                continue
            pointer = pathlib.Path(root) / (item.get('current') or '%s/current.json' % ident)
            if not pointer.is_file():
                continue
            try:
                pin = _load(pointer)
            except ValueError:
                continue
            version = pin.get('version') or pin.get('current')
            directory = pathlib.Path(root) / ident / 'versions' / str(version)
            manifest = directory / 'manifest.json'
            if version and manifest.is_file():
                out.append((group, ident, version, directory, _load(manifest)))
    return out


def _locked_packages(directory, manifest):
    """Distribution names pinned by the release's environment lock (options and comments dropped)."""
    lock = ((manifest.get('runtime') or {}).get('environmentLock'))
    path = directory / lock if lock else None
    names = set()
    if path is not None and path.is_file():
        for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
            line = line.split('#')[0].strip()
            if not line or line.startswith('-'):
                continue
            match = re.match(r'^([A-Za-z0-9][A-Za-z0-9._-]*)', line)
            if match:
                names.add(match.group(1).lower().replace('_', '-'))
    return names


def compute_union(roots):
    """The union as a sorted item list plus any repository that could not contribute."""
    items = {}

    def add(item_id, kind, who):
        item = items.setdefault(item_id, {'id': item_id, 'kind': kind, 'requiredBy': []})
        if who not in item['requiredBy']:
            item['requiredBy'].append(who)

    gaps = []
    for repo in REPOS:
        root = roots.get(repo)
        releases = _releases(root) if root else None
        if releases is None:
            gaps.append({'repo': repo, 'root': str(root or ''),
                         'why': 'no registry.json (or no such root), so this repository contributes '
                                'nothing to the union and every feature it carries is unaccounted'})
            continue
        for group, ident, version, directory, manifest in releases:
            who = '%s:%s@%s' % (repo, ident, version)
            permissions = manifest.get('permissions')
            if isinstance(permissions, dict) and all(permissions.get(f) for f in TRIPLE_FIELDS):
                add('permission-triple:' + '/'.join(str(permissions[f]) for f in TRIPLE_FIELDS),
                    'permission', who)
            runtime = manifest.get('runtime') or {}
            if runtime.get('type') or manifest.get('entry'):
                add('action:script' if runtime.get('type', '').startswith('python') else 'action:prompt',
                    'action', who)
            for package in sorted(_locked_packages(directory, manifest)):
                add('python-package:' + package, 'package', who)
            policies = manifest.get('policies')
            if isinstance(policies, list):
                if 'peer' in policies or manifest.get('peerLock') or manifest.get('toolLock'):
                    add('action:peer', 'action', who)
            for profile in (manifest.get('requiredProfiles') or []):
                add('profile:' + str(profile), 'profile', who)
            if manifest.get('prompt'):
                add('action:prompt', 'action', who)
    return [items[key] for key in sorted(items)], sorted(gaps, key=lambda g: g['repo'])


def union_body(ordered, gaps):
    return json.dumps({'schema': UNION_SCHEMA, 'items': ordered, 'sourceGaps': gaps},
                      ensure_ascii=False, sort_keys=True)


def _has_script_rung(config):
    """A claimed script action needs at least one structurally usable execution rung.

    The runner intentionally does not infer a rung from the legacy single
    ``executionBackend`` field: doing so would silently choose execution policy. A
    platform that declares script support must move that policy into the explicit
    ``scriptEnvironmentRungs`` ladder; platforms that declare the action absent are
    handled by the normal ``declaredAbsent`` path.
    """
    rungs = config.get('scriptEnvironmentRungs')
    if not isinstance(rungs, list):
        return False
    for rung in rungs:
        if not isinstance(rung, dict):
            continue
        exec_path = rung.get('execPath')
        backend = rung.get('executionBackend')
        environment = rung.get('scriptEnvironment') or config.get('scriptEnvironment')
        requires_sealed = rung.get('requiresSealedEnvironment', False)
        if (isinstance(exec_path, str) and exec_path in SCRIPT_EXEC_PATHS
                and type(requires_sealed) is bool
                and isinstance(backend, str) and backend.strip()
                and isinstance(environment, str) and environment.strip()
                and (not requires_sealed or config.get('environmentManifest'))):
            return True
    return False


def classify(ordered, capabilities, config):
    """Verdicts: this platform's declarations, read back against the bytes it names."""
    descriptor = capabilities.get('descriptor') or {}
    actions = descriptor.get('actions') or {}
    profiles = descriptor.get('profiles') or {}
    adapters = capabilities.get('permissionAdapters') or []
    checks = capabilities.get('checks') or {}
    absent = capabilities.get('declaredAbsent') or {}
    plan = capabilities.get('gapPlan') or {}
    packages = set()
    manifest_path = config.get('environmentManifest')
    if manifest_path and pathlib.Path(str(manifest_path)).is_file():
        try:
            packages = set((_load(manifest_path).get('packages') or {}).keys())
        except ValueError:
            packages = set()

    def satisfies(triple):
        field_values = dict(zip(TRIPLE_FIELDS, triple.split('/')))
        return any(all(str(adapter.get(field)) == value for field, value in field_values.items())
                   for adapter in adapters)

    verdicts, missing_plan = [], []
    for item in ordered:
        item_id, kind = item['id'], item['kind']
        if kind == 'action':
            action = item_id.split(':', 1)[1]
            facet = actions.get(action) or {}
            declared = facet.get('supported') is True
            if action == 'script' and action not in actions and checks.get('scriptEnvironment') is True:
                # The 2.1 descriptor migration used this check as the declaration
                # and evidence key. Keep it readable, but require a 3.1 rung before
                # it can satisfy the shared action:script item.
                declared = True
            evidence_keys = [EVIDENCE_FOR_ACTION[action]]
            if action == 'script':
                # Compatibility alias used by early 2.1 configs; it still requires
                # the explicit 0.8+ rung below before it can count as evidence.
                evidence_keys.append('scriptEnvironment')
            backed = any(bool(checks.get(key)) for key in evidence_keys)
            rung_missing = action == 'script' and declared and not _has_script_rung(config)
            if rung_missing:
                backed = False
        elif kind == 'permission':
            declared = backed = satisfies(item_id.split(':', 1)[1])
        elif kind == 'package':
            declared = backed = bool(packages) and item_id.split(':', 1)[1] in packages
        else:
            profile = profiles.get(item_id.split(':', 1)[1]) or {}
            declared = bool(profile.get('declared'))
            backed = declared and bool(profile.get('adapters'))
        if item_id in absent:
            verdict, reason = 'declaredAbsent', absent[item_id]
        elif declared and backed:
            verdict, reason = 'pass', None
        elif declared:
            if kind == 'action' and item_id == 'action:script' and rung_missing:
                verdict, reason = ('unverified', 'config.scriptEnvironmentRungs is missing or malformed; '
                                   'migrate each allowed execPath/backend into an explicit rung')
            else:
                verdict, reason = 'unverified', 'declared supported, but the evidence named for it is absent'
        else:
            verdict, reason = 'declaredAbsent', 'the platform declares no adapter/facet for this item'
        row = {'id': item_id, 'kind': kind, 'verdict': verdict, 'requiredBy': item['requiredBy']}
        if reason:
            row['reason'] = reason
        if verdict != 'pass':
            entry = plan.get(item_id) or {}
            if entry.get('path') and entry.get('costMinutes') is not None:
                row['remediation'] = {'path': entry['path'], 'costMinutes': entry['costMinutes']}
            else:
                row['remediation'] = None
                missing_plan.append(item_id)
        verdicts.append(row)
    return verdicts, missing_plan


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--config', required=True, help='platform config json (toolRoot/agentRoot/…)')
    parser.add_argument('--out', help='write the report here (stdout otherwise)')
    parser.add_argument('--union-out', help='also write the platform-independent union here')
    parser.add_argument('--strict', action='store_true', help='exit 1 unless the floor is reached')
    parser.add_argument('--only', metavar='SOFTWARE_ID[,ID…]', help='3.0 BP-3: narrow the row set to the '
                       'items one or more software releases contribute, keeping the report structure and '
                       'the platform-independent unionSha256 - a single-cell re-check, never a matrix. '
                       'An id that matches no row is a FAIL (D-32): a narrowed run that judged nothing '
                       'must not read as a pass.')
    args = parser.parse_args(argv)
    config = _load(args.config)
    capabilities = _load(config['capabilities'])
    roots = {repo: config.get(key) for repo, key in
             (('tool', 'toolRoot'), ('agent', 'agentRoot'), ('software', 'softwareRoot'))}
    ordered, gaps = compute_union(roots)
    body = union_body(ordered, gaps)
    digest = hashlib.sha256(body.encode('utf-8')).hexdigest()
    verdicts, missing_plan = classify(ordered, capabilities, config)
    plan = capabilities.get('gapPlan') or {}
    for gap in gaps:  # a repository that cannot contribute is a gap too, and needs the same exit
        key = 'union-source-gap:' + gap['repo']
        gap['gapPlan'] = plan.get(key) or None
        if not (gap['gapPlan'] or {}).get('path') or (gap['gapPlan'] or {}).get('costMinutes') is None:
            missing_plan.append(key)
    narrowed = None
    if args.only:
        # The union stays whole; only this platform's row set narrows, so two platforms that filter
        # the same id still agree about what the union is. Each requested id is judged and answered
        # on its own (D-32: an unknown id used to leave an empty set that exited 0).
        requested = [token.strip() for token in args.only.split(',') if token.strip()]
        kept, per_id, unknown = [], {}, []
        for ident in requested:
            prefix = 'software:%s@' % ident
            hits = [row for row in verdicts if any(who.startswith(prefix) for who in row['requiredBy'])]
            per_id[ident] = {v: sum(1 for row in hits if row['verdict'] == v)
                             for v in ('pass', 'declaredAbsent', 'unverified')}
            per_id[ident]['rows'] = len(hits)
            if not hits:
                unknown.append(ident)
            for row in hits:
                if row not in kept:
                    kept.append(row)
        verdicts = kept
        counts = {v: sum(1 for row in verdicts if row['verdict'] == v)
                  for v in ('pass', 'declaredAbsent', 'unverified')}
        narrowed = {'only': args.only, 'onlyIds': requested, 'perOnlyId': per_id, 'unknownOnlyIds': unknown,
                    'filteredRows': len(verdicts), 'emptyRowSet': not verdicts}
    else:
        counts = {v: sum(1 for row in verdicts if row['verdict'] == v)
                  for v in ('pass', 'declaredAbsent', 'unverified')}
    stable = {'schema': REPORT_SCHEMA, 'unionSha256': digest, 'unionItems': len(ordered),
              'unionSourceGaps': gaps, 'verdicts': verdicts, 'counts': counts,
              'remediationMissing': missing_plan}
    report = dict(stable, **(narrowed or {}),
                  platform=capabilities.get('platform') or descriptor_platform(capabilities),
                  # a filtered set with no rows is not a floor reached - that would be a zero
                  # denominator answering "green" (the D-32 rule)
                  floorReached=not counts['declaredAbsent'] and not counts['unverified'] and not missing_plan
                  and not (narrowed or {}).get('emptyRowSet') and not (narrowed or {}).get('unknownOnlyIds'),
                  conformDigest=hashlib.sha256(json.dumps(stable, ensure_ascii=False, sort_keys=True)
                                               .encode('utf-8')).hexdigest(),
                  generatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    text = json.dumps(report, ensure_ascii=False, indent=1) + '\n'
    if args.out:
        pathlib.Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(args.out).write_text(text, encoding='utf-8')
    else:
        print(text, end='')
    if args.union_out:
        # Exactly the bytes that were hashed, so any third party can re-derive unionSha256 from
        # the file; a trailing newline here would make the digest unverifiable.
        pathlib.Path(args.union_out).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(args.union_out).write_bytes(body.encode('utf-8'))
    print('conform %s platform=%s union=%s items=%d pass=%d declaredAbsent=%d unverified=%d '
          'remediationMissing=%d floorReached=%s' % (report['conformDigest'][:12], report['platform'],
                                                       digest[:12], len(ordered), counts['pass'],
                                                       counts['declaredAbsent'], counts['unverified'],
                                                       len(missing_plan), report['floorReached']))
    # D-32: a narrowing that matched nothing, or named an id that carries no row, is a failure of
    # the command itself and exits non-zero whatever --strict says. The floor question stays --strict's.
    if (narrowed or {}).get('emptyRowSet') or (narrowed or {}).get('unknownOnlyIds'):
        print('conform FAIL: --only judged nothing; unknown ids: %s'
              % ((narrowed or {}).get('unknownOnlyIds') or ['<all filtered rows empty>']), file=sys.stderr)
        return 1
    return 1 if (args.strict and not report['floorReached']) else 0


def descriptor_platform(capabilities):
    return (capabilities.get('descriptor') or {}).get('platformId')


if __name__ == '__main__':
    raise SystemExit(main())
