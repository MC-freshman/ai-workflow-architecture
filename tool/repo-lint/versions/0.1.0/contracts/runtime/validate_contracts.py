"""Static contract checks only. No execution, runtime persistence or recovery."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path, PureWindowsPath

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parent
SAFE_INTEGER = 9007199254740991


def canonical_bytes(value):
    def check(item):
        if item is None or isinstance(item, bool):
            return
        if isinstance(item, int):
            if abs(item) > SAFE_INTEGER:
                raise ValueError("integer outside portable range")
        elif isinstance(item, str):
            item.encode("utf-8", errors="strict")
        elif isinstance(item, list):
            for child in item:
                check(child)
        elif isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise ValueError("object key is not a string")
                check(key)
                check(child)
        else:
            raise ValueError("floats and non-JSON values are forbidden")

    check(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def strict_loads(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON property: " + key)
            result[key] = value
        return result

    def forbidden(value):
        raise ValueError("non-integer JSON number: " + value)

    return json.loads(text, object_pairs_hook=pairs, parse_float=forbidden, parse_constant=forbidden)


def strict_load(path):
    return strict_loads(path.read_text(encoding="utf-8"))


def history_classification(record):
    version = record.get("schemaVersion", record.get("schema", record.get("Schema")))
    if version == "ai-maintenance-run-lock/v1" or record.get("recordType") == "maintenance" or record.get("purpose") == "maintenance":
        return "maintenance-not-executable"
    if version == "ai-run-lock/v1":
        return "historical-v1-read-only-information-insufficient"
    if version == "ai-run-lock/v1.1":
        return "new-contract-requires-validation"
    return "unsupported-read-only"


def validators():
    schemas = [strict_load(path) for path in sorted(ROOT.glob("*.schema.json"))]
    for schema in schemas:
        Draft202012Validator.check_schema(schema)
    registry = Registry().with_resources((schema["$id"], Resource.from_contents(schema)) for schema in schemas)
    checker = FormatChecker()

    @checker.checks("date-time", raises=ValueError)
    def timestamp(value):
        if not isinstance(value, str):
            return True
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", value):
            return False
        datetime.fromisoformat(value.replace("Z", "+00:00").replace("z", "+00:00"))
        return True

    return {schema["$id"].rsplit("/", 1)[1]: Draft202012Validator(schema, registry=registry, format_checker=checker) for schema in schemas}


def file_record(path, content):
    raw = content.encode("utf-8")
    return {"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}


def example_bundle(stopped=False):
    seed = strict_load(ROOT / "examples" / "valid-scenario.json")
    source = {"kind": "explicit", "path": "E:/ai/codex/fixtures/request.json", "sha256": "a" * 64}

    def resource(key, kind, version):
        return {"key": key, "kind": kind, "id": key, "version": version,
                "path": "E:/ai/codex/fixtures/packages/" + key + "/" + version,
                "manifestSha256": "b" * 64, "contentManifestSha256": "c" * 64,
                "resolvedFrom": dict(source), "dependencies": []}

    initial_file = file_record(seed["input"]["path"], seed["input"]["content"])
    inputs = {"parameters": seed["parameters"], "parametersSha256": digest(seed["parameters"]),
              "files": [initial_file], "manifestSha256": digest([initial_file])}
    inputs["snapshotSha256"] = digest({key: inputs[key] for key in ("parametersSha256", "manifestSha256")})
    lock = {"schemaVersion": "ai-run-lock/v1.1", "recordType": "execution", "runId": seed["runId"],
            "parentRunId": None, "platform": "codex", "createdAt": seed["createdAt"],
            "runRoot": "E:/ai/codex/runtime/runs/" + seed["runId"], "canonicalization": "sha256-cjson-safe-v1",
            "selection": {"agent": None, "workflow": "example-workflow", "runner": "wf-runner", "environment": ["python"]},
            "resources": [resource("example-workflow", "workflow", "1.0.0"), resource("wf-runner", "runner", "0.1.0"), resource("python", "interpreter", "3.13.7")],
            "input": inputs, "execution": {"maxParallel": 1, "resume": False,
            "stages": [{"id": "draft", "action": "prompt", "dependsOn": [], "requiredGates": ["output-check"]}]}}
    locked_hash = digest(lock)
    attempt_hash = digest({"initialInputSha256": inputs["snapshotSha256"], "artifacts": []})
    attempt = {"stageId": "draft", "attempt": 1, "action": "prompt", "inputSha256": attempt_hash, "artifacts": []}
    output = file_record(seed["output"]["path"], seed["output"]["content"])
    evidence = file_record(seed["gateEvidence"]["path"], seed["gateEvidence"]["content"])
    completion = {"stageId": "draft", "attempt": 1, "inputSha256": attempt_hash, "artifacts": [], "outputs": [output],
                  "gates": [{"gateId": "output-check", "status": "pass", "inputSha256": attempt_hash,
                             "outputManifestSha256": digest([output]), "evidence": evidence}]}
    events, states = [], []

    def append(event_type, status, active=None, completed=None, stop=False, transaction_id=None):
        index = len(events)
        event = {"schemaVersion": "ai-run-event/v1.1", "runId": seed["runId"], "lockSha256": locked_hash,
                 "sequence": index + 1, "transactionId": transaction_id or "tx-" + str(index), "previousRevision": index - 1 if index else None,
                 "newRevision": index, "previousEventSha256": events[-1]["eventSha256"] if index else None,
                 "type": event_type, "status": status, "at": seed["createdAt"], "evidence": []}
        event["eventSha256"] = digest(event)
        events.append(event)
        states.append({"schemaVersion": "ai-run-state/v1.1", "runId": seed["runId"], "lockSha256": locked_hash,
                       "stateRevision": index, "lastEventSequence": index + 1, "lastEventSha256": event["eventSha256"],
                       "status": status, "outcome": "known", "stopRequested": stop, "activeAttempt": copy.deepcopy(active),
                       "completed": copy.deepcopy(completed or []), "managedProcesses": [],
                       "finalOutput": [output] if status == "succeeded" else [], "error": None, "updatedAt": seed["createdAt"]})

    append("prepared", "prepared")
    if stopped:
        append("stop-requested", "prepared", stop=True)
        append("stopped", "stopped", stop=True, transaction_id="tx-1")
    else:
        append("stage-claimed", "running", attempt)
        append("prompt-delivered", "waiting-for-input", attempt, transaction_id="tx-1")
        append("stage-completed", "running", completed=[completion], transaction_id="tx-2")
        append("succeeded", "succeeded", completed=[completion], transaction_id="tx-2")

    messages, transactions = [], []

    def exchange(operation, payload, state, revision=None, extra=None, error=None):
        index = len(messages) // 2
        request = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request", "requestId": "req-" + str(index),
                   "operation": operation, "runId": seed["runId"], "payload": copy.deepcopy(payload)}
        if operation != "status":
            request["idempotencyKey"] = "key-" + str(index)
        if revision is not None:
            request["expectedStateRevision"] = revision
        response = {key: request[key] for key in ("schemaVersion", "requestId", "operation", "runId")}
        response.update({"kind": "response", "ok": error is None})
        if error:
            response["error"] = {"code": error, "message": "Synthetic contract rejection", "retryable": False}
        else:
            response["result"] = {"lockSha256": locked_hash, "state": copy.deepcopy(state), **(extra or {})}
        messages.extend([request, response])
        if operation != "status":
            transaction_id = "tx-" + str(index)
            transactions.append({"schemaVersion": "ai-run-transaction/v1.1", "transactionId": transaction_id,
                                 "platform": "codex", "runId": seed["runId"], "idempotencyKey": request["idempotencyKey"],
                                 "requestSha256": digest({k: v for k, v in request.items() if k != "requestId"}),
                                 "request": copy.deepcopy(request), "phase": "committed", "effectBoundaryCrossed": False,
                                 "eventSequences": [event["sequence"] for event in events if event["transactionId"] == transaction_id] if error is None else [],
                                 "response": copy.deepcopy(response)})

    prepare = {"platform": "codex", "parentRunId": None, "target": {"mode": "workflow", "id": "example-workflow", "version": "1.0.0"},
               "parameters": seed["parameters"], "inputSources": [{"sourcePath": "E:/ai/codex/fixtures/source.txt", "snapshotPath": initial_file["path"]}]}
    exchange("prepare", prepare, states[0])
    if stopped:
        exchange("stop", {"reason": "User requested stop"}, states[-1], revision=0)
    else:
        task = {**attempt, "initialInputSha256": inputs["snapshotSha256"], "allowedTools": [], "prompt": "Return the requested synthetic draft."}
        exchange("next", {}, states[2], revision=0, extra={"task": task, "reason": "claimed"})
        exchange("submit", completion, states[-1], revision=2, extra={"accepted": True})
    exchange("status", {}, states[-1])
    exchange("stop", {"reason": "Late stop"}, states[-1], revision=states[-1]["stateRevision"], error="TERMINAL_RUN")
    exchange("next", {}, states[-1], revision=states[-1]["stateRevision"], extra={"task": None, "reason": "terminal"})
    return {"lock": lock, "events": events, "states": states, "messages": messages, "transactions": transactions}


def validate_bundle(bundle, checks):
    errors = []

    def require(condition, code):
        if not condition:
            errors.append(code)

    try:
        canonical_bytes(bundle)
    except (ValueError, UnicodeError) as error:
        return ["canonical:" + str(error)]
    groups = [("run-lock", [bundle["lock"]]), ("event", bundle["events"]), ("state", bundle["states"]),
              ("protocol", bundle["messages"]), ("transaction", bundle["transactions"])]
    for name, documents in groups:
        for index, document in enumerate(documents):
            for error in checks[name + ".schema.json"].iter_errors(document):
                errors.append("schema:" + name + ":" + str(index) + ":" + "/".join(map(str, error.absolute_path)) + ":" + error.message)
    if errors:
        return errors

    lock = bundle["lock"]
    lock_hash = digest(lock)
    run_id = lock["runId"]
    resources = {item["key"]: item for item in lock["resources"]}
    require(len(resources) == len(lock["resources"]), "resource:duplicate")
    require(PureWindowsPath(lock["runRoot"]).name == run_id, "path:run-id")
    require(lock["parentRunId"] != run_id, "run:parent-self")
    selection = lock["selection"]
    for role in ("agent", "workflow", "runner"):
        key = selection[role]
        if key is not None:
            require(key in resources and resources[key]["kind"] == role, "selection:" + role)
    for key in selection["environment"]:
        require(key in resources and resources[key]["kind"] in {"interpreter", "library", "renderer"}, "selection:environment")
    for item in resources.values():
        require(len({edge["key"] for edge in item["dependencies"]}) == len(item["dependencies"]), "dependency:duplicate")
        for edge in item["dependencies"]:
            require(edge["key"] in resources and resources[edge["key"]]["version"] == edge["version"], "dependency:exact-version")
    roots = [selection["workflow"], selection["runner"], *selection["environment"]]
    if selection["agent"]:
        roots.append(selection["agent"])
        agent = resources.get(selection["agent"], {})
        require(any(edge["key"] == selection["workflow"] and edge["source"]["kind"] == "tool-lock" for edge in agent.get("dependencies", [])), "authority:tool-lock")
    seen, active = set(), set()

    def visit(key):
        if key in active:
            errors.append("dependency:cycle")
        if key in seen or key not in resources:
            return
        seen.add(key)
        active.add(key)
        for edge in resources[key]["dependencies"]:
            visit(edge["key"])
        active.remove(key)

    for key in roots:
        visit(key)
    require(seen == set(resources), "dependency:unreachable")

    def files_valid(files, prefix=None):
        paths = [item["path"] for item in files]
        require(paths == sorted(paths), "files:order")
        require(len({path.casefold() for path in paths}) == len(paths), "files:alias")
        for path in paths:
            require(not any(re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part) for part in path.split("/")), "path:device")
            if prefix:
                require(path.startswith(prefix), "input:prefix" if prefix == "inputs/" else "evidence:prefix")

    inputs = lock["input"]
    files_valid(inputs["files"], "inputs/")
    require(digest(inputs["parameters"]) == inputs["parametersSha256"], "hash:parameters")
    require(digest(inputs["files"]) == inputs["manifestSha256"], "hash:input-manifest")
    require(digest({key: inputs[key] for key in ("parametersSha256", "manifestSha256")}) == inputs["snapshotSha256"], "hash:snapshot")
    stages = {item["id"]: item for item in lock["execution"]["stages"]}
    require(len(stages) == len(lock["execution"]["stages"]), "stage:duplicate")
    visited, visiting = set(), set()

    def visit_stage(key):
        if key in visiting:
            errors.append("stage:cycle")
        if key in visited or key not in stages:
            return
        visited.add(key)
        visiting.add(key)
        for parent in stages[key]["dependsOn"]:
            require(parent in stages, "stage:missing-dependency")
            visit_stage(parent)
        visiting.remove(key)

    for stage_id in stages:
        visit_stage(stage_id)

    def attempt_hash(record):
        return digest({"initialInputSha256": inputs["snapshotSha256"], "artifacts": record["artifacts"]})

    def completion_valid(record, known_outputs):
        stage = stages.get(record["stageId"])
        require(stage is not None, "stage:unknown")
        require(record["inputSha256"] == attempt_hash(record), "attempt:input")
        files_valid(record["artifacts"])
        require(all(item in known_outputs for item in record["artifacts"]), "attempt:unproven-artifact")
        prefix = "evidence/" + record["stageId"] + "/" + str(record["attempt"]) + "/"
        files_valid(record["outputs"], prefix)
        gates = {item["gateId"]: item for item in record["gates"]}
        require(len(gates) == len(record["gates"]), "gate:duplicate")
        if stage:
            require(set(stage["requiredGates"]).issubset(gates), "gate:required")
        for gate in gates.values():
            require(gate["status"] == "pass", "gate:not-pass")
            require(gate["inputSha256"] == record["inputSha256"], "gate:input")
            require(gate["outputManifestSha256"] == digest(record["outputs"]), "gate:output")
            files_valid([gate["evidence"]], prefix)

    event_by_sequence = {event["sequence"]: event for event in bundle["events"]}

    def state_valid(state):
        require(state["runId"] == run_id, "state:run-id")
        require(state["lockSha256"] == lock_hash, "hash:lock")
        event = event_by_sequence.get(state["lastEventSequence"])
        require(event is not None, "state:missing-event")
        if event:
            require(event["eventSha256"] == state["lastEventSha256"] and event["newRevision"] == state["stateRevision"] and event["status"] == state["status"], "state:event-link")
        done, known_outputs = set(), []
        for complete in state["completed"]:
            completion_valid(complete, known_outputs)
            stage = stages.get(complete["stageId"])
            require(complete["stageId"] not in done, "stage:duplicate-completion")
            if stage:
                require(set(stage["dependsOn"]).issubset(done), "stage:dependency-not-completed")
            done.add(complete["stageId"])
            known_outputs.extend(complete["outputs"])
        active_attempt = state["activeAttempt"]
        if active_attempt:
            stage = stages.get(active_attempt["stageId"])
            require(stage is not None and stage["action"] == active_attempt["action"], "attempt:action")
            require(active_attempt["stageId"] not in done, "attempt:already-completed")
            if stage:
                require(set(stage["dependsOn"]).issubset(done), "attempt:dependency")
            require(active_attempt["inputSha256"] == attempt_hash(active_attempt), "attempt:input")
            files_valid(active_attempt["artifacts"])
            require(all(item in known_outputs for item in active_attempt["artifacts"]), "attempt:unproven-artifact")
        if state["status"] == "succeeded":
            require(done == set(stages), "success:incomplete")
            require(all(item in known_outputs for item in state["finalOutput"]), "success:unproven-output")
        if state["status"] in {"prepared", "running", "waiting-for-input"}:
            require(state["error"] is None, "state:unexpected-error")

    transitions = {"prepared": {"prepared", "running", "blocked", "failed", "stopped"},
                   "running": {"running", "waiting-for-input", "blocked", "failed", "succeeded", "stopped"},
                   "waiting-for-input": {"waiting-for-input", "running", "blocked", "failed", "stopped"},
                   "blocked": {"blocked", "stopped"}, "failed": set(), "succeeded": set(), "stopped": set()}
    previous = None
    transaction_ids = set()
    for index, event in enumerate(bundle["events"], 1):
        require(event["sequence"] == index, "event:sequence")
        require(event["runId"] == run_id and event["lockSha256"] == lock_hash, "event:identity")
        require(event["eventSha256"] == digest({k: v for k, v in event.items() if k != "eventSha256"}), "hash:event")
        fixed_status = {"prepared": "prepared", "stage-claimed": "running", "prompt-delivered": "waiting-for-input",
                        "result-accepted": "running", "stage-completed": "running", "blocked": "blocked",
                        "failed": "failed", "succeeded": "succeeded", "stopped": "stopped", "unknown-outcome": "blocked"}
        if event["type"] in fixed_status:
            require(event["status"] == fixed_status[event["type"]], "event:type-status")
        require(event["transactionId"] not in transaction_ids or previous["transactionId"] == event["transactionId"], "event:noncontiguous-transaction")
        transaction_ids.add(event["transactionId"])
        if previous:
            require(event["previousEventSha256"] == previous["eventSha256"], "event:chain")
            require(event["previousRevision"] == previous["newRevision"] and event["newRevision"] == previous["newRevision"] + 1, "event:revision")
            require(event["status"] in transitions[previous["status"]], "event:terminal" if not transitions[previous["status"]] else "event:transition")
        previous = event
    for state in bundle["states"]:
        state_valid(state)

    require(len(bundle["messages"]) % 2 == 0, "protocol:unpaired")
    for request, response in zip(bundle["messages"][::2], bundle["messages"][1::2]):
        require(request["kind"] == "request" and response["kind"] == "response", "protocol:order")
        require(all(request[key] == response[key] for key in ("requestId", "operation", "runId")), "protocol:correlation")
        require(request["runId"] == run_id, "protocol:run-id")
        if not response["ok"]:
            continue
        result = response["result"]
        state = result["state"]
        state_valid(state)
        require(result["lockSha256"] == lock_hash, "hash:lock")
        operation = request["operation"]
        if operation == "prepare":
            target = request["payload"]["target"]
            resource = resources.get(selection[target["mode"]], {})
            require(resource.get("id") == target["id"] and resource.get("version") == target["version"], "prepare:target")
            require(state["status"] == "prepared", "prepare:status")
            require(request["payload"]["parameters"] == inputs["parameters"], "prepare:parameters")
            require(sorted(item["snapshotPath"] for item in request["payload"]["inputSources"]) == [item["path"] for item in inputs["files"]], "prepare:snapshots")
        if operation == "next":
            task = result["task"]
            require((task is not None) == (result["reason"] == "claimed"), "next:reason")
            if task:
                require(not state["stopRequested"], "next:stop-requested")
                active_attempt = state["activeAttempt"] or {}
                require(all(task[key] == active_attempt.get(key) for key in ("stageId", "attempt", "action", "inputSha256", "artifacts")), "next:attempt")
                require(task["initialInputSha256"] == inputs["snapshotSha256"] and task["inputSha256"] == attempt_hash(task), "next:input")
                if task["action"] == "script":
                    require(task["script"]["resourceKey"] in resources, "next:script-resource")
            else:
                conditions = {"waiting": state["status"] == "waiting-for-input", "blocked": state["status"] == "blocked",
                              "terminal": state["status"] in {"failed", "succeeded", "stopped"}, "stop-requested": state["stopRequested"]}
                require(conditions.get(result["reason"], False), "next:reason-state")
        if operation == "submit":
            payload = request["payload"]
            before = next((item for item in bundle["states"] if item["stateRevision"] == request["expectedStateRevision"]), None)
            require(before is not None, "submit:revision")
            if before:
                active_attempt = before["activeAttempt"] or {}
                require(before["status"] in {"running", "waiting-for-input"} and not before["stopRequested"], "submit:state")
                require(payload["stageId"] == active_attempt.get("stageId") and payload["attempt"] == active_attempt.get("attempt"), "submit:attempt")
                require(payload["inputSha256"] == active_attempt.get("inputSha256") and payload["artifacts"] == active_attempt.get("artifacts"), "submit:input")
            require(payload in state["completed"], "submit:uncommitted")
        if operation == "stop":
            require(state["stopRequested"], "stop:flag")
    receipts = {}
    for receipt in bundle["transactions"]:
        request = receipt["request"]
        require(receipt["runId"] == run_id and receipt["platform"] == lock["platform"], "transaction:identity")
        require(receipt["idempotencyKey"] == request["idempotencyKey"], "transaction:key")
        require(receipt["requestSha256"] == digest({k: v for k, v in request.items() if k != "requestId"}), "transaction:hash")
        key = (receipt["platform"], receipt["runId"], receipt["idempotencyKey"])
        if key in receipts:
            require(receipts[key]["requestSha256"] == receipt["requestSha256"] and receipts[key]["response"] == receipt["response"], "transaction:idempotency")
        receipts[key] = receipt
        if receipt["phase"] == "committed":
            require(all(request[field] == receipt["response"][field] for field in ("requestId", "operation", "runId")), "transaction:correlation")
            sequences = receipt["eventSequences"]
            require(sequences == sorted(sequences), "transaction:event-order")
            require(sequences == [event["sequence"] for event in bundle["events"] if event["transactionId"] == receipt["transactionId"]], "transaction:event-link")
            if receipt["response"]["ok"]:
                response_result = receipt["response"]["result"]
                if sequences:
                    require(response_result["state"]["lastEventSequence"] == sequences[-1], "transaction:response-state")
                else:
                    require(request["operation"] == "next" and response_result.get("task") is None, "transaction:missing-event")
            else:
                require(not sequences, "transaction:rejected-mutation")
    return errors


def mutate(bundle, case):
    result = copy.deepcopy(bundle)
    operation = case.get("operation")
    if operation == "append-after-terminal":
        event = copy.deepcopy(result["events"][-1])
        event.update({"sequence": event["sequence"] + 1, "previousRevision": event["newRevision"], "newRevision": event["newRevision"] + 1,
                      "previousEventSha256": event["eventSha256"], "transactionId": "late-tx", "type": "stage-claimed", "status": "running"})
        event["eventSha256"] = digest({k: v for k, v in event.items() if k != "eventSha256"})
        result["events"].append(event)
    elif operation == "conflicting-receipt":
        receipt = copy.deepcopy(result["transactions"][0])
        receipt["request"]["payload"]["parameters"]["seed"] = 999
        receipt["requestSha256"] = digest({k: v for k, v in receipt["request"].items() if k != "requestId"})
        result["transactions"].append(receipt)
    elif operation == "agent-without-tool-lock":
        agent = copy.deepcopy(result["lock"]["resources"][0])
        agent.update({"key": "example-agent", "kind": "agent", "id": "example-agent"})
        agent["dependencies"] = [{"key": "example-workflow", "version": "1.0.0", "source": copy.deepcopy(agent["resolvedFrom"])}]
        result["lock"]["resources"].append(agent)
        result["lock"]["selection"]["agent"] = agent["key"]
    else:
        target = result
        for key in case["path"][:-1]:
            target = target[key]
        key = case["path"][-1]
        if case.get("delete"):
            del target[key]
        else:
            target[key] = case["value"]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", required=True, type=Path,
                        help="Existing caller-owned runtime root; this path check is not a sandbox")
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    try:
        allowed_root = args.runtime_root.resolve(strict=True)
    except OSError as error:
        parser.error("runtime root must exist: " + str(error))
    if not allowed_root.is_dir():
        parser.error("runtime root must be an existing directory")
    report_path = args.report.resolve()
    if not report_path.is_relative_to(allowed_root):
        parser.error("resolved report output must remain under --runtime-root")
    example_path = report_path.with_name("positive-example-bundles.json").resolve()
    if not example_path.is_relative_to(allowed_root):
        parser.error("resolved example output must remain under --runtime-root")
    if report_path == example_path:
        parser.error("report and positive example output paths must be distinct")
    for output_path in (report_path, example_path):
        if output_path.exists() or output_path.is_symlink():
            parser.error("refusing to overwrite existing output: " + str(output_path))
    checks = validators()
    results = []
    bundles = [example_bundle(), example_bundle(stopped=True)]
    for index, bundle in enumerate(bundles):
        errors = validate_bundle(bundle, checks)
        results.append({"id": "P0" + str(index + 1), "kind": "static-positive", "passed": not errors, "errors": errors})
    for case in strict_load(ROOT / "examples" / "negative-cases.json"):
        errors = validate_bundle(mutate(bundles[0], case), checks)
        results.append({"id": case["id"], "description": case["description"], "kind": "static-negative",
                        "passed": any(error.startswith(case["expect"]) for error in errors), "expectedPrefix": case["expect"], "errors": errors})
    vectors = [({"z": 1, "a": [True, None, "x"]}, b'{"a":[true,null,"x"],"z":1}'),
               ({"\u00e9": "\u4e2d", "a": -0}, '{"a":0,"\u00e9":"\u4e2d"}'.encode("utf-8")),
               ({"x": "\n\t\"\\"}, b'{"x":"\\n\\t\\"\\\\"}')]
    for index, (value, expected) in enumerate(vectors):
        results.append({"id": "H0" + str(index + 1), "kind": "canonical-vector", "passed": canonical_bytes(value) == expected})
    for index, value in enumerate([1.5, float("nan"), "\ud800", SAFE_INTEGER + 1]):
        rejected = False
        try:
            canonical_bytes(value)
        except (ValueError, UnicodeError):
            rejected = True
        results.append({"id": "H1" + str(index), "kind": "canonical-rejection", "passed": rejected})
    for index, value in enumerate(['{"x":1,"x":2}', '{"x":1e2}', '{"x":NaN}', '\ufeff{"x":1}']):
        rejected = False
        try:
            strict_loads(value)
        except ValueError:
            rejected = True
        results.append({"id": "J0" + str(index), "kind": "strict-json-rejection", "passed": rejected})
    replay = copy.deepcopy(bundles[0])
    replay["transactions"].append(copy.deepcopy(replay["transactions"][0]))
    replay_errors = validate_bundle(replay, checks)
    results.append({"id": "P03", "kind": "static-identical-receipt-replay", "passed": not replay_errors, "errors": replay_errors})
    history = [({"schemaVersion": "ai-run-lock/v1", "status": "prepared"}, "historical-v1-read-only-information-insufficient"),
               ({"schema": "ai-run-lock/v1", "recordType": "maintenance"}, "maintenance-not-executable"),
               ({"schemaVersion": "unrecognized"}, "unsupported-read-only"),
               ({"Schema": "ai-maintenance-run-lock/v1", "Agent": None, "Workflow": None, "WorkflowExecutionStarted": False}, "maintenance-not-executable")]
    for index, (record, expected) in enumerate(history):
        before = copy.deepcopy(record)
        results.append({"id": "V0" + str(index), "kind": "historical-read-only-classification",
                        "passed": history_classification(record) == expected and record == before})
    report = {"schemaVersion": "runtime-contract-test-report/v1", "scope": "Phase 0 static contracts only",
              "runtimeImplemented": False, "schemasValidated": len(checks), "total": len(results),
              "passed": sum(item["passed"] for item in results), "failed": sum(not item["passed"] for item in results),
              "results": results}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    for output_path, content in ((report_path, report), (example_path, bundles)):
        if not output_path.resolve().is_relative_to(allowed_root):
            parser.error("output parent changed outside --runtime-root: " + str(output_path))
        try:
            with output_path.open("x", encoding="utf-8") as stream:
                stream.write(json.dumps(content, indent=2, ensure_ascii=True) + "\n")
        except OSError as error:
            parser.error("output creation failed; preserve any partial evidence: " + str(error))
    print(json.dumps({"passed": report["passed"], "failed": report["failed"], "report": str(report_path), "examples": str(example_path)}))
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
