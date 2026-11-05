# -*- coding: utf-8 -*-
"""ZCode 平台侧 peer 派发器（A3 / 2.0-unlock 项4b，驱动真实 runner 子 run）。

接入点：wf-runner 的 ``Engine.dispatch_delegation`` 经配置键
``peerDispatcherModule`` 加载本模块，调用 ``create(opts)`` → ``dispatch(record)``。

与 2026-09-13 ZP-9 旧实现的区别（升级点，如实声明）：
  * 旧实现：子“运行”只是 dispatch 目录下的物化目录 + 平台执行器（peerChildExecutor）；
  * 新实现（本模块）：每个 peer 一个**真实子 run** —— 走本发布线 cli 的
    ``prepare``（``parentRunId``=父 run、target mode=agent、**显式精确版本**）→
    ``next`` 得任务 → 以**本会话产出并落盘的阶段证据**（peerContentRoot 声明处）
    密封 ``evidence/<stage>/<attempt>/output.json`` → ``submit`` → 子 run
    ``succeeded``。缺内容 = failed，**绝不伪造占位证据**。
  * ``children/<peerId>/`` 下仍物化 ZP-9 形状的血缘视图（child-run.json /
    child-request.json / child-result.json），与真实子 run 目录互为印证。
  * 生命周期逐条写 ``calls.log``；``cancel.flag`` 出现即未派发子置 rejected。

边界（如实）：zcode 会话**不能以编程方式派生 LLM 子会话**；子阶段内容的真实
作者是派发时刻的宿主会话（本模块只搬运与密封该会话预先落盘的文件）。该边界与
ZP-9 的诚实声明一脉相承。

红线：只写 E:/ai/zcode/runtime/ 与本模块自身目录；不触共享发布目录/其它平台。
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

VERSION = "zcode-peer-dispatcher/1.0.0"
DEFAULT_CONFIG = "E:/ai/zcode/bridge/zcode-config-pilot.json"
MAX_STAGES = 12


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ZcodePeerDispatcher:
    def __init__(self, calls_log, scenario="success"):
        self.calls_log = Path(calls_log)
        self.dispatch_dir = self.calls_log.parent
        self.scenario = scenario
        config_path = Path(os.environ.get("ZCODE_CONFIG", DEFAULT_CONFIG))
        self.config = json.loads(config_path.read_text(encoding="utf-8-sig"))
        self.python = str(Path(self.config["platformRoot"]) / "runtime" / "py-env" / "Scripts" / "python.exe")
        self.runner = Path(self.config["runner"])
        self.runs = Path(self.config["runsRoot"])
        self.content_root = Path(self.config["peerContentRoot"])
        self.tmp = Path(self.config["platformRoot"]) / "runtime" / "tmp" / "v6" / "dispatch"
        self.tmp.mkdir(parents=True, exist_ok=True)
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                        PYTHONPYCACHEPREFIX=str(Path(self.config["platformRoot"]) / "runtime" / "tmp" / "v6" / "cache"),
                        ZCODE_CONFIG=str(config_path))
        # 引擎同款 canonical 哈希（sha256-cjson-safe），使 resultSha256 可被验收侧复算。
        self.canon = _load(Path(self.config["contracts"]) / "contracts" / "runtime" / "validate_contracts.py",
                           "peer_dispatcher_contracts")

    # -- runner protocol helpers ---------------------------------------------

    def _op(self, run_id: str, operation: str, payload: dict, timeout: int):
        stamp = str(time.time_ns())
        req = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
               "requestId": "r-%s-%s-%s" % (run_id, operation, stamp), "operation": operation,
               "runId": run_id, "payload": payload}
        if operation != "status":
            state = json.loads((self.runs / run_id / "state.json").read_text(encoding="utf-8"))
            req["idempotencyKey"] = "i-%s-%s-%s" % (run_id, operation, stamp)
            req["expectedStateRevision"] = state["stateRevision"]
        request_file = self.tmp / ("%s-%s-%s.json" % (run_id, operation, stamp))
        request_file.write_text(json.dumps(req, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run([self.python, "-B", str(self.runner / "cli.py"), "--config", str(self.config_path()),
                               "--request", str(request_file)],
                              capture_output=True, text=True, timeout=timeout, env=self.env)
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:
            return {"ok": False, "error": {"code": "DISPATCHER_TRANSPORT",
                                           "message": (proc.stdout + proc.stderr)[-240:]}}

    def config_path(self):
        return Path(os.environ.get("ZCODE_CONFIG", DEFAULT_CONFIG))

    def _record(self, value):
        path = Path(value)
        return {"path": path.relative_to(self.run_root).as_posix(),
                "sha256": _sha256(path), "size": path.stat().st_size}

    # -- child lifecycle -------------------------------------------------------

    def _materialise_child(self, record: dict, peer: dict, child_run_id: str) -> Path:
        child_root = self.dispatch_dir / "children" / peer["id"]
        child_root.mkdir(parents=True, exist_ok=True)
        lineage = {"schema": "ai-peer-child-run/v1", "childRunId": child_run_id,
                   "parentRunId": record["parentRunId"], "sequence": record["sequence"],
                   "platform": self.config["platform"],
                   "agent": {"id": peer["id"], "version": peer["version"], "manifestSha256": peer["manifestSha256"]},
                   "briefSha256": hashlib.sha256(record["brief"].encode("utf-8")).hexdigest(),
                   "requestSha256": record["requestSha256"], "permissions": record["permissions"],
                   "runnerConfig": str(self.config_path()), "createdAt": _now()}
        (child_root / "child-run.json").write_text(json.dumps(lineage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return child_root

    def _drive_child(self, record: dict, peer: dict, child_run_id: str, timeout: int):
        """真实子 run 生命周期。Returns (status, reason, result_doc_or_None)."""
        self.run_root = self.runs / child_run_id
        req = {"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
               "requestId": "r-" + child_run_id, "operation": "prepare", "runId": child_run_id,
               "idempotencyKey": "i-" + child_run_id,
               "payload": {"platform": self.config["platform"], "parentRunId": record["parentRunId"],
                           "target": {"mode": "agent", "id": peer["id"], "version": peer["version"]},
                           "parameters": {"engagementId": "peer-" + record["sequence"], "brief": record["brief"],
                                          "targets": [], "peer": peer["id"] + "@" + peer["version"]},
                           "inputSources": [{"sourcePath": str(self.dispatch_dir / "request.json"),
                                             "snapshotPath": "inputs/peer-record.json"}]}}
        request_file = self.tmp / (child_run_id + "-prepare.json")
        request_file.write_text(json.dumps(req, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run([self.python, "-B", str(self.runner / "cli.py"), "--config", str(self.config_path()),
                               "--request", str(request_file)], capture_output=True, text=True, timeout=timeout, env=self.env)
        try:
            body = json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:
            return "failed", "prepare transport failure: " + (proc.stdout + proc.stderr)[-160:], None
        if not body.get("ok"):
            return "failed", "prepare rejected: " + json.dumps(body.get("error"), ensure_ascii=False)[:220], None
        for _ in range(MAX_STAGES):
            body = self._op(child_run_id, "next", {}, timeout)
            if not body.get("ok"):
                return "failed", "next rejected: " + json.dumps(body.get("error"), ensure_ascii=False)[:220], None
            task = (body.get("result") or {}).get("task") or {}
            stage_id, attempt = task.get("stageId"), task.get("attempt")
            content = self.content_root / peer["id"] / (str(stage_id) + ".json")
            if not content.is_file():
                return "failed", "no session-authored evidence for stage " + str(stage_id), None
            evidence = self.run_root / "evidence" / str(stage_id) / str(attempt) / "output.json"
            evidence.parent.mkdir(parents=True, exist_ok=True)
            evidence.write_bytes(content.read_bytes())
            payload = {"stageId": stage_id, "attempt": attempt, "inputSha256": task["inputSha256"],
                       "artifacts": task.get("artifacts", []), "outputs": [self._record(evidence)], "gates": []}
            body = self._op(child_run_id, "submit", payload, timeout)
            if not body.get("ok") or not (body.get("result") or {}).get("accepted"):
                return "failed", "submit rejected: " + json.dumps(body.get("error"), ensure_ascii=False)[:220], None
            state = json.loads((self.run_root / "state.json").read_text(encoding="utf-8"))
            if state.get("status") == "succeeded":
                final = state.get("finalOutput")
                if not final:
                    return "failed", "succeeded without finalOutput", None
                return "completed", None, {"childRunId": child_run_id, "finalOutput": final,
                                           "resultSha256": hashlib.sha256(self.canon.canonical_bytes(final)).hexdigest()}
            if state.get("status") in ("failed", "blocked", "stopped"):
                return "failed", "child run terminal " + str(state.get("status")) + ": " + json.dumps(state.get("error"), ensure_ascii=False)[:160], None
        return "timeout", "stage budget exhausted (" + str(MAX_STAGES) + ")", None

    # -- runner entry point ----------------------------------------------------

    def dispatch(self, record: dict) -> dict:
        self._journal({"event": "delegation-received", "sequence": record["sequence"],
                       "peers": [peer["id"] + "@" + peer["version"] for peer in record["peers"]],
                       "scenario": self.scenario})
        children = []
        timeout = int(record.get("timeoutSeconds") or 600)
        for peer in record["peers"]:
            child_run_id = record["sequence"] + "-" + peer["id"]
            if (self.dispatch_dir / "cancel.flag").exists():
                self._journal({"event": "delegation-cancelled", "peer": peer["id"]})
                children.append({"childRunId": child_run_id, "peerId": peer["id"], "peerVersion": peer["version"],
                                 "requestSha256": record["requestSha256"], "status": "rejected",
                                 "reason": "delegation cancelled before dispatch"})
                continue
            child_root = self._materialise_child(record, peer, child_run_id)
            self._journal({"event": "child-created", "childRunId": child_run_id,
                           "peer": peer["id"] + "@" + peer["version"], "realChildRun": str(self.runs / child_run_id)})
            try:
                status, reason, result_doc = self._drive_child(record, peer, child_run_id, timeout)
            except subprocess.TimeoutExpired:
                status, reason, result_doc = "timeout", "child run exceeded timeoutSeconds", None
            except Exception as exc:  # dispatcher must never break the engine's transaction
                status, reason, result_doc = "failed", "dispatcher error: " + repr(exc)[:200], None
            child = {"childRunId": child_run_id, "peerId": peer["id"], "peerVersion": peer["version"],
                     "requestSha256": record["requestSha256"], "status": status}
            if reason:
                child["reason"] = reason
            if result_doc is not None:
                (child_root / "child-result.json").write_text(
                    json.dumps({**result_doc, "finishedAt": _now()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                child["resultSha256"] = result_doc["resultSha256"]
            self._journal({"event": "child-settled", "childRunId": child_run_id, "status": status,
                           "reason": reason, "resultSha256": child.get("resultSha256")})
            children.append(child)
        settled = "completed" if children and all(c["status"] == "completed" for c in children) else "failed"
        self._journal({"event": "delegation-settled", "status": settled, "children": len(children)})
        return {"children": children, "status": settled, "dispatcherVersion": VERSION}

    def _journal(self, event: dict) -> None:
        payload = {"at": _now(), **event}
        with self.calls_log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def create(opts):
    return ZcodePeerDispatcher(opts["callsLog"], opts.get("scenario", "success"))
