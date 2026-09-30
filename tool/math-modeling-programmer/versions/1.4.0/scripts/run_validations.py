#!/usr/bin/env python3
"""Run declarative validation checks and write a machine-readable report."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validation_plugins import run_check  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run modeling validation plugins")
    parser.add_argument("config", type=Path)
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("reports/validation.json"))
    args = parser.parse_args()
    root = args.project.resolve()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    checks = [run_check(root, item) for item in config.get("checks", [])]
    payload = {
        "validation_id": config.get("validation_id", "VAL-001"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if checks and all(item.status == "PASS" for item in checks) else "FAIL",
        "checks": [item.as_dict() for item in checks],
    }
    output = args.output if args.output.is_absolute() else root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"].lower(), "validation_id": payload["validation_id"], "output": str(output)}, ensure_ascii=False))
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
