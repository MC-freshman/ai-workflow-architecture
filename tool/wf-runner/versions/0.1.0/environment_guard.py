"""Verify actual execution files against the pinned environment snapshot."""
import json
from pathlib import Path
import subprocess
import sys

from runtime_core import Rejected, file_hash


def verify_host(manifest):
    value = json.loads(Path(manifest).read_text(encoding='utf-8'))
    if Path(sys.executable).resolve() != Path(value['executable']).resolve():
        raise Rejected('HASH_MISMATCH', 'Runner interpreter differs from pinned environment')
    for row in value['files']:
        if file_hash(row['path']) != row['sha256']:
            raise Rejected('HASH_MISMATCH', 'Runner environment content changed')


def verify_script(manifest):
    from sandbox import linux
    code = "import hashlib,json,sys; from pathlib import Path; d=json.loads(Path(sys.argv[1]).read_text()); bad=[r['path'] for r in d['files'] if hashlib.sha256(Path(r['path']).read_bytes()).hexdigest()!=r['sha256']]; print(json.dumps({'verified':len(d['files']),'mismatches':len(bad)})); sys.exit(bool(bad))"
    result = subprocess.run(['C:/WINDOWS/system32/wsl.exe', '-d', 'Ubuntu2204', '--exec', '/usr/bin/python3', '-B', '-c', code, linux(manifest)], capture_output=True, timeout=120)
    if result.returncode:
        raise Rejected('HASH_MISMATCH', 'Script environment content changed or verification unavailable')
    return json.loads(result.stdout.decode('utf-8'))
