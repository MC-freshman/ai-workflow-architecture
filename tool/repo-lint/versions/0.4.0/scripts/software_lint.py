"""Software repository validation (architecture 3.0, S-P3a).

The workflow/expert/pack faces are validated by repo_lint's scanner; this module is the third
repository's face, reached through the same CLI (`--software-root`) and merged into the same report,
so a platform gets one decision rather than two. Two severity levels matter and they are not
interchangeable:

* ``error`` refuses a publication - a shape that cannot be trusted.
* ``warning`` registers a finding on already-published bytes - red line 1 says a rule written after
  a release cannot retroactively refuse that release, so the anomaly must become visible instead
  (C-2's ``SOFTWARE_RECIPE_MISSING``, the 65-character digest behind D-40, a release with no
  ``SOURCE.json``).
"""
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

from jsonschema import Draft202012Validator

SEMVER = re.compile(r'^[0-9]+\.[0-9]+\.[0-9]+$')
HEX64 = re.compile(r'^[0-9a-fA-F]{64}$')
RECIPE_OS = ('windows', 'linux', 'macos')
POINTER_KEYS_FORBIDDEN = ('current', 'updatedAt')
SCHEMA_DIR = Path(__file__).resolve().parents[1] / 'schemas'
SHAPES = {'manifest': 'software-manifest-v1.schema.json', 'recipe': 'software-recipe-v1.schema.json',
          'selftest': 'software-selftest-v1.schema.json'}


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validators():
    out = {}
    for name, filename in SHAPES.items():
        out[name] = Draft202012Validator(read_json(SCHEMA_DIR / filename))
    return out


class Findings(List[dict]):
    def add(self, rule, severity, code, message, ident='', version='', path=''):
        item = dict(rule=rule, severity=severity, code=code, kind='software', id=ident,
                    version=version, path=str(path), message=message)
        if item not in self:
            self.append(item)


def _seal(release: Path, findings: Findings, ident: str):
    sums = release / 'SHA256SUMS'
    if not sums.is_file():
        findings.add('SW3', 'error', 'missing-hash-manifest', 'Release has no SHA256SUMS.', ident,
                     release.name, sums)
        return
    rows = {}
    for line in sums.read_text(encoding='utf-8').replace('\r\n', '\n').split('\n'):
        if line.strip():
            digest, rel = re.split(r'\s{2,}', line.strip(), maxsplit=1)
            rows[rel.replace('\\', '/')] = digest.lower()
    on_disk = {p.relative_to(release).as_posix() for p in release.rglob('*') if p.is_file()} - {'SHA256SUMS'}
    for rel, digest in sorted(rows.items()):
        target = release / rel
        if not target.is_file():
            findings.add('SW3', 'error', 'listed-file-missing', 'SHA256SUMS lists %s but it is not there.'
                         % rel, ident, release.name, target)
        elif sha256(target) != digest:
            findings.add('SW3', 'error', 'hash-mismatch', 'SHA256SUMS no longer matches %s.' % rel,
                         ident, release.name, target)
    for rel in sorted(on_disk - set(rows)):
        findings.add('SW3', 'error', 'unlisted-file', 'File inside the release is not in SHA256SUMS: %s.'
                     % rel, ident, release.name, release / rel)
    if not (release / 'SOURCE.json').is_file():
        findings.add('SW3', 'warning', 'missing-source', 'Published release carries no SOURCE.json '
                     '(provenance). New releases must carry one; this one is immutable.', ident,
                     release.name, release / 'SOURCE.json')


def _check_manifest(release: Path, ident: str, findings: Findings, validators, new_release: bool):
    path = release / 'manifest.json'
    if not path.is_file():
        findings.add('SW4', 'error', 'missing-manifest', 'Release has no manifest.json.', ident,
                     release.name, path)
        return None
    manifest = read_json(path)
    for err in validators['manifest'].iter_errors(manifest):
        findings.add('SW4', 'error', 'manifest-shape', '/'.join(str(p) for p in err.path)[:60] + ': '
                     + err.message[:160], ident, release.name, path)
    if manifest.get('id') != ident:
        findings.add('SW4', 'error', 'manifest-id', 'manifest.id %r does not match the directory name.'
                     % manifest.get('id'), ident, release.name, path)
    snapshot_path = release / manifest.get('snapshot', '')
    if not snapshot_path.is_file():
        findings.add('SW4', 'error', 'snapshot-missing', 'manifest.snapshot names %s which is not in the '
                     'release.' % manifest.get('snapshot'), ident, release.name, snapshot_path)
        return manifest
    snapshot = read_json(snapshot_path)
    names = {c.get('name') for c in snapshot.get('capabilities') or []}
    for cap in manifest.get('capabilities') or []:
        if cap.get('name') not in names:
            findings.add('SW4', 'error' if new_release else 'warning', 'capability-not-in-snapshot',
                         'Capability %r is declared in the manifest but absent from the frozen snapshot, '
                         'so drift cannot be detected for it.' % cap.get('name'), ident, release.name,
                         snapshot_path)
        for ref_key in ('inputSchemaRef', 'outputSchemaRef'):
            ref = cap.get(ref_key)
            if ref and not (release / ref).is_file():
                findings.add('SW4', 'error', 'schema-ref-missing', '%s names %s which is not in the '
                             'release.' % (ref_key, ref), ident, release.name, release / ref)
    if not snapshot.get('frozen'):
        findings.add('SW4', 'warning', 'snapshot-unfrozen', 'Capability snapshot carries no `frozen` '
                     'marker, so the engine must answer CAPABILITY_UNAVAILABLE rather than claim drift '
                     'detection for this recipe (C-4).', ident, release.name, snapshot_path)
    return manifest


def _check_recipes(release: Path, ident: str, manifest: Optional[dict], findings: Findings,
                  validators, new_release: bool):
    supported = sorted(k for k, v in (manifest or {}).get('platformSupport', {}).items()
                       if (v.get('status') if isinstance(v, dict) else v) == 'supported')
    present = sorted(p.stem for p in (release / 'recipes').glob('*.json')) if (release / 'recipes').is_dir() else []
    for os_name in [o for o in supported if o not in present]:
        findings.add('SW5', 'warning' if not new_release else 'error', 'SOFTWARE_RECIPE_MISSING',
                     'platformSupport declares %s supported but recipes/%s.json does not exist. A '
                     'platform on that OS must report this row as declaredAbsent with a path and a '
                     'cost; the claim is never read as "available" (C-2).' % (os_name, os_name), ident,
                     release.name, release / 'recipes' / ('%s.json' % os_name))
    for os_name in [o for o in present if o not in RECIPE_OS]:
        findings.add('SW5', 'error', 'recipe-unknown-os', 'recipes/%s.json is not one of the three known '
                     'operating systems.' % os_name, ident, release.name, release / 'recipes' / (os_name + '.json'))
    for path in sorted((release / 'recipes').glob('*.json')) if (release / 'recipes').is_dir() else []:
        recipe = read_json(path)
        for err in validators['recipe'].iter_errors(recipe):
            findings.add('SW5', 'error', 'recipe-shape', '/'.join(str(p) for p in err.path)[:60] + ': '
                         + err.message[:160], ident, release.name, path)
        if recipe.get('platform') != path.stem:
            findings.add('SW5', 'error', 'recipe-platform-mismatch', 'recipes/%s.json says platform %r.'
                         % (path.name, recipe.get('platform')), ident, release.name, path)
        if recipe.get('softwareId') != ident:
            findings.add('SW5', 'error', 'recipe-id-mismatch', 'recipes/%s.json names softwareId %r.'
                         % (path.name, recipe.get('softwareId')), ident, release.name, path)
        for entry in (recipe.get('verify') or {}).get('files') or []:
            digest = str(entry.get('sha256') or '')
            if not HEX64.fullmatch(digest):
                findings.add('SW5', 'error' if new_release else 'warning',
                             'SOFTWARE_RECIPE_DIGEST_MALFORMED',
                             'verify.files[%s].sha256 is %d characters, not 64, so the body can never be '
                             'matched against it.' % (entry.get('path'), len(digest)), ident,
                             release.name, path)
    return supported, present


def _check_selftest(release: Path, ident: str, manifest: Optional[dict], findings: Findings, validators):
    directory = release / 'selftest'
    paths = sorted(directory.glob('*.json')) if directory.is_dir() else []
    if not paths:
        findings.add('SW7', 'error', 'selftest-missing', 'Release declares no selftest definition.',
                     ident, release.name, directory)
    for path in paths:
        doc = read_json(path)
        for err in validators['selftest'].iter_errors(doc):
            findings.add('SW7', 'error', 'selftest-shape', '/'.join(str(p) for p in err.path)[:60] + ': '
                         + err.message[:160], ident, release.name, path)
        declared = {c.get('name') for c in (manifest or {}).get('capabilities') or []}
        for check in doc.get('checks') or []:
            cap = check.get('capability')
            if cap and cap not in declared:
                findings.add('SW7', 'error', 'selftest-unknown-capability',
                             'Selftest step %r calls capability %r which the manifest does not declare.'
                             % (check.get('id'), cap), ident, release.name, path)


def _check_credentials(release: Path, ident: str, findings: Findings):
    """A credential literal is the one thing a recipe must never contain (red line 3).

    Structured files only: the schema already forbids anything but `none` / `reference:<name>` in
    `permissionRequests.credentials` (C-6), and this scan is the same rule applied to the remaining
    JSON. Human-readable instructions legitimately show a user how to write a config file, so
    matching prose would flag documentation, not a defect.
    """
    for path in sorted(p for p in release.rglob('*.json')):
        text = path.read_text(encoding='utf-8', errors='replace')
        if re.search(r':\s*"plaintext:', text) or re.search(r'"[^"]*(password|secret|token)"\s*:\s*"[^"]+"',
                                                            text, re.I):
            findings.add('SW8', 'error', 'CREDENTIAL_LITERAL', 'File appears to carry an inline credential '
                         'rather than a `reference:<name>`; a repository file must never hold one.',
                         ident, release.name, path)


def lint_software_root(root, new_release: bool = False) -> dict:
    root = Path(root)
    findings = Findings()
    registry_path = root / 'registry.json'
    if not registry_path.is_file():
        findings.add('SW1', 'error', 'registry-missing', 'The software repository has no registry.json, '
                     'so it cannot be resolved by the same machinery as tool/ and agent/ (BP-1).',
                     path=root)
        return dict(findings=findings, resources=[], checkedFiles=0)
    registry = read_json(registry_path)
    if registry.get('schema') != 'ai-software-registry/v1':
        findings.add('SW1', 'error', 'registry-schema', 'registry.json schema is %r.' % registry.get('schema'),
                     path=registry_path)
    if not isinstance(registry.get('version'), int):
        findings.add('SW1', 'error', 'registry-version-type', 'registry.version must be an integer (the '
                     'contract parser forbids non-integers).', path=registry_path)
    entries = registry.get('software') or []
    ids = [e.get('id') for e in entries]
    if len(ids) != len(set(ids)):
        findings.add('SW1', 'error', 'duplicate-id', 'registry.json names the same software twice.',
                     path=registry_path)
    validators = _validators()
    resources = []
    checked = 0
    for entry in entries:
        ident = entry.get('id') or ''
        pointer_rel = entry.get('current') or ''
        pointer_path = root / pointer_rel
        if sorted(entry) != ['current', 'enabled', 'id', 'invocable', 'kind', 'transports']:
            findings.add('SW1', 'error', 'registry-entry-keys', 'Entry %r keys are %s; C-5 fixes them to '
                         '{id, current, enabled, kind, invocable, transports} - notably no version, which '
                         'would be a second source of truth beside the pointer (D-36).'
                         % (ident, sorted(entry)), ident, path=registry_path)
        if not pointer_path.is_file():
            findings.add('SW1', 'error', 'pointer-missing', 'registry entry names %s which does not exist.'
                         % pointer_rel, ident, path=pointer_path)
            continue
        pointer = read_json(pointer_path)
        version = pointer.get('version')
        if pointer.get('schema') != 'ai-software-pointer/v1' or pointer.get('id') != ident:
            findings.add('SW2', 'error', 'pointer-mismatch', 'Pointer schema/id do not match the registry '
                         'entry.', ident, str(version), pointer_path)
        if not SEMVER.match(str(version or '')):
            findings.add('SW2', 'error', 'pointer-version', 'Pointer has no semantic version.', ident,
                         str(version), pointer_path)
        for key in POINTER_KEYS_FORBIDDEN:
            if key in pointer:
                findings.add('SW2', 'error', 'pointer-key-abolished', 'Pointer carries `%s`, which S-P2 '
                             'abolished; one selection key (`version`) is the whole rule.' % key, ident,
                             str(version), pointer_path)
        if pointer.get('hashManifest') != 'SHA256SUMS':
            findings.add('SW2', 'error', 'pointer-hash-manifest', 'Pointer must name its hash manifest.',
                         ident, str(version), pointer_path)
        versions_dir = root / ident / 'versions'
        listed = sorted(p.name for p in versions_dir.iterdir() if p.is_dir()) if versions_dir.is_dir() else []
        if pointer.get('available') != listed:
            findings.add('SW2', 'error', 'pointer-listing-stale', 'Pointer.available %r disagrees with the '
                         'versions/ directory %r; `available` is a cache and may not lie.'
                         % (pointer.get('available'), listed), ident, str(version), pointer_path)
        release = versions_dir / str(version)
        if not release.is_dir():
            findings.add('SW2', 'error', 'release-missing', 'Pointer names release %s which does not exist.'
                         % version, ident, str(version), release)
            continue
        _seal(release, findings, ident)
        manifest = _check_manifest(release, ident, findings, validators, new_release)
        supported, present = _check_recipes(release, ident, manifest, findings, validators, new_release)
        _check_selftest(release, ident, manifest, findings, validators)
        _check_credentials(release, ident, findings)
        checked += sum(1 for p in release.rglob('*') if p.is_file())
        resources.append(dict(id=ident, version=version, kind=(manifest or {}).get('kind'),
                              capabilities=len((manifest or {}).get('capabilities') or []),
                              platformSupport=supported, recipes=present,
                              profiles=(manifest or {}).get('requiredProfiles') or []))
    return dict(findings=findings, resources=sorted(resources, key=lambda r: r['id']), checkedFiles=checked)


def merge(report: dict, software: dict, root='') -> dict:
    """Fold the software face into the same report and decision as the other two repositories."""
    counts_key = {'error': 'errors', 'warning': 'warnings', 'info': 'infos'}
    report['roots']['software'] = str(root)
    blockers = [f for f in software['findings'] if f['severity'] == 'error']
    for finding in software['findings']:
        if finding not in report['findings']:
            report['findings'].append(finding)
            report['summary'][counts_key[finding['severity']]] += 1
    report['summary']['softwareResources'] = len(software['resources'])
    report['summary']['checkedFiles'] += software['checkedFiles']
    if blockers:
        report['decision']['blockingFindings'] = (report['decision']['blockingFindings'] +
                                                  [f for f in blockers if f not in report['decision']['blockingFindings']])
        report['decision']['status'] = 'blocked'
        report['summary']['exitCode'] = 1
    elif report['summary']['warnings'] and report['summary']['exitCode'] == 0:
        report['summary']['exitCode'] = 2
    report['software'] = dict(resources=software['resources'],
                              findings={severity: sum(1 for f in software['findings']
                                                      if f['severity'] == severity)
                                        for severity in ('error', 'warning', 'info')})
    return report
