#!/usr/bin/env python3
"""game-start 交付物完整性门禁（Z10 §6.2 批 A 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（立项启动包），写入
game-start-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

检查的是 schema 表达不了的东西：里程碑与后续动作的相互引用、风险与成功标准的
可执行性、不可用能力是否已记为 NOT_RUN、以及占位文本是否被当成交付物。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")


def load(name, findings):
    try:
        with open(name, encoding="utf-8-sig") as stream:
            return json.load(stream)
    except FileNotFoundError:
        findings.append("MISSING_INPUT: " + name + " was not sealed")
        return None
    except ValueError as exc:
        findings.append("UNPARSEABLE_INPUT: " + name + ": " + str(exc))
        return None


def write_check(status, findings, reason=None):
    with open("game-start-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


def blanks(value, path):
    found = []
    if isinstance(value, str):
        lowered = value.lower()
        for token in PLACEHOLDERS:
            if token in lowered:
                found.append("PLACEHOLDER_TEXT: " + path + " contains " + token)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += blanks(item, path + "[" + str(index) + "]")
    elif isinstance(value, dict):
        for key, item in value.items():
            found += blanks(item, path + "." + str(key))
    return found


def main():
    findings = []
    deliverable = load("output.json", findings)
    if deliverable is None:
        write_check("violations", findings)
        return 1

    blocked = deliverable.get("status") == "blocked"
    blockers = deliverable.get("blockers") or []
    if blocked and blockers and all(str(item).startswith("MISSING_INFO") for item in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(item) for item in blockers])
        return 2

    charter = deliverable.get("charter") or {}
    criteria = charter.get("successCriteria") or []
    if len(criteria) < 2:
        findings.append("SUCCESS_CRITERIA_TOO_FEW: charter.successCriteria needs at least 2 entries")
    if len(set(criteria)) != len(criteria):
        findings.append("DUPLICATE_SUCCESS_CRITERION: charter.successCriteria repeats an entry")
    for index, item in enumerate(criteria):
        if len(str(item).strip()) < 8:
            findings.append("THIN_SUCCESS_CRITERION: charter.successCriteria[" + str(index) + "] is not checkable")

    milestones = deliverable.get("milestones") or []
    names = [str(item.get("name", "")) for item in milestones]
    targets = [str(item.get("target", "")) for item in milestones]
    if len(milestones) < 3:
        findings.append("MILESTONES_TOO_FEW: " + str(len(milestones)) + " < 3")
    if len(set(names)) != len(names):
        findings.append("DUPLICATE_MILESTONE_NAME: milestone names must be unique")
    if len(set(targets)) != len(targets):
        findings.append("DUPLICATE_MILESTONE_TARGET: two milestones share a target")
    for index, item in enumerate(milestones):
        if len(str(item.get("exitCriteria", "")).strip()) < 10:
            findings.append("THIN_EXIT_CRITERIA: milestones[" + str(index) + "] has no usable exit criteria")

    risks = deliverable.get("risks") or []
    risk_ids = [str(item.get("id", "")) for item in risks]
    if len(risks) < 3:
        findings.append("RISKS_TOO_FEW: " + str(len(risks)) + " < 3")
    if len(set(risk_ids)) != len(risk_ids):
        findings.append("DUPLICATE_RISK_ID: risk ids must be unique")
    for index, item in enumerate(risks):
        if len(str(item.get("description", "")).strip()) < 15:
            findings.append("THIN_RISK_DESCRIPTION: risks[" + str(index) + "] does not describe the risk")
        if len(str(item.get("mitigation", "")).strip()) < 10:
            findings.append("THIN_RISK_MITIGATION: risks[" + str(index) + "] has no usable mitigation")

    actions = deliverable.get("nextActions") or []
    if len(actions) < 2:
        findings.append("NEXT_ACTIONS_TOO_FEW: " + str(len(actions)) + " < 2")
    referenced = set()
    for index, item in enumerate(actions):
        ref = str(item.get("milestoneRef", ""))
        if ref not in names:
            findings.append("UNKNOWN_MILESTONE_REF: nextActions[" + str(index) + "] cites " + repr(ref))
        else:
            referenced.add(ref)
        if not str(item.get("owner", "")).strip():
            findings.append("OWNERLESS_ACTION: nextActions[" + str(index) + "] has no owner")
    for name in names:
        if name not in referenced:
            findings.append("UNCOVERED_MILESTONE: " + name + " has no next action")

    if not blockers and deliverable.get("status") in {"partial", "blocked"}:
        findings.append("UNEXPLAINED_PARTIAL: status " + str(deliverable.get("status")) + " without blockers")

    unavailable = deliverable.get("unavailableChecks") or []
    if not unavailable:
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")

    findings += blanks(deliverable, "output")

    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
