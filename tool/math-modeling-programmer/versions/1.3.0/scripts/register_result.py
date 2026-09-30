#!/usr/bin/env python3
"""Register a result with source-file hashes in JSONL and CSV ledgers."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lineage import sha256_paths  # noqa: E402


FIELDS = ["problem_id", "experiment_id", "claim", "value", "unit", "method", "parameter_source", "uncertainty", "evidence", "code_module", "status", "notes"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Register a traceable result")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--problem-id", required=True)
    parser.add_argument("--experiment-id", required=True)
    parser.add_argument("--claim", required=True)
    parser.add_argument("--value", required=True)
    parser.add_argument("--unit", default="")
    parser.add_argument("--method", default="")
    parser.add_argument("--parameter-source", default="")
    parser.add_argument("--uncertainty", default="")
    parser.add_argument("--evidence", nargs="*", default=[])
    parser.add_argument("--code-module", nargs="*", default=[])
    parser.add_argument("--input", nargs="*", default=[])
    parser.add_argument("--config", nargs="*", default=[])
    parser.add_argument("--status", choices=["DRAFT", "CHECKED", "FROZEN", "BLOCKED"], default="DRAFT")
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    root = args.project.resolve()
    try:
        input_hashes = sha256_paths(root, args.input)
        config_hashes = sha256_paths(root, args.config)
        code_hashes = sha256_paths(root, args.code_module)
    except FileNotFoundError as exc:
        print(json.dumps({"status": "failed", "error": f"找不到血缘文件: {exc}"}, ensure_ascii=False))
        return 2
    evidence = [item.replace("\\", "/") for item in args.evidence]
    record = {
        "result_id": f"{args.experiment_id}-{args.problem_id}",
        "problem_id": args.problem_id,
        "experiment_id": args.experiment_id,
        "claim": args.claim,
        "value": args.value,
        "unit": args.unit,
        "method": args.method,
        "parameter_source": args.parameter_source,
        "uncertainty": args.uncertainty,
        "evidence": evidence,
        "code_module": [item.replace("\\", "/") for item in args.code_module],
        "input_hashes": input_hashes,
        "config_hashes": config_hashes,
        "code_hashes": code_hashes,
        "status": args.status,
        "notes": args.notes,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    result_dir = root / "results"
    result_dir.mkdir(parents=True, exist_ok=True)
    jsonl = result_dir / "result_registry.jsonl"
    with jsonl.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    csv_path = result_dir / "result_registry.csv"
    existing = []
    if csv_path.is_file():
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    row = {field: record.get(field, "") for field in FIELDS}
    row["evidence"] = ";".join(evidence)
    existing.append(row)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(existing)
    print(json.dumps({"status": "success", "result": record["result_id"], "jsonl": str(jsonl), "csv": str(csv_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
