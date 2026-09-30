#!/usr/bin/env python3
"""Manage project stages and enforce artifact gates."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


STAGES = ["INIT", "AUDIT", "SPEC", "BASELINE", "SOLVE", "EXPERIMENT", "VALIDATE", "FIGURES", "FREEZE"]
REQUIRED = {
    "AUDIT": ["reports/*_audit.md"],
    "SPEC": ["model_spec.yaml", "reports/*_audit.md"],
    "BASELINE": ["model_spec.yaml", "src/baseline.py"],
    "SOLVE": ["model_spec.yaml", "src/solver.py"],
    "EXPERIMENT": ["configs/experiment.json", "experiments"],
    "VALIDATE": ["reports/validation_report.md"],
    "FIGURES": ["figures/figure_registry.csv", "reports/figure_check.json"],
    "FREEZE": ["results/result_registry.csv", "figures/figure_registry.csv", "reports/validation_report.md", "reports/figure_check.json"],
}


def load(root: Path) -> tuple[dict, dict]:
    manifest_path = root / "project_manifest.json"
    state_path = root / "stage_state.json"
    if not manifest_path.is_file() or not state_path.is_file():
        raise FileNotFoundError("项目未初始化，请先运行 init_project.py")
    return json.loads(manifest_path.read_text(encoding="utf-8")), json.loads(state_path.read_text(encoding="utf-8"))


def save(root: Path, manifest: dict, state: dict) -> None:
    root.joinpath("project_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    root.joinpath("stage_state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def missing(root: Path, stage: str) -> list[str]:
    missing_items = []
    for item in REQUIRED.get(stage, []):
        if "*" in item:
            if not list(root.glob(item)):
                missing_items.append(item)
        elif not (root / item).exists():
            missing_items.append(item)
    if stage in {"SPEC", "BASELINE", "SOLVE"}:
        spec = root / "model_spec.yaml"
        if spec.is_file() and not re.search(r"^status:\s*[\"']?CONFIRMED", spec.read_text(encoding="utf-8"), flags=re.M):
            missing_items.append("model_spec.yaml (status must be CONFIRMED)")
    if stage == "FREEZE":
        registry = root / "tasks" / "task_registry.jsonl"
        if registry.is_file():
            latest: dict[str, dict] = {}
            try:
                for line in registry.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        record = json.loads(line)
                        if isinstance(record, dict) and record.get("task_id"):
                            latest[str(record["task_id"])] = record
            except (OSError, json.JSONDecodeError):
                missing_items.append("tasks/task_registry.jsonl (JSON 无效)")
            for task_id, record in latest.items():
                if record.get("paper_candidate") and record.get("review_status") != "ACCEPTED":
                    missing_items.append(f"任务 {task_id} (paper_candidate 需审核为 ACCEPTED)")
    if stage in {"FIGURES", "FREEZE"}:
        figure_check = root / "reports" / "figure_check.json"
        if figure_check.is_file():
            try:
                check_payload = json.loads(figure_check.read_text(encoding="utf-8"))
                if check_payload.get("status") != "success":
                    missing_items.append("reports/figure_check.json (图表 QA 必须 success)")
            except (OSError, json.JSONDecodeError):
                missing_items.append("reports/figure_check.json (JSON 无效)")
    return missing_items


def main() -> int:
    parser = argparse.ArgumentParser(description="Advance or inspect the modeling stage")
    parser.add_argument("command", choices=["status", "advance", "block", "unblock"])
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--to", choices=STAGES)
    parser.add_argument("--reason", default="")
    args = parser.parse_args()
    root = args.project.resolve()
    try:
        manifest, state = load(root)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 2

    if args.command == "status":
        next_index = STAGES.index(state["stage"]) + 1
        state["required_for_next"] = REQUIRED.get(STAGES[next_index], []) if next_index < len(STAGES) else []
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return 0

    now = datetime.now(timezone.utc).isoformat()
    if args.command == "block":
        state.update({"status": "BLOCKED", "block_reason": args.reason or "未提供原因", "updated_at": now})
        state.setdefault("history", []).append({"stage": state["stage"], "status": "BLOCKED", "reason": state["block_reason"], "at": now})
        save(root, manifest, state)
        print(json.dumps({"status": "success", "stage": state["stage"], "state": "BLOCKED"}, ensure_ascii=False))
        return 0

    if args.command == "unblock":
        state.update({"status": "READY", "block_reason": None, "updated_at": now})
        state.setdefault("history", []).append({"stage": state["stage"], "status": "READY", "at": now})
        save(root, manifest, state)
        print(json.dumps({"status": "success", "stage": state["stage"], "state": "READY"}, ensure_ascii=False))
        return 0

    if args.to is None:
        parser.error("advance 必须提供 --to")
    current_index = STAGES.index(state["stage"])
    target_index = STAGES.index(args.to)
    if state.get("status") == "BLOCKED":
        print(json.dumps({"status": "failed", "error": "当前阶段已阻塞，请先修复问题并执行 unblock", "reason": state.get("block_reason")}, ensure_ascii=False))
        return 1
    if target_index != current_index + 1:
        print(json.dumps({"status": "failed", "error": "只能推进到下一个阶段", "current": state["stage"], "requested": args.to}, ensure_ascii=False))
        return 1
    missing_items = missing(root, args.to)
    if missing_items:
        state.update({"status": "BLOCKED", "missing_items": missing_items, "block_reason": "阶段产物缺失", "updated_at": now})
        save(root, manifest, state)
        print(json.dumps({"status": "blocked", "stage": state["stage"], "next": args.to, "missing": missing_items}, ensure_ascii=False))
        return 1
    state.update({"stage": args.to, "status": "READY", "missing_items": [], "block_reason": None, "updated_at": now})
    state.setdefault("history", []).append({"stage": args.to, "status": "READY", "at": now})
    manifest["current_stage"] = args.to
    save(root, manifest, state)
    print(json.dumps({"status": "success", "stage": args.to}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
