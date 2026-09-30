#!/usr/bin/env python3
"""Validate the behavior-evaluation case schema."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate behavior evaluation cases")
    parser.add_argument("cases", type=Path, default=Path(__file__).with_name("cases.json"), nargs="?")
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    errors = []
    ids = set()
    for index, case in enumerate(cases, start=1):
        for field in ("id", "prompt", "expected_invariants", "failure_modes"):
            if field not in case:
                errors.append(f"第 {index} 个场景缺少 {field}")
        if case.get("id") in ids:
            errors.append(f"场景 ID 重复: {case.get('id')}")
        ids.add(case.get("id"))
    result = {"status": "success" if not errors and cases else "failed", "cases": len(cases), "errors": errors}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
