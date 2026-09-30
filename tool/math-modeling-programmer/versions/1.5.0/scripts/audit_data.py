#!/usr/bin/env python3
"""Audit CSV/TSV/JSON inputs without modifying source files."""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return isinstance(value, float) and math.isnan(value)


def _numeric(value: Any) -> float | None:
    if _is_missing(value):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def audit_rows(rows: list[dict[str, Any]], source: str) -> dict[str, Any]:
    columns = list(rows[0].keys()) if rows else []
    column_report: dict[str, Any] = {}
    for column in columns:
        values = [row.get(column) for row in rows]
        non_missing = [value for value in values if not _is_missing(value)]
        numeric = [_numeric(value) for value in non_missing]
        numeric = [value for value in numeric if value is not None]
        report: dict[str, Any] = {
            "missing": len(values) - len(non_missing),
            "unique": len({str(value) for value in non_missing}),
            "sample": [str(value) for value in non_missing[:5]],
        }
        if numeric and len(numeric) == len(non_missing):
            report["inferred_type"] = "numeric"
            report["min"] = min(numeric)
            report["max"] = max(numeric)
        else:
            report["inferred_type"] = "text"
        column_report[column] = report

    serialised = [json.dumps(row, ensure_ascii=False, sort_keys=True, default=str) for row in rows]
    duplicate_count = len(serialised) - len(set(serialised))
    return {
        "source": source,
        "rows": len(rows),
        "columns": len(columns),
        "column_names": columns,
        "duplicate_rows": duplicate_count,
        "columns_report": column_report,
        "sample_rows": rows[:5],
    }


def read_input(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle, delimiter=delimiter)]
    if suffix == ".json":
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list) and all(isinstance(item, dict) for item in payload):
            return payload
        if isinstance(payload, dict):
            return [{"key": key, "value": value} for key, value in payload.items()]
        raise ValueError("JSON 顶层必须是对象或对象数组")
    raise ValueError(f"暂不支持 {suffix}；请先导出为 CSV、TSV 或 JSON")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a modeling data file")
    parser.add_argument("input", type=Path, help="CSV/TSV/JSON input")
    parser.add_argument("--output-dir", type=Path, default=Path("reports"))
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"找不到输入文件: {args.input}")
    try:
        rows = read_input(args.input)
        result = audit_rows(rows, str(args.input))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}")
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = args.input.stem
    json_path = args.output_dir / f"{stem}_audit.json"
    md_path = args.output_dir / f"{stem}_audit.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# 数据审计：{args.input.name}",
        "",
        f"- 行数：{result['rows']}",
        f"- 列数：{result['columns']}",
        f"- 重复行：{result['duplicate_rows']}",
        "",
        "## 字段摘要",
        "",
        "| 字段 | 类型 | 缺失 | 唯一值 | 范围/样例 |",
        "|---|---|---:|---:|---|",
    ]
    for name, column in result["columns_report"].items():
        span = f"{column['min']} ~ {column['max']}" if column["inferred_type"] == "numeric" else ", ".join(column["sample"])
        lines.append(f"| {name} | {column['inferred_type']} | {column['missing']} | {column['unique']} | {span} |")
    lines += ["", "## 待确认事项", "", "- 字段语义、单位、主键和异常值处理规则需由建模手确认。"]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "success", "json": str(json_path), "report": str(md_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
