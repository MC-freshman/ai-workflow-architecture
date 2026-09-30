"""The host rung controller (2.1.0 §3.2 last rung): same observable contract as the jail
controller, no jail. Only reachable when the run's own lock carries consent.

It writes result.json with exitCode / reason / processTreeEnded, honours authorize.flag (so a
script never starts before the state is committed) and cancel.flag, and exits 0 whenever the
process tree was accounted for - the script's own failure is data, not an uncertain outcome.
"""
import json
import pathlib
import subprocess
import sys
import time


def main():
    config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    root = pathlib.Path(config["result"]).parent
    started = time.time()
    record = {"exitCode": None, "reason": "not-started", "processTreeEnded": True,
              "isolation": "host-controlled", "startedAt": started}

    def write():
        record["wallMs"] = int((time.time() - started) * 1000)
        (root / "result.json").write_text(json.dumps(record), encoding="utf-8")

    cancel, authorize = pathlib.Path(config["cancel"]), config.get("authorize")
    if authorize:
        deadline = time.time() + 60
        while not pathlib.Path(authorize).is_file():
            if cancel.is_file() or time.time() > deadline:
                record["reason"] = "cancelled" if cancel.is_file() else "authorize-timeout"
                record["exitCode"] = None
                write()
                return 0
            time.sleep(0.05)
    with open(config["stdout"], "wb") as out, open(config["stderr"], "wb") as err:
        # The launcher already starts this controller with the host rung's interpreter
        # (sandbox._launch_command), so sys.executable is that interpreter for the child too.
        process = subprocess.Popen([sys.executable,
                                    str(pathlib.Path(config["release"]) / config["entry"])] + list(config["argv"]),
                                   cwd=config["work"], stdout=out, stderr=err)
        (root / "process.json").write_text(json.dumps({"pid": process.pid}), encoding="utf-8")
        deadline = time.time() + int(config["timeoutSeconds"])
        while process.poll() is None:
            if cancel.is_file():
                process.terminate()
            if time.time() > deadline:
                process.kill()
                record["reason"] = "timeout"
                break
            time.sleep(0.05)
        process.wait()
    record["exitCode"] = process.returncode
    record["processTreeEnded"] = process.poll() is not None
    if record["reason"] == "not-started":
        record["reason"] = "timeout" if record["reason"] == "timeout" else "exited"
    write()
    return 0 if record["processTreeEnded"] else 1


raise SystemExit(main())
