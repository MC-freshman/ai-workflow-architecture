"""Vendor app-server adapter. No model turn; real MCP tool calls, scoped process tree."""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest() if Path(path).exists() else None


def protect(data, decrypt=False):
    if os.name != 'nt':
        raise ValueError('NATIVE_CONFIG_BACKUP_UNAVAILABLE')
    class Blob(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('NATIVE_CONFIG_BACKUP_FAILED')
    try:
        return ctypes.string_at(target.data, target.length)
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(target.data)


def backup(path, output):
    original = Path(path).read_bytes() if Path(path).exists() else None
    sealed = protect(original or b'')
    if protect(sealed, True) != (original or b''):
        raise ValueError('NATIVE_CONFIG_RESTORE_FAILED')
    value = {'schema': 'native-config-private-backup/v1', 'path': str(path), 'existed': original is not None, 'beforeSha256': digest(path), 'encryptedPayload': base64.b64encode(sealed).decode(), 'restoreVerified': True, 'containsCredentials': 'possible', 'scope': 'current-Windows-user-DPAPI'}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    if Path(output).exists():
        raise ValueError('NATIVE_CONFIG_BACKUP_EXISTS')
    # A real isolated restored file, not just an in-memory cryptographic round trip.
    drill = Path(output).with_suffix('.restore-drill')
    try:
        drill.write_bytes(protect(sealed, True))
        if drill.read_bytes() != (original or b''):
            raise ValueError('NATIVE_CONFIG_RESTORE_FAILED')
    finally:
        if drill.exists():
            drill.unlink()
    Path(output).write_text(json.dumps(value), encoding='utf-8')
    return value


def restore(output):
    value = json.loads(Path(output).read_text(encoding='utf-8'))
    path = Path(value['path'])
    if value['existed']:
        payload = protect(base64.b64decode(value['encryptedPayload']), True)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.manager-restore')
        temporary.write_bytes(payload)
        temporary.replace(path)
    elif path.exists():
        path.unlink()
    return digest(path) == value['beforeSha256']


class Rpc:
    def __init__(self, executable, home, cwd):
        env = {**os.environ, 'CODEX_HOME': home}
        self.process = subprocess.Popen([executable, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=cwd, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.messages = queue.Queue()
        self.sequence = 0
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except (ValueError, UnicodeError):
                continue
        self.messages.put({'closed': True})

    def send(self, value):
        self.process.stdin.write((json.dumps(value) + '\n').encode())
        self.process.stdin.flush()

    def call(self, method, params):
        self.sequence += 1
        sequence = self.sequence
        self.send({'id': sequence, 'method': method, 'params': params})
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=max(.1, deadline-time.monotonic()))
            if message.get('closed'):
                raise ValueError('NATIVE_CLIENT_CONNECTION_FAILED')
            if 'method' in message:
                if 'id' in message:
                    self.send({'id': message['id'], 'error': {'code': -32601, 'message': 'Maintenance probe does not authorize interactive actions'}})
                continue
            if message.get('id') == sequence:
                if 'error' in message:
                    # Vendor error bodies may contain user settings. Do not export them.
                    raise ValueError('NATIVE_CLIENT_RPC_FAILED:' + method)
                return message['result']
        raise ValueError('NATIVE_CLIENT_TIMEOUT')

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)


def codex(spec):
    profile = spec['profile']
    rpc = Rpc(profile['executable'], profile['home'], spec['cwd'])
    try:
        rpc.call('initialize', {'clientInfo': {'name': 'architecture_manager', 'version': '0.6.0'}, 'capabilities': {'experimentalApi': True}})
        rpc.send({'method': 'initialized'})
        config = rpc.call('config/read', {'includeLayers': False})['config']
        if spec['operation'] == 'configure':
            if digest(profile['configPath']) != spec['beforeSha256']:
                raise ValueError('INTEGRATION_BASELINE_MISMATCH')
            # Refuse an existing unmanaged server instead of replacing its credentials.
            old = config.get('mcp_servers', {}).get('architecture')
            if old is not None and any(old.get(key) != value for key, value in spec['entry'].items()) and not spec.get('managed'):
                raise ValueError('NATIVE_SERVER_NAME_CONFLICT')
            backup(profile['configPath'], spec['backupPath'])
            if old is not None and all(old.get(key) == value for key, value in spec['entry'].items()):
                return {'registered': True, 'configSha256': digest(profile['configPath']), 'backupRestoreVerified': True, 'configurationUnchanged': True}
            wrote = False
            try:
                if digest(profile['configPath']) != spec['beforeSha256']:
                    raise ValueError('INTEGRATION_BASELINE_MISMATCH')
                rpc.call('config/batchWrite', {'edits': [{'keyPath': 'mcp_servers.architecture.' + key, 'value': value, 'mergeStrategy': 'replace'} for key, value in spec['entry'].items()], 'filePath': profile['configPath'], 'reloadUserConfig': True})
                wrote = True
                written_sha = digest(profile['configPath'])
                updated = rpc.call('config/read', {'includeLayers': False})['config'].get('mcp_servers', {}).get('architecture')
                if updated is None or any(updated.get(key) != value for key, value in spec['entry'].items()):
                    raise ValueError('NATIVE_CONFIGURATION_READBACK_FAILED')
            except Exception:
                if wrote and digest(profile['configPath']) != written_sha:
                    raise ValueError('NATIVE_CONFIG_EXTERNAL_CHANGE')
                if wrote and not restore(spec['backupPath']):
                    raise ValueError('NATIVE_CONFIG_RESTORE_FAILED')
                raise
            return {'registered': True, 'configSha256': digest(profile['configPath']), 'backupRestoreVerified': True}
        # Do not enable/inject architecture here: verification must consume native registration.
        entry = config.get('mcp_servers', {}).get('architecture', {})
        if any(entry.get(key) != value for key, value in spec['entry'].items()):
            raise ValueError('NATIVE_CONFIGURATION_READBACK_FAILED')
        overrides = {'mcp_servers.' + name + '.enabled': False for name in config.get('mcp_servers', {}) if name != 'architecture'}
        thread = rpc.call('thread/start', {'cwd': spec['cwd'], 'ephemeral': True, 'config': overrides})['thread']['id']
        receipt = rpc.call('mcpServer/tool/call', {'server': 'architecture', 'threadId': thread, 'tool': 'architecture_probe', 'arguments': spec['challenge']})
        resources = rpc.call('mcpServer/tool/call', {'server': 'architecture', 'threadId': thread, 'tool': 'architecture_list', 'arguments': {}})
        releases = {repo: rpc.call('mcpServer/tool/call', {'server': 'architecture', 'threadId': thread, 'tool': 'architecture_get_release', 'arguments': {'repository': repo, 'id': value['id'], 'version': value['version']}}) for repo, value in spec['releases'].items()}
        return {'receipt': receipt, 'resources': resources, 'releases': releases, 'modelTurnStarted': False, 'transport': 'vendor-app-server', 'configSha256': digest(profile['configPath'])}
    finally:
        rpc.close()


def main():
    spec = json.load(sys.stdin)
    if spec['operation'] == 'backup':
        value = backup(spec['configPath'], spec['backupPath'])
        result = {'backupRestoreVerified': value['restoreVerified']}
    elif spec['operation'] == 'restore':
        result = {'ok': restore(spec['backupPath'])}
    else:
        result = codex(spec)
    print(json.dumps({'ok': True, **result}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc) if str(exc).startswith(('NATIVE_', 'INTEGRATION_')) else 'NATIVE_CLIENT_CONNECTION_FAILED'}), flush=True)
        sys.exit(1)
