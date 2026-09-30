#!/usr/bin/env python3
"""Register a paper figure and its source result IDs."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


FIELDS = ["figure_id", "claim", "path", "source_result_ids", "format", "dpi", "width_mm", "height_mm", "status", "notes"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Register a modeling figure")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--figure-id", required=True)
    parser.add_argument("--claim", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--source-result", action="append", default=[])
    parser.add_argument("--format", dest="file_format", default="")
    parser.add_argument("--dpi", default="")
    parser.add_argument("--width-mm", default="")
    parser.add_argument("--height-mm", default="")
    parser.add_argument("--status", choices=["DRAFT", "CHECKED", "FROZEN"], default="DRAFT")
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    root = args.project.resolve()
    figure_path = (root / args.path).resolve()
    if root not in figure_path.parents or not figure_path.is_file():
        parser.error("图表路径必须是项目内的现有文件")
    registry_path = root / "figures" / "figure_registry.csv"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    if registry_path.is_file():
        with registry_path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = [row for row in csv.DictReader(handle) if row.get("figure_id") != args.figure_id]
    row = {
        "figure_id": args.figure_id,
        "claim": args.claim,
        "path": figure_path.relative_to(root).as_posix(),
        "source_result_ids": ";".join(args.source_result),
        "format": args.file_format or figure_path.suffix.lower().lstrip("."),
        "dpi": args.dpi,
        "width_mm": args.width_mm,
        "height_mm": args.height_mm,
        "status": args.status,
        "notes": args.notes,
    }
    rows.append(row)
    with registry_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"registered {args.figure_id}: {registry_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
