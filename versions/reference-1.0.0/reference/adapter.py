"""Parse /wf and /wfa calls, resolve exact versions, and create isolated run locks."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid


SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")


class AdapterError(RuntimeError):
    """An invocation cannot be resolved safely."""


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AdapterError(f"cannot read valid JSON: {path}") from exc


def parse_message(message: str) -> tuple[str, str, str]:
    parts = message.strip().split(maxsplit=2)
    if len(parts) < 2 or parts[0] not in {"/wf", "/wfa"}:
        raise AdapterError("expected /wf <workflow-id> <task> or /wfa <agent-id> <task>")
    return parts[0][1:], parts[1], parts[2] if len(parts) == 3 else ""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_release(release: Path) -> None:
    sums = release / "SHA256SUMS"
    if not sums.is_file():
        raise AdapterError(f"missing release hashes: {sums}")
    for number, raw in enumerate(sums.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            expected, relative = raw.split(None, 1)
        except ValueError as exc:
            raise AdapterError(f"malformed SHA256SUMS line {number}: {sums}") from exc
        target = release / relative.strip().lstrip("*")
        if not target.is_file() or sha256(target) != expected.lower():
            raise AdapterError(f"release integrity failure: {target}")


def registry_entry(repository: Path, kind: str, resource_id: str) -> tuple[Path, dict]:
    root_name, key = ("tool", "workflows") if kind == "wf" else ("agent", "agents")
    root = repository / root_name
    registry = read_json(root / "registry.json")
    matches = [item for item in registry.get(key, []) if item.get("id") == resource_id and item.get("enabled")]
    if len(matches) != 1:
        raise AdapterError(f"enabled {kind} resource not found exactly once: {resource_id}")
    return root, matches[0]


def exact_release(repository: Path, kind: str, resource_id: str, version: str | None = None) -> tuple[Path, dict]:
    root, entry = registry_entry(repository, kind, resource_id)
    pointer_path = root / entry["current"]
    selected = version or read_json(pointer_path).get("version")
    if not isinstance(selected, str) or not SEMVER.fullmatch(selected):
        raise AdapterError(f"invalid selected version for {resource_id}: {selected}")
    resource_root = pointer_path.parent
    release = resource_root / "versions" / selected
    manifest = read_json(release / "manifest.json")
    expected_schema = "ai-workflow/v2.1" if kind == "wf" else "ai-agent/v2"
    if manifest.get("schema") != expected_schema or manifest.get("id") != resource_id or manifest.get("version") != selected:
        raise AdapterError(f"manifest identity mismatch: {release}")
    verify_release(release)
    return release, manifest


def prepare_run(message: str, repository: Path, runtime_root: Path) -> dict:
    mode, resource_id, task = parse_message(message)
    release, manifest = exact_release(repository, mode, resource_id)
    workflow = None
    if mode == "wfa":
        lock = read_json(release / manifest["toolLock"])
        requested = lock.get("workflow", {})
        workflow_release, workflow_manifest = exact_release(
            repository, "wf", requested.get("id", ""), requested.get("version")
        )
        workflow = {
            "id": workflow_manifest["id"],
            "version": workflow_manifest["version"],
            "source": workflow_release.relative_to(repository).as_posix(),
        }
    now = datetime.now(timezone.utc)
    run_id = now.strftime("%Y%m%dT%H%M%S.%fZ-") + uuid.uuid4().hex[:12]
    run_dir = runtime_root / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    lock = {
        "schema": "ai-run-lock/v1",
        "architectureVersion": "1.0.0",
        "runId": run_id,
        "mode": mode,
        "resource": {
            "id": manifest["id"],
            "version": manifest["version"],
            "source": release.relative_to(repository).as_posix(),
        },
        "workflow": workflow,
        "status": "prepared",
        "resolvedAt": now.isoformat(),
    }
    (run_dir / "request.json").write_text(
        json.dumps({"message": message, "task": task}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_dir / "run-lock.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return {"runDir": str(run_dir), "lock": lock}


def complete_run(run_dir: Path, result: str) -> dict:
    lock_path = run_dir / "run-lock.json"
    lock = read_json(lock_path)
    if lock.get("status") != "prepared":
        raise AdapterError("only a prepared run can be completed")
    (run_dir / "result.json").write_text(
        json.dumps({"result": result}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lock["status"] = "completed"
    lock["completedAt"] = datetime.now(timezone.utc).isoformat()
    lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return lock


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    invoke = sub.add_parser("invoke")
    invoke.add_argument("message")
    invoke.add_argument("--repository", type=Path, default=Path("examples/repository"))
    invoke.add_argument("--runtime-root", type=Path, default=Path(".runtime"))
    complete = sub.add_parser("complete")
    complete.add_argument("run_dir", type=Path)
    complete.add_argument("--result", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = (
            prepare_run(args.message, args.repository.resolve(), args.runtime_root.resolve())
            if args.command == "invoke"
            else complete_run(args.run_dir.resolve(), args.result)
        )
    except AdapterError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, "data": payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

