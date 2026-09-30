#!/usr/bin/env python3
"""Create a reproducible modeling project skeleton without overwriting files."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path


STAGES = ["INIT", "AUDIT", "SPEC", "BASELINE", "SOLVE", "EXPERIMENT", "VALIDATE", "FIGURES", "FREEZE"]
DIRS = [
    "data/raw", "data/processed", "src", "configs", "experiments", "experiments/tasks",
    "results", "figures", "reports", "scripts", "tasks/inbox", "tasks/manifests", "tasks/accepted", "tasks/blocked",
]


def write_if_missing(path: Path, content: str, force: bool) -> bool:
    if path.exists() and not force:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize a modeling project")
    parser.add_argument("project", type=Path)
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--language", choices=["python", "matlab", "r", "mixed", "other"], default="python")
    parser.add_argument("--entrypoint", default="src/main.py")
    parser.add_argument("--force", action="store_true", help="only replace generated manifest files")
    args = parser.parse_args()
    root = args.project.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for relative in DIRS:
        (root / relative).mkdir(parents=True, exist_ok=True)

    project_id = args.project_id or root.name
    now = datetime.now(timezone.utc).isoformat()
    manifest = {
        "project_id": project_id,
        "language": args.language,
        "current_stage": "INIT",
        "raw_data_dir": "data/raw",
        "entrypoint": args.entrypoint,
        "created_at": now,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }
    state = {
        "project_id": project_id,
        "stage": "INIT",
        "status": "READY",
        "updated_at": now,
        "history": [{"stage": "INIT", "status": "READY", "at": now}],
        "missing_items": [],
        "block_reason": None,
    }
    registry_header = "problem_id,experiment_id,claim,value,unit,method,parameter_source,uncertainty,evidence,code_module,status,notes\n"
    created = []
    if write_if_missing(root / "project_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", args.force):
        created.append("project_manifest.json")
    if write_if_missing(root / "stage_state.json", json.dumps(state, ensure_ascii=False, indent=2) + "\n", args.force):
        created.append("stage_state.json")
    if write_if_missing(root / "results" / "result_registry.csv", registry_header, False):
        created.append("results/result_registry.csv")
    if write_if_missing(root / "results" / "result_registry.jsonl", "", False):
        created.append("results/result_registry.jsonl")
    task_registry_header = "record_type,task_id,run_id,kind,title,status,review_status,manifest_id,experiment_id,fingerprint,inputs,outputs,output_hashes,acceptance,claim,paper_candidate,message,notes,created_at\n"
    if write_if_missing(root / "tasks" / "task_registry.jsonl", "", False):
        created.append("tasks/task_registry.jsonl")
    if write_if_missing(root / "tasks" / "task_registry.csv", task_registry_header, False):
        created.append("tasks/task_registry.csv")
    template = Path(__file__).resolve().parents[1] / "templates" / "task_manifest.json"
    if template.is_file() and write_if_missing(root / "tasks" / "manifests" / "example.json", template.read_text(encoding="utf-8"), False):
        created.append("tasks/manifests/example.json")
    figure_contract = Path(__file__).resolve().parents[1] / "templates" / "figure_contract.json"
    if figure_contract.is_file() and write_if_missing(root / "configs" / "figure_contract.json", figure_contract.read_text(encoding="utf-8"), False):
        created.append("configs/figure_contract.json")
    for script_name in (
        "run_tasks.py", "review_task.py", "task_registry.py", "run_figure_qa.py",
        "record_visual_review.py", "visual_qa.py", "layout_tools.py",
        "figure_safety.py", "validate_figure.py", "audit_pdf_text.py",
        "audit_figure_collisions.py", "audit_panel_alignment.py",
    ):
        source = Path(__file__).resolve().parent / script_name
        target = root / "scripts" / script_name
        if source.is_file() and write_if_missing(target, source.read_text(encoding="utf-8"), False):
            created.append(f"scripts/{script_name}")
    usage = Path(__file__).resolve().parents[1] / "TASK_WORKFLOW_USAGE.md"
    if usage.is_file() and write_if_missing(root / "TASK_WORKFLOW_USAGE.md", usage.read_text(encoding="utf-8"), False):
        created.append("TASK_WORKFLOW_USAGE.md")
    team_usage = Path(__file__).resolve().parents[1] / "TEAM_HANDOFF_USAGE.md"
    if team_usage.is_file() and write_if_missing(root / "TEAM_HANDOFF_USAGE.md", team_usage.read_text(encoding="utf-8"), False):
        created.append("TEAM_HANDOFF_USAGE.md")
    readme = (
        f"# {project_id}\n\n运行入口：`{args.entrypoint}`\n\n当前阶段：INIT\n\n"
        "任务入口：`python scripts/run_tasks.py tasks/manifests/<manifest>.json --project . --mode quick`\n\n"
        "图表入口：`python scripts/run_figure_qa.py --project . --source figures/fig1.py "
        "--contract configs/figure_contract.json --output-dir figures/qa/FIG-1/01`\n"
    )
    if write_if_missing(root / "README.md", readme, False):
        created.append("README.md")

    print(json.dumps({"status": "success", "project": str(root), "created": created, "stage": "INIT"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
