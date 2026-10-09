"""Wrap long WSL commands with a target-private Linux process group controller."""
import json
from pathlib import Path
import shutil
import subprocess
import uuid


def install(root, backend):
    root = Path(root)
    def linux(path):
        value = Path(path).as_posix()
        for rule in sorted(backend['pathMap'], key=lambda row: len(row['windows']), reverse=True):
            stem = rule['windows'].rstrip('/')
            if value.casefold().startswith(stem.casefold() + '/'):
                return rule['linux'] + value[len(stem):].lstrip('/')
        raise ValueError('unmapped owned guest path')
    helper = root / 'guest-controller.py'
    shutil.copy2(Path(__file__).with_name('guest_controller.py'), helper)
    original = subprocess.run
    def controlled(argv, *args, **kwargs):
        if isinstance(argv, (list, tuple)) and argv and str(argv[0]).casefold() == backend['wslExecutable'].casefold() and '--exec' in argv:
            position = argv.index('--exec')
            directory = root / 'guest-commands' / uuid.uuid4().hex
            directory.mkdir(parents=True)
            request = directory / 'request.json'
            request.write_text(json.dumps({'argv': list(argv[position + 1:]), 'environment': {'PYTHONDONTWRITEBYTECODE': '1'}}), encoding='utf-8')
            argv = list(argv[:position + 1]) + [backend['interpreter'], '-B', linux(helper), linux(request)]
        return original(argv, *args, **kwargs)
    subprocess.run = controlled
