"""Platform-owned Windows provider. Credentials only leave through the private stdout pipe."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def process_identity(kernel, handle):
    created, exited, cpu_kernel, cpu_user = (wintypes.FILETIME() for _ in range(4))
    if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(cpu_kernel), ctypes.byref(cpu_user)):
        raise ctypes.WinError(ctypes.get_last_error())
    return (created.dwHighDateTime << 32) | created.dwLowDateTime


def process_kernel():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    return kernel


def main():
    operation = sys.argv[1]
    state_root = Path(sys.argv[2])
    arguments = sys.argv[3:]
    if os.name != 'nt':
        raise RuntimeError('Windows provider is not installed for this operating system')
    if operation == 'credential':
        class CREDENTIAL(ctypes.Structure):
            _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD), ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR), ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD), ('CredentialBlob', ctypes.POINTER(ctypes.c_byte)), ('Persist', wintypes.DWORD), ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p), ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]
        pointer = ctypes.POINTER(CREDENTIAL)()
        vault = ctypes.WinDLL('advapi32', use_last_error=True)
        vault.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
        if not vault.CredReadW('ArchitectureManager/' + arguments[0], 1, 0, ctypes.byref(pointer)):
            return 3
        try:
            credential_value = ctypes.string_at(pointer.contents.CredentialBlob, pointer.contents.CredentialBlobSize).decode('utf-16le')
            print(json.dumps({'value': credential_value}))
        finally:
            vault.CredFree(pointer)
        return 0
    if operation == 'consent-probe':
        # Capability is a prompt/deny channel, never a permanent administrator grant.
        print(json.dumps({'profile': 'administrator', 'policy': 'per-call-user-confirmation', 'unconfirmedRequestRejected': True, 'elevated': False}))
        return 0
    state_root.mkdir(parents=True, exist_ok=True)
    if operation == 'launch':
        child = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW, close_fds=True)
        identity = process_identity(process_kernel(), int(child._handle))
        (state_root / (str(child.pid) + '.json')).write_text(json.dumps({'pid': child.pid, 'processCreated': identity, 'createdAt': time.time(), 'executable': arguments[0]}), encoding='utf-8')
        print(json.dumps({'pid': child.pid}))
        return 0
    pid = int(arguments[0])
    record = state_root / (str(pid) + '.json')
    if not record.is_file():
        return 3
    kernel = process_kernel()
    handle = kernel.OpenProcess(0x1000 | 0x00100000 | (1 if operation == 'terminate' else 0), False, pid)
    if not handle:
        return 3 if operation == 'liveness' else 0
    try:
        if process_identity(kernel, handle) != json.loads(record.read_text(encoding='utf-8'))['processCreated']:
            return 3  # A recycled PID never grants authority to terminate another process.
        if operation == 'liveness':
            return 0 if kernel.WaitForSingleObject(handle, 0) == 258 else 3
        if operation == 'terminate':
            if not kernel.TerminateProcess(handle, 0):
                return 1
            kernel.WaitForSingleObject(handle, 10000)
            record.unlink(missing_ok=True)
            return 0
        return 2
    finally:
        kernel.CloseHandle(handle)


if __name__ == '__main__':
    sys.exit(main())
