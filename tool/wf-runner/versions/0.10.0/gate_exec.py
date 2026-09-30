"""Generic evidence-bound gate executors (M3-B). Runner-owned code; never imported from submissions.

Target refs use explicit schemes: evidence:<rel under the current attempt evidence dir>,
work:<rel under work/project>, run:<rel under the run root>. Every target is resolved
through runtime_core.relative_path, so traversal, links, drives and devices are rejected.
"""
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from jsonschema import Draft202012Validator

from runtime_core import Rejected, file_hash, relative_path, write_bytes

EXECUTOR_VERSION = "wf-gate-exec/0.2.0"
GENERIC_TYPES = ("file", "json-schema", "hash", "pattern-scan", "process")


def declaration_validator():
    schema = json.loads((Path(__file__).resolve().parent / "schemas/gate.schema.json").read_text(encoding="utf-8-sig"))
    return Draft202012Validator({"$ref": "#/$defs/declaration", "$defs": schema["$defs"]})


def evidence_validator():
    schema = json.loads((Path(__file__).resolve().parent / "schemas/gate.schema.json").read_text(encoding="utf-8-sig"))
    return Draft202012Validator({"$ref": "#/$defs/evidence", "$defs": schema["$defs"]})


def _bases(store_root, attempt_prefix):
    return {
        "evidence": relative_path(store_root, attempt_prefix.rstrip("/")),
        "work": relative_path(store_root, "work/project"),
        "run": store_root,
    }


def _resolve_target(store_root, attempt_prefix, ref):
    scheme, _, rel = ref.partition(":")
    if scheme not in ("evidence", "work", "run") or not rel:
        raise Rejected("INVALID_REQUEST", "Gate target must use an evidence/work/run scheme")
    base = _bases(store_root, attempt_prefix)[scheme]
    return base, relative_path(base, rel)


class _Collector:
    def __init__(self, store_root, attempt_prefix):
        self.records = []
        self._store_root = store_root
        self._attempt_prefix = attempt_prefix

    def add(self, ref):
        base, path = _resolve_target(self._store_root, self._attempt_prefix, ref)
        if not path.is_file():
            return None
        self.records.append({"ref": ref, "sha256": file_hash(path), "size": path.stat().st_size})
        return path


def _fail(reason):
    return {"status": "fail", "reason": reason}


def evaluate(contracts, store_root, workflow_root, declaration, attempt_prefix, gate_id, schema_validator):
    gate_type = declaration["type"]
    collector = _Collector(store_root, attempt_prefix)
    result = {"executorVersion": EXECUTOR_VERSION, "type": gate_type, "targets": [], "hits": []}

    def finish(status=None, reason=None, extra=None):
        result["targets"] = collector.records
        if status is None:
            status = "pass" if not result.get("_failed") else "fail"
        if status == "fail":
            result["status"] = "fail"
            result["reason"] = reason or "gate failed"
        else:
            result["status"] = "pass"
        if extra:
            result.update(extra)
        result.pop("_failed", None)
        return result

    if gate_type == "file":
        path = collector.add(declaration["target"])
        if path is None:
            result["_failed"] = True
            return finish("fail", "MISSING_FILE: " + declaration["target"])
        if declaration.get("minBytes") and path.stat().st_size < declaration["minBytes"]:
            result["_failed"] = True
            return finish("fail", "TOO_SMALL: " + declaration["target"])
        expected = declaration.get("sha256")
        if expected and file_hash(path) != expected:
            result["_failed"] = True
            return finish("fail", "HASH_MISMATCH: " + declaration["target"])
        return finish()

    if gate_type == "hash":
        for entry in declaration["entries"]:
            path = collector.add(entry["target"])
            if path is None:
                result["_failed"] = True
                return finish("fail", "MISSING_FILE: " + entry["target"])
            if file_hash(path) != entry["sha256"]:
                result["_failed"] = True
                return finish("fail", "HASH_MISMATCH: " + entry["target"])
        return finish()

    if gate_type == "json-schema":
        path = collector.add(declaration["target"])
        if path is None:
            result["_failed"] = True
            return finish("fail", "MISSING_FILE: " + declaration["target"])
        try:
            value = contracts.lint.read_json(path)
        except Exception as exc:
            result["_failed"] = True
            return finish("fail", "UNPARSEABLE_TARGET: " + str(exc))
        failure = None
        try:
            schema_validator(contracts, workflow_root, declaration["schema"], value)
        except Rejected:
            raise
        except Exception as exc:
            failure = "SCHEMA_VALIDATION_FAILED: " + type(exc).__name__
        for cross in declaration.get("crossHash", []):
            against_path = collector.add(cross["against"])
            if against_path is None:
                failure = failure or ("MISSING_FILE: " + cross["against"])
                continue
            node = value
            try:
                for key in cross["field"]:
                    node = node[key]
            except (KeyError, TypeError):
                failure = failure or ("CROSS_FIELD_MISSING: " + "/".join(cross["field"]))
                continue
            if node != file_hash(against_path):
                failure = failure or ("STALE_CROSS_REFERENCE: " + "/".join(cross["field"]))
        if failure:
            return finish("fail", failure)
        return finish()

    if gate_type == "pattern-scan":
        compiled = []
        for rule in declaration["rules"]:
            try:
                compiled.append((rule["id"], re.compile(rule["pattern"])))
            except re.error as exc:
                raise Rejected("INVALID_REQUEST", "Invalid scan rule " + rule["id"] + ": " + str(exc))
        for ref in declaration["targets"]:
            path = collector.add(ref)
            if path is None:
                result["_failed"] = True
                return finish("fail", "MISSING_FILE: " + ref)
            text = path.read_text(encoding="utf-8", errors="replace")
            for number, line in enumerate(text.splitlines(), start=1):
                for rule_id, pattern in compiled:
                    hit = pattern.search(line)
                    if hit:
                        masked = line[max(0, hit.start() - 20):hit.start()] + "<<<match>>>" + line[hit.end():hit.end() + 20]
                        result["hits"].append({"rule": rule_id, "target": ref, "line": number, "context": masked})
        if result["hits"]:
            result["_failed"] = True
            return finish("fail", "PATTERN_HIT: " + result["hits"][0]["rule"])
        return finish()

    if gate_type == "process":
        if declaration.get("interpreter", "runner-python") != "runner-python":
            raise Rejected("CAPABILITY_UNAVAILABLE", "Process gate supports only the runner interpreter")
        cwd_scheme = declaration.get("cwd", "work")
        if cwd_scheme not in ("work", "evidence"):
            raise Rejected("INVALID_REQUEST", "Process gate cwd must be work or evidence")
        cwd = _bases(store_root, attempt_prefix)[cwd_scheme]
        argv = [sys.executable] + [str(workflow_root / item.split(":", 1)[1]) if item.startswith("workflow:") else item for item in declaration["argv"]]
        timeout = declaration.get("timeoutSeconds", 30)
        started = time.monotonic()
        try:
            completed = subprocess.run(argv, cwd=str(cwd), timeout=timeout, capture_output=True)
        except subprocess.TimeoutExpired:
            result["_failed"] = True
            return finish("fail", "TIMEOUT: process gate exceeded " + str(timeout) + "s")
        duration_ms = int((time.monotonic() - started) * 1000)
        log_dir = relative_path(store_root, attempt_prefix + "_gateexec/" + gate_id)
        write_bytes(log_dir / "stdout.log", completed.stdout)
        write_bytes(log_dir / "stderr.log", completed.stderr)
        stdout_ref = "evidence:" + attempt_prefix + "_gateexec/" + gate_id + "/stdout.log"
        stderr_ref = "evidence:" + attempt_prefix + "_gateexec/" + gate_id + "/stderr.log"
        exit_code = completed.returncode
        accepted_exit = exit_code in declaration.get("expectExit", [0])
        missing = None
        for artifact in declaration["expectArtifacts"]:
            path = collector.add(artifact["target"])
            if path is None:
                missing = "MISSING_ARTIFACT: " + artifact["target"]
                break
            if artifact.get("minBytes") and path.stat().st_size < artifact["minBytes"]:
                missing = "TOO_SMALL: " + artifact["target"]
                break
        if not accepted_exit or missing:
            reason = missing or "EXIT_CODE: " + str(exit_code) + " not in " + str(declaration.get("expectExit", [0]))
            if reason.startswith("EXIT_CODE") and declaration.get("reasonFrom"):
                reason_path = _resolve_target(store_root, attempt_prefix, declaration["reasonFrom"])[1]
                if reason_path.is_file():
                    try:
                        verdict = json.loads(reason_path.read_text(encoding="utf-8-sig"))
                        if isinstance(verdict.get("reason"), str) and verdict["reason"]:
                            reason = verdict["reason"]
                    except (OSError, ValueError):
                        pass
            result["_failed"] = True
            return finish("fail", reason, {"process": {"exitCode": exit_code, "durationMs": duration_ms, "stdoutLog": stdout_ref, "stderrLog": stderr_ref}})
        return finish("pass", None, {"process": {"exitCode": exit_code, "durationMs": duration_ms, "stdoutLog": stdout_ref, "stderrLog": stderr_ref}})

    raise Rejected("CAPABILITY_UNAVAILABLE", "Unknown gate executor: " + str(gate_type))
