"""Windows platform credential provider with private encrypted backup and real restore drill."""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]


class Credential(ctypes.Structure):
    _fields_ = [('flags', wintypes.DWORD), ('type', wintypes.DWORD), ('target', wintypes.LPWSTR), ('comment', wintypes.LPWSTR), ('written', wintypes.FILETIME), ('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte)), ('persist', wintypes.DWORD), ('count', wintypes.DWORD), ('attributes', ctypes.c_void_p), ('alias', wintypes.LPWSTR), ('username', wintypes.LPWSTR)]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def prune_backups(backup_root, reference, keep=10):
    """AUD-D-007: bound per-reference backup directories; only prune what this tool wrote."""
    try:
        candidates = []
        for entry in backup_root.iterdir():
            manifest = entry / 'MANIFEST.json'
            if not entry.is_dir() or not manifest.is_file():
                continue
            try:
                data = json.loads(manifest.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue  # an unrecognized directory is never touched
            if data.get('schema') == 'architecture-manager-credential-backup/v1' and data.get('reference') == reference:
                candidates.append((entry.stat().st_mtime, entry))
        candidates.sort(reverse=True)
        for _, entry in candidates[keep:]:
            shutil.rmtree(entry)
    except OSError:
        pass  # pruning is best effort; the fresh backup is already durable


def protect(value, entropy, decrypt=False):
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    source_buffer = ctypes.create_string_buffer(value)
    entropy_buffer = ctypes.create_string_buffer(entropy)
    source = Blob(len(value), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    extra = Blob(len(entropy), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_byte)))
    output = Blob()
    method = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    method.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    method.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not method(ctypes.byref(source), None, ctypes.byref(extra), None, None, 1, ctypes.byref(output)):
        raise ValueError('CREDENTIAL_ENCRYPTION_FAILED')
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def vault_api():
    vault = ctypes.WinDLL('advapi32', use_last_error=True)
    vault.CredWriteW.argtypes = [ctypes.POINTER(Credential), wintypes.DWORD]
    vault.CredWriteW.restype = wintypes.BOOL
    vault.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    vault.CredReadW.restype = wintypes.BOOL
    vault.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    vault.CredFree.argtypes = [ctypes.c_void_p]
    return vault


def write_vault(target, value):
    data = value.encode('utf-16le')
    if len(data) > 2560:
        raise ValueError('CREDENTIAL_VALUE_TOO_LARGE')
    buffer = ctypes.create_string_buffer(data)
    credential = Credential()
    credential.type, credential.persist = 1, 2
    credential.target, credential.username = target, 'Architecture Manager'
    credential.size, credential.data = len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))
    if not vault_api().CredWriteW(ctypes.byref(credential), 0):
        raise ValueError('CREDENTIAL_VAULT_FAILED')


def read_vault(target):
    vault, pointer = vault_api(), ctypes.POINTER(Credential)()
    if not vault.CredReadW(target, 1, 0, ctypes.byref(pointer)):
        raise ValueError('MCP_CREDENTIAL_REQUIRED')
    try:
        return ctypes.string_at(pointer.contents.data, pointer.contents.size).decode('utf-16le')
    finally:
        vault.CredFree(pointer)


def main():
    if os.name != 'nt':
        raise ValueError('CREDENTIAL_STORE_UNSUPPORTED')
    operation, root = sys.argv[1], Path(sys.argv[2]).resolve()
    request = json.load(sys.stdin)
    name = request.get('name', '')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', name):
        raise ValueError('CREDENTIAL_REFERENCE_INVALID')
    realm = digest(str(root).lower().encode('utf-8'))
    entropy = (realm + '/' + name).encode('ascii')
    target = 'ArchitectureManager/' + realm + '/' + name
    path = root / (digest(name.encode('utf-8')) + '.json')
    if operation == 'read':
        # Only the registered native MCP provider consumes this stdout in memory.
        print(json.dumps({'value': read_vault(target)}))
        return
    if operation == 'status':
        available = False
        try:
            read_vault(target)
            available = True
        except ValueError:
            pass
        print(json.dumps({'ok': True, 'reference': 'reference:' + name, 'available': available, 'encryptedRecordExists': path.is_file()}))
        return
    if operation == 'delete':
        if not vault_api().CredDeleteW(target, 1, 0) and ctypes.get_last_error() != 1168:
            raise ValueError('CREDENTIAL_VAULT_FAILED')
        # Retain the encrypted primary and backups for explicit restoration.
        print(json.dumps({'ok': True, 'reference': 'reference:' + name, 'deleted': True, 'encryptedBackupRetained': path.is_file()}))
        return
    if operation == 'restore':
        saved = json.loads(path.read_text(encoding='utf-8'))
        if saved.get('reference') != 'reference:' + name or saved.get('realm') != realm:
            raise ValueError('CREDENTIAL_RESTORE_FAILED')
        value = protect(base64.b64decode(saved['ciphertext']), entropy, decrypt=True).decode('utf-8')
        write_vault(target, value)
        print(json.dumps({'ok': True, 'reference': 'reference:' + name, 'restored': read_vault(target) == value}))
        return
    if operation != 'set':
        raise ValueError('CREDENTIAL_OPERATION_INVALID')
    value = request.get('value')
    if not isinstance(value, str) or not value or len(value.encode('utf-16le')) > 2560:
        raise ValueError('CREDENTIAL_VALUE_INVALID')
    backup = Path(request['backupRoot']).resolve() / str(uuid.uuid4())
    root.mkdir(parents=True, exist_ok=True)
    backup.mkdir(parents=True)
    if path.is_file():
        shutil.copyfile(path, backup / 'previous.json')
    encrypted = protect(value.encode('utf-8'), entropy)
    record = {'schema': 'architecture-manager-private-credential/v1', 'reference': 'reference:' + name, 'realm': realm, 'containsCredentials': True, 'ciphertext': base64.b64encode(encrypted).decode('ascii')}
    payload = (json.dumps(record) + '\n').encode('utf-8')
    (backup / 'credential.json').write_bytes(payload)
    restored = (backup / 'restored.json')
    shutil.copyfile(backup / 'credential.json', restored)
    recovered = json.loads(restored.read_text(encoding='utf-8'))
    recovered_value = protect(base64.b64decode(recovered['ciphertext']), entropy, decrypt=True).decode('utf-8')
    probe_target = target + '/restore-' + str(uuid.uuid4())
    try:
        write_vault(probe_target, recovered_value)
        if recovered_value != value or read_vault(probe_target) != value or restored.read_bytes() != payload:
            raise ValueError('CREDENTIAL_RESTORE_FAILED')
    finally:
        vault_api().CredDeleteW(probe_target, 1, 0)
        restored.unlink(missing_ok=True)
    manifest = {'schema': 'architecture-manager-credential-backup/v1', 'reference': 'reference:' + name, 'containsCredentials': True, 'encrypted': True, 'currentUserOnly': True, 'realm': realm, 'file': 'credential.json', 'sha256': digest(payload), 'restoreDrill': {'performed': True, 'ciphertextBytesEqual': True, 'vaultRoundtripPassed': True}}
    (backup / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    write_vault(target, value)
    temp = path.with_name(path.name + '-' + str(uuid.uuid4()) + '.tmp')
    temp.write_bytes(payload)
    os.replace(temp, path)
    prune_backups(Path(request['backupRoot']).resolve(), 'reference:' + name)
    print(json.dumps({'ok': True, 'reference': 'reference:' + name, 'backup': str(backup), 'restoreDrill': True, 'containsCredentials': True, 'encrypted': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never include caller values, native stderr or exception details.
        code = str(error) if str(error).startswith(('CREDENTIAL_', 'MCP_CREDENTIAL_')) else 'CREDENTIAL_STORE_FAILED'
        print(json.dumps({'ok': False, 'error': code}))
        sys.exit(3)
