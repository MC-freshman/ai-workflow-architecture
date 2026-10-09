"""Restore the registered archives and exact interpreter aliases with one command."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import zipfile


def unpack(archive, destination):
    destination = Path(destination)
    if destination.exists():
        raise ValueError('restore target already exists')
    with zipfile.ZipFile(archive) as source:
        for entry in source.namelist():
            path = PurePosixPath(entry)
            if path.is_absolute() or '..' in path.parts or '\\' in entry:
                raise ValueError('unsafe backup archive')
        source.extractall(destination)


def main():
    registration = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    root = Path(sys.argv[2])
    if sys.argv[-1] == '--guest':
        archive = Path(registration['sealedArchiveLinux'])
        if hashlib.sha256(archive.read_bytes()).hexdigest() != registration['sealedArchiveSha256']:
            raise ValueError('sealed archive changed')
        unpack(archive, root)
        for link in registration['links']:
            path = PurePosixPath(link['path'])
            if path.is_absolute() or '..' in path.parts or link['target'] not in registration['allowedSystemInterpreters']:
                raise ValueError('unsafe interpreter link')
            (root / link['path']).symlink_to(link['target'])
        for file in (root / 'bin').iterdir():
            if file.is_file() and not file.is_symlink(): file.chmod(file.stat().st_mode | 0o111)
        for row in registration['sealedFiles']:
            if hashlib.sha256((root / row['path']).read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('sealed restore hash differs')
        subprocess.run([str(root / 'bin/python'), '-B', '-c', 'import jsonschema,yaml,numpy,matplotlib,fitz'], check=True)
        print(json.dumps({'sealedRestored': True, 'hashesMatch': True})); return
    expected = Path(registration['platformRoot']).resolve() / 'runtime'
    if expected not in root.resolve().parents:
        raise ValueError('restore target must belong to registered platform runtime')
    backup = Path(sys.argv[1]).parent
    host_archive = backup / 'host-environment.zip'
    if hashlib.sha256(host_archive.read_bytes()).hexdigest() != registration['hostArchiveSha256']:
        raise ValueError('host archive changed')
    unpack(host_archive, root / 'host')
    for row in registration['hostFiles']:
        if hashlib.sha256((root / 'host' / row['path']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('host restore hash differs')
    subprocess.run([str(root / 'host/Scripts/python.exe'), '-B', '-c', 'import jsonschema,yaml,numpy'], check=True)
    def linux(path):
        value = Path(path).as_posix()
        for rule in registration['backend']['pathMap']:
            stem = rule['windows'].rstrip('/')
            if value.casefold().startswith(stem.casefold() + '/'):
                return rule['linux'] + value[len(stem):].lstrip('/')
        raise ValueError('unmapped restore target')
    backend = registration['backend']
    subprocess.run([backend['wslExecutable'], '-d', backend['distro'], '--exec', backend['interpreter'], '-B', linux(Path(__file__)), linux(Path(sys.argv[1])), linux(root / 'sealed'), '--guest'], check=True)
    print(json.dumps({'hostRestored': True, 'sealedRestored': True, 'hashesMatch': True}))


if __name__ == '__main__':
    main()
