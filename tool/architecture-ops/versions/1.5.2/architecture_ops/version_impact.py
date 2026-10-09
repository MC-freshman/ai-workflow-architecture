"""Reverse-dependency impact for a resource@version (read-only).

Answers "if I switch X@v, who pins X?" so a one-sentence switch can check closure before
applying (agent tool-lock entries that reference the target). Pure static scan; no writes.

  python -B -m architecture_ops.version_impact --config CFG --kind workflow --id ID --version VER
"""
import argparse
import json
import sys
from pathlib import Path


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8-sig"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True); ap.add_argument("--kind", required=True)
    ap.add_argument("--id", required=True); ap.add_argument("--version")
    args = ap.parse_args()
    cfg = _load(args.config)
    tool, agent = Path(cfg["toolRoot"]), Path(cfg["agentRoot"])
    hits = []
    for ad in sorted(p for p in agent.iterdir() if p.is_dir()):
        lock = ad / "tool-lock.json"
        cur = ad / "current.json"
        if cur.is_file():
            try:
                ver = _load(cur).get("version")
                lock = ad / "versions" / str(ver) / json.loads((ad / "versions" / str(ver) / "manifest.json").read_text(encoding="utf-8-sig")).get("toolLock", "tool-lock.json")
            except Exception:
                pass
        if lock.is_file():
            data = _load(lock)
            if args.id in (data.get("workflows") or {}):
                pinned = data["workflows"][args.id]
                if args.version is None or pinned == args.version:
                    hits.append({"agent": ad.name, "pins": {args.id: pinned}, "exact": True})
    print(json.dumps({"schema": "ai-version-impact/v1", "target": "%s:%s@%s" % (args.kind, args.id, args.version or "*"),
                      "reverseDependencies": hits, "note": "Agent tool-lock pins are exact; a switch that changes the pinned target must be paired with a new agent release, not auto-followed."},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
