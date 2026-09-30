#!/usr/bin/env python3
"""Record runtime and optional package information for reproducibility."""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Record the local modeling environment")
    parser.add_argument("--output", type=Path, default=Path("reports/environment.json"))
    parser.add_argument("--project", type=Path, default=Path("."))
    args = parser.parse_args()
    package_output = ""
    try:
        completed = subprocess.run([sys.executable, "-m", "pip", "freeze"], text=True, capture_output=True, timeout=30, check=False)
        package_output = completed.stdout if completed.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        package_output = ""
    payload = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "implementation": platform.python_implementation(),
        "machine": platform.machine(),
        "executable": sys.executable,
        "packages": [line for line in package_output.splitlines() if line.strip()],
        "package_capture": "pip freeze" if package_output else "NOT_AVAILABLE",
    }
    output = args.output if args.output.is_absolute() else args.project / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "success", "output": str(output), "package_count": len(payload["packages"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
