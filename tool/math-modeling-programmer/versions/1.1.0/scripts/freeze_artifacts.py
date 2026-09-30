#!/usr/bin/env python3
"""Create a portable SHA-256 manifest for a project delivery directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a portable SHA-256 artifact manifest")
    parser.add_argument("project", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--exclude", action="append", default=[".git", "__pycache__", "manifest.sha256", "*.pyc"])
    args = parser.parse_args()
    root = args.project.resolve()
    if not root.is_dir():
        parser.error(f"找不到项目目录: {root}")
    output = args.output or root / "results" / "manifest.sha256"
    output = output if output.is_absolute() else root / output
    output = output.resolve()
    if root not in output.parents:
        parser.error("manifest 必须写入项目目录内")
    output.parent.mkdir(parents=True, exist_ok=True)
    reproduce = root / "results" / "reproduce.md"
    reproduce.write_text("# 复现说明\n\n项目根目录为当前目录。请先阅读 README.md，再使用项目配置运行主入口。\n\n" +
                         "```text\n" + "python -m pip install -r requirements.txt  # 若项目提供该文件\n" +
                         "python src/main.py\n" + "```\n", encoding="utf-8")
    excluded = set(args.exclude)
    files: list[dict[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.resolve() == output:
            continue
        relative = path.relative_to(root)
        if any(part in excluded for part in relative.parts) or any(relative.match(pattern) for pattern in excluded if "*" in pattern):
            continue
        files.append({"path": relative.as_posix(), "sha256": digest(path)})

    payload = {
        "manifest_version": "1.0",
        "root": ".",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": {"python": sys.version.split()[0], "platform": platform.platform()},
        "files": files,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "success", "files": len(files), "manifest": str(output), "reproduce": str(reproduce)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
