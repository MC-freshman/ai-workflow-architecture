"""Strict contracts and durable single-writer storage for the Phase 1 runner."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PureWindowsPath
import re
import time
import uuid


class Rejected(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Contracts:
    def __init__(self, release, scanner_release=None):
        self.release = Path(release)
        standalone = False
        manifest_path = self.release / "manifest.json"
        if manifest_path.is_file():
            try:
                standalone = json.loads(manifest_path.read_text(encoding="utf-8-sig")).get("schema") == "ai-runtime-contracts/v1"
            except ValueError:
                standalone = False  # the legacy branch below surfaces unreadable manifests exactly as before
        self.scanner = self.release
        if standalone:
            # G-B: a standalone contracts package is verified here against its own
            # SHA256SUMS (CANONICALIZATION.md file-digest rule), never via repo-lint.
            declared = self.verify_package()
            if declared.get("version") != self.release.name:
                raise Rejected("HASH_MISMATCH", "Standalone contract package version differs from its directory")
            if scanner_release is None:
                raise Rejected("CAPABILITY_UNAVAILABLE", "Standalone contracts require a platform-declared scannerRelease for resource scanning")
            self.scanner = unlinked(scanner_release)
            self.lint = load_module(self.scanner / "scripts/repo_lint.py", "pinned_repo_lint_scanner")
        else:
            self.lint = load_module(self.release / "scripts/repo_lint.py", "pinned_repo_lint")
            scanner = self.lint.Scanner(self.release.parent, self.release.parent)
            manifest = self.lint.read_json(self.release / "manifest.json")
            scanner.integrity(self.release, manifest, ("workflow", "repo-lint", str(manifest.get("version", "unknown"))))
            if scanner.findings:
                raise Rejected("HASH_MISMATCH", "Contract package integrity failed")
        self.reference = load_module(self.release / "contracts/runtime/validate_contracts.py", "pinned_runtime_contracts")
        self.validators = self.reference.validators()

    def verify_package(self):
        """Self-contained integrity: strict SHA256SUMS lines, two-way coverage,
        per-file digests; returns the parsed release manifest."""
        sums = self.release / "SHA256SUMS"
        if not sums.is_file():
            raise Rejected("HASH_MISMATCH", "Standalone contract package has no SHA256SUMS")
        try:
            manifest = json.loads((self.release / "manifest.json").read_text(encoding="utf-8-sig"))
        except ValueError as exc:
            raise Rejected("HASH_MISMATCH", "Contract package manifest is not readable JSON") from exc
        listed = {}
        for line in sums.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            match = re.fullmatch(r"([0-9a-f]{64})  (\S+)", line)
            if match is None or match.group(2) in listed:
                raise Rejected("HASH_MISMATCH", "Contract package checksum line is malformed or duplicated")
            listed[match.group(2)] = match.group(1)
        present = {row.relative_to(self.release).as_posix() for row in self.release.rglob("*") if row.is_file() and row.name != "SHA256SUMS"}
        if set(listed) != present:
            raise Rejected("HASH_MISMATCH", "Contract package contents differ from SHA256SUMS")
        for name, digest in listed.items():
            path = relative_path(self.release, name)
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise Rejected("HASH_MISMATCH", "Contract package content changed: " + name)
        return manifest

    @property
    def definition_schema(self):
        return self.definition_schema_for('ai-workflow-definition/v2')

    def definition_schema_for(self, declared):
        """Pick the contract that matches the generation a definition declares.

        The workflow-definition schemas travel with the lint release; a standalone contracts
        package keeps protocol schemas only. A v2 document must keep validating under v2 after the
        v3 file exists -- that is what "v3 is a pure incremental generation" means for the 113
        releases already on disk.
        """
        name = {'ai-workflow-definition/v3': 'workflow-definition-v3.schema.json'}.get(
            declared, 'workflow-definition-v2.schema.json')
        for root in (self.release, self.scanner):
            candidate = Path(root) / ("schemas/" + name)
            if candidate.is_file():
                return candidate
        raise Rejected("HASH_MISMATCH", "Workflow definition schema is missing from the pinned contracts: " + name)

    def canonical(self, value):
        return self.reference.canonical_bytes(value)

    def hash(self, value):
        return hashlib.sha256(self.canonical(value)).hexdigest()

    def read(self, path):
        try:
            value = self.reference.strict_load(Path(path))
        except ValueError as exc:
            if isinstance(exc, Rejected):
                raise
            # D-34: one bad evidence value used to stop a whole production round with a bare
            # traceback. The location is now in the message, and it is a classified refusal.
            raise Rejected("INVALID_REQUEST", "Document is not strict JSON: " + str(exc)) from exc
        self.canonical(value)
        return value

    def validate(self, kind, value):
        self.canonical(value)
        self.validators[kind + ".schema.json"].validate(value)


def now():
    return datetime.now(timezone.utc).isoformat()


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def unlinked(path):
    path = Path(path).absolute()
    for ancestor in [path] + list(path.parents):
        if ancestor.exists() or ancestor.is_symlink():
            stat = ancestor.lstat()
            if ancestor.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400:
                raise Rejected("UNAUTHORIZED", "Links and junctions are forbidden")
    return path


def relative_path(root, value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value or "//" in value or value.startswith("/"):
        raise Rejected("UNAUTHORIZED", "Expected a canonical relative path")
    parts = value.split("/")
    if any(p in ("", ".", "..") or p.endswith((".", " ")) or re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", p, re.I) or any(ord(c) < 32 or c in '<>"|?*' for c in p) for p in parts):
        raise Rejected("UNAUTHORIZED", "Unsafe Windows path")
    root = unlinked(root)
    path = unlinked(root / value)
    path.resolve().relative_to(root.resolve())
    return path


def record(root, path):
    path = unlinked(path)
    return {"path": path.relative_to(root).as_posix(), "sha256": file_hash(path), "size": path.stat().st_size}


def verify_files(root, rows):
    seen = {}
    for row in rows:
        alias = row["path"].casefold()
        prior = seen.get(alias)
        if prior is not None:
            if prior == row:
                # F3: one sealed file may legitimately be both a stage output and
                # its gate evidence; an identical record verifies once.
                continue
            raise Rejected("HASH_MISMATCH", "Duplicate artifact path with conflicting records")
        seen[alias] = row
        path = relative_path(root, row["path"])
        if not path.is_file() or record(root, path) != row:
            raise Rejected("HASH_MISMATCH", "Input or evidence bytes changed")


def write_bytes(path, data, exclusive=False):
    path = unlinked(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        with path.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        return
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


class Store:
    def __init__(self, root, contracts, fault=None):
        self.root = unlinked(root)
        self.c = contracts
        self.fault = fault or (lambda point: None)

    def read(self, name):
        return self.c.read(relative_path(self.root, name))

    def write(self, name, value, exclusive=False):
        write_bytes(relative_path(self.root, name), self.c.canonical(value) + b"\n", exclusive)

    @contextmanager
    def lease(self, wait_seconds=0, name='.writer.lock', recover=True):
        import msvcrt
        path = relative_path(self.root, name)
        with path.open("a+b") as stream:
            stream.seek(0, os.SEEK_END)
            if not stream.tell():
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            deadline = time.monotonic() + wait_seconds
            while True:
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as exc:
                    if time.monotonic() >= deadline:
                        raise Rejected("REVISION_CONFLICT", "Another writer owns this run") from exc
                    time.sleep(.01)
            try:
                if recover:
                    self.recover()
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)

    def recover(self):
        journal = self.root / "pending-commit.json"
        if journal.exists():
            self.materialize(self.c.read(journal))

    def materialize(self, bundle):
        # The fsynced redo record contains no business action. Replaying only
        # committed bytes repairs crashes between event/state/receipt exports.
        event_path = relative_path(self.root, "events.jsonl")
        old_bytes = event_path.read_bytes() if event_path.exists() else b""
        prefix = bundle["eventPrefix"].encode("utf-8")
        desired = prefix + b"".join(self.c.canonical(e) + b"\n" for e in bundle["events"])
        if not desired.startswith(old_bytes):
            raise Rejected("PERSISTENCE_ERROR", "Event journal does not match durable intent")
        if len(old_bytes) < len(desired):
            with event_path.open("ab") as stream:
                stream.write(desired[len(old_bytes):])
                stream.flush()
                os.fsync(stream.fileno())
        self.fault("after-events")
        current = self.read("state.json") if (self.root / "state.json").exists() else None
        if current not in (bundle["before"], bundle["state"]):
            raise Rejected("PERSISTENCE_ERROR", "State differs from durable commit")
        self.write("state.json", bundle["state"])
        self.fault("after-state")
        if bundle["receipt"] is not None:
            self.write(bundle["receiptPath"], bundle["receipt"])
        self.fault("after-receipt")
        archive = self.root / "commits" / (bundle["commitId"] + ".json")
        archive.parent.mkdir(exist_ok=True)
        os.replace(self.root / "pending-commit.json", archive)

    def commit(self, before, state, events, receipt=None, receipt_path=None):
        self.c.validate("state", state)
        for event in events:
            self.c.validate("event", event)
        if receipt is not None:
            self.c.validate("transaction", receipt)
        event_path = self.root / "events.jsonl"
        prefix = event_path.read_text(encoding="utf-8") if event_path.exists() else ""
        bundle = {"commitId": uuid.uuid4().hex, "before": before, "state": state, "events": events, "eventPrefix": prefix, "receipt": receipt, "receiptPath": receipt_path}
        self.write("pending-commit.json", bundle, exclusive=True)
        self.fault("after-intent")
        self.materialize(bundle)

    def observe(self):
        # status is read-only and returns a committed snapshot even during export.
        pending = self.root / "pending-commit.json"
        if pending.exists():
            try:
                return self.c.read(pending)["state"]
            except FileNotFoundError:
                pass  # The writer archived the journal after materializing state.
        return self.read("state.json")


def event_for(c, lock, state, previous, transaction_id, kind, evidence=None):
    # The contract keeps the v1.1 document shape closed over the types it was written with, so a
    # type that only exists from 1.3 onwards is stamped with the event generation that allows it.
    generation = "ai-run-event/v1.2" if kind in {"attempt-failed", "software-called"} else "ai-run-event/v1.1"
    event = {"schemaVersion": generation, "runId": lock["runId"], "lockSha256": c.hash(lock), "sequence": 1 if previous is None else previous["lastEventSequence"] + 1, "transactionId": transaction_id, "previousRevision": None if previous is None else previous["stateRevision"], "newRevision": 0 if previous is None else previous["stateRevision"] + 1, "previousEventSha256": None if previous is None else previous["lastEventSha256"], "type": kind, "status": state["status"], "at": now(), "evidence": evidence or []}
    event["eventSha256"] = c.hash(event)
    state.update(stateRevision=event["newRevision"], lastEventSequence=event["sequence"], lastEventSha256=event["eventSha256"], updatedAt=event["at"])
    return event
