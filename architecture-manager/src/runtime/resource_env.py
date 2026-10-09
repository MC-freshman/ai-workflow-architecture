"""Prepare and really restore a platform-owned resource environment before activation."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args):
    value = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=1200)
    if value.returncode:
        raise RuntimeError('RESOURCE_ENVIRONMENT_COMMAND_FAILED:' + Path(args[0]).name)
    return value.stdout.decode('utf-8', errors='replace').strip()


def python_at(directory):
    return directory / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def normalized(name):
    import re
    return re.sub(r'[-_.]+', '-', name).lower()


def probe(python):
    script = "import importlib.metadata as m,json;print(json.dumps({d.metadata['Name']:d.version for d in m.distributions()}))"
    return {normalized(k): v for k, v in json.loads(run([str(python), '-B', '-c', script])).items()}


def files(directory):
    base = directory / ('Lib/site-packages' if os.name == 'nt' else 'lib')
    return {f.relative_to(base).as_posix(): sha(f) for f in base.rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix != '.pyc' and f.name not in {'RECORD', 'REQUESTED'}}


def restore(backup, destination):
    recipe = json.loads((backup / 'recipe.json').read_text(encoding='utf-8'))
    if not destination.resolve().is_relative_to(Path(recipe['platformRoot']).resolve() / 'runtime'):
        raise RuntimeError('RESOURCE_ENVIRONMENT_PATH_MISMATCH')
    run([recipe['creatorPython'], '-B', '-m', 'venv', str(destination)])
    python = python_at(destination)
    run([str(python), '-B', '-m', 'pip', 'install', '--no-index', '--find-links', str(backup / 'wheels'), '-r', str(backup / 'requirements.lock')])
    expected = json.loads((backup / 'FILES.json').read_text(encoding='utf-8'))
    actual = files(destination)
    if actual != expected:
        raise RuntimeError('RESOURCE_ENVIRONMENT_RESTORE_HASH_MISMATCH')
    return {'pass': True, 'filesCompared': len(expected), 'packages': probe(python)}


def main(spec_path):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    directory, backup = Path(spec['directory']).resolve(), Path(spec['backup']).resolve()
    if spec_path.resolve().parent != directory or spec['platformId'] not in directory.parts or spec['platformId'] not in backup.parts:
        raise RuntimeError('RESOURCE_ENVIRONMENT_PATH_MISMATCH')
    env = directory / 'active'
    result_path = directory / 'resource-environment.json'
    if result_path.exists():
        result = json.loads(result_path.read_text(encoding='utf-8'))
        if result['requirementsDigest'] != spec['requirementsDigest'] or not all(probe(Path(result['python'])).get(k) == v for k, v in spec['packages'].items()):
            raise RuntimeError('RESOURCE_ENVIRONMENT_DRIFT')
        return
    print(json.dumps({'phase': '准备资源依赖环境'}), flush=True)
    run([spec['python'], '-B', '-m', 'venv', str(env)])
    python = python_at(env)
    direct = directory / 'requirements.in'
    direct.write_text(''.join(f'{k}=={v}\n' for k, v in sorted(spec['packages'].items())), encoding='utf-8')
    options = ['--no-index', '--find-links', spec['wheelhouse']] if spec.get('wheelhouse') else []
    run([str(python), '-B', '-m', 'pip', 'install', *options, '-r', str(direct)])
    run([str(python), '-B', '-m', 'pip', 'check'])
    packages = probe(python)
    if not all(packages.get(k) == v for k, v in spec['packages'].items()):
        raise RuntimeError('RESOURCE_ENVIRONMENT_PACKAGE_MISMATCH')
    imports = {'python-docx': 'docx', 'openpyxl': 'openpyxl', 'python-pptx': 'pptx', 'reportlab': 'reportlab', 'pymupdf': 'pymupdf', 'numpy': 'numpy', 'pandas': 'pandas', 'matplotlib': 'matplotlib', 'scikit-learn': 'sklearn'}
    selected = [imports[k] for k in spec['packages'] if k in imports]
    if selected:
        run([str(python), '-B', '-c', 'import importlib; ' + '; '.join(f'importlib.import_module({m!r})' for m in selected)])
    backup.mkdir(parents=True, exist_ok=True)
    wheels = backup / 'wheels'
    wheels.mkdir(exist_ok=True)
    lock = backup / 'requirements.lock'
    lock.write_text(''.join(f'{k}=={v}\n' for k, v in sorted(packages.items()) if k not in {'pip', 'setuptools', 'wheel'} or k in spec['packages']), encoding='utf-8')
    run([str(python), '-B', '-m', 'pip', 'download', *options, '--only-binary=:all:', '--dest', str(wheels), '-r', str(lock)])
    expected = files(env)
    save(backup / 'FILES.json', expected)
    recipe = {'schema': 'manager-resource-environment-backup/v1', 'platformId': spec['platformId'], 'platformRoot': str(directory.parents[2]), 'creatorPython': spec['python'], 'containsCredentials': False, 'command': [spec['python'], '-B', str(backup / 'restore.py'), '--restore', str(backup), '<target-platform-runtime-destination>']}
    save(backup / 'recipe.json', recipe)
    shutil.copyfile(__file__, backup / 'restore.py')
    print(json.dumps({'phase': '离线恢复并逐文件核对资源环境'}), flush=True)
    restored = restore(backup, directory / 'restore-drill')
    proof_path = directory / 'RESTORE-VERIFIED.json'
    save(proof_path, {**restored, 'recipeSha256': sha(backup / 'recipe.json'), 'filesSha256': sha(backup / 'FILES.json')})
    (backup / 'SHA256SUMS').write_text(''.join(sha(f) + '  ' + f.relative_to(backup).as_posix() + '\n' for f in sorted(backup.rglob('*')) if f.is_file() and f.name != 'SHA256SUMS'), encoding='utf-8')
    save(result_path, {'schema': 'ai-resource-environment/v1', 'platformId': spec['platformId'], 'ownership': 'platform/runtime', 'python': str(python), 'packages': packages, 'profiles': spec['profiles'], 'requirementsDigest': spec['requirementsDigest'], 'restoreEvidence': str(proof_path), 'restoreEvidenceSha256': sha(proof_path), 'importsVerified': selected, 'backupRecipeSha256': sha(backup / 'recipe.json')})


if __name__ == '__main__':
    if sys.argv[1] == '--restore':
        print(json.dumps(restore(Path(sys.argv[2]), Path(sys.argv[3]))))
    else:
        main(Path(sys.argv[1]))
