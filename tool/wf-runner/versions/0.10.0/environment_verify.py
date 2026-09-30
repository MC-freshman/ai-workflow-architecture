"""In-guest half of the script environment verification (see environment_guard.py).

argv: manifest, previous-attestation-or-'-', attestation-output-or-'-'
Prints one JSON summary; exits non-zero when the tree does not match the manifest.
"""
import hashlib
import json
import os
import sys
from pathlib import Path


ATTESTATION = 'environment-verification.json'
SAMPLE_FRACTION = 0.05
REHASH_FRACTION = 0.5


def signature(path):
    try:
        info = os.stat(path)
    except OSError:
        return None
    return [info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    manifest_path = sys.argv[1]
    previous_path = sys.argv[2] if len(sys.argv) > 2 else '-'
    out_path = sys.argv[3] if len(sys.argv) > 3 else '-'
    blob = Path(manifest_path).read_bytes()
    manifest = json.loads(blob.decode('utf-8-sig'))
    manifest_sha = hashlib.sha256(blob).hexdigest()
    rows = manifest.get('files') or []
    previous = None
    if previous_path != '-':
        try:
            loaded = json.loads(Path(previous_path).read_text(encoding='utf-8'))
            if loaded.get('manifestSha256') == manifest_sha and isinstance(loaded.get('stat'), dict):
                previous = loaded
        except (OSError, ValueError):
            previous = None
    table = (previous or {}).get('stat') or {}
    moved = [row for row in rows if table.get(row['path']) != signature(row['path'])]
    moved_paths = {row['path'] for row in moved}
    sample = []
    step = max(1, int(1 / SAMPLE_FRACTION))
    mode = 'full'
    if previous is not None and len(moved) <= max(1, int(len(rows) * REHASH_FRACTION)):
        mode = 'incremental'
        sample = [row for row in rows[::step] if row['path'] not in moved_paths]
    check = rows if mode == 'full' else (moved + sample)
    mismatches, stats = [], dict(table)
    for row in check:
        current = signature(row['path'])
        if current is None:
            mismatches.append(row['path'])  # a listed file that is gone is a mismatch, not a crash
            continue
        if digest(row['path']) != row['sha256']:
            mismatches.append(row['path'])
        stats[row['path']] = current
    summary = {'mode': mode, 'listed': len(rows), 'rehashed': len(check), 'moved': len(moved),
               'sampled': len(sample), 'mismatches': len(mismatches), 'manifestSha256': manifest_sha,
               'firstMismatch': mismatches[:1]}
    if not mismatches and out_path != '-' and mode == 'full':
        # a fresh authoritative pass re-bases the run; an incremental pass keeps the existing
        # baseline so the trusted-but-unhashed entries stay attributed to the authoritative pass
        Path(out_path).write_bytes(json.dumps({'schema': 'ai-environment-verification/v1',
                                               'manifestSha256': manifest_sha, 'mode': mode,
                                               'listed': len(rows), 'stat': {r['path']: stats[r['path']]
                                                                            for r in rows if r['path'] in stats},
                                               'sampleFraction': SAMPLE_FRACTION},
                                              ensure_ascii=False).encode('utf-8'))
    print(json.dumps(summary))
    return 1 if mismatches else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - a broken verifier must not look like tampering
        print(json.dumps({'error': type(exc).__name__, 'detail': str(exc)[:200]}))
        sys.exit(2)
