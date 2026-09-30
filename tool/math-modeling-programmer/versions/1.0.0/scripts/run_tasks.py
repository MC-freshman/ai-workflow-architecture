#!/usr/bin/env python3
"""Run a dependency-aware batch of small modeling tasks.

The runner deliberately treats the task manifest as JSON so it can run in a
clean contest environment without requiring a YAML parser. Task entrypoints
receive context through environment variables and remain responsible for the
actual modeling logic.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from task_registry import append_record, latest_records, read_records  # noqa: E402


EXECUTION_STATUSES = {"PASS", "FAIL", "BLOCKED", "CACHED"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    root_resolved = root.resolve()
    if path != root_resolved and root_resolved not in path.parents:
        raise ValueError(f"路径必须位于项目目录内: {relative}")
    return path


def file_hashes(root: Path, paths: list[str]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for value in paths:
        path = inside(root, value)
        if not path.is_file():
            raise FileNotFoundError(value)
        hashes[value.replace("\\", "/")] = sha256(path)
    return hashes


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)


def load_manifest(root: Path, path: Path) -> dict[str, Any]:
    if root.resolve() not in path.resolve().parents and path.resolve() != root.resolve():
        raise ValueError("任务清单必须位于项目目录内")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("任务清单顶层必须是对象")
    tasks = payload.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("tasks 必须是非空数组")
    task_ids = [str(task.get("task_id", "")) for task in tasks if isinstance(task, dict)]
    if len(task_ids) != len(set(task_ids)) or any(not task_id for task_id in task_ids):
        raise ValueError("task_id 必须非空且唯一")
    task_map = {str(task["task_id"]): task for task in tasks}
    for task_id, task in task_map.items():
        dependencies = task.get("dependencies", [])
        if not isinstance(dependencies, list):
            raise ValueError(f"{task_id}: dependencies 必须是数组")
        missing = [str(item) for item in dependencies if str(item) not in task_map]
        if missing:
            raise ValueError(f"{task_id}: 依赖任务不存在: {', '.join(missing)}")
        if not task.get("kind") or not task.get("title"):
            raise ValueError(f"{task_id}: kind 和 title 不能为空")
        if not isinstance(task.get("args", []), list):
            raise ValueError(f"{task_id}: args 必须是数组")
        outputs = task.get("outputs", [])
        if not isinstance(outputs, list) or not outputs:
            raise ValueError(f"{task_id}: outputs 必须是非空数组")
        for output in outputs:
            inside(root, str(output))
    return payload


def dependency_order(tasks: dict[str, dict[str, Any]], selected: set[str]) -> list[str]:
    order: list[str] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visited:
            return
        if task_id in visiting:
            raise ValueError(f"任务依赖存在循环: {task_id}")
        visiting.add(task_id)
        for dependency in tasks[task_id].get("dependencies", []):
            visit(str(dependency))
        visiting.remove(task_id)
        visited.add(task_id)
        order.append(task_id)

    for task_id in sorted(selected):
        visit(task_id)
    return order


def select_tasks(tasks: dict[str, dict[str, Any]], requested: list[str]) -> set[str]:
    if not requested:
        return set(tasks)
    unknown = [task_id for task_id in requested if task_id not in tasks]
    if unknown:
        raise ValueError(f"找不到任务: {', '.join(unknown)}")
    selected = set(requested)
    changed = True
    while changed:
        changed = False
        for task_id in list(selected):
            for dependency in tasks[task_id].get("dependencies", []):
                dependency = str(dependency)
                if dependency not in selected:
                    selected.add(dependency)
                    changed = True
    return selected


def task_inputs(manifest: dict[str, Any], task: dict[str, Any]) -> list[str]:
    values = [str(item) for item in manifest.get("shared_inputs", [])]
    values.extend(str(item) for item in task.get("inputs", []))
    return list(dict.fromkeys(values))


def task_fingerprint(manifest: dict[str, Any], task: dict[str, Any], input_hashes: dict[str, str], entrypoint_hash: str, mode: str) -> str:
    payload = {
        "manifest_id": manifest.get("manifest_id", ""),
        "task": task,
        "input_hashes": input_hashes,
        "entrypoint_hash": entrypoint_hash,
        "mode": mode,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def outputs_exist(root: Path, outputs: list[str]) -> bool:
    return all(inside(root, output).is_file() for output in outputs)


def output_hashes(root: Path, outputs: list[str]) -> dict[str, str]:
    return {output.replace("\\", "/"): sha256(inside(root, output)) for output in outputs if inside(root, output).is_file()}


def command_for(root: Path, entrypoint: Path, args: list[Any]) -> list[str]:
    command = [sys.executable, str(entrypoint)] if entrypoint.suffix.lower() == ".py" else [str(entrypoint)]
    return command + [str(item) for item in args]


def make_record(task: dict[str, Any], manifest: dict[str, Any], run_id: str, status: str, **extra: Any) -> dict[str, Any]:
    record = {
        "record_type": "execution",
        "task_id": str(task["task_id"]),
        "run_id": run_id,
        "kind": str(task.get("kind", "")),
        "title": str(task.get("title", "")),
        "status": status,
        "review_status": "PENDING",
        "manifest_id": str(manifest.get("manifest_id", "")),
        "experiment_id": str(task.get("experiment_id", "")),
        "fingerprint": extra.pop("fingerprint", ""),
        "inputs": extra.pop("inputs", []),
        "outputs": extra.pop("outputs", []),
        "output_hashes": extra.pop("output_hashes", {}),
        "acceptance": task.get("acceptance", []),
        "claim": str(task.get("claim", "")),
        "paper_candidate": bool(task.get("paper_candidate", False)),
        "message": extra.pop("message", ""),
        "notes": extra.pop("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    record.update(extra)
    return record


def status_payload(root: Path, registry: str) -> dict[str, Any]:
    records = read_records(root, registry)
    latest = latest_records(records)
    items = [latest[key] for key in sorted(latest)]
    counts: dict[str, int] = {}
    for item in items:
        review_status = str(item.get("review_status") or "")
        value = review_status if review_status and review_status != "PENDING" else str(item.get("status") or "UNKNOWN")
        counts[value] = counts.get(value, 0) + 1
    return {"status": "success", "tasks": items, "counts": counts, "records": len(records)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a dependency-aware batch of modeling tasks")
    parser.add_argument("manifest", type=Path, help="JSON task manifest")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--mode", choices=["quick", "official", "debug"], default="quick")
    parser.add_argument("--task", action="append", default=[], help="只运行指定任务及其依赖，可重复使用")
    parser.add_argument("--timeout", type=float, default=3600)
    parser.add_argument("--no-cache", action="store_true", help="忽略相同指纹的既有成功结果")
    parser.add_argument("--stop-on-error", action="store_true")
    parser.add_argument("--status", action="store_true", help="显示任务登记表中每个任务的最新状态")
    parser.add_argument("--registry", default="tasks/task_registry.jsonl")
    args = parser.parse_args()
    root = args.project.resolve()

    try:
        if args.status:
            print(json.dumps(status_payload(root, args.registry), ensure_ascii=False, indent=2))
            return 0
        manifest_path = args.manifest.resolve()
        manifest = load_manifest(root, manifest_path)
        entrypoint = inside(root, str(manifest.get("entrypoint", "")))
        if not entrypoint.is_file():
            raise FileNotFoundError(f"entrypoint: {manifest.get('entrypoint')}")
        task_map = {str(task["task_id"]): task for task in manifest["tasks"]}
        selected = select_tasks(task_map, [str(item) for item in args.task])
        order = dependency_order(task_map, selected)
        shared_input_hashes = file_hashes(root, [str(item) for item in manifest.get("shared_inputs", [])])
        entrypoint_hash = sha256(entrypoint)
        previous = latest_records(read_records(root, args.registry))
    except (OSError, ValueError, json.JSONDecodeError, KeyError) as exc:
        parser.error(str(exc))

    output_root = inside(root, str(manifest.get("output_root", "experiments/tasks")))
    output_root.mkdir(parents=True, exist_ok=True)
    run_stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    statuses: dict[str, str] = {}
    summaries: list[dict[str, Any]] = []
    aborted = False

    for index, task_id in enumerate(order, start=1):
        task = task_map[task_id]
        run_id = f"{safe_id(task_id)}-{run_stamp}-{index:03d}"
        dependencies = [str(item) for item in task.get("dependencies", [])]
        if aborted or any(statuses.get(dependency) in {"FAIL", "BLOCKED"} for dependency in dependencies):
            record = make_record(task, manifest, run_id, "BLOCKED", message="依赖任务失败或批次已停止", inputs=task_inputs(manifest, task), outputs=task.get("outputs", []))
            append_record(root, record, args.registry)
            statuses[task_id] = "BLOCKED"
            summaries.append(record)
            continue

        inputs = task_inputs(manifest, task)
        try:
            input_hash_map = dict(shared_input_hashes)
            input_hash_map.update(file_hashes(root, [str(item) for item in task.get("inputs", [])]))
        except (OSError, ValueError, FileNotFoundError) as exc:
            record = make_record(task, manifest, run_id, "FAIL", message=f"输入文件无效: {exc}", inputs=inputs, outputs=task.get("outputs", []))
            append_record(root, record, args.registry)
            statuses[task_id] = "FAIL"
            summaries.append(record)
            aborted = aborted or args.stop_on_error
            continue

        fingerprint = task_fingerprint(manifest, task, input_hash_map, entrypoint_hash, args.mode)
        old = previous.get(task_id, {})
        declared_outputs = [str(item) for item in task.get("outputs", [])]
        if not args.no_cache and old.get("fingerprint") == fingerprint and old.get("status") in {"PASS", "CACHED"} and outputs_exist(root, declared_outputs):
            record = make_record(task, manifest, run_id, "CACHED", fingerprint=fingerprint, inputs=inputs, outputs=declared_outputs,
                                 output_hashes=output_hashes(root, declared_outputs), message="复用相同输入、代码和参数的既有结果", cached_from=old.get("run_id", ""))
            append_record(root, record, args.registry)
            statuses[task_id] = "CACHED"
            summaries.append(record)
            previous[task_id] = record
            continue

        task_dir = output_root / safe_id(task_id) / run_id
        task_dir.mkdir(parents=True, exist_ok=True)
        command = command_for(root, entrypoint, list(manifest.get("base_args", [])) + list(task.get("args", [])))
        environment = os.environ.copy()
        environment.update({
            "TASK_ID": task_id,
            "TASK_RUN_ID": run_id,
            "TASK_KIND": str(task.get("kind", "")),
            "TASK_TITLE": str(task.get("title", "")),
            "TASK_MODE": args.mode,
            "TASK_OUTPUT_DIR": str(task_dir),
            "TASK_MANIFEST": str(manifest_path),
            "TASK_INPUT_HASHES": json.dumps(input_hash_map, ensure_ascii=False, sort_keys=True),
        })
        if task.get("seed") is not None:
            environment["MODEL_SEED"] = str(task["seed"])
            environment["PYTHONHASHSEED"] = str(task["seed"])

        started = time.perf_counter()
        status = "PASS"
        message = "任务执行成功"
        returncode: int | None = None
        stdout = ""
        stderr = ""
        try:
            completed = subprocess.run(command, cwd=root, env=environment, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       check=False, timeout=args.timeout)
            returncode = completed.returncode
            stdout = completed.stdout
            stderr = completed.stderr
            if returncode != 0:
                status = "FAIL"
                message = f"任务退出码为 {returncode}"
            elif not outputs_exist(root, declared_outputs):
                status = "FAIL"
                missing = [output for output in declared_outputs if not inside(root, output).is_file()]
                message = f"任务未生成声明的产物: {', '.join(missing)}"
        except subprocess.TimeoutExpired as exc:
            status = "FAIL"
            message = f"任务超时（{args.timeout:g} 秒）"
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
        except OSError as exc:
            status = "FAIL"
            message = f"启动任务失败: {exc}"
        runtime = round(time.perf_counter() - started, 6)
        (task_dir / "stdout.log").write_text(stdout or "", encoding="utf-8")
        (task_dir / "stderr.log").write_text(stderr or "", encoding="utf-8")
        record = make_record(task, manifest, run_id, status, fingerprint=fingerprint, inputs=inputs, outputs=declared_outputs,
                             output_hashes=output_hashes(root, declared_outputs), message=message, command=command,
                             returncode=returncode, runtime_seconds=runtime, task_output_dir=task_dir.relative_to(root).as_posix(),
                             environment={"python": sys.version.split()[0], "platform": platform.platform(), "mode": args.mode})
        (task_dir / "metadata.json").write_text(json.dumps(record, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
        append_record(root, record, args.registry)
        statuses[task_id] = status
        summaries.append(record)
        previous[task_id] = record
        if status == "FAIL" and (args.stop_on_error or not bool(manifest.get("continue_on_error", True))):
            aborted = True

    failed = sum(item["status"] == "FAIL" for item in summaries)
    blocked = sum(item["status"] == "BLOCKED" for item in summaries)
    payload = {"status": "failed" if failed or blocked else "success", "manifest_id": manifest.get("manifest_id", ""),
               "mode": args.mode, "tasks": summaries, "counts": {"PASS": sum(item["status"] == "PASS" for item in summaries),
               "CACHED": sum(item["status"] == "CACHED" for item in summaries), "FAIL": failed, "BLOCKED": blocked}}
    summary_path = output_root / "last_task_run.json"
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "manifest_id": payload["manifest_id"], "counts": payload["counts"], "summary": str(summary_path)}, ensure_ascii=False, indent=2))
    return 1 if payload["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
