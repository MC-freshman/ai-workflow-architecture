"""WSL2 process controller and Linux namespace/execute-allowlist boundary."""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def landlock(executable=None):
    libc = ctypes.CDLL(None, use_errno=True)
    abi = libc.syscall(444, 0, 0, 1)
    if abi < 1:
        raise OSError(ctypes.get_errno(), "Landlock is required")
    if executable is None:
        return abi
    rules = ctypes.c_uint64(1)  # LANDLOCK_ACCESS_FS_EXECUTE
    fd = libc.syscall(444, ctypes.byref(rules), ctypes.sizeof(rules), 0)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "landlock_create_ruleset")

    class PathRule(ctypes.Structure):
        _pack_ = 1
        _fields_ = [("access", ctypes.c_uint64), ("parent", ctypes.c_int)]

    try:
        for allowed in (executable, str(Path('/lib64/ld-linux-x86-64.so.2').resolve())):
            target = os.open(allowed, os.O_PATH | os.O_CLOEXEC)
            try:
                rule = PathRule(1, target)
                if libc.syscall(445, fd, 1, ctypes.byref(rule), 0):
                    raise OSError(ctypes.get_errno(), "landlock_add_rule")
            finally:
                os.close(target)
        if libc.prctl(38, 1, 0, 0, 0) or libc.syscall(446, fd, 0):
            raise OSError(ctypes.get_errno(), "landlock_restrict_self")
    finally:
        os.close(fd)


def child(config):
    libc = ctypes.CDLL(None, use_errno=True)
    libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_char_p]

    def mount(source, target, kind=None, flags=0, data=None):
        args = [os.fsencode(x) if x is not None else None for x in (source, target, kind)]
        if libc.mount(*args, flags, os.fsencode(data) if data else None):
            raise OSError(ctypes.get_errno(), "mount: " + str(target))

    root = Path(config["jail"])
    mount(None, "/", flags=16384 | (1 << 18))  # recursive private
    mount("tmpfs", root, "tmpfs", 2 | 4, "size=64m")

    def bind(source, relative, readonly=True, noexec=False):
        source = Path(source)
        target = root / relative.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            target.mkdir(exist_ok=True)
        else:
            target.touch()
        mount(source, target, flags=4096 | 16384)
        targets = [target]
        if source.is_dir():
            for line in Path('/proc/self/mountinfo').read_text().splitlines():
                mounted = Path(line.split()[4].replace('\\040', ' '))
                if target in mounted.parents:
                    targets.append(mounted)
        for mounted in targets:
            flags = os.statvfs(mounted).f_flag
            mount(None, mounted, flags=4096 | 32 | flags | 2 | (1 if readonly else 0) | (8 if noexec else 0))

    for name in ('usr/bin/python3', 'usr/bin/python3.10', 'usr/lib/python3.10', 'usr/lib/x86_64-linux-gnu', 'usr/share/fonts', 'usr/share/fontconfig', 'lib', 'lib64'):
        if Path("/" + name).exists():
            bind("/" + name, name)
    for name in ("etc/ld.so.cache", "etc/fonts"):
        if Path("/" + name).exists():
            bind("/" + name, name)
    for name in ("null", "zero", "urandom", "random"):
        bind("/dev/" + name, "dev/" + name, False)
    bind(config["release"], "release")
    bind(config["environment"], "environment")
    bind(config["work"], "work", False, noexec=True)
    raw_inputs = Path(config['work']) / 'data/raw'
    if raw_inputs.is_dir():
        bind(raw_inputs, 'work/data/raw')
    bind(config["scratch"], "scratch", False, noexec=True)
    (root / "proc").mkdir()
    mount("proc", root / "proc", "proc", 2 | 4 | 8)
    os.chroot(root)
    os.chdir("/work")
    executable = "/environment/bin/python"
    landlock(str(Path(executable).resolve()))

    class Header(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]

    class Caps(ctypes.Structure):
        _fields_ = [("effective", ctypes.c_uint32), ("permitted", ctypes.c_uint32), ("inheritable", ctypes.c_uint32)]

    header = Header(0x20080522, 0)
    caps = (Caps * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(caps)):
        raise OSError(ctypes.get_errno(), "capset")
    env = {"PATH": "/environment/bin", "HOME": "/scratch", "TMPDIR": "/scratch", "TEMP": "/scratch", "TMP": "/scratch", "MPLCONFIGDIR": "/scratch/matplotlib", "XDG_CACHE_HOME": "/scratch/cache", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1", "MPLBACKEND": "Agg", "LANG": "C.UTF-8"}
    env['PYTHONPYCACHEPREFIX'] = '/scratch/bytecode'
    os.execve(executable, [executable, "-B", "/release/" + config["entry"]] + config["argv"], env)


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(".pending")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def control(config_path):
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    if config.get('authorize'):
        deadline = time.monotonic() + 30
        while not Path(config['authorize']).exists():
            if Path(config['cancel']).exists() or time.monotonic() >= deadline:
                save(config['result'], {'exitCode': -1, 'reason': 'cancelled-before-launch', 'processTreeEnded': True, 'elapsedMilliseconds': 0})
                return
            time.sleep(.05)
        if Path(config['cancel']).exists():
            save(config['result'], {'exitCode': -1, 'reason': 'cancelled-before-launch', 'processTreeEnded': True, 'elapsedMilliseconds': 0})
            return
    abi = landlock()
    for key in ("jail", "scratch"):
        Path(config[key]).mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    with open(config["stdout"], "xb") as out, open(config["stderr"], "xb") as err:
        process = subprocess.Popen(["/usr/bin/unshare", "--user", "--map-root-user", "--net", "--mount", "--pid", "--fork", "--kill-child=KILL", "/usr/bin/python3", "-B", str(Path(__file__).resolve()), "--child", config_path], stdout=out, stderr=err, start_new_session=True, env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
        save(config["processRecord"], {"pid": process.pid, "procStart": Path(f"/proc/{process.pid}/stat").read_text().split(") ", 1)[1].split()[19], "landlockAbi": abi})
        reason = "exited"
        try:
            while process.poll() is None:
                if Path(config["cancel"]).exists() or time.monotonic() - started >= config["timeoutSeconds"]:
                    reason = "cancelled" if Path(config["cancel"]).exists() else "timeout"
                    os.killpg(process.pid, signal.SIGKILL)
                    break
                time.sleep(0.05)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    save(config["result"], {"exitCode": process.returncode, "reason": reason, "processTreeEnded": True, "elapsedMilliseconds": round((time.monotonic() - started) * 1000), "landlockAbi": abi})


if __name__ == "__main__":
    if sys.argv[1] == "--probe":
        print(json.dumps({"landlockAbi": landlock()}))
    elif sys.argv[1] == "--child":
        child(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
    else:
        control(sys.argv[1])
