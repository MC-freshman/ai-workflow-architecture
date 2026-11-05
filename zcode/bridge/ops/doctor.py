"""zcode/ops doctor (A5, read-only). Reports current platform + shared 2.0 state
for human/gate inspection. Never writes outside a chosen --out (or stdout). No
execution of business workflows; no credential/other-platform access.

Usage: python -B doctor.py [--config CFG] [--out FILE]
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

TOOL = Path("E:/ai/tool")


def sha(p):
    import hashlib
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(Path("E:/ai/zcode/bridge/zcode-config.json")))
    ap.add_argument("--out")
    args = ap.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    caps = json.loads(Path(config["capabilities"]).read_text(encoding="utf-8-sig"))

    reg = json.loads((TOOL / "registry.json").read_text(encoding="utf-8-sig"))

    def counts():
        out = {}
        for sec in ("workflows", "contracts", "governance", "packs", "skills"):
            arr = reg.get(sec, [])
            out[sec] = {"total": len(arr),
                        "invocable": sum(1 for e in arr if e.get("invocable") is True),
                        "kinds": sorted({e.get("kind", "workflow") for e in arr})}
        return out

    def cur(rel):
        p = TOOL / rel
        if not p.is_file():
            return None
        return json.loads(p.read_text(encoding="utf-8-sig")).get("version")

    report = {
        "schema": "ai-platform-doctor/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "platform": config.get("platform"),
        "pins": {"runner": Path(config["runner"]).name, "contracts": Path(config.get("contracts", "")).name,
                 "toolRegistryVersion": reg.get("version")},
        "registry": counts(),
        "candidate20": {
            "runtime-contracts": cur("runtime-contracts/current.json"),
            "platform-conformance": cur("platform-conformance/current.json"),
            "architecture-ops": cur("architecture-ops/current.json"),
            "wfRunner_0_7_0_present": (TOOL / "wf-runner/versions/0.7.0").is_dir(),
            "repoLint_0_3_0_present": (TOOL / "repo-lint/versions/0.3.0").is_dir(),
        },
        "capabilities": {"checks": caps.get("checks"), "declaredAbsent": sorted(caps.get("declaredAbsent", {})),
                         "profiles": sorted(caps.get("profiles", {}))},
        "openGates": {
            "note": "doctor reports state only; readiness is asserted by platform-conformance + invocation_matrix evidence, not by this file.",
            "repoLintRealWf": "open (shared-read-only mount: external authorization, P4)",
            "c5ProjectLock": "open (needs zcode script backend + concurrency tests, P3)",
            "codexMigration": "external (codex session owns codex/; P7 handoff)",
        },
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
