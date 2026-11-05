"""Validate the public reference repository and its immutable example releases."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "repository"
FORBIDDEN_PARTS = {".git", ".runtime", "runtime", "userdata", "node_modules", "__pycache__"}
FORBIDDEN_NAMES = {".env", "auth.json"}
ABSOLUTE_PATHS = (
    re.compile(r"[A-Za-z]:" + r"\\" + r"(?:Users|ai)" + r"\\", re.IGNORECASE),
    re.compile("/" + "home" + r"/[^/]+/"),
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_repository_manifest(errors: list[str]) -> int:
    manifest = ROOT / "REPOSITORY-SHA256SUMS"
    if not manifest.is_file():
        errors.append("missing REPOSITORY-SHA256SUMS")
        return 0
    checked = 0
    for number, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            expected, relative = raw.split(None, 1)
        except ValueError:
            errors.append(f"malformed repository hash line: {number}")
            continue
        target = ROOT / relative.strip().lstrip("*")
        if not target.is_file() or digest(target) != expected.lower():
            errors.append(f"repository hash failure: {relative.strip()}")
        checked += 1
    return checked


def main() -> int:
    errors: list[str] = []
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if any(part in FORBIDDEN_PARTS for part in relative.parts):
            continue
        if path.is_file():
            if path.name.lower() in FORBIDDEN_NAMES:
                errors.append(f"forbidden file: {relative.as_posix()}")
            if path.stat().st_size > 2 * 1024 * 1024:
                errors.append(f"unexpected large file: {relative.as_posix()}")
            if path.suffix.lower() in {".md", ".json", ".py", ".yml", ".yaml", ""}:
                text = path.read_text(encoding="utf-8")
                if relative.as_posix() != "LICENSE" and any(pattern.search(text) for pattern in ABSOLUTE_PATHS):
                    errors.append(f"machine-specific absolute path: {relative.as_posix()}")
    for registry_root, key in ((EXAMPLE / "tool", "workflows"), (EXAMPLE / "agent", "agents")):
        registry = json.loads((registry_root / "registry.json").read_text(encoding="utf-8"))
        for item in registry.get(key, []):
            pointer = json.loads((registry_root / item["current"]).read_text(encoding="utf-8"))
            release = (registry_root / item["current"]).parent / "versions" / pointer["version"]
            manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
            if manifest.get("id") != item["id"] or manifest.get("version") != pointer["version"]:
                errors.append(f"pointer/manifest mismatch: {item['id']}")
            sums = release / "SHA256SUMS"
            if not sums.is_file():
                errors.append(f"missing SHA256SUMS: {release.relative_to(ROOT).as_posix()}")
                continue
            for raw in sums.read_text(encoding="utf-8").splitlines():
                if not raw.strip():
                    continue
                expected, relative = raw.split(None, 1)
                target = release / relative.strip().lstrip("*")
                if not target.is_file() or digest(target) != expected.lower():
                    errors.append(f"hash failure: {target.relative_to(ROOT).as_posix()}")
    repository_hashes = validate_repository_manifest(errors)
    result = {
        "ok": not errors,
        "architectureVersion": "1.0.0",
        "repositoryHashesChecked": repository_hashes,
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
