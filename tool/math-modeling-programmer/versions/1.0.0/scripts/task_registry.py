"""Shared task execution and review registry helpers."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Iterable


REGISTRY_FIELDS = [
    "record_type",
    "task_id",
    "run_id",
    "kind",
    "title",
    "status",
    "review_status",
    "manifest_id",
    "experiment_id",
    "fingerprint",
    "inputs",
    "outputs",
    "output_hashes",
    "acceptance",
    "claim",
    "paper_candidate",
    "message",
    "notes",
    "created_at",
]


def registry_paths(root: Path, jsonl: str = "tasks/task_registry.jsonl", csv_path: str = "tasks/task_registry.csv") -> tuple[Path, Path]:
    """Return project-local registry paths."""
    return root / jsonl, root / csv_path


def _csv_row(record: dict[str, Any]) -> dict[str, str]:
    row: dict[str, str] = {}
    for field in REGISTRY_FIELDS:
        value = record.get(field, "")
        if isinstance(value, (dict, list)):
            row[field] = json.dumps(value, ensure_ascii=False, sort_keys=True)
        elif value is None:
            row[field] = ""
        else:
            row[field] = str(value)
    return row


def append_record(root: Path, record: dict[str, Any], jsonl: str = "tasks/task_registry.jsonl", csv_path: str = "tasks/task_registry.csv") -> None:
    """Append one event to both the machine-readable and spreadsheet registries."""
    jsonl_path, csv_file = registry_paths(root, jsonl, csv_path)
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    csv_file.parent.mkdir(parents=True, exist_ok=True)
    with jsonl_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    existing: list[dict[str, str]] = []
    if csv_file.is_file():
        with csv_file.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    with csv_file.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REGISTRY_FIELDS)
        writer.writeheader()
        writer.writerows(existing + [_csv_row(record)])


def read_records(root: Path, jsonl: str = "tasks/task_registry.jsonl") -> list[dict[str, Any]]:
    """Read valid JSONL records, ignoring blank lines but surfacing malformed rows."""
    path = root / jsonl
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"任务登记表第 {line_number} 行 JSON 无效: {exc}") from exc
            if isinstance(payload, dict):
                records.append(payload)
    return records


def latest_records(records: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return the latest event for each task in append order."""
    latest: dict[str, dict[str, Any]] = {}
    for record in records:
        task_id = str(record.get("task_id", ""))
        if task_id:
            latest[task_id] = record
    return latest
