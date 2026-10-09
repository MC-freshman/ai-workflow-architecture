"""Own a command tree. Windows Job Object closes the tree if this controller dies."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


def main():
    specification = json.loads(sys.stdin.readline())
    if Path(specification['cancelPath']).exists():
        return 125
    job = None
    if os.name == 'nt':
        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [(field, ctypes.c_ulonglong) for field in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]
        class BASIC(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong), ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t), ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD), ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
        class EXTENDED(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO_COUNTERS), ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]; kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        job = kernel.CreateJobObjectW(None, None)
        limits = EXTENDED(); limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        process = subprocess.Popen(specification['argv'], cwd=specification['cwd'], stdin=subprocess.PIPE if specification.get('input') is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=0x00000004 | subprocess.CREATE_NO_WINDOW)
        if not kernel.AssignProcessToJobObject(job, int(process._handle)):
            process.kill(); raise ctypes.WinError(ctypes.get_last_error())
        native = ctypes.WinDLL('ntdll'); native.NtResumeProcess.argtypes = [wintypes.HANDLE]
        if native.NtResumeProcess(int(process._handle)) != 0:
            kernel.TerminateJobObject(job, 1); raise RuntimeError('unable to resume owned command')
    else:
        process = subprocess.Popen(specification['argv'], cwd=specification['cwd'], stdin=subprocess.PIPE if specification.get('input') is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    if specification.get('input') is not None:
        process.stdin.write(specification['input'].encode('utf-8')); process.stdin.close()
    def copy(source, destination):
        while True:
            data = source.read1(65536)
            if not data: break
            destination.buffer.write(data); destination.buffer.flush()
    threads = [threading.Thread(target=copy, args=(process.stdout, sys.stdout)), threading.Thread(target=copy, args=(process.stderr, sys.stderr))]
    for thread in threads: thread.start()
    started = time.monotonic(); termination = None
    try:
        while process.poll() is None:
            if Path(specification['cancelPath']).exists() or time.monotonic() - started > specification['timeoutSeconds']:
                termination = 'cancelled' if Path(specification['cancelPath']).exists() else 'timed-out'
                # Existing WSL controllers own their Linux descendants and accept this exact cancel marker.
                for record in Path(specification['scopeRoot']).rglob('process.json'):
                    record.with_name('cancel.flag').touch()
                time.sleep(.3)
                if job: kernel.TerminateJobObject(job, 125)
                else: os.killpg(process.pid, signal.SIGKILL)
                break
            time.sleep(.05)
        process.wait()
    finally:
        if job: kernel.CloseHandle(job)
        for thread in threads: thread.join(timeout=5)
    return 125 if termination == 'cancelled' else 124 if termination == 'timed-out' else process.returncode


if __name__ == '__main__':
    sys.exit(main())
