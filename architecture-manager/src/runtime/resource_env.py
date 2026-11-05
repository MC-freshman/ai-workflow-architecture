"""Prepare and really restore a platform-owned resource environment before activation."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time


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


def emit(event):
    print(json.dumps(event), flush=True)


def dir_bytes(roots):
    total = 0
    for root in roots:
        base = Path(root)
        if not base.exists():
            continue
        for directory, _, names in os.walk(base):
            for name in names:
                try:
                    total += os.path.getsize(os.path.join(directory, name))
                except OSError:
                    # A file can vanish mid-download; the next poll sees the rest.
                    pass
    return total


def stream(args, stage, spec, watch=()):
    """Run a long pip command with a progress-aware deadline.

    D-172: the old fixed 1200s wall clock killed pip while it was still making
    progress (measured 24 KB/s against PyPI over IPv6, ~100 MB of wheels). The
    deadline is now renewed whenever pip prints a line or the watched
    directories grow; only real inactivity (idleTimeoutSeconds, default 900) or
    the hard cap (maxSeconds, default 3600) ends a run. Progress events carry
    the observed rate so the caller can show the download is alive.
    """
    idle_limit = float(spec.get('idleTimeoutSeconds') or 900)
    hard_limit = float(spec.get('maxSeconds') or 3600)
    started = time.time()
    lines = []
    state = {'last': started, 'note': ''}
    lock = threading.Lock()
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})

    def reader():
        for line in process.stdout:
            with lock:
                state['last'] = time.time()
                state['note'] = line.rstrip()
                if len(lines) < 200:
                    lines.append(state['note'])

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    watched = [Path(item) for item in watch if item]
    baseline = dir_bytes(watched)
    peak = baseline
    last_emit = 0.0
    last_size = 0.0
    timed_out = None
    try:
        while process.poll() is None:
            time.sleep(1.0)
            now = time.time()
            if now - last_size >= 5:
                last_size = now
                size = dir_bytes(watched)
                if size > peak:
                    peak = size
                    with lock:
                        state['last'] = now
            with lock:
                idle = now - state['last']
                note = state['note']
            elapsed = now - started
            if now - last_emit >= 10:
                last_emit = now
                emit({'phase': stage, 'elapsedSeconds': round(elapsed), 'idleSeconds': round(idle), 'downloadedBytes': peak,
                      'rateBytesPerSecond': round((peak - baseline) / max(elapsed, 1)), 'idleTimeoutSeconds': round(idle_limit),
                      'maxSeconds': round(hard_limit), 'lastLine': note[:200]})
            if idle > idle_limit:
                timed_out = 'RESOURCE_ENVIRONMENT_IDLE_TIMEOUT:%s:%ds' % (stage, round(idle_limit))
                break
            if elapsed > hard_limit:
                timed_out = 'RESOURCE_ENVIRONMENT_TIME_LIMIT:%s:%ds' % (stage, round(hard_limit))
                break
    finally:
        if process.poll() is None:
            process.kill()
    process.wait()
    thread.join(timeout=10)
    if timed_out:
        raise RuntimeError(timed_out)
    if process.returncode:
        tail = lines[-1] if lines else 'no output'
        raise RuntimeError('RESOURCE_ENVIRONMENT_COMMAND_FAILED:' + Path(args[0]).name + ':' + tail[:200])
    return '\n'.join(lines)


def index_options(spec):
    """D-171: the download route is configurable. A mirror index-url, an offline
    wheelhouse, or both (mirror first, local wheels as an additional source).
    Before this the only knob was a caller-supplied wheelhouse and nothing in
    the product surfaced either one."""
    options = []
    if spec.get('indexUrl'):
        options += ['--index-url', str(spec['indexUrl']).strip()]
    for host in spec.get('trustedHosts') or ([spec['trustedHost']] if spec.get('trustedHost') else []):
        options += ['--trusted-host', str(host).strip()]
    if spec.get('wheelhouse'):
        options += ['--find-links', spec['wheelhouse']]
        # A wheelhouse on its own means "install offline from these wheels".
        if not spec.get('indexUrl'):
            options += ['--no-index']
    return options


def transport_options(spec):
    # Socket level patience: a slow mirror needs many retries, not one short shot.
    return ['--timeout', str(int(spec.get('socketTimeoutSeconds') or 60)), '--retries', str(int(spec.get('retries') or 10))]


def pip_ready(python):
    try:
        run([str(python), '-B', '-m', 'pip', '--version'])
        return True
    except Exception:
        return False


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
    options = index_options(spec) + transport_options(spec)
    wheels = backup / 'wheels'
    wheels.mkdir(parents=True, exist_ok=True)
    cache = Path(os.environ.get('PIP_CACHE_DIR') or (directory / 'pip-cache'))
    emit({'phase': '准备资源依赖环境'})
    python = python_at(env)
    # D-172: a venv left behind by an interrupted attempt is reused, so a retry
    # continues instead of starting from an empty interpreter again.
    if python.exists() and pip_ready(python):
        emit({'phase': '复用已准备的资源环境并续装', 'python': str(python)})
    else:
        run([spec['python'], '-B', '-m', 'venv', str(env)])
        python = python_at(env)
    direct = directory / 'requirements.in'
    direct.write_text(''.join(f'{k}=={v}\n' for k, v in sorted(spec['packages'].items())), encoding='utf-8')
    # D-172: wheels an earlier attempt already fetched stay in play.
    local = ['--find-links', str(wheels)] if any(wheels.glob('*.whl')) else []
    try:
        stream([str(python), '-B', '-m', 'pip', 'install', *options, *local, '-r', str(direct)], '安装资源依赖包', spec, watch=[directory, wheels])
        run([str(python), '-B', '-m', 'pip', 'check'])
        packages = probe(python)
        if not all(packages.get(k) == v for k, v in spec['packages'].items()):
            raise RuntimeError('RESOURCE_ENVIRONMENT_PACKAGE_MISMATCH')
        imports = {'python-docx': 'docx', 'openpyxl': 'openpyxl', 'python-pptx': 'pptx', 'reportlab': 'reportlab', 'pymupdf': 'pymupdf', 'numpy': 'numpy', 'pandas': 'pandas', 'matplotlib': 'matplotlib', 'scikit-learn': 'sklearn'}
        selected = [imports[k] for k in spec['packages'] if k in imports]
        if selected:
            run([str(python), '-B', '-c', 'import importlib; ' + '; '.join(f'importlib.import_module({m!r})' for m in selected)])
        lock = backup / 'requirements.lock'
        lock.write_text(''.join(f'{k}=={v}\n' for k, v in sorted(packages.items()) if k not in {'pip', 'setuptools', 'wheel'} or k in spec['packages']), encoding='utf-8')
        emit({'phase': '下载离线 wheel 备份'})
        stream([str(python), '-B', '-m', 'pip', 'download', *options, *local, '--only-binary=:all:', '--dest', str(wheels), '-r', str(lock)], '下载离线 wheel 备份', spec, watch=[directory, wheels])
    except Exception:
        # D-172: never throw away progress. The venv, the pip cache and every
        # wheel already downloaded stay on disk, so re-running resumes.
        emit({'phase': '资源环境准备中断：已保留虚拟环境与已下载内容，重新执行将续装', 'keptVenv': str(env), 'keptWheels': str(wheels), 'keptCache': str(cache)})
        raise
    expected = files(env)
    save(backup / 'FILES.json', expected)
    recipe = {'schema': 'manager-resource-environment-backup/v1', 'platformId': spec['platformId'], 'platformRoot': str(directory.parents[2]), 'creatorPython': spec['python'], 'containsCredentials': False, 'command': [spec['python'], '-B', str(backup / 'restore.py'), '--restore', str(backup), '<target-platform-runtime-destination>']}
    save(backup / 'recipe.json', recipe)
    shutil.copyfile(__file__, backup / 'restore.py')
    emit({'phase': '离线恢复并逐文件核对资源环境'})
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
