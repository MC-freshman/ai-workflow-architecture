#!/usr/bin/env python3
"""Validate the human-readable result registry and its evidence paths."""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path


REQUIRED = {
    "problem_id",
    "experiment_id",
    "claim",
    "value",
    "unit",
    "method",
    "parameter_source",
    "uncertainty",
    "evidence",
    "code_module",
    "status",
}
VALID_STATUS = {"DRAFT", "CHECKED", "FROZEN", "BLOCKED"}


def value_is_numeric(value: str) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate result_registry.csv")
    parser.add_argument("registry", type=Path)
    parser.add_argument("--project", type=Path, default=None)
    args = parser.parse_args()
    if not args.registry.is_file():
        parser.error(f"找不到结果登记表: {args.registry}")
    registry = args.registry.resolve()
    root = (args.project or (registry.parent.parent if registry.parent.name == "results" else registry.parent)).resolve()

    errors: list[str] = []
    warnings: list[str] = []
    with registry.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        missing_fields = REQUIRED - fields
        if missing_fields:
            errors.append(f"缺少字段: {', '.join(sorted(missing_fields))}")
        seen: set[tuple[str, str, str]] = set()
        rows = 0
        for line_number, row in enumerate(reader, start=2):
            rows += 1
            key = (row.get("problem_id", ""), row.get("experiment_id", ""), row.get("claim", ""))
            if key in seen:
                errors.append(f"第 {line_number} 行与此前记录重复: {key}")
            seen.add(key)
            status = row.get("status", "").strip().upper()
            if status not in VALID_STATUS:
                errors.append(f"第 {line_number} 行状态无效: {status!r}")
            if status in {"CHECKED", "FROZEN"} and not value_is_numeric(row.get("value", "")):
                warnings.append(f"第 {line_number} 行 value 不是标量数字，请确认是否为向量/表格结果")
            if status == "FROZEN":
                if not row.get("value", "").strip() or not row.get("evidence", "").strip():
                    errors.append(f"第 {line_number} 行冻结记录缺少 value 或 evidence")
                for evidence in row.get("evidence", "").split(";"):
                    if evidence.strip() and not (root / evidence.strip()).is_file():
                        errors.append(f"第 {line_number} 行 evidence 不存在: {evidence.strip()}")
            if status in {"CHECKED", "FROZEN"} and not row.get("uncertainty", "").strip():
                warnings.append(f"第 {line_number} 行没有填写 uncertainty")

    result = {"status": "failed" if errors else "success", "rows": rows, "errors": errors, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
