#!/usr/bin/env python3
"""Record human review decisions for task outputs."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from task_registry import append_record, latest_records, read_records  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Review a completed modeling task")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--decision", required=True, choices=["ACCEPTED", "REWORK", "BLOCKED"])
    parser.add_argument("--notes", default="")
    parser.add_argument("--registry", default="tasks/task_registry.jsonl")
    args = parser.parse_args()
    root = args.project.resolve()
    try:
        latest = latest_records(read_records(root, args.registry))
    except ValueError as exc:
        parser.error(str(exc))
    previous = latest.get(args.task_id)
    if previous is None:
        parser.error(f"任务尚未执行，找不到 task_id: {args.task_id}")
    record = dict(previous)
    record.update({
        "record_type": "review",
        "review_status": args.decision,
        "notes": args.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    append_record(root, record, args.registry)
    print(json.dumps({"status": "success", "task_id": args.task_id, "decision": args.decision}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
