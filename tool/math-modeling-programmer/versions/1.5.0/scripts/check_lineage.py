#!/usr/bin/env python3
"""Check that registered lineage files still exist and match recorded hashes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lineage import sha256_file  # noqa: E402


def check_group(root: Path, mapping: dict[str, str], label: str, errors: list[str]) -> None:
    for relative, expected in mapping.items():
        path = (root / relative).resolve()
        if not path.is_file() or root.resolve() not in path.parents:
            errors.append(f"{label}: 文件不存在 {relative}")
        elif sha256_file(path) != expected:
            errors.append(f"{label}: 哈希已变化 {relative}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check result lineage")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--registry", default="results/result_registry.jsonl")
    args = parser.parse_args()
    root = args.project.resolve()
    registry = root / args.registry
    errors: list[str] = []
    records = 0
    if not registry.is_file():
        print(json.dumps({"status": "failed", "errors": [f"找不到登记表 {args.registry}"]}, ensure_ascii=False))
        return 2
    with registry.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            records += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"第 {line_number} 行 JSON 无效: {exc}")
                continue
            check_group(root, record.get("input_hashes", {}), f"{record.get('result_id', line_number)} inputs", errors)
            check_group(root, record.get("config_hashes", {}), f"{record.get('result_id', line_number)} config", errors)
            check_group(root, record.get("code_hashes", {}), f"{record.get('result_id', line_number)} code", errors)
            for evidence in record.get("evidence", []):
                path = (root / evidence).resolve()
                if not path.is_file() or root.resolve() not in path.parents:
                    errors.append(f"{record.get('result_id', line_number)} evidence: 文件不存在 {evidence}")
    result = {"status": "failed" if errors else "success", "records": records, "errors": errors}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
