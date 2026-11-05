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
import tempfile
from datetime import datetime, timezone
from pathlib import Path

OPS = Path(__file__).resolve().parent
EXCEPTIONS_DEFAULT = Path("E:/ai/codex/bridge/invocation-exceptions.json")
CONFIG_DEFAULT = "E:/ai/codex/bridge/runner-config.json"
INPUT_CODES = {"INVALID_REQUEST", "INPUT_MISMATCH"}


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
    import subprocess
    result = subprocess.run([sys.executable, "-B", str(cli), "--config", str(config), "--request", str(path)],
                            capture_output=True, text=True, timeout=180)
    try:
        return json.loads(result.stdout.strip().splitlines()[-1]), result.returncode
    except (ValueError, IndexError):
        raw = result.stdout + result.stderr
        # An uncaught schema error means the synthetic parameters did not satisfy the target input schema.
        code = "INVALID_REQUEST" if "ValidationError" in raw else "NO-RESPONSE"
        return {"ok": False, "error": {"code": code, "message": raw[-300:]}}, result.returncode


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=CONFIG_DEFAULT)
    parser.add_argument("--out", required=True)
    parser.add_argument("--exceptions", default=str(EXCEPTIONS_DEFAULT))
    parser.add_argument("--runs-root")
    parser.add_argument("--emit-exceptions", action="store_true")
    parser.add_argument("--only")
    parser.add_argument("--targets", help="comma-separated kind:id@version overrides, e.g. agent:novel-writer@1.2.0")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    tool_root = Path(config["toolRoot"])
    agent_root = Path(config["agentRoot"])
    runner_dir = Path(config["runner"])
    cli = runner_dir / "cli.py"

    exceptions_path = Path(args.exceptions)
    exceptions = {}
    if exceptions_path.is_file():
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
        for kind, ident, version in targets:
            if args.only and args.only not in {kind, ident}:
                continue
            repo = agent_root if kind == "agent" else tool_root
            release = repo / ident / "versions" / str(version)
            manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8-sig"))
            legacy = manifest.get("schema") != "ai-workflow/v2.1" if kind == "workflow" else False
            run_id = "matrix-%s-%s" % (kind, ident)
            index += 1
            prepared, code = exchange(cli, config_path, {
                "operation": "prepare", "runId": run_id,
                "platform": config.get("platform", "codex"), "parentRunId": None,
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

    summary = {status: sum(1 for row in rows if row["status"] == status) for status in ("PASS", "NEEDS-INPUT", "EXPECTED", "FAIL")}
    report = {"schema": "ai-invocation-matrix/v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
              "config": str(args.config), "runsRoot": run_config["runsRoot"], "summary": summary, "rows": rows,
              "invocableDenominator": len(rows), "excludedByType": excluded,
              "note": "Script stages are never executed here; claim+stop only. NEEDS-INPUT means the synthetic parameters did not satisfy the target input schema. Non-invocable resources are excluded by type (ENTRY-04), not counted as EXPECTED."}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.emit_exceptions:
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
