"""Verify the actual execution files against the pinned environment snapshot.

Two modes, chosen per call:

* ``full`` - hash every listed file. This is the authoritative pass, and a run does it at
  least once: it is what the attestation is measured against and the only mode that can see
  a modification whose timestamps were deliberately put back.
* ``incremental`` - after a full pass the run carries ``environment-verification.json``
  (manifest digest + a stat table). Files whose size/mtime/ctime/inode are untouched are
  trusted, everything that moved is re-hashed, and a deterministic sample is re-hashed even
  when nothing moved. A manifest change, a missing entry, or more than half the tree moving
  forces a fresh full pass.

The residual gap is therefore explicit rather than tacit: between the authoritative pass and
the sample, a tamper that restores every stat field exactly is not guaranteed to be seen by
an incremental call. It is seen by the next run's full pass, and the attestation records how
much of the tree any given call actually re-hashed.
"""
import json
from pathlib import Path
import subprocess
import sys

from runtime_core import Rejected, file_hash

ATTESTATION = 'environment-verification.json'
SAMPLE_FRACTION = 0.05
REHASH_FRACTION = 0.5


def verify_host(manifest):
    value = json.loads(Path(manifest).read_text(encoding='utf-8'))
    if Path(sys.executable).resolve() != Path(value['executable']).resolve():
        raise Rejected('HASH_MISMATCH', 'Runner interpreter differs from pinned environment')
    for row in value['files']:
        if file_hash(row['path']) != row['sha256']:
            raise Rejected('HASH_MISMATCH', 'Runner environment content changed')


def verify_script(manifest, backend=None, store_root=None):
    """Verify the sealed script environment through the platform's declared backend.

    ``store_root`` enables the per-run attestation; without it this is the 0.7.9 behaviour
    (full re-hash every call), so a platform that has not adopted the 2.1 generation is
    unaffected by its presence.
    """
    from sandbox import linux
    from sandbox import _validated
    backend = _validated(backend)
    guest = linux(Path(__file__).with_name('environment_verify.py'), backend)
    previous_arg, output_arg = '-', '-'
    if store_root:
        attestation = Path(store_root) / ATTESTATION
        output_arg = linux(attestation, backend)
        if attestation.is_file():
            previous_arg = output_arg
    argv = [backend['wslExecutable'], '-d', backend['distro'], '--exec', backend['interpreter'], '-B', guest,
            linux(manifest, backend), previous_arg, output_arg]
    budget = backend['verifyTimeoutSeconds']
    try:
        result = subprocess.run(argv, capture_output=True, timeout=budget)
    except subprocess.TimeoutExpired:
        # F4: running out of verification budget is not evidence of tampering. Both used to
        # come back as HASH_MISMATCH, so a merely large sealed environment looked compromised
        # and the reported cause contradicted the real one. The budget itself is
        # platform-declared (verifyTimeoutSeconds, 1..3600) -- not an engine hard cap.
        raise Rejected('ENVIRONMENT_VERIFY_TIMEOUT',
                       'Script environment verification exceeded verifyTimeoutSeconds=' + str(budget))
    if result.returncode == 1:
        raise Rejected('HASH_MISMATCH',
                       'Script environment content changed: ' + result.stdout.decode('utf-8', 'replace')[-200:]
                       + result.stderr.decode('utf-8', 'replace')[-200:])
    if result.returncode:
        # a broken verifier is not evidence about the environment; 0.7.x folded this into
        # HASH_MISMATCH too, which is how "we could not read the file" became "it was forged"
        raise Rejected('EXECUTION_FAILED',
                       'Script environment verifier did not complete: '
                       + result.stdout.decode('utf-8', 'replace')[-300:]
                       + result.stderr.decode('utf-8', 'replace')[-300:])
    summary = json.loads(result.stdout.decode('utf-8'))
    summary['attestation'] = output_arg != '-'
    return summary
