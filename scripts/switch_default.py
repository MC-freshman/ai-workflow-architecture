"""Validate a candidate release, then atomically switch one current.json pointer."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from reference.adapter import AdapterError, exact_release, registry_entry


def switch_default(repository: Path, mode: str, resource_id: str, version: str) -> Path:
    exact_release(repository, mode, resource_id, version)
    root, entry = registry_entry(repository, mode, resource_id)
    pointer = root / entry["current"]
    payload = {"schema": "ai-current-pointer/v1", "version": version}
    pointer.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=pointer.parent, prefix=".current-", suffix=".json", delete=False
    ) as stream:
        stream.write(json.dumps(payload, indent=2) + "\n")
        temporary = Path(stream.name)
    try:
        os.replace(temporary, pointer)
    finally:
        temporary.unlink(missing_ok=True)
    return pointer


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("wf", "wfa"))
    parser.add_argument("resource_id")
    parser.add_argument("version")
    parser.add_argument("--repository", type=Path, default=Path("examples/repository"))
    args = parser.parse_args()
    try:
        pointer = switch_default(args.repository.resolve(), args.mode, args.resource_id, args.version)
    except AdapterError as exc:
        parser.error(str(exc))
    print(json.dumps({"ok": True, "pointer": str(pointer), "version": args.version}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
