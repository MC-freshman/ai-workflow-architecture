#!/usr/bin/env python3
"""Inspect project structure and report actionable pre-run problems."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re


STAGES = ["INIT", "AUDIT", "SPEC", "BASELINE", "SOLVE", "EXPERIMENT", "VALIDATE", "FIGURES", "FREEZE"]
REQUIRED_DIRS = [
    "data/raw", "data/processed", "src", "configs", "experiments", "experiments/tasks",
    "results", "figures", "reports", "scripts", "tasks/manifests",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check modeling project readiness")
    parser.add_argument("project", type=Path, default=Path("."), nargs="?")
    args = parser.parse_args()
    root = args.project.resolve()
    errors = []
    warnings = []
    if not root.is_dir():
        parser.error(f"找不到项目目录: {root}")
    manifest_path = root / "project_manifest.json"
    state_path = root / "stage_state.json"
    if not manifest_path.is_file():
        errors.append("缺少 project_manifest.json，请运行 init_project.py")
    if not state_path.is_file():
        errors.append("缺少 stage_state.json，请运行 init_project.py")
    for relative in REQUIRED_DIRS:
        if not (root / relative).is_dir():
            warnings.append(f"缺少推荐目录: {relative}")
    manifest = {}
    state = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("current_stage") not in STAGES:
                errors.append("project_manifest.current_stage 无效")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"project_manifest.json 无效: {exc}")
    if state_path.is_file():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if state.get("stage") not in STAGES:
                errors.append("stage_state.stage 无效")
            if state.get("status") == "BLOCKED" and not state.get("block_reason"):
                errors.append("阶段标记为 BLOCKED，但没有 block_reason")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"stage_state.json 无效: {exc}")
    spec = root / "model_spec.yaml"
    if spec.is_file() and not re.search(r"^status:\s*[\"']?CONFIRMED", spec.read_text(encoding="utf-8"), flags=re.M):
        warnings.append("model_spec.yaml 尚未标记为 CONFIRMED")
    elif not spec.is_file():
        warnings.append("缺少 model_spec.yaml")
    registry = root / "results" / "result_registry.csv"
    if registry.is_file() and registry.stat().st_size <= 1:
        warnings.append("result_registry.csv 目前为空")
    task_registry = root / "tasks" / "task_registry.jsonl"
    if task_registry.is_file():
        try:
            for line_number, line in enumerate(task_registry.read_text(encoding="utf-8").splitlines(), start=1):
                if line.strip():
                    payload = json.loads(line)
                    if not isinstance(payload, dict) or not payload.get("task_id"):
                        warnings.append(f"task_registry.jsonl 第 {line_number} 行缺少 task_id")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"task_registry.jsonl 无效: {exc}")
    elif (root / "tasks").is_dir():
        warnings.append("缺少 tasks/task_registry.jsonl")
    if state.get("stage") in {"FIGURES", "FREEZE"} and not (root / "configs" / "figure_contract.json").is_file():
        warnings.append("缺少 configs/figure_contract.json；图表 QA 无法启动")
    payload = {"status": "failed" if errors else "ready_with_warnings" if warnings else "ready", "project": str(root), "stage": state.get("stage", manifest.get("current_stage")), "errors": errors, "warnings": warnings}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
