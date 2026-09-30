#!/usr/bin/env python3
"""game-launch 交付物完整性门禁（Z10 §6.2 批 C1）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json，写 game-launch-check.json，退出 0/1/2。

上游的硬规则：GO 不能与阻塞项共存（有 blocked 阶段或 critical 阻塞项就只能 CONDITIONAL GO 或
NO-GO）、完成阶段必须有证据、回滚计划必须有触发条件/步骤/负责人且经过演练。
"""
import json
import sys
from datetime import date

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
GO_VERDICTS = ("GO", "CONDITIONAL GO", "NO-GO")


def load(fs):
    try:
        with open("output.json", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except FileNotFoundError:
        fs.append("MISSING_INPUT: output.json was not sealed")
    except ValueError as exc:
        fs.append("UNPARSEABLE_INPUT: output.json: " + str(exc))
    return None


def write_check(status, findings, reason=None):
    with open("game-launch-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


def blanks(value, path):
    found = []
    if isinstance(value, str):
        low = value.lower()
        found += ["PLACEHOLDER_TEXT: " + path + " contains " + t for t in PLACEHOLDERS if t in low]
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += blanks(item, path + "[" + str(index) + "]")
    elif isinstance(value, dict):
        for key, item in value.items():
            found += blanks(item, path + "." + str(key))
    return found


def main():
    findings = []
    doc = load(findings)
    if doc is None:
        write_check("violations", findings)
        return 1
    blockers = doc.get("blockers") or []
    if doc.get("status") == "blocked" and blockers and all(str(i).startswith("MISSING_INFO") for i in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(i) for i in blockers])
        return 2

    phases = doc.get("phases") or []
    ids = [str(item.get("id", "")) for item in phases]
    if len(phases) < 4:
        findings.append("PHASES_TOO_FEW: " + str(len(phases)) + " < 4")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_PHASE_ID: phase ids must be unique")
    blocked_phases = 0
    for index, item in enumerate(phases):
        state = item.get("status")
        if state not in ("complete", "in-progress", "blocked"):
            findings.append("BAD_PHASE_STATUS: phases[" + str(index) + "] has " + repr(state))
        if state == "complete" and len(str(item.get("evidence", "")).strip()) < 5:
            findings.append("COMPLETE_WITHOUT_EVIDENCE: phases[" + str(index) + "] claims completion without evidence")
        if state == "blocked":
            blocked_phases += 1

    severity = {}
    for index, item in enumerate(blockers):
        severity[str(item.get("id", ""))] = item.get("severity")
        if item.get("severity") not in ("critical", "major", "minor"):
            findings.append("BAD_BLOCKER_SEVERITY: blockers[" + str(index) + "] has " + repr(item.get("severity")))
        if not str(item.get("owner", "")).strip():
            findings.append("OWNERLESS_BLOCKER: blockers[" + str(index) + "] has no owner")
        if len(str(item.get("mitigation", "")).strip()) < 10:
            findings.append("UNMITIGATED_BLOCKER: blockers[" + str(index) + "] states no mitigation")
    critical_open = sum(1 for value in severity.values() if value == "critical")

    for index, item in enumerate(doc.get("risks") or []):
        if len(str(item.get("mitigation", "")).strip()) < 10:
            findings.append("UNMITIGATED_RISK: risks[" + str(index) + "] states no mitigation")

    rollback = doc.get("rollback") or {}
    if len(str(rollback.get("trigger", "")).strip()) < 10:
        findings.append("ROLLBACK_WITHOUT_TRIGGER: rollback.trigger is missing")
    if len(rollback.get("steps") or []) < 3:
        findings.append("ROLLBACK_STEPS_TOO_FEW: rollback.steps needs at least 3 entries")
    if not str(rollback.get("owner", "")).strip():
        findings.append("ROLLBACK_WITHOUT_OWNER: rollback.owner is missing")
    try:
        date.fromisoformat(str(rollback.get("testedOn")))
    except ValueError:
        findings.append("ROLLBACK_NOT_TESTED: rollback.testedOn must be a YYYY-MM-DD rehearsal date")

    decision = doc.get("decision")
    if decision not in GO_VERDICTS:
        findings.append("BAD_DECISION: decision must be one of " + "/".join(GO_VERDICTS))
    elif decision == "GO" and (blocked_phases or critical_open):
        findings.append("GO_WITH_OPEN_ISSUES: GO is not allowed with " + str(blocked_phases) + " blocked phase(s) and " +
                        str(critical_open) + " critical blocker(s)")
    if decision in ("CONDITIONAL GO", "NO-GO") and not blockers:
        findings.append("CONDITION_UNSTATED: " + str(decision) + " requires the blocking items to be listed")

    findings += blanks(doc, "output")
    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
