"""Read-only snapshot of the selected runner host; never invokes host business code."""
import hashlib
import json
from pathlib import Path
import sys
import os
import importlib

# Capture the runner's imported dependency closure, not every unrelated package
# installed in this Python. The sealed script environment has its own manifest.
for name in ('jsonschema', 'referencing', 'yaml'):
    importlib.import_module(name)

paths = {Path(sys.executable).resolve()}
base = Path(sys.base_prefix)
for pattern in ('python*.dll', 'python*.zip'):
    paths.update(base.glob(pattern))
for directory in (base / 'Lib', base / 'DLLs'):
    if directory.is_dir():
        for folder, directories, names in os.walk(directory):
            directories[:] = [name for name in directories if name not in ('site-packages', '__pycache__', 'test', 'tests', 'turtledemo')]
            paths.update(Path(folder) / name for name in names if Path(name).suffix.lower() in ('.py', '.pyd', '.dll', '.zip'))
packages = set()
for module in list(sys.modules.values()):
    filename = getattr(module, '__file__', None)
    if not filename:
        continue
    file = Path(filename).resolve()
    if 'site-packages' in file.parts:
        index = file.parts.index('site-packages')
        packages.add(Path(*file.parts[:index + 2]))
for package in packages:
    if package.is_dir():
        paths.update(p for p in package.rglob('*') if p.is_file() and p.suffix.lower() in ('.py', '.pyd', '.dll', '.zip'))
    elif package.is_file():
        paths.add(package)
rows = [{'path': str(p.resolve()), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(paths)]
print(json.dumps({'executable': str(Path(sys.executable).resolve()), 'pythonVersion': '.'.join(map(str, sys.version_info[:3])), 'files': rows, 'scope': 'runner-host-stdlib-and-imported-dependency-packages'}))
