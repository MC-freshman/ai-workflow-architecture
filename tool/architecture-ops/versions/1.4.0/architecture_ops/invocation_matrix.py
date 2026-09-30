"""R1-6: invocation matrix gate — is every registered resource actually callable?

Drives the real runner (pinned release) with prepare -> next -> stop for each enabled workflow and agent.
Script stages are never executed (claim + stop only); nothing is written outside the platform runs root.

Usage:
  invocation_matrix.py --out REPORT [--config CFG] [--exceptions FILE] [--emit-exceptions] [--runs-root DIR]

Classification per row:
  PASS        prepare + next + stop all behaved
  NEEDS-INPUT prepare rejected by the target input schema (synthetic parameters are not enough) — not an invocability failure
  FAIL        resolution or protocol failure not documented in the exceptions file
  EXPECTED    FAIL that matches a documented entry in the exceptions file (infrastructure or pending gap)

Exit code: 1 when at least one non-EXPECTED FAIL exists, else 0.
"""
import argparse
import importlib.util
import json
import re
import sys
import hashlib
import tempfile
from datetime import datetime, timezone
from pathlib import Path

OPS = Path(__file__).resolve().parent
INPUT_CODES = {"INVALID_REQUEST", "INPUT_MISMATCH"}
# D-10 / D-17 (2.0.x repair): this harness used to live inside one platform's ops/ directory
# and defaulted to *that* platform's config and exception file, so every other platform silently
# judged the wrong tree. Shared here it carries no platform defaults at all.


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def inline_references(document, base_dir, depth=0, seen=None):
    """Inline relative $ref targets so synthesis sees real constraints (patterns, minLength, required)."""
    seen = seen or set()
    if depth > 5:
        return document
    if isinstance(document, dict):
        reference = document.get("$ref")
        if isinstance(reference, str) and not reference.startswith("#"):
            target_name, _, fragment = reference.partition("#")
            target_path = (base_dir / target_name).resolve()
            key = str(target_path) + "#" + fragment
            if key in seen or not target_path.is_file():
                return {}
            seen.add(key)
            try:
                target = json.loads(target_path.read_text(encoding="utf-8-sig"))
            except (OSError, ValueError):
                return {}
            for part in fragment.lstrip("/").split("/"):
                if part:
                    target = target.get(part, {}) if isinstance(target, dict) else {}
            return inline_references(target, target_path.parent, depth + 1, seen)
        return {key: inline_references(value, base_dir, depth + 1, seen) for key, value in document.items()}
    if isinstance(document, list):
        return [inline_references(item, base_dir, depth + 1, seen) for item in document]
    return document


def merge_branches(schema):
    """Flatten allOf into a single constraint set; sibling keys win over branch keys."""
    if not isinstance(schema, dict) or "allOf" not in schema:
        return schema
    merged = {}
    for branch in schema.get("allOf", []):
        branch = merge_branches(branch) if isinstance(branch, dict) else {}
        for key, value in branch.items():
            if key in {"properties", "required"} and isinstance(value, (dict, list)) and isinstance(merged.get(key), type(value)):
                if isinstance(value, dict):
                    merged[key] = {**value, **merged[key]}
                else:
                    merged[key] = sorted(set(list(value) + list(merged[key])))
            else:
                merged[key] = value
    for key, value in schema.items():
        if key == "allOf":
            continue
        if key in {"properties", "required"} and isinstance(value, (dict, list)) and isinstance(merged.get(key), type(value)):
            if isinstance(value, dict):
                merged[key] = {**merged[key], **value}
            else:
                merged[key] = sorted(set(list(merged[key]) + list(value)))
        else:
            merged[key] = value
    return merged


def synthesize(schema, root_schema=None, depth=0):
    """Minimal schema-shaped value; path-ish strings get an existing directory."""
    root_schema = root_schema or schema
    if depth > 6 or not isinstance(schema, dict):
        return None
    schema = merge_branches(schema)
    if "allOf" in schema:
        schema = {key: value for key, value in schema.items() if key != "allOf"}
    if "$ref" in schema:
        target = root_schema
        for part in schema["$ref"].lstrip("#/").split("/"):
            target = target.get(part, {}) if isinstance(target, dict) else {}
        return synthesize(target, root_schema, depth + 1)
    for key in ("const", "default", "examples"):
        if key in schema:
            return schema[key][0] if key == "examples" and isinstance(schema[key], list) and schema[key] else schema[key]
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]
    for key in ("oneOf", "anyOf"):
        if schema.get(key):
            # Take the first branch but keep sibling constraints (properties/minLength usually live there).
            branch = schema[key][0]
            siblings = {name: value for name, value in schema.items() if name not in {"oneOf", "anyOf", "allOf"}}
            merged = merge_branches({"allOf": [siblings, branch]}) if siblings else branch
            return synthesize(merged, root_schema, depth + 1)
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((item for item in kind if item != "null"), kind[0] if kind else None)
    if kind == "object" or (kind is None and ("properties" in schema or "required" in schema)):
        properties = schema.get("properties", {})
        names = list(schema.get("required", [])) or list(properties)
        value = {}
        for name in names:
            if name not in properties and schema.get("additionalProperties") is False:
                continue
            value[name] = synthesize(properties.get(name, {}), root_schema, depth + 1)
        return value
    if kind == "array":
        count = max(1, int(schema.get("minItems", 0))) if schema.get("minItems") else 0
        return [synthesize(schema.get("items", {}), root_schema, depth + 1) for _ in range(count)]
    if kind == "integer":
        return max(int(schema.get("minimum", 1)), 1)
    if kind == "number":
        # Contract canonicalisation rejects non-integer JSON numbers, so never emit a float literal.
        return max(int(schema.get("minimum", 1)), 1)
    if kind == "boolean":
        return False
    if kind == "string" or kind is None:
        pattern = str(schema.get("pattern", ""))
        if any(token in pattern for token in ("[A-Za-z]:", "\\\\", "/")):
            return str(Path(tempfile.gettempdir()).as_posix())
        value = "matrix-smoke"
        if re.search(r"\\d|\[0-9\]", pattern):
            value += "-1"
        minimum = schema.get("minLength")
        if isinstance(minimum, int) and len(value) < minimum:
            value = (value + "-" + "x" * minimum)[:max(minimum, len(value))]
        maximum = schema.get("maxLength")
        if isinstance(maximum, int) and len(value) > maximum:
            value = value[:maximum]
        return value
    return None


def parameters_for(tool_root, release_root, manifest):
    schema_path = release_root / manifest["inputSchema"]
    if not schema_path.is_file():
        return {}
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    schema = inline_references(schema, schema_path.parent)
    value = synthesize(schema)
    return value if isinstance(value, dict) else {}


def agent_parameters(tool_root, release, manifest, ident):
    """Synthesize against the workflow the engine will actually run (runnerWorkflow, else same-named lock entry)."""
    try:
        locked = json.loads((release / manifest.get("toolLock", "tool-lock.json")).read_text(encoding="utf-8-sig")).get("workflows") or {}
    except (OSError, ValueError):
        return {}
    main = manifest.get("runnerWorkflow") or (ident if ident in locked else None)
    if not main or main not in locked:
        return {}
    workflow_release = tool_root / main / "versions" / str(locked[main])
    try:
        workflow_manifest = json.loads((workflow_release / "manifest.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return parameters_for(tool_root, workflow_release, workflow_manifest)


def exchange(cli, config, payload, scratch, index):
    request = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request", "requestId": "matrix-" + str(index),
               "operation": payload.pop("operation"), "runId": payload.pop("runId")}
    if request["operation"] != "status":
        request["idempotencyKey"] = "matrix-key-" + str(index)
    if "expectedStateRevision" in payload:
        request["expectedStateRevision"] = payload.pop("expectedStateRevision")
    request["payload"] = payload
    path = scratch / ("request-%d.json" % index)
    path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
    import os
    import subprocess
    # Platform-local workaround for shared-side D-15/D-16: wf-runner's cli.py prints
    # ensure_ascii=False JSON, so under this host's ANSI code page (cp936) any response whose
    # prompt text carries astral characters dies in print() -> UnicodeEncodeError is a ValueError
    # -> the engine answers INVALID_REQUEST/phase=request *after* the run already committed.
    # The protocol is JSON/UTF-8, so this launcher pins the child's stdio to UTF-8 and decodes it
    # as UTF-8 here. As of wf-runner 0.7.9 the engine itself always answers in UTF-8 (D-15 closed);
    # the pin stays as defence in depth for platforms still pinned to an older generation.
    child_env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    result = subprocess.run([sys.executable, "-B", str(cli), "--config", str(config), "--request", str(path)],
                            capture_output=True, text=True, timeout=180,
                            encoding="utf-8", errors="replace", env=child_env)
    try:
        return json.loads(result.stdout.strip().splitlines()[-1]), result.returncode
    except (ValueError, IndexError):
        raw = result.stdout + result.stderr
        # An uncaught schema error means the synthetic parameters did not satisfy the target input schema.
        code = "INVALID_REQUEST" if "ValidationError" in raw else "NO-RESPONSE"
        return {"ok": False, "error": {"code": code, "message": raw[-300:],
                                        # D-17: surface the engine's own diagnostic instead of only its tail.
                                        "diagnosticRef": _diagnostic_ref(raw)}}, result.returncode


def _diagnostic_ref(raw):
    import re
    found = re.search(r"runtime/logs/wf-runner/[0-9a-f]{32}\.log", raw or "")
    return found.group(0) if found else None



def digest_of_self():
    """Digest of this file as recorded by the release's own SHA256SUMS, so a platform can pin it."""
    here = Path(__file__).resolve()
    sums = here.parents[1] / "SHA256SUMS"
    name = here.relative_to(here.parents[1]).as_posix()
    if sums.is_file():
        for line in sums.read_bytes().decode("utf-8").splitlines():
            if line.strip().endswith(name):
                return line.split()[0]
    return hashlib.sha256(here.read_bytes()).hexdigest()


def classify(error_code, keys, exceptions):
    """An exception only matches when the observed error code is the documented one."""
    for key in keys:
        entry = exceptions.get(key)
        if entry is None:
            continue
        documented = entry.get("expectedCode")
        if documented and documented != error_code:
            return "FAIL"
        return "EXPECTED"
    if error_code in INPUT_CODES:
        return "NEEDS-INPUT"
    return "FAIL"



SOFTWARE_GAP_CODES = ("SOFTWARE_NOT_INSTALLED", "CAPABILITY_UNAVAILABLE", "SOFTWARE_DRIFT",
                      "PROFILE_NOT_DECLARED", "EGRESS_DENIED", "CONSENT_REQUIRED")


def gateway_interpreter(config_path, gateway):
    """D-59: resolve the interpreter that runs the platform's gateway document.

    The runner config's own map wins when it declares this suffix; otherwise the software gateway
    config is asked (a platform that only carries that file still has to be able to answer a
    software row, and used to be told CONFIG_MISSING); otherwise the interpreter this harness is
    already running under. The second value names which level answered, and the row carries it -- a
    fallback must never be readable as an explicit declaration.
    """
    suffix = Path(gateway).suffix.lower() or ".py"
    interpreter = (config_path.get("interpreters") or {}).get(suffix)
    if interpreter:
        return interpreter, "config.interpreters"
    gateway_config = config_path.get("softwareGatewayConfig")
    document = {}
    if gateway_config:
        try:
            document = json.loads(Path(gateway_config).read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            document = {}
    found = (document.get("interpreters") or {}).get(suffix) or document.get("python")
    if found:
        return found, "softwareGatewayConfig"
    return sys.executable, "sys.executable"


def gateway_message(config_path, gateway, message, timeout=120):
    """Ask the platform's own software gateway exactly the way the engine does: one JSON object in,
    one JSON object out, interpreter taken from the platform config because a .py is not executable."""
    import subprocess
    path = Path(gateway)
    interpreter, _interpreter_from = gateway_interpreter(config_path, gateway)
    try:
        proc = subprocess.run([interpreter, "-B", str(path), "--config", str(config_path["softwareGatewayConfig"])],
                              input=json.dumps(message, ensure_ascii=False).encode("utf-8"),
                              capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, "HARNESS_ERROR", type(exc).__name__ + ": " + str(exc)[:200]
    lines = [line for line in proc.stdout.decode("utf-8", "replace").splitlines() if line.startswith("{")]
    if not lines:
        return None, "HARNESS_ERROR", "gateway answered without a protocol document: " \
            + (proc.stdout + proc.stderr).decode("utf-8", "replace")[-200:]
    return json.loads(lines[-1]), None, None


def software_cells(config, software_root, exceptions, stamp):
    """One cell per enabled recipe: the pinned release the gateway serves, whether its capability
    snapshot is frozen (C-4: unfrozen is a gap, never a drift), and whether this platform has a
    verified body registered. PASS requires all three; anything the platform can name a reason for is
    EXPECTED through the same exception machinery as the other kinds; a harness fault is a FAIL."""
    registry_path = Path(software_root) / "registry.json"
    if not registry_path.is_file():
        return [], [{"kind": "software", "id": "*", "reason": "software registry is missing",
                     "inDenominator": False}]
    registry = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    environment = {}
    env_path = config.get("softwareEnvironment")
    if env_path and Path(env_path).is_file():
        environment = (json.loads(Path(env_path).read_text(encoding="utf-8-sig")).get("bodies") or {})
    rows = []
    for entry in registry.get("software", []):
        if not entry.get("enabled"):
            continue
        ident = entry["id"]
        version = json.loads((Path(software_root) / entry["current"]).read_text(
            encoding="utf-8-sig")).get("version")
        answer, harness_code, harness_error = gateway_message(
            config, config["softwareGateway"],
            {"schema": "ai-software-inventory/v1", "softwareId": ident, "softwareVersion": version})
        row = {"kind": "software", "id": ident, "version": str(version),
               "runId": "matrix-software-%s-%s" % (ident, stamp)}
        if harness_code:
            row.update(status="FAIL", prepare=False, errorCode=harness_code, errorMessage=harness_error)
            rows.append(row)
            continue
        reason = None
        if not answer.get("ok"):
            error = answer.get("error") or {}
            row["errorCode"] = error.get("code")
            row["errorMessage"] = str(error.get("message"))[:200]
            reason = error.get("code") if error.get("code") in SOFTWARE_GAP_CODES else "UNCLASSIFIED"
            if reason == "UNCLASSIFIED":
                reason = None                       # an unnamed gateway error is a FAIL, not a gap
        elif not answer.get("frozen"):
            reason = "SNAPSHOT_NOT_FROZEN"          # C-4: no baseline exists, so nothing was verified
        elif not answer.get("capabilities"):
            reason = "CAPABILITY_LIST_EMPTY"
        elif ident not in environment:
            reason = "BODY_NOT_VERIFIED"            # the recipe resolves, this platform has no body
        row["prepare"] = bool(answer.get("ok"))
        row["claimed"] = bool(answer.get("frozen"))
        row["taskAction"] = "gateway-inventory"
        row["interpreterFrom"] = gateway_interpreter(config, str(config.get("softwareGateway") or ""))[1]
        row["snapshotFrozen"] = bool(answer.get("frozen"))
        row["capabilities"] = len(answer.get("capabilities") or [])
        row["bodyVerified"] = ident in environment
        if reason:
            row["gapReason"] = reason
            keys = ["software:%s@%s" % (ident, version), "software:%s@*" % ident]
            row["status"] = classify(reason, keys, exceptions)
        else:
            row["status"] = "PASS"
        rows.append(row)
    return rows, []


def main():
    # Provenance pin: a platform records which generation of the judge measured it. Handled
    # before argparse because --config/--out stay mandatory for a real run (no defaults).
    if "--print-digest" in sys.argv[1:]:
        print(json.dumps({"harness": "architecture-ops/invocation_matrix",
                          "packageRoot": str(Path(__file__).resolve().parents[1]),
                          "digest": digest_of_self()}, ensure_ascii=False))
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="the invoking platform's runner config; there is no default")
    parser.add_argument("--out", required=True, help="report path; parent directories are created")
    parser.add_argument("--exceptions", help="platform exception ledger; omit it to register nothing as EXPECTED")
    parser.add_argument("--print-digest", action="store_true",
                       help="print this harness's sealed digest and exit (platform provenance pin)")
    parser.add_argument("--runs-root")
    parser.add_argument("--emit-exceptions", action="store_true")
    parser.add_argument("--only")
    parser.add_argument("--targets", help="comma-separated kind:id@version overrides, e.g. agent:novel-writer@1.2.0")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    platform_id = config.get("platform")
    if not platform_id:
        raise SystemExit("config.platform is required: the matrix reports against the platform that runs it")
    tool_root = Path(config["toolRoot"])
    agent_root = Path(config["agentRoot"])
    runner_dir = Path(config["runner"])
    cli = runner_dir / "cli.py"

    exceptions_path = Path(args.exceptions) if args.exceptions else None
    exceptions = {}
    if exceptions_path is not None and exceptions_path.is_file():
        document = json.loads(exceptions_path.read_text(encoding="utf-8-sig"))
        for section in ("infrastructure", "pendingGaps"):
            for entry in document.get(section, []):
                exceptions["%s:%s@%s" % (entry.get("kind", "workflow"), entry["id"], entry.get("version", "*"))] = entry

    with tempfile.TemporaryDirectory(prefix="invocation-matrix-") as scratch_name:
        scratch = Path(scratch_name)
        # engine.py requires runsRoot to live inside platformRoot; keep smoke runs inside the platform tree.
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        base = Path(args.runs_root) if args.runs_root else Path(config["platformRoot"]) / "runtime" / "matrix-smoke" / stamp
        run_config = dict(config)
        run_config["runsRoot"] = str(base) if base.name == "runs" else str(base / "runs")
        Path(run_config["runsRoot"]).mkdir(parents=True, exist_ok=True)
        config_path = base / "config.json"
        config_path.write_text(json.dumps(run_config, ensure_ascii=False, indent=2), encoding="utf-8")

        targets = []
        overrides = {}
        for item in (args.targets or "").split(","):
            item = item.strip()
            if item and "@" in item and ":" in item:
                key, version = item.rsplit("@", 1)
                overrides[key.strip()] = version.strip()
        tool_registry = json.loads((tool_root / "registry.json").read_text(encoding="utf-8-sig"))
        excluded = []
        for entry in tool_registry.get("workflows", []):
            if not entry.get("enabled"):
                continue
            # C6 / ENTRY-04: non-invocable resources (engine/contracts/pack/...) leave the
            # /wf denominator by TYPE with a machine-readable reason — never an EXPECTED "failure".
            if entry.get("invocable", True) is False:
                excluded.append({"kind": entry.get("kind", "workflow"), "id": entry["id"],
                                 "reason": "resource-kind not invocable via /wf", "inDenominator": False})
                continue
            version = json.loads((tool_root / entry["current"]).read_text(encoding="utf-8-sig")).get("version")
            targets.append(("workflow", entry["id"], overrides.get("workflow:" + entry["id"], version)))
        agent_registry = json.loads((agent_root / "registry.json").read_text(encoding="utf-8-sig"))
        for entry in agent_registry.get("agents", []):
            if entry.get("enabled"):
                version = json.loads((agent_root / entry["current"]).read_text(encoding="utf-8-sig")).get("version")
                targets.append(("agent", entry["id"], overrides.get("agent:" + entry["id"], version)))

        rows = []
        index = 0
        # D-32: a narrowed matrix answered "FAIL 0" for an id that matched nothing, which is
        # indistinguishable from a pass in a log. Every --only token must therefore actually judge
        # a row; the ones that judge nothing come back as FAIL rows naming themselves.
        wanted = [token.strip() for token in (args.only or '').split(',') if token.strip()]
        wanted_set = set(wanted)
        matched = set()
        for kind, ident, version in targets:
            keys = {kind, ident, "%s:%s" % (kind, ident), "%s:*" % kind}
            if wanted_set and not (wanted_set & keys):
                continue
            matched |= wanted_set & keys
            repo = agent_root if kind == "agent" else tool_root
            release = repo / ident / "versions" / str(version)
            manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8-sig"))
            legacy = manifest.get("schema") != "ai-workflow/v2.1" if kind == "workflow" else False
            # D-17: run names used to be deterministic and never cleaned, so a second invocation
            # died on "UNAUTHORIZED: Run directory already exists" and read as a capability FAIL.
            # The per-invocation stamp makes every run of the matrix its own smoke run.
            run_id = "matrix-%s-%s-%s" % (kind, ident, stamp)
            index += 1
            prepared, code = exchange(cli, config_path, {
                "operation": "prepare", "runId": run_id,
                "platform": platform_id, "parentRunId": None,
                "target": {"mode": kind, "id": ident, "version": str(version)},
                "parameters": parameters_for(tool_root, release, manifest) if kind == "workflow"
                else agent_parameters(tool_root, release, manifest, ident),
                "inputSources": []}, scratch, index)
            row = {"kind": kind, "id": ident, "version": version, "prepare": prepared.get("ok", False),
                   "errorCode": (prepared.get("error") or {}).get("code"), "claimed": None, "stopped": None}
            if prepared.get("ok"):
                state = prepared["result"]["state"]
                index += 1
                claimed, _ = exchange(cli, config_path, {
                    "operation": "next", "runId": run_id, "expectedStateRevision": state["stateRevision"]}, scratch, index)
                task = (claimed.get("result") or {}).get("task")
                row["claimed"] = bool(task)
                row["taskAction"] = (task or {}).get("action")
                index += 1
                revision = (claimed.get("result") or {}).get("state", {}).get("stateRevision", state["stateRevision"])
                stopped, _ = exchange(cli, config_path, {
                    "operation": "stop", "runId": run_id, "expectedStateRevision": revision,
                    "reason": "invocation matrix smoke"}, scratch, index)
                row["stopped"] = (stopped.get("result") or {}).get("state", {}).get("status") == "stopped"
                row["status"] = "PASS" if (row["claimed"] and row["stopped"]) else "FAIL"
            else:
                keys = ["%s:%s@%s" % (kind, ident, version), "%s:%s@*" % (kind, ident)]
                row["status"] = classify(row["errorCode"], keys, exceptions)
                row["errorMessage"] = (prepared.get("error") or {}).get("message")
                row["legacyDefinition"] = legacy
            rows.append(row)

        software_rows, software_exclusions = ([], [])
        if config.get("softwareRoot") and config.get("softwareGateway") \
                and config.get("softwareGatewayConfig"):
            software_rows, software_exclusions = software_cells(
                run_config, config["softwareRoot"], exceptions, stamp)
        elif config.get("softwareRoot") or config.get("softwareGateway"):
            software_exclusions = [{"kind": "software", "id": "*", "inDenominator": False,
                                    "reason": "software wiring is partial: softwareRoot, softwareGateway "
                                              "and softwareGatewayConfig all have to be declared"}]
        else:
            software_exclusions = [{"kind": "software", "id": "*", "inDenominator": False,
                                    "reason": "platform declares no software wiring (3.0 face not adopted)"}]
        for row in software_rows:
            keys = {"software", row["id"], "software:%s" % row["id"], "software:*"}
            if wanted_set and not (wanted_set & keys):
                continue
            matched |= wanted_set & keys
            rows.append(row)

    for token in sorted(wanted_set - matched):
        rows.append({"id": "selection:" + token, "status": "FAIL", "errorCode": "HARNESS_EMPTY_SELECTION",
                     "errorMessage": "--only selected no row: nothing was judged for this id, so the "
                                     "cell cannot be reported as passing"})
    summary = {status: sum(1 for row in rows if row["status"] == status) for status in ("PASS", "NEEDS-INPUT", "EXPECTED", "FAIL")}
    report = {"schema": "ai-invocation-matrix/v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
              "config": str(args.config), "runsRoot": run_config["runsRoot"], "summary": summary, "rows": rows,
              "invocableDenominator": len(rows), "excludedByType": excluded + software_exclusions,
              "note": "Software rows are answered by the platform gateway plus its own body registry (3.0 S-P9): a recipe resolves, its snapshot is frozen and a verified body is present. Script stages are never executed here; claim+stop only. NEEDS-INPUT means the synthetic parameters did not satisfy the target input schema. Non-invocable resources are excluded by type (ENTRY-04), not counted as EXPECTED."}
    # D-18: --out used to be written only after the whole matrix had run, so a missing parent
    # directory threw away 20+ minutes of engine calls. Create it up front.
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.emit_exceptions and exceptions_path is not None:
        infrastructure = [{"id": "wf-runner", "kind": "workflow", "version": "0.5.2",
                           "reason": "引擎自身（自指定义 action:script → cli.py），不作为用户可调用工作流", "review": "2026-09-14"}]
        pending = []
        for row in rows:
            if row["status"] == "FAIL":
                reason = ("legacy 定义（%s），待 Z10 §6.2 迁移" % row.get("errorCode")) if row.get("legacyDefinition") \
                    else ("agent 无主工作流（%s），待 Z10 §6.1 补齐" % row.get("errorCode"))
                pending.append({"id": row["id"], "kind": row["kind"], "version": row["version"], "reason": reason,
                                "evidence": "invocation-matrix report", "review": "2026-09-14"})
        document = {"schema": "ai-invocation-exceptions/v1", "updatedAt": "2026-09-14",
                    "note": "EXPECTED 行需在此登记；基础设施条目与待补齐条目分列。新增 FAIL 不在登记内即阻断发布。",
                    "infrastructure": infrastructure, "pendingGaps": pending}
        exceptions_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"exceptionsWritten": str(exceptions_path), "pendingGaps": len(pending)}, ensure_ascii=False))

    print(json.dumps({"summary": summary, "out": args.out,
                      "failures": [row["id"] for row in rows if row["status"] == "FAIL"]}, ensure_ascii=False))
    return 1 if summary["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
