"""C2c project lock (ADR-4 / §10.2-10.3 / gate 4).

Cross-process, same-host mutual exclusion keyed by a NORMALIZED project identity — not a
raw-path string hash. Handles Windows drive-letter case, 8.3/short names, and link/junction
targets via resolve(); produces a stable key. On Windows the lock is an OS named mutex so it
spans independent processes/platforms on the host; each caller records its own evidence and
no lock file is written into another platform's runtime.

This is the primitive; runner writeback serialization hooks it at the point a run commits to
a shared project target (see STATUS note — full in-runner writeback wiring is a remaining step).
"""
import ctypes
import hashlib
import os
from ctypes import wintypes
from pathlib import Path

from runtime_core import Rejected

WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 258
_WAIT_INFINITE = 0xFFFFFFFF


def normalize_project_path(target):
    """Canonical identity of a write target. Returns (canonical_str, sha256_key[:32])."""
    p = Path(target)
    try:
        rp = p.resolve()  # case, 8.3, symlinks and junctions collapse to the real target
    except OSError:
        rp = p
    s = str(rp).replace("\\", "/")
    parts = s.split("/")
    if parts and len(parts[0]) == 2 and parts[0][1] == ":":
        parts[0] = parts[0].upper()  # e: and E: are the same drive
    s = "/".join(parts).rstrip("/") or "/"
    key = hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]
    return s, key


class ProjectLock:
    """Acquire exclusive access to a project write target. RESOURCE_BUSY if held."""

    def __init__(self, target, wait_seconds=0):
        self.canonical, self.key = normalize_project_path(target)
        self.name = "Local\\ai-projlock-" + self.key
        self._wait_ms = max(0, int(wait_seconds * 1000))
        self._handle = None

    def acquire(self):
        if os.name != "nt":
            raise Rejected("CAPABILITY_UNAVAILABLE", "ProjectLock named-mutex is Windows-only in this backend")
        k32 = ctypes.windll.kernel32
        k32.CreateMutexW.restype = wintypes.HANDLE
        handle = k32.CreateMutexW(None, False, self.name)
        if not handle:
            raise Rejected("INTERNAL_ERROR", "CreateMutexW failed: " + str(ctypes.GetLastError()))
        status = k32.WaitForSingleObject(wintypes.HANDLE(handle), self._wait_ms)
        if status == WAIT_OBJECT_0:
            self._handle = handle
            return self
        k32.CloseHandle(wintypes.HANDLE(handle))
        code = "RESOURCE_BUSY" if status == WAIT_TIMEOUT else "REVISION_CONFLICT"
        raise Rejected(code, "Project write target is locked by another run: " + self.canonical)

    def release(self):
        if self._handle:
            k32 = ctypes.windll.kernel32
            k32.ReleaseMutex(wintypes.HANDLE(self._handle))
            k32.CloseHandle(wintypes.HANDLE(self._handle))
            self._handle = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False
