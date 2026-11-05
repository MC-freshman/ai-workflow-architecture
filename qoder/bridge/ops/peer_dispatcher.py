"""qoder peer dispatcher (qoder-peer-dispatcher/1.0.0) — gate-4 wiring on the qoder side.

Contract (fixed by wf-runner 0.7.6 engine.dispatch_delegation):
  module.create({"callsLog": <path>, "scenario": <str>}) -> object with .dispatch(record) -> outcome
  outcome = {"children": [{childRunId, peerId, peerVersion, status, requestSha256, resultSha256?}],
             "status": <str>, "dispatcherVersion": <str>}

What this adapter does: for every peer the engine already authorized against the parent's
exact peer lock, it starts a REAL child run of this platform through the pinned 0.7.6 CLI
(`prepare` with parentRunId = the parent run, mode=agent, exact pinned version), drives each
returned prompt stage to completion with qoder-authored sealed evidence, and reports the
child's terminal state. A child whose stage evidence has not been authored fails; this
adapter never invents business output to keep a run green.

Platform convention: the engine does not forward the runner config to the dispatcher, so
the driver exports QODER_CONFIG (candidate config path) before invoking dispatch_delegation.
Stage evidence lives under config['peerContentRoot'].

qoder owns this file. zcode's dispatcher is a separate implementation on a separate platform;
neither one's acceptance evidence transfers to the other.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

VERSION = "qoder-peer-dispatcher/1.0.0"


def _load(cfg_path, name):
    spec = sys.modules.get(name)
    if spec:
        return spec
    import importlib.util

    module = importlib.util.module_from_spec(importlib.util.spec_from_file_location(name, cfg_path))
    sys.modules[name] = module
    module.__loader__ = None
    importlib.util.module_from_spec(importlib.util.spec_from_file_location(name, cfg_path)).__spec__  # noqa: B018
    return module


class QoderPeerDispatcher:
    def __init__(self, options):
        self.calls_log = Path(options["callsLog"])
        self.scenario = options.get("scenario", "success")
        config_path = os.environ.get("QODER_CONFIG")
        if not config_path:
            raise RuntimeError("QODER_CONFIG must point at the qoder runner config for peer dispatch")
        self.config_path = Path(config_path)
        self.config = json.loads(self.config_path.read_text(encoding="utf-8-sig"))
        self.runner = Path(self.config["runner"])
        self.cli = self.runner / "cli.py"
        if str(self.runner) not in sys.path:
            sys.path.insert(0, str(self.runner))
        from runtime_core import Contracts

        self.contracts = Contracts(self.config["contracts"], self.config.get("scannerRelease"))
        self.content_root = Path(self.config["peerContentRoot"])
        self.runs_root = Path(self.config["runsRoot"])
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                        PYTHONPYCACHEPREFIX=str(self.runs_root.parent / "maintenance/2.0-B/tmp/cache"),
                        PYTHONIOENCODING="utf-8", PYTHONUTF8="1")

    # ---- protocol plumbing -------------------------------------------------
    def _call(self, args, timeout=600):
        proc = subprocess.run([sys.executable, "-B", str(self.cli), "--config", str(self.config_path)] + args,
                              capture_output=True, timeout=timeout, env=self.env)
        tail = proc.stdout.decode("utf-8", "replace").strip().splitlines()
        try:
            return proc.returncode, json.loads(tail[-1])
        except Exception:
            return proc.returncode, {"raw": (proc.stdout + proc.stderr).decode("utf-8", "replace")[-400:]}

    def _request(self, body):
        path = self.runs_root.parent / "maintenance/2.0-B/tmp/dispatch" / (body["requestId"] + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        return self._call(["--request", str(path)])

    def _state(self, run_id):
        return json.loads((self.runs_root / run_id / "state.json").read_text(encoding="utf-8"))

    def _prepare(self, record, peer, child_run_id):
        return {"schemaVersion": "ai-run-protocol/v1.2", "kind": "request",
                "requestId": "r-" + child_run_id, "operation": "prepare", "runId": child_run_id,
                "idempotencyKey": "i-" + child_run_id,
                "payload": {"platform": self.config["platform"], "parentRunId": record["parentRunId"],
                            "target": {"mode": "agent", "id": peer["id"], "version": peer["version"]},
                            "parameters": {"engagementId": "PEER-" + record["sequence"],
                                           "brief": record["brief"],
                                           "targets": ["E:/ai/agent/" + peer["id"]]},
                            "inputSources": []}}

    def _submit(self, run_id, task, content):
        data = content.encode("utf-8") if isinstance(content, str) else content
        evidence = self.runs_root / run_id / "evidence" / str(task["stageId"]) / str(task["attempt"]) / "output.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        payload = {"stageId": task["stageId"], "attempt": task["attempt"], "inputSha256": task["inputSha256"],
                   "artifacts": task.get("artifacts", []),
                   "outputs": [{"path": str(evidence.relative_to(self.runs_root / run_id)).replace("\\", "/"),
                                "sha256": digest, "size": len(data)}],
                   "gates": []}
        body = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
                "requestId": "r-%s-submit-%s-%d" % (run_id, task["stageId"], time.time_ns()),
                "operation": "submit", "runId": run_id,
                "idempotencyKey": "i-%s-submit-%s" % (run_id, task["stageId"]),
                "expectedStateRevision": self._state(run_id)["stateRevision"], "payload": payload}
        return self._request(body)

    def _next(self, run_id):
        body = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
                "requestId": "r-%s-next-%d" % (run_id, time.time_ns()), "operation": "next", "runId": run_id,
                "idempotencyKey": "i-%s-next-%d" % (run_id, time.time_ns()),
                "expectedStateRevision": self._state(run_id)["stateRevision"], "payload": {}}
        return self._request(body)

    # ---- one child ---------------------------------------------------------
    def _run_child(self, record, peer):
        child_run_id = record["sequence"] + "-" + peer["id"]
        stale = self.runs_root / child_run_id
        if stale.exists():
            shutil_rmtree(stale)
        rc, body = self._request(self._prepare(record, peer, child_run_id))
        if body.get("ok") is not True:
            return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                    "status": "rejected", "requestSha256": record["requestSha256"],
                    "reason": "prepare: " + json.dumps(body.get("error") or body, ensure_ascii=False)[:200]}
        peer_dir = self.content_root / peer["id"]
        driven = []
        for _ in range(12):  # bounded pump; the child pipeline has three stages
            rc, body = self._next(child_run_id)
            if body.get("ok") is not True:
                return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                        "status": "failed", "requestSha256": record["requestSha256"],
                        "reason": "next: " + json.dumps(body.get("error") or body, ensure_ascii=False)[:200],
                        "stages": driven}
            task = (body.get("result") or {}).get("task") or {}
            if not task.get("stageId"):
                break
            stage = str(task["stageId"])
            content_path = peer_dir / (stage + ".json")
            if not content_path.is_file():
                self._stop(child_run_id, "qoder dispatcher: no authored evidence for " + stage)
                return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                        "status": "failed", "requestSha256": record["requestSha256"],
                        "reason": "missing-authored-content:" + stage, "stages": driven}
            text = content_path.read_text(encoding="utf-8")
            text = (text.replace("{{parentRunId}}", record["parentRunId"])
                        .replace("{{sequence}}", record["sequence"])
                        .replace("{{peerId}}", peer["id"])
                        .replace("{{peerVersion}}", peer["version"])
                        .replace("{{brief}}", record["brief"]))
            if self.scenario == "fail-child" and peer["id"].endswith("reporting"):
                self._stop(child_run_id, "injected dispatcher failure scenario")
                return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                        "status": "failed", "requestSha256": record["requestSha256"],
                        "reason": "scenario:fail-child", "stages": driven}
            rc, body = self._submit(child_run_id, task, text)
            if (body.get("result") or {}).get("accepted") is not True:
                self._stop(child_run_id, "submit rejected")
                return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                        "status": "failed", "requestSha256": record["requestSha256"],
                        "reason": "submit " + stage + ": " + json.dumps(body.get("error") or {}, ensure_ascii=False)[:200],
                        "stages": driven}
            driven.append(stage)
        state = self._state(child_run_id)
        if state.get("status") != "succeeded":
            self._stop(child_run_id, "child did not reach succeeded")
            return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                    "status": "failed", "requestSha256": record["requestSha256"],
                    "reason": "terminal-state:" + str(state.get("status")), "stages": driven}
        return {"peerId": peer["id"], "peerVersion": peer["version"], "childRunId": child_run_id,
                "status": "completed", "requestSha256": record["requestSha256"],
                "resultSha256": self.contracts.hash(state["finalOutput"]), "stages": driven,
                "sealedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

    def _stop(self, run_id, reason):
        try:
            self._request({"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
                           "requestId": "r-%s-stop-%d" % (run_id, time.time_ns()), "operation": "stop",
                           "runId": run_id, "idempotencyKey": "i-%s-stop-%d" % (run_id, time.time_ns()),
                           "expectedStateRevision": self._state(run_id)["stateRevision"],
                           "payload": {"reason": reason}})
        except Exception:
            pass

    # ---- engine entry point ------------------------------------------------
    def dispatch(self, record):
        children = []
        for peer in record["peers"]:
            try:
                children.append(self._run_child(record, peer))
            except Exception as exc:  # a broken child is recorded, never silently dropped
                children.append({"peerId": peer["id"], "peerVersion": peer["version"],
                                 "childRunId": record["sequence"] + "-" + peer["id"],
                                 "status": "failed", "requestSha256": record["requestSha256"],
                                 "reason": type(exc).__name__ + ": " + str(exc)[:180]})
        with self.calls_log.parent.joinpath("calls.log").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                     "dispatcher": VERSION, "scenario": self.scenario,
                                     "parentRunId": record["parentRunId"], "sequence": record["sequence"],
                                     "requestSha256": record["requestSha256"],
                                     "children": [{"peerId": c["peerId"], "status": c["status"],
                                                   "childRunId": c["childRunId"]} for c in children]},
                                    ensure_ascii=False) + "\n")
        completed = sum(1 for c in children if c["status"] == "completed")
        status = "completed" if completed == len(children) else ("partial" if completed else "failed")
        return {"children": children, "status": status, "dispatcherVersion": VERSION}


def shutil_rmtree(path):
    import shutil

    shutil.rmtree(path, ignore_errors=True)


def create(options):
    return QoderPeerDispatcher(options)
