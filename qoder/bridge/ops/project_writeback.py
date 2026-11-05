"""qoder platform writeback guard (C5 / ADR-4, gate-4 wiring on the qoder side).

Copies sealed artifacts from a run's working project back into a shared project
directory WHILE holding the same normalized project mutex that wf-runner 0.7.6 takes
when it reads project files into a run (engine._acquire_project_locks over
config['projectWriteRoots']). While this guard holds the mutex, a runner prepare that
touches the same project rejects with RESOURCE_BUSY; while the runner holds it, this
guard rejects with RESOURCE_BUSY. Different projects never contend.

The interface shape is dictated by the shared release's project_lock module, not
copied from another platform's adapter: qoder owns this file and the path policy below.

Usage:
  python -B project_writeback.py --runner E:/ai/tool/wf-runner/versions/0.7.6
      --project-root E:/ai/qoder/runtime/maintenance/2.0-B/fixtures/project
      --evidence-out E:/ai/qoder/runtime/maintenance/2.0-B/tmp/k3/wb.json
      --mapping work/project/out/a.md:reports/a.md [--mapping ...] [--run-id RID]
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runner", required=True)
    ap.add_argument("--runs-root", default="E:/ai/qoder/runtime/runs")
    ap.add_argument("--run-id")
    ap.add_argument("--project-root", required=True)
    ap.add_argument("--evidence-out", required=True)
    ap.add_argument("--mapping", action="append", default=[], required=True)
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.runner).resolve()))
    from project_lock import ProjectLock, normalize_project_path
    from runtime_core import Rejected

    run_root = None
    if args.run_id:
        run_root = Path(args.runs_root) / args.run_id
        state = json.loads((run_root / "state.json").read_text(encoding="utf-8"))
        if state["status"] != "succeeded":
            print(json.dumps({"ok": False, "error": "run is not terminal-succeeded: " + state["status"]}))
            return 1

    project_canon, _ = normalize_project_path(args.project_root)
    pairs = []
    for spec in args.mapping:
        if ":" not in spec[2:]:
            print(json.dumps({"ok": False, "error": "mapping must be source:target: " + spec}))
            return 1
        src_s, dst_s = spec.rsplit(":", 1)
        src = Path(src_s)
        if run_root is not None and not src.is_absolute():
            src = run_root / src
        if Path(dst_s).is_absolute() or ".." in Path(dst_s.replace("\\", "/")).parts:
            print(json.dumps({"ok": False, "error": "mapping target must stay inside the project root: " + dst_s}))
            return 1
        dst = Path(os.path.normpath(project_canon + "/" + dst_s.replace("\\", "/")))
        if not str(dst).casefold().startswith(project_canon.casefold() + "/"):
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
                staging = dst.with_name(dst.name + ".qoder-writeback.tmp")
                staging.write_bytes(data)
                if dst.exists() and dst.read_bytes() == data:
                    staging.unlink()
                    status = "unchanged"
                else:
                    os.replace(str(staging), str(dst))
                    status = "written"
                written.append({"source": str(src), "target": str(dst.resolve()),
                                "sha256": digest, "size": len(data), "status": status})
    except Rejected as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": str(exc)}}))
        return 1

    evidence = {"schema": "qoder-project-writeback/v1", "platform": "qoder", "runner": str(args.runner),
                "runId": args.run_id, "project": project_canon,
                "at": datetime.now(timezone.utc).isoformat(),
                "files": written, "lock": "ProjectLock held across the whole write window"}
    out = Path(args.evidence_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "written": len(written), "evidence": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
