#!/usr/bin/env python3
"""Suggest pattern adapters without selecting a model automatically."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from adapters.registry import ADAPTERS, suggest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Suggest modeling problem adapters")
    parser.add_argument("description", nargs="+", help="题目或数据的简短描述")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    matches = list(ADAPTERS) if args.all else suggest(" ".join(args.description))
    print(json.dumps({"status": "success", "matches": [item.as_dict() for item in matches], "note": "适配器是参考和检查清单，不是模型选择结果"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
