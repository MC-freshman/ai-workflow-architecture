"""Shared helpers for content hashes and result lineage."""

from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_paths(root: Path, paths: list[str]) -> dict[str, str]:
    output = {}
    for relative in paths:
        path = (root / relative).resolve()
        if not path.is_file() or root.resolve() not in path.parents:
            raise FileNotFoundError(relative)
        output[relative.replace("\\", "/")] = sha256_file(path)
    return output


def hash_mapping(mapping: dict[str, str]) -> str:
    payload = "\n".join(f"{key}={mapping[key]}" for key in sorted(mapping))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
