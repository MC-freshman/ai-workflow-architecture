"""Declarative execution backend adapter (C2d / gate 2).

The shared core carries no host path, launcher, distro or interpreter literals.
A platform supplies an ``wf-runner-execution-backend/v1`` document (inline dict or a
path to one) through ``config['executionBackend']``; the engine ships no backend
default. ``backends/wsl2-ubuntu.json`` inside this release is only an optional
reference declaration of one accepted shape -- loading it is a platform decision.
Configuration values come from the trusted platform config, never from request authority.
"""
import json
import re
from pathlib import Path
import subprocess

from runtime_core import Rejected, file_hash, relative_path, unlinked, write_bytes

BACKEND_SCHEMA = "wf-runner-execution-backend/v1"
BIND_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _validated(backend):
    if isinstance(backend, (str, Path)):
        try:
            backend = json.loads(Path(backend).read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise Rejected("INVALID_REQUEST", "Execution backend document cannot be read") from exc
    if not isinstance(backend, dict) or backend.get("schema") != BACKEND_SCHEMA:
        raise Rejected("CAPABILITY_UNAVAILABLE", "Execution backend must declare " + BACKEND_SCHEMA)
    if backend.get("kind") == "host":
        # 2.1.0 §3.2, last rung: no distro, no path translation, no jail. That is precisely why
        # the engine only routes here when this run's consent is in the lock.
        value = backend.get("interpreter")
        if not isinstance(value, str) or not value or "\x00" in value:
            raise Rejected("INVALID_REQUEST", "Execution backend field is not a usable string: interpreter")
        host = dict(backend)
        host["pathMap"], host["sharedReadOnlyBinds"] = [], []
        host["verifyTimeoutSeconds"] = backend.get("verifyTimeoutSeconds", 120)
        return host
    if backend.get("kind") != "wsl2":
        raise Rejected("CAPABILITY_UNAVAILABLE", "Unsupported execution backend kind: " + str(backend.get("kind")))
    for field in ("wslExecutable", "distro", "interpreter"):
        value = backend.get(field)
        if not isinstance(value, str) or not value or "\x00" in value:
            raise Rejected("INVALID_REQUEST", "Execution backend field is not a usable string: " + field)
    rules = backend.get("pathMap")
    if not isinstance(rules, list) or not rules:
        raise Rejected("INVALID_REQUEST", "Execution backend requires a non-empty pathMap")
    normalized = []
    for rule in rules:
        if not isinstance(rule, dict):
            raise Rejected("INVALID_REQUEST", "pathMap entries must be objects")
        win, lin = rule.get("windows"), rule.get("linux")
        if (not isinstance(win, str) or not isinstance(lin, str) or not win.endswith("/")
                or not lin.startswith("/") or not lin.endswith("/") or "\x00" in win + lin):
            raise Rejected("INVALID_REQUEST", "pathMap entries need canonical 'windows:/' and '/linux/' prefixes")
        normalized.append({"windows": win, "linux": lin})
    normalized.sort(key=lambda pair: len(pair["windows"]), reverse=True)  # longest host prefix wins
    timeout = backend.get("verifyTimeoutSeconds", 120)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 3600:
        raise Rejected("INVALID_REQUEST", "verifyTimeoutSeconds must be an integer 1..3600")
    binds = backend.get("sharedReadOnlyBinds", [])
    if not isinstance(binds, list):
        raise Rejected("INVALID_REQUEST", "sharedReadOnlyBinds must be a list")
    for item in binds:
        if (not isinstance(item, dict) or not isinstance(item.get("windows"), str)
                or not isinstance(item.get("name"), str) or not BIND_NAME.fullmatch(item["name"])):
            raise Rejected("INVALID_REQUEST", "sharedReadOnlyBinds entries need a host path and a [a-z0-9-] name")
    backend = dict(backend)
    backend["pathMap"] = normalized
    backend["sharedReadOnlyBinds"] = binds
    backend["verifyTimeoutSeconds"] = timeout
    return backend


def linux(path, backend):
    """Translate an absolute host path into the declared distro path space."""
    backend = _validated(backend)
    posix = unlinked(path).as_posix()
    if backend.get("kind") == "host":
        return posix
    for rule in backend["pathMap"]:
        stem = rule["windows"][:-1].casefold()  # drop trailing slash for matching
        lowered = posix.casefold()
        if lowered == stem or lowered.startswith(stem + "/"):
            return rule["linux"] + posix[len(stem):].lstrip("/")
    raise Rejected("UNAUTHORIZED", "Path is outside the execution backend pathMap")


def shared_binds(backend):
    """Translate declared read-only shared roots into jail bind specifications."""
    backend = _validated(backend)
    return [{"source": linux(item["windows"], backend), "target": "shared/" + item["name"]}
            for item in backend["sharedReadOnlyBinds"]]


def _launch_command(backend, controller, config_path):
    """Render the host launch command. Never kill the launcher to infer Linux
    termination: the controller owns the namespace and cancellation is a control file."""
    if backend.get("kind") == "host":
        return [backend["interpreter"], str(controller), str(config_path)]
    return [backend["wslExecutable"], "-d", backend["distro"], "--exec", backend["interpreter"],
            "-B", linux(controller, backend), linux(config_path, backend)]


def check_seal(seal_manifest, seal_digest, environment):
    """Re-verify the seal at the sandbox entry itself, before anything exists on disk.

    D-53: the runner-side chain verifies the sealed environment, but `start_script` was callable
    directly and a platform tool that bypassed the runner got the jail with no integrity check at
    all. The rule is therefore on the entry: a dispatch must name the file that attests its
    environment and the digest it was pinned to. Cheap (one file hash, the tree is never walked),
    and it holds for every caller, not only for the one that remembered to check.
    """
    if not seal_manifest or not seal_digest:
        raise Rejected("INVALID_REQUEST",
                       "Script dispatch requires sealManifest plus sealDigest: a caller that bypasses "
                       "the runner must not receive sealed-environment protection for free")
    manifest = unlinked(seal_manifest)
    if not manifest.is_file():
        raise Rejected("INVALID_REQUEST",
                       "Seal manifest is not a readable file, so the environment root cannot be "
                       "verified before dispatch: " + str(manifest) + " (scriptEnvironment / "
                       "scriptEnvironmentRungs[].executionBackend of the pinned rung)")
    if len(str(seal_digest)) != 64 or file_hash(manifest) != str(seal_digest):
        raise Rejected("INTEGRITY_MISMATCH",
                       "Seal manifest digest differs from the digest handed to the dispatch: "
                       + str(manifest) + " for environment " + str(environment))


def start_script(release, entry, argv, work, environment, attempt_root, timeout=30, gated=False, backend=None,
                 seal_manifest=None, seal_digest=None):
    check_seal(seal_manifest, seal_digest, environment)
    if backend is None:
        raise Rejected("CAPABILITY_UNAVAILABLE", "Script dispatch requires a declared execution backend")
    backend = _validated(backend)
    release = unlinked(release)
    relative_path(release, entry)
    if not entry.endswith(".py") or not isinstance(argv, list) or not all(isinstance(a, str) and "\x00" not in a for a in argv):
        raise Rejected("UNAUTHORIZED", "Only locked Python entries and structured argv are supported")
    attempt_root = unlinked(attempt_root)
    attempt_root.mkdir(parents=True, exist_ok=False)
    work = unlinked(work)
    work.mkdir(parents=True, exist_ok=True)
    config = {"release": linux(release, backend), "entry": entry, "argv": argv, "work": linux(work, backend), "environment": linux(environment, backend), "timeoutSeconds": timeout}
    config.update({key: linux(attempt_root / name, backend) for key, name in {"jail": "jail", "scratch": "scratch", "stdout": "stdout.log", "stderr": "stderr.log", "result": "result.json", "processRecord": "process.json", "cancel": "cancel.flag"}.items()})
    config['authorize'] = linux(attempt_root / 'authorize.flag', backend) if gated else None
    config['sharedReadOnlyBinds'] = shared_binds(backend)
    config_path = attempt_root / "config.json"
    write_bytes(config_path, json.dumps(config).encode("utf-8"), exclusive=True)
    controller = Path(__file__).with_name("sandbox_host.py" if backend.get("kind") == "host"
                                           else "sandbox_linux.py")
    process = subprocess.Popen(_launch_command(backend, controller, config_path), stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
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


def run_script(release, entry, argv, work, environment, attempt_root, timeout=30, started=None, backend=None,
               seal_manifest=None, seal_digest=None):
    process = start_script(release, entry, argv, work, environment, attempt_root, timeout, backend=backend,
                           seal_manifest=seal_manifest, seal_digest=seal_digest)
    if started:
        started(process.pid)
    return wait_script(process, attempt_root)
