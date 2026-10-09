"""One-sentence default switch (requirement #3), platform-scope, CAS-guarded, revertible.

Sets a platform's default selection for a workflow/agent/software by writing the platform's OWN
bridge.json `defaults.{workflow|agent}Versions[id]=version`. It NEVER edits shared
`current.json` and NEVER touches another platform (gate: default scope is the platform).

Flow: plan -> apply (compare-and-swap on the prior bridge hash + checkpoint) -> verify
-> readback. revert restores the exact prior bytes. Ambiguity/failed gate -> block, no
silent version guessing.

  python -B -m architecture_ops.switch_defaults plan   --config CFG --bridge BRIDGE --kind workflow --id ID --to VER --checkpoint DIR
  ... apply / verify / revert --plan PLAN
"""
import argparse
import hashlib
import json
import shutil
import sys
import time
import uuid
from pathlib import Path

SECTIONS = {"workflow": "workflowVersions", "agent": "agentVersions",
            "software": "softwareVersions"}
# One root key per kind, so "same semantics over three repositories" is one table
# rather than a ternary that silently favours the first two.
ROOT_KEYS = {"workflow": "toolRoot", "agent": "agentRoot", "software": "softwareRoot"}


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8-sig"))


def _release_exists(tool_or_agent_root, kind, ident, version):
    """Target must be a published, integrity-clean version dir (SHA256SUMS all match)."""
    vdir = Path(tool_or_agent_root) / ident / "versions" / version
    sums = vdir / "SHA256SUMS"
    if not vdir.is_dir() or not sums.is_file():
        return False, "version dir or SHA256SUMS missing"
    for line in sums.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        h, rel = line.split("  ", 1)
        f = vdir / rel
        if not f.exists() or sha(f) != h:
            return False, "integrity mismatch at " + rel
    return True, "ok"


def plan(args):
    bridge = Path(args.bridge)
    cfg = _load(args.config)
    if not bridge.is_file():
        sys.exit("REFUSE: bridge not found " + str(bridge))
    if args.kind not in SECTIONS:
        sys.exit("REFUSE: kind must be workflow|agent|software")
    root = cfg[ROOT_KEYS[args.kind]]
    ok, why = _release_exists(root, args.kind, args.id, args.to)
    if not ok:
        sys.exit("REFUSE: target not published/intact (%s): %s" % (args.id + "@" + args.to, why))
    base = _load(bridge)
    prior_sha = sha(bridge)
    checkpoint = Path(args.checkpoint); checkpoint.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    backup = checkpoint / ("bridge-" + stamp + ".json")
    plan_path = checkpoint / ("plan-" + stamp + ".json")
    proposed = json.loads(json.dumps(base))
    proposed.setdefault("defaults", {}).setdefault(SECTIONS[args.kind], {})[args.id] = args.to
    plan_obj = {"schema": "ai-default-switch-plan/v1", "checkpointId": stamp, "bridge": str(bridge),
                "expectedPriorSha256": prior_sha, "backupPath": str(backup),
                "scope": "platform:" + base.get("platform"), "kind": args.kind, "id": args.id,
                "from": (base.get("defaults", {}).get(SECTIONS[args.kind], {}) or {}).get(args.id, "shared-current"),
                "to": args.to, "newContent": proposed, "sharedCurrentTouched": False}
    plan_path.write_text(json.dumps(plan_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"plan": str(plan_path), "checkpointId": stamp, "expectedPriorSha256": prior_sha[:16],
                      "from": plan_obj["from"], "to": args.to, "scope": plan_obj["scope"]}, ensure_ascii=False))


def _apply_or_revert(p):
    plan_obj = _load(p)
    bridge = Path(plan_obj["bridge"])
    # CAS: the file must still equal what the plan was computed against.
    if not bridge.is_file() or sha(bridge) != plan_obj["expectedPriorSha256"]:
        sys.exit("BLOCK (CAS): bridge changed since plan; re-plan, do not overwrite others' edits.")
    return plan_obj, bridge


def apply(args):
    plan_obj, bridge = _apply_or_revert(args.plan)
    backup = Path(plan_obj["backupPath"])
    if not backup.exists():
        shutil.copyfile(bridge, backup)  # checkpoint original bytes
        if sha(backup) != plan_obj["expectedPriorSha256"]:
            sys.exit("BLOCK: checkpoint backup differs from plan prior; aborting before write.")
    tmp = bridge.with_name(bridge.name + "." + uuid.uuid4().hex + ".tmp")
    tmp.write_text(json.dumps(plan_obj["newContent"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # re-assert CAS immediately before the atomic swap (minimize TOCTOU window)
    if sha(bridge) != plan_obj["expectedPriorSha256"]:
        tmp.unlink(); sys.exit("BLOCK (CAS): bridge changed at swap; aborted, no write.")
    os_replace(tmp, bridge)
    print(json.dumps({"applied": True, "checkpointId": plan_obj["checkpointId"], "backup": str(backup)}, ensure_ascii=False))


def os_replace(src, dst):
    import os
    os.replace(src, dst)


def verify(args):
    plan_obj = _load(args.plan)
    cur = _load(plan_obj["bridge"])
    got = (cur.get("defaults", {}).get(SECTIONS[plan_obj["kind"]], {}) or {}).get(plan_obj["id"])
    ok = got == plan_obj["to"]
    print(json.dumps({"verified": bool(ok), "expected": plan_obj["to"], "readback": got,
                      "checkpointId": plan_obj["checkpointId"]}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


def revert(args):
    plan_obj = _load(args.plan)
    bridge = Path(plan_obj["bridge"]); backup = Path(plan_obj["backupPath"])
    if not backup.is_file():
        sys.exit("BLOCK: no checkpoint backup at " + str(backup))
    # byte-exact restore, but only over the value THIS plan wrote (don't clobber a later legit edit)
    if sha(bridge) != sha_from_obj(plan_obj["newContent"], plan_obj["bridge"]):
        cur = _load(bridge)
        same = json.dumps(cur, sort_keys=True) == json.dumps(plan_obj["newContent"], sort_keys=True)
        if not same:
            sys.exit("BLOCK (CAS): bridge not at this plan's applied state; not reverting over others' changes.")
    tmp = bridge.with_name(bridge.name + ".rev." + uuid.uuid4().hex + ".tmp")
    shutil.copyfile(backup, tmp)
    os_replace(tmp, bridge)
    restored = sha(bridge) == sha(backup)
    print(json.dumps({"reverted": bool(restored), "byteExact": bool(restored),
                      "checkpointId": plan_obj["checkpointId"], "backup": str(backup)}, ensure_ascii=False))
    sys.exit(0 if restored else 1)


def sha_from_obj(obj, bridge_path):
    p = Path(bridge_path).with_name("__expected_new__.json")
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    v = sha(p); p.unlink(missing_ok=True)
    return v


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--config", required=True); p.add_argument("--bridge", required=True)
    p.add_argument("--kind", required=True); p.add_argument("--id", required=True); p.add_argument("--to", required=True)
    p.add_argument("--checkpoint", required=True); p.set_defaults(fn=plan)
    for name, fn in (("apply", apply), ("verify", verify), ("revert", revert)):
        s = sub.add_parser(name); s.add_argument("--plan", required=True); s.set_defaults(fn=fn)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
