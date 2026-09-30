"""Checkpointed switch for one shared current.json pointer.

The caller supplies its own platform config. Plans, exact prior pointer bytes, and
recovery evidence are written only under that platform's runtime/maintenance tree.
This command changes one shared selector; it does not change platform defaults or
claim cross-platform locking.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path


KINDS = {
    "workflow": ("toolRoot", "workflows"),
    "agent": ("agentRoot", "agents"),
    "software": ("softwareRoot", "software"),
    "contracts": ("toolRoot", "contracts"),
    "governance": ("toolRoot", "governance"),
}
POINTER_SCHEMAS = {
    "workflow": "ai-workflow-pointer/v1",
    "agent": "ai-agent-pointer/v1",
    "software": "ai-software-pointer/v1",
    "contracts": "ai-contracts-pointer/v1",
    "governance": "ai-governance-pointer/v1",
}
ID_RE = re.compile(r"^[a-z0-9_][a-z0-9._-]*$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


class Refusal(Exception):
    pass


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate JSON property: " + key)
        result[key] = value
    return result


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), object_pairs_hook=_pairs)


def _sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def _sha(path):
    return _sha_bytes(Path(path).read_bytes())


def _entry_sha(entry):
    data = json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _sha_bytes(data)


def _reject_reparse(path):
    path = Path(path).absolute()
    for item in [path, *path.parents]:
        if item.exists() or item.is_symlink():
            stat = item.lstat()
            if item.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400:
                raise Refusal("reparse points are not allowed in switch paths: " + str(item))


def _platform_config(config_path):
    config_path = Path(config_path).resolve(strict=True)
    _reject_reparse(config_path)
    config = _read(config_path)
    if not isinstance(config, dict) or not isinstance(config.get("platformRoot"), str):
        raise Refusal("platform config must declare platformRoot")
    platform_root = Path(config["platformRoot"]).resolve(strict=True)
    _reject_reparse(platform_root)
    return config_path, config, platform_root


def _checkpoint_path(config, platform_root, requested):
    allowed = (platform_root / "runtime" / "maintenance").resolve(strict=False)
    checkpoint = Path(requested).resolve(strict=False)
    try:
        checkpoint.relative_to(allowed)
    except ValueError as exc:
        raise Refusal("checkpoint must remain under this platform's runtime/maintenance") from exc
    _reject_reparse(checkpoint)
    return checkpoint


def _resource(config, kind, ident):
    if kind not in KINDS or not ID_RE.fullmatch(ident):
        raise Refusal("kind or resource id is invalid")
    root_key, section = KINDS[kind]
    if not isinstance(config.get(root_key), str):
        raise Refusal("platform config has no " + root_key)
    root = Path(config[root_key]).resolve(strict=True)
    _reject_reparse(root)
    registry_path = root / "registry.json"
    _reject_reparse(registry_path)
    registry = _read(registry_path)
    rows = registry.get(section)
    if not isinstance(rows, list):
        raise Refusal("registry has no " + section + " list")
    entries = [row for row in rows if isinstance(row, dict) and row.get("id") == ident]
    if len(entries) != 1:
        raise Refusal("resource must have exactly one registry entry: " + ident)
    entry = entries[0]
    if entry.get("enabled") is False:
        raise Refusal("disabled resources cannot be switched: " + ident)
    expected_current = ident + "/current.json"
    if entry.get("current") != expected_current:
        raise Refusal("registry current path differs from the canonical resource pointer")
    pointer_path = root / expected_current
    _reject_reparse(pointer_path)
    return root, registry_path, entry, pointer_path


def _verify_release(root, ident, version):
    release = root / ident / "versions" / version
    _reject_reparse(release)
    sums_path = release / "SHA256SUMS"
    manifest_path = release / "manifest.json"
    source_path = release / "SOURCE.json"
    if not release.is_dir() or not sums_path.is_file() or not manifest_path.is_file() or not source_path.is_file():
        raise Refusal("target release, manifest, SOURCE.json, or SHA256SUMS is missing")
    listed = {}
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\s]+)", line)
        if match is None or match.group(2) in listed:
            raise Refusal("target SHA256SUMS is malformed or contains duplicate paths")
        rel = match.group(2)
        if "\\" in rel or rel.startswith("/") or any(part in ("", ".", "..") for part in rel.split("/")):
            raise Refusal("target SHA256SUMS contains an unsafe relative path")
        listed[rel] = match.group(1)
    release_paths = list(release.rglob("*"))
    for path in release_paths:
        _reject_reparse(path)
    actual = {path.relative_to(release).as_posix(): path for path in release_paths
              if path.is_file() and path.name != "SHA256SUMS"}
    if set(listed) != set(actual):
        raise Refusal("target release directory and SHA256SUMS coverage differ")
    for rel, expected in listed.items():
        if _sha(actual[rel]) != expected:
            raise Refusal("target release integrity mismatch: " + rel)
    manifest = _read(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("id") != ident or manifest.get("version") != version:
        raise Refusal("target manifest id/version does not match the selected pointer")
    return {"path": str(release), "manifestSha256": _sha(manifest_path),
            "sha256SumsSha256": _sha(sums_path)}


def _pointer(kind, ident, pointer_path, expected_version=None):
    if not pointer_path.is_file():
        raise Refusal("registered current.json pointer is missing")
    current = _read(pointer_path)
    if (not isinstance(current, dict) or current.get("id") != ident
            or current.get("schema") != POINTER_SCHEMAS[kind]
            or not VERSION_RE.fullmatch(str(current.get("version", "")))):
        raise Refusal("current.json has an invalid identity or version")
    if current.get("hashManifest") != "SHA256SUMS":
        raise Refusal("current.json is missing the shared pointer shape")
    if expected_version is not None and current["version"] != expected_version:
        raise Refusal("current.json version differs from --from")
    return current


def _write_exclusive(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _atomic_write(path, data):
    path = Path(path)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    _write_exclusive(tmp, data)
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def _load_plan(path):
    _reject_reparse(path)
    plan = _read(path)
    if not isinstance(plan, dict) or plan.get("schema") != "ai-current-switch-plan/v1":
        raise Refusal("unsupported or malformed current switch plan")
    return plan


def _context(plan):
    config_path, config, platform_root = _platform_config(plan["configPath"])
    checkpoint = _checkpoint_path(config, platform_root, plan["checkpointRoot"])
    root, registry_path, entry, pointer_path = _resource(config, plan["kind"], plan["id"])
    if (str(config_path) != plan["configPath"] or str(checkpoint) != plan["checkpointRoot"]
            or str(registry_path) != plan["registryPath"] or str(pointer_path) != plan["pointerPath"]):
        raise Refusal("plan paths no longer resolve through the supplied platform config")
    entry_version = entry.get("version")
    if plan["registryUpdate"]:
        if entry_version not in (plan["from"], plan["to"]):
            raise Refusal("registry version is outside this plan's before/after values")
        registry_sha = _sha(registry_path)
        if registry_sha not in (plan["registryBeforeSha256"], plan["registryAfterSha256"]):
            raise Refusal("registry changed outside this plan; re-plan before switching")
    elif _entry_sha(entry) != plan["registryEntrySha256"]:
        raise Refusal("target registry entry changed after plan; re-plan before switching")
    backup_path = Path(plan["backupPath"]).resolve(strict=False)
    _reject_reparse(backup_path)
    try:
        backup_path.relative_to(checkpoint)
    except ValueError as exc:
        raise Refusal("checkpoint backup escaped this platform's runtime/maintenance tree") from exc
    if plan["registryUpdate"]:
        registry_backup = Path(plan["registryBackupPath"]).resolve(strict=False)
        try:
            registry_backup.relative_to(checkpoint)
        except ValueError as exc:
            raise Refusal("registry checkpoint escaped this platform's runtime/maintenance tree") from exc
        _reject_reparse(registry_backup)
    release = _verify_release(root, plan["id"], plan["to"])
    if (release["manifestSha256"] != plan["targetManifestSha256"]
            or release["sha256SumsSha256"] != plan["targetSha256SumsSha256"]):
        raise Refusal("target release changed after plan")
    return config, platform_root, checkpoint, pointer_path


def plan(args):
    if not ID_RE.fullmatch(args.id) or not VERSION_RE.fullmatch(args.to) or not VERSION_RE.fullmatch(args.from_version):
        raise Refusal("id and versions must use the registered id and exact semantic-version forms")
    config_path, config, platform_root = _platform_config(args.config)
    checkpoint = _checkpoint_path(config, platform_root, args.checkpoint)
    root, registry_path, entry, pointer_path = _resource(config, args.kind, args.id)
    prior = _pointer(args.kind, args.id, pointer_path, args.from_version)
    if args.to == prior["version"]:
        raise Refusal("target version is already current")
    target = _verify_release(root, args.id, args.to)
    prior_bytes = pointer_path.read_bytes()
    registry_bytes = registry_path.read_bytes()
    registry_obj = _read(registry_path)
    registry_rows = registry_obj.get(KINDS[args.kind][1], [])
    registry_entry = next(row for row in registry_rows if row.get("id") == args.id)
    registry_update = "version" in registry_entry and registry_entry["version"] == args.from_version
    if "version" in registry_entry and registry_entry["version"] not in (args.from_version, args.to):
        raise Refusal("registry version is neither current nor the requested target; resolve index drift first")
    registry_new_bytes = None
    if registry_update:
        registry_entry["version"] = args.to
        registry_new_bytes = (json.dumps(registry_obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    new_content = dict(prior)
    new_content["version"] = args.to
    new_bytes = (json.dumps(new_content, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    backup_path = checkpoint / (stamp + ".current.before.json")
    registry_backup_path = checkpoint / (stamp + ".registry.before.json") if registry_update else None
    plan_path = checkpoint / (stamp + ".plan.json")
    _write_exclusive(backup_path, prior_bytes)
    if registry_update:
        _write_exclusive(registry_backup_path, registry_bytes)
    plan_obj = {
        "schema": "ai-current-switch-plan/v1",
        "checkpointId": stamp,
        "configPath": str(config_path),
        "checkpointRoot": str(checkpoint),
        "platform": str(config.get("platform", "unknown")),
        "kind": args.kind,
        "id": args.id,
        "from": args.from_version,
        "to": args.to,
        "registryPath": str(registry_path),
        "registryEntrySha256": _entry_sha(entry),
        "registryUpdate": registry_update,
        "registryBeforeSha256": _sha_bytes(registry_bytes),
        "registryAfterSha256": _sha_bytes(registry_new_bytes) if registry_update else _sha_bytes(registry_bytes),
        "registryBackupPath": str(registry_backup_path) if registry_update else None,
        "registryBackupSha256": _sha_bytes(registry_bytes) if registry_update else None,
        "registryAfterBase64": base64.b64encode(registry_new_bytes).decode("ascii") if registry_update else None,
        "pointerPath": str(pointer_path),
        "priorPointerSha256": _sha_bytes(prior_bytes),
        "backupPath": str(backup_path),
        "backupSha256": _sha_bytes(prior_bytes),
        "targetManifestSha256": target["manifestSha256"],
        "targetSha256SumsSha256": target["sha256SumsSha256"],
        "newPointerBase64": base64.b64encode(new_bytes).decode("ascii"),
        "newPointerSha256": _sha_bytes(new_bytes),
    }
    _write_exclusive(plan_path, (json.dumps(plan_obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {"plan": str(plan_path), "checkpointId": stamp, "from": args.from_version,
            "to": args.to, "platform": plan_obj["platform"], "backup": str(backup_path),
            "registryUpdate": registry_update}


def apply(args):
    plan_obj = _load_plan(args.plan)
    _config, _platform_root, _checkpoint, pointer_path = _context(plan_obj)
    backup = Path(plan_obj["backupPath"])
    if not backup.is_file() or _sha(backup) != plan_obj["backupSha256"]:
        raise Refusal("checkpoint is missing or its prior-pointer bytes changed")
    pointer_sha = _sha(pointer_path) if pointer_path.is_file() else None
    if pointer_sha not in (plan_obj["priorPointerSha256"], plan_obj["newPointerSha256"]):
        raise Refusal("current.json changed after plan (CAS); no write performed")
    new_bytes = base64.b64decode(plan_obj["newPointerBase64"], validate=True)
    if _sha_bytes(new_bytes) != plan_obj["newPointerSha256"]:
        raise Refusal("planned current.json bytes failed their digest")
    registry_path = Path(plan_obj["registryPath"])
    registry_bytes = None
    if plan_obj["registryUpdate"]:
        registry_backup = Path(plan_obj["registryBackupPath"])
        if (not registry_backup.is_file()
                or _sha(registry_backup) != plan_obj["registryBackupSha256"]):
            raise Refusal("registry checkpoint is missing or its bytes changed")
        registry_sha = _sha(registry_path)
        if registry_sha not in (plan_obj["registryBeforeSha256"], plan_obj["registryAfterSha256"]):
            raise Refusal("registry changed after plan (CAS); no write performed")
        registry_bytes = base64.b64decode(plan_obj["registryAfterBase64"], validate=True)
        if _sha_bytes(registry_bytes) != plan_obj["registryAfterSha256"]:
            raise Refusal("planned registry bytes failed their digest")
    if pointer_sha == plan_obj["priorPointerSha256"]:
        if _sha(pointer_path) != plan_obj["priorPointerSha256"]:
            raise Refusal("current.json changed at the swap boundary (CAS); no write performed")
        _atomic_write(pointer_path, new_bytes)
    if plan_obj["registryUpdate"] and _sha(registry_path) == plan_obj["registryBeforeSha256"]:
        if _sha(registry_path) != plan_obj["registryBeforeSha256"]:
            raise Refusal("registry changed at the swap boundary (CAS); no write performed")
        _atomic_write(registry_path, registry_bytes)
    if _sha(pointer_path) != plan_obj["newPointerSha256"]:
        _atomic_write(pointer_path, backup.read_bytes())
        raise Refusal("pointer readback mismatch; prior bytes restored")
    if plan_obj["registryUpdate"] and _sha(registry_path) != plan_obj["registryAfterSha256"]:
        raise Refusal("registry readback mismatch; checkpoint retained for explicit recovery")
    return {"applied": True, "checkpointId": plan_obj["checkpointId"],
            "pointer": str(pointer_path), "sha256": plan_obj["newPointerSha256"],
            "registryUpdated": plan_obj["registryUpdate"]}


def verify(args):
    plan_obj = _load_plan(args.plan)
    _config, _platform_root, _checkpoint, pointer_path = _context(plan_obj)
    if not pointer_path.is_file() or _sha(pointer_path) != plan_obj["newPointerSha256"]:
        raise Refusal("current.json does not match this plan's target bytes")
    if plan_obj["registryUpdate"] and _sha(Path(plan_obj["registryPath"])) != plan_obj["registryAfterSha256"]:
        raise Refusal("registry index does not match this plan's target version")
    current = _pointer(plan_obj["kind"], plan_obj["id"], pointer_path, plan_obj["to"])
    return {"verified": True, "checkpointId": plan_obj["checkpointId"],
            "id": plan_obj["id"], "version": current["version"], "sha256": plan_obj["newPointerSha256"]}


def revert(args):
    plan_obj = _load_plan(args.plan)
    _config, _platform_root, _checkpoint, pointer_path = _context(plan_obj)
    backup = Path(plan_obj["backupPath"])
    if not backup.is_file() or _sha(backup) != plan_obj["backupSha256"]:
        raise Refusal("checkpoint is missing or its prior-pointer bytes changed")
    pointer_sha = _sha(pointer_path) if pointer_path.is_file() else None
    if pointer_sha not in (plan_obj["priorPointerSha256"], plan_obj["newPointerSha256"]):
        raise Refusal("current.json changed outside this plan (CAS); no write performed")
    registry_path = Path(plan_obj["registryPath"])
    if plan_obj["registryUpdate"]:
        registry_sha = _sha(registry_path)
        if registry_sha not in (plan_obj["registryBeforeSha256"], plan_obj["registryAfterSha256"]):
            raise Refusal("registry changed outside this plan (CAS); no write performed")
        registry_backup = Path(plan_obj["registryBackupPath"])
        if (not registry_backup.is_file()
                or _sha(registry_backup) != plan_obj["registryBackupSha256"]):
            raise Refusal("registry checkpoint is missing or its bytes changed")
        if registry_sha == plan_obj["registryAfterSha256"]:
            _atomic_write(registry_path, registry_backup.read_bytes())
    if pointer_sha == plan_obj["newPointerSha256"]:
        if _sha(pointer_path) != plan_obj["newPointerSha256"]:
            raise Refusal("current.json changed at the revert boundary (CAS); no write performed")
        _atomic_write(pointer_path, backup.read_bytes())
    restored = _sha(pointer_path) == plan_obj["priorPointerSha256"]
    if not restored:
        raise Refusal("restored pointer did not match the exact checkpoint bytes")
    if plan_obj["registryUpdate"] and _sha(registry_path) != plan_obj["registryBeforeSha256"]:
        raise Refusal("registry did not match its exact checkpoint after revert")
    return {"reverted": True, "byteExact": True, "checkpointId": plan_obj["checkpointId"],
            "pointer": str(pointer_path), "sha256": plan_obj["priorPointerSha256"],
            "registryRestored": plan_obj["registryUpdate"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--config", required=True)
    p.add_argument("--kind", choices=sorted(KINDS), required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--from", dest="from_version", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--checkpoint", required=True, help="directory under this platform's runtime/maintenance")
    p.set_defaults(fn=plan)
    for name, fn in (("apply", apply), ("verify", verify), ("revert", revert)):
        subparser = sub.add_parser(name)
        subparser.add_argument("--plan", required=True)
        subparser.set_defaults(fn=fn)
    args = parser.parse_args()
    try:
        result = args.fn(args)
    except (Refusal, OSError, ValueError, KeyError) as exc:
        print("BLOCK: " + str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
