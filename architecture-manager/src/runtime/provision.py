"""Prepare platform-owned environments from exact release locks. Never reads peer runtimes."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import re
import uuid


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def progress(phase):
    print(json.dumps({'phase': phase}), flush=True)


def run(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, encoding='utf-8', errors='replace', **kwargs)
    if result.returncode:
        diagnostic = re.sub(r'https?://\S+', '[download endpoint]', (result.stdout + result.stderr)[-2400:]).replace('\0', '')
        raise RuntimeError('program failed: ' + str(argv[0]) + '\n' + diagnostic)
    return result.stdout


def main(path):
    spec = json.loads(Path(path).read_text(encoding='utf-8'))
    root = Path(spec['workspaceRoot']).resolve()
    base = (root / spec['installRoot']).resolve()
    if root / spec['platformId'] not in base.parents or base != Path(path).parent.resolve():
        raise ValueError('platform path mismatch')
    backend = spec['backend']
    if sys.version_info[:2] < (3, 10):
        raise ValueError('select Python 3.10 or newer to prepare the current pinned package requirements')

    def linux(value):
        value = Path(value).as_posix()
        for item in sorted(backend['pathMap'], key=lambda r: len(r['windows']), reverse=True):
            prefix = item['windows'].rstrip('/')
            if value.casefold().startswith(prefix.casefold() + '/'):
                return item['linux'] + value[len(prefix):].lstrip('/')
        raise ValueError('path is not mapped')

    def guest(argv):
        directory = base / 'guest-commands' / uuid.uuid4().hex
        directory.mkdir(parents=True)
        request = directory / 'request.json'
        save(request, {'argv': argv, 'environment': {'TMPDIR': linux(base / 'guest-tmp'), 'PIP_NO_CACHE_DIR': '1', 'PYTHONDONTWRITEBYTECODE': '1'}})
        return run([backend['wslExecutable'], '-d', backend['distro'], '--exec', backend['interpreter'], '-B', linux(base / 'guest-controller.py'), linux(request)])

    (base / 'guest-tmp').mkdir(exist_ok=True)
    shutil.copy2(Path(__file__).with_name('guest_controller.py'), base / 'guest-controller.py')

    version = json.loads(guest([backend['interpreter'], '-B', '-c', 'import sys,json;print(json.dumps(list(sys.version_info[:2])))']))
    # Current published controller binds the 3.10 standard library. Do not claim another runtime works.
    if version != [3, 10]:
        raise ValueError('published sandbox requires a verified Python 3.10 guest; select a compatible backend')
    requirements = base / 'requirements.lock.txt'
    requirements.write_text('\n'.join(spec['requirements']) + '\n', encoding='utf-8')
    host = base / 'host'
    progress('创建本平台 Windows 环境并安装固定版本依赖')
    run([sys.executable, '-B', '-m', 'venv', '--copies', str(host)])
    host_python = host / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    # Shared release requirements include scientific profiles, not only the runner's imports.
    run([str(host_python), '-B', '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(requirements)])
    wheels = base / 'wheels'
    progress('按实际 Linux ABI 下载固定版本安装包')
    wheels.mkdir(exist_ok=True)
    libc = json.loads(guest([backend['interpreter'], '-B', '-c', 'import platform,json;print(json.dumps({"libc":platform.libc_ver(),"machine":platform.machine()}))']))
    if libc['libc'][0] != 'glibc' or libc['machine'] != 'x86_64':
        raise ValueError('no registered wheel selection recipe for this guest ABI')
    minor = int(libc['libc'][1].split('.')[1])
    platforms = [part for number in range(minor, 4, -1) for part in ('--platform', 'manylinux_2_%s_x86_64' % number)] + ['--platform', 'manylinux2014_x86_64', '--platform', 'manylinux2010_x86_64']
    run([str(host_python), '-B', '-m', 'pip', 'download', '--disable-pip-version-check', '--only-binary=:all:'] + platforms + ['--python-version', '310', '--implementation', 'cp', '--abi', 'cp310', '-r', str(requirements), '--dest', str(wheels)])
    sealed = base / 'sealed'
    progress('创建本平台隔离环境并离线安装依赖')
    # A failed previous attempt already replaced these three venv aliases.
    # Remove only aliases within this installation before venv copies its executable again.
    guest([backend['interpreter'], '-B', '-c', 'import pathlib,sys;p=pathlib.Path(sys.argv[1]); names=("python","python3","python"+str(sys.version_info.major)+"."+str(sys.version_info.minor));[(f.unlink()) for name in names for f in [p/name] if f.is_symlink()]', linux(sealed / 'bin')])
    guest([backend['interpreter'], '-B', '-m', 'venv', '--without-pip', '--copies', linux(sealed)])
    guest([backend['interpreter'], '-B', '-c', 'import pathlib,sys;p=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.executable).resolve();[(f.unlink(missing_ok=True),f.symlink_to(target)) for f in (p/"python",p/"python3",p/("python"+str(sys.version_info.major)+"."+str(sys.version_info.minor)))]', linux(sealed / 'bin')])
    # An offline pip wheel avoids installing system apt packages or needing guest networking.
    import ensurepip
    pip_wheel = next((Path(ensurepip.__file__).parent / '_bundled').glob('pip-*.whl'))
    shutil.copy2(pip_wheel, base / pip_wheel.name)
    guest([linux(sealed / 'bin/python'), '-B', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);from pip._internal.cli.main import main;sys.exit(main(sys.argv[2:]))', linux(base / pip_wheel.name), 'install', '--no-index', '--find-links', linux(wheels), '-r', linux(requirements)])
    # lib64 is a venv-generated relative alias, not an external dependency.
    guest([backend['interpreter'], '-B', '-c', 'import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.unlink() if p.is_symlink() and str(p.readlink())=="lib" else None', linux(sealed / 'lib64')])
    inventory_code = 'import json,hashlib,pathlib,sys,importlib.metadata as m; p=pathlib.Path(sys.argv[1]); print(json.dumps({"pythonVersion":".".join(map(str,sys.version_info[:3])),"executable":sys.executable,"environment":str(p),"packages":{d.metadata["Name"].lower().replace("_","-"):d.version for d in m.distributions()},"files":[{"path":str(f),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(p.rglob("*")) if f.is_file()],"links":[{"path":str(f.relative_to(p)),"target":str(f.readlink())} for f in sorted(p.rglob("*")) if f.is_symlink()]}))'
    manifest = json.loads(guest([linux(sealed / 'bin/python'), '-B', '-c', inventory_code, linux(sealed)]))
    if not manifest['files']:
        raise ValueError('empty environment')
    save(base / 'script-environment.json', manifest)
    progress('复算隔离环境的逐文件哈希')
    verifier = Path(spec['runner']) / 'environment_verify.py'
    verification = json.loads(guest([backend['interpreter'], '-B', linux(verifier), linux(base / 'script-environment.json'), '-', linux(base / 'environment-verification.json')]))
    if verification.get('mismatches') != 0:
        raise ValueError('environment hash verification failed')
    backup = root / spec['backupRoot']
    progress('登记独立备份并执行真实恢复演练')
    backup.mkdir(parents=True, exist_ok=True)
    registration_path = backup / 'PREPARATION.json'
    owner = {'platformId': spec['platformId'], 'installationId': spec['installationId'], 'installRoot': spec['installRoot'], 'backupRoot': spec['backupRoot'], 'containsCredentials': False}
    if registration_path.exists() and json.loads(registration_path.read_text(encoding='utf-8')) != owner:
        raise ValueError('backup ownership mismatch')
    if not registration_path.exists() and any(file.name not in {'requirements.lock.txt','wheels','sealed-environment.zip'} for file in backup.iterdir()):
        raise ValueError('unregistered backup directory')
    save(registration_path, owner)
    shutil.copy2(requirements, backup / 'requirements.lock.txt')
    shutil.copytree(wheels, backup / 'wheels', dirs_exist_ok=True)
    wheel_hashes = [{'path': f.name, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(wheels.iterdir())]
    archive = backup / 'sealed-environment.zip'
    link_paths = {row['path'] for row in manifest['links']}
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for row in manifest['files']:
            relative = row['path'][len(linux(sealed)) + 1:]
            if relative not in link_paths:
                output.write(sealed.joinpath(*relative.split('/')), relative)
    # Restore from the backup archive, compare every byte, then use its real interpreter.
    attempt = uuid.uuid4().hex
    restored = base / ('restore-drill-' + attempt)
    guest([backend['interpreter'], '-B', '-c', 'import zipfile,sys,pathlib,os; p=pathlib.Path(sys.argv[2]);zipfile.ZipFile(sys.argv[1]).extractall(p);[(f.chmod(f.stat().st_mode|0o111)) for f in (p/"bin").iterdir() if f.is_file() and not f.is_symlink()]', linux(archive), linux(restored)])
    save(backup / 'links.json', manifest['links'])
    guest([backend['interpreter'], '-B', '-c', 'import pathlib,sys,json;p=pathlib.Path(sys.argv[1]);[(f.unlink(missing_ok=True),f.symlink_to(r["target"])) for r in json.load(open(sys.argv[2])) for f in [p.joinpath(r["path"])]]', linux(restored), linux(backup / 'links.json')])
    restored_inventory = json.loads(guest([linux(restored / 'bin/python'), '-B', '-c', inventory_code, linux(restored)]))
    expected = {f['path'][len(linux(sealed)):]: f['sha256'] for f in manifest['files']}
    actual = {f['path'][len(linux(restored)):]: f['sha256'] for f in restored_inventory['files']}
    if expected != actual:
        raise ValueError('restoration bytes differ')
    guest([linux(restored / 'bin/python'), '-B', '-c', 'import jsonschema,yaml,numpy,matplotlib,fitz;print("restored imports pass")'])
    host_archive = backup / 'host-environment.zip'
    host_files = [{'path': str(f.relative_to(host)), 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(host.rglob('*')) if f.is_file()]
    with zipfile.ZipFile(host_archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for row in host_files:
            output.write(host / row['path'], row['path'])
    host_restored = base / ('host-restore-drill-' + attempt)
    with zipfile.ZipFile(host_archive) as archive_input:
        archive_input.extractall(host_restored)
    if any(hashlib.sha256((host_restored / r['path']).read_bytes()).hexdigest() != r['sha256'] for r in host_files):
        raise ValueError('host restore hash mismatch')
    run([str(host_restored / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')), '-B', '-c', 'import jsonschema,yaml,numpy;print("host restore imports pass")'])
    save(backup / 'HOST-REBUILD.json', {'platformId': spec['platformId'], 'containsCredentials': False, 'archive': str(host_archive), 'archiveSha256': hashlib.sha256(host_archive.read_bytes()).hexdigest(), 'files': host_files, 'restoreVerified': True, 'rebuildCommand': [sys.executable, '-B', '-m', 'venv', '--copies', str(host)], 'installCommand': [str(host_python), '-B', '-m', 'pip', 'install', '-r', str(backup / 'requirements.lock.txt')]})
    shutil.copy2(Path(__file__).with_name('restore_env.py'), backup / 'restore.py')
    restore_registration = {'schema': 'manager-environment-restore/v1', 'platformId': spec['platformId'], 'platformRoot': str(root / spec['platformId']), 'backend': backend, 'sealedArchiveLinux': linux(archive), 'sealedArchiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'hostArchiveSha256': hashlib.sha256(host_archive.read_bytes()).hexdigest(), 'links': manifest['links'], 'allowedSystemInterpreters': sorted(set(link['target'] for link in manifest['links'])), 'sealedFiles': [{'path': row['path'][len(linux(sealed)) + 1:], 'sha256': row['sha256']} for row in manifest['files']], 'hostFiles': host_files, 'containsCredentials': False, 'command': [sys.executable, '-B', str(backup / 'restore.py'), str(backup / 'RESTORE.json'), str(base / ('registered-restore-drill-' + attempt))]}
    save(backup / 'RESTORE.json', restore_registration)
    restored_result = json.loads(run(restore_registration['command']).splitlines()[-1])
    if not all(restored_result.get(key) is True for key in ('hostRestored', 'sealedRestored', 'hashesMatch')):
        raise ValueError('registered restoration did not pass')
    save(backup / 'RESTORE-VERIFIED.json', {'installationId': spec['installationId'], 'registrationSha256': hashlib.sha256((backup / 'RESTORE.json').read_bytes()).hexdigest(), 'result': restored_result, 'command': restore_registration['command']})
    save(backup / 'REBUILD.json', {'schema': 'platform-environment-rebuild/v1', 'platformId': spec['platformId'], 'containsCredentials': False, 'requirements': spec['requirements'], 'wheels': wheel_hashes, 'archive': {'path': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}, 'environmentFiles': manifest['files'], 'command': [backend['wslExecutable'], '-d', backend['distro'], '--exec', backend['interpreter'], '-B', '-m', 'zipfile', '-e', linux(archive), linux(sealed)], 'restoreDrill': {'hashesMatch': True, 'importsPassed': True, 'path': str(restored)}})
    save(base / 'result.json', {'ok': True, 'environmentVerified': True, 'restoreVerified': True, 'hostPython': str(host_python), 'environmentManifest': str(base / 'script-environment.json'), 'backupPath': str(backup), 'listedFiles': len(manifest['files']), 'verification': verification})
    progress('本平台环境及备份恢复已通过，准备激活配置')


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except Exception as error:
        save(Path(sys.argv[1]).parent / 'failure.json', {'ok': False, 'reason': str(error), 'type': type(error).__name__})
        raise
