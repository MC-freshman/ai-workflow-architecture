"""Codex-owned WSL2 adapter. Configuration paths are not request authority."""
import json
from pathlib import Path
import subprocess

from runtime_core import Rejected, relative_path, unlinked, write_bytes


def linux(path):
    path = Path(path).absolute()
    if path.drive.lower() != "e:":
        raise Rejected("UNAUTHORIZED", "This adapter is configured only for E: platform paths")
    return "/mnt/e/" + path.as_posix()[3:]


def start_script(release, entry, argv, work, environment, attempt_root, timeout=30, gated=False):
    release = unlinked(release)
    relative_path(release, entry)
    if not entry.endswith(".py") or not isinstance(argv, list) or not all(isinstance(a, str) and "\x00" not in a for a in argv):
        raise Rejected("UNAUTHORIZED", "Only locked Python entries and structured argv are supported")
    attempt_root = unlinked(attempt_root)
    attempt_root.mkdir(parents=True, exist_ok=False)
    work = unlinked(work)
    work.mkdir(parents=True, exist_ok=True)
    config = {"release": linux(release), "entry": entry, "argv": argv, "work": linux(work), "environment": linux(environment), "timeoutSeconds": timeout}
    config.update({key: linux(attempt_root / name) for key, name in {"jail": "jail", "scratch": "scratch", "stdout": "stdout.log", "stderr": "stderr.log", "result": "result.json", "processRecord": "process.json", "cancel": "cancel.flag"}.items()})
    config['authorize'] = linux(attempt_root / 'authorize.flag') if gated else None
    config_path = attempt_root / "config.json"
    write_bytes(config_path, json.dumps(config).encode("utf-8"), exclusive=True)
    controller = Path(__file__).with_name("sandbox_linux.py")
    # Never kill wsl.exe to infer Linux termination. The controller owns and
    # observes the complete namespace; cancellation is a separate control file.
    process = subprocess.Popen(["C:/WINDOWS/system32/wsl.exe", "-d", "Ubuntu2204", "--exec", "/usr/bin/python3", "-B", linux(controller), linux(config_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return process


def wait_script(process, attempt_root):
    attempt_root = Path(attempt_root)
    _, diagnostic = process.communicate()
    result_path = attempt_root / "result.json"
    if not result_path.exists():
        write_bytes(attempt_root / "controller-error.log", diagnostic, exclusive=True)
        raise Rejected("UNKNOWN_OUTCOME", "Isolation controller did not confirm process-tree termination")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["controllerExitCode"] = process.returncode
    if process.returncode != 0 or result.get("processTreeEnded") is not True:
        raise Rejected("UNKNOWN_OUTCOME", "Isolation controller outcome is uncertain")
    return result


def run_script(release, entry, argv, work, environment, attempt_root, timeout=30, started=None):
    process = start_script(release, entry, argv, work, environment, attempt_root, timeout)
    if started:
        started(process.pid)
    return wait_script(process, attempt_root)
