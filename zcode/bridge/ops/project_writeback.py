"""Platform writeback guard (C5 / ADR-4 gate-4 wiring, zcode side).

Copies sealed files from a run's working project back into a shared project directory
UNDER the same normalized project mutex that wf-runner 0.7.6 acquires when it reads
project files into a run (_acquire_project_locks). While the writeback holds the lock,
any runner prepare touching the same project rejects with RESOURCE_BUSY (and vice
versa); different projects are unaffected.

Usage:
  python -B project_writeback.py --runner E:/ai/tool/wf-runner/versions/0.7.6 \
      --project-root E:/path/to/project --evidence-out E:/ai/zcode/runtime/.../x.json \
      --mapping work/project/a.md:reports/a.md --mapping ...
Requires the source run to be terminal-succeeded when --run-id is given.
"""
import argparse, hashlib, json, os, shutil, sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runner", required=True)
    ap.add_argument("--runs-root", default="E:/ai/zcode/runtime/runs")
    ap.add_argument("--run-id")
    ap.add_argument("--project-root", required=True)
    ap.add_argument("--evidence-out", required=True)
    ap.add_argument("--mapping", action="append", default=[], required=True)
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.runner).resolve()))
    from project_lock import ProjectLock, normalize_project_path
    from runtime_core import unlinked, relative_path, Rejected

    run_root = None
    if args.run_id:
        run_root = Path(args.runs_root) / args.run_id
        state = json.loads((run_root / "state.json").read_text(encoding="utf-8"))
        if state["status"] != "succeeded":
            print(json.dumps({"ok": False, "error": "run is not terminal-succeeded: " + state["status"]}))
            return 1

    pairs = []
    project_canon, _ = normalize_project_path(args.project_root)
    for spec in args.mapping:
        if spec.count(":") < 1 or ":" not in spec[2:]:
            print(json.dumps({"ok": False, "error": "mapping must be source:target: " + spec}))
            return 1
        src_s, dst_s = spec.rsplit(":", 1)
        src = Path(src_s)
        if run_root is not None and not src.is_absolute():
            src = run_root / src
        dst = Path(project_canon) / dst_s
        dstr = str(dst.resolve()).replace("\\", "/").rstrip("/")
        if not dstr.casefold().startswith(project_canon.casefold() + "/") and dstr.casefold() != project_canon.casefold():
            print(json.dumps({"ok": False, "error": "mapping target escapes the project root: " + dst_s}))
            return 1
        if not src.is_file():
            print(json.dumps({"ok": False, "error": "source missing: " + str(src)}))
            return 1
        pairs.append((src, dst))

    try:
        with ProjectLock(args.project_root):
            written = []
            for src, dst in pairs:
                data = src.read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                dst.parent.mkdir(parents=True, exist_ok=True)
                tmp = dst.with_name(dst.name + ".writeback.tmp")
                tmp.write_bytes(data)
                if dst.exists() and dst.read_bytes() == data:
                    tmp.unlink()
                    status = "unchanged"
                else:
                    os.replace(str(tmp), str(dst))
                    status = "written"
                written.append({"source": str(src), "target": str(dst.resolve()), "sha256": digest, "size": len(data), "status": status})
    except Rejected as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": str(exc)}}))
        return 1

    evidence = {"schema": "zcode-project-writeback/v1", "platform": "zcode", "runner": str(args.runner),
                "runId": args.run_id, "project": project_canon, "at": datetime.now(timezone.utc).isoformat(),
                "files": written, "lock": "ProjectLock held for the whole write window"}
    out = Path(args.evidence_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "written": len(written), "evidence": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
