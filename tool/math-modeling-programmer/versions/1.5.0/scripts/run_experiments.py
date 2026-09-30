#!/usr/bin/env python3
"""Run local experiments with reproducibility metadata and safe project paths."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if root.resolve() not in path.parents and path != root.resolve():
        raise ValueError(f"路径必须位于项目目录内: {relative}")
    return path


def file_hashes(root: Path, values: list[str]) -> dict[str, str]:
    output = {}
    for value in values:
        path = inside(root, value)
        if not path.is_file():
            raise FileNotFoundError(value)
        output[value.replace("\\", "/")] = sha256(path)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Run configured modeling experiments")
    parser.add_argument("config", type=Path, help="JSON experiment config")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--output-dir", type=Path, default=Path("experiments"))
    parser.add_argument("--timeout", type=float, default=3600)
    args = parser.parse_args()
    root = args.project.resolve()
    config_path = args.config.resolve()
    if root not in config_path.parents and config_path != root:
        parser.error("配置文件必须位于项目目录内")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        parser.error(f"配置文件无效: {exc}")
    entrypoint = str(config.get("entrypoint", ""))
    if not entrypoint:
        parser.error("配置必须包含 entrypoint")
    entrypoint_path = inside(root, entrypoint)
    if not entrypoint_path.is_file():
        parser.error(f"找不到 entrypoint: {entrypoint}")
    base_args = [str(item) for item in config.get("base_args", [])]
    runs = config.get("runs", [])
    if not isinstance(runs, list) or not runs:
        parser.error("runs 必须是非空数组")
    try:
        input_hashes = file_hashes(root, [str(item) for item in config.get("input_files", [])])
    except (ValueError, FileNotFoundError) as exc:
        parser.error(f"输入文件无效: {exc}")
    output_root = inside(root, str(args.output_dir))
    output_root.mkdir(parents=True, exist_ok=True)
    summaries = []
    for index, run in enumerate(runs, start=1):
        run_id = str(run.get("id") or f"EXP-{index:03d}")
        run_dir = inside(root, str(Path(args.output_dir) / run_id))
        if run_dir.exists() and any(run_dir.iterdir()):
            summaries.append({"experiment_id": run_id, "status": "SKIPPED", "reason": "实验目录已有文件"})
            continue
        run_dir.mkdir(parents=True, exist_ok=True)
        command = [sys.executable, str(entrypoint_path)] if entrypoint_path.suffix.lower() == ".py" else [str(entrypoint_path)]
        command += base_args + [str(item) for item in run.get("args", [])]
        seed = run.get("seed")
        seed_arg = run.get("seed_arg", config.get("seed_arg"))
        if seed is not None and seed_arg:
            command += [str(seed_arg), str(seed)]
        environment = os.environ.copy()
        if seed is not None:
            environment["MODEL_SEED"] = str(seed)
            environment["PYTHONHASHSEED"] = str(seed)
        metadata = {
            "experiment_id": run_id,
            "command": command,
            "seed": seed,
            "config_path": config_path.relative_to(root).as_posix(),
            "config_hash": sha256(config_path),
            "entrypoint": entrypoint.replace("\\", "/"),
            "entrypoint_hash": sha256(entrypoint_path),
            "input_hashes": input_hashes,
            "environment": {"python": sys.version.split()[0], "platform": platform.platform()},
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "RUNNING",
        }
        started = time.perf_counter()
        try:
            completed = subprocess.run(command, cwd=root, env=environment, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       check=False, timeout=args.timeout)
            metadata.update({"status": "PASS" if completed.returncode == 0 else "FAIL", "returncode": completed.returncode})
        except subprocess.TimeoutExpired as exc:
            completed = None
            metadata.update({"status": "TIMEOUT", "returncode": None, "timeout_seconds": args.timeout})
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
        else:
            stdout = completed.stdout
            stderr = completed.stderr
        metadata.update({"runtime_seconds": round(time.perf_counter() - started, 6),
                         "finished_at": datetime.now(timezone.utc).isoformat()})
        (run_dir / "stdout.log").write_text(stdout, encoding="utf-8")
        (run_dir / "stderr.log").write_text(stderr, encoding="utf-8")
        metadata["output_files"] = [path.relative_to(root).as_posix() for path in run_dir.rglob("*") if path.is_file()]
        (run_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summaries.append(metadata)

    failed = sum(item["status"] in {"FAIL", "TIMEOUT"} for item in summaries)
    payload = {"status": "failed" if failed else "success", "runs": summaries}
    (output_root / "last_run.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
