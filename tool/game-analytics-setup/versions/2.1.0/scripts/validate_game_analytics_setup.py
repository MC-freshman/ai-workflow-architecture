#!/usr/bin/env python3
"""game-analytics-setup 交付物完整性门禁（Z10 §6.2 批 C1）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json，写 game-analytics-setup-check.json，
退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

上游的硬规则：埋点必须先有目标再有事件（每个目标都要被事件覆盖）、KPI 必须有可复算口径、
事件名唯一且规范、涉及个人信息的事件必须触发同意与保留期要求。
"""
import json
import re
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
EVENT_NAME = re.compile(r"^[a-z][a-z0-9_]{2,}$")


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
    with open("game-analytics-setup-check.json", "w", encoding="utf-8") as stream:
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

    events = doc.get("events") or []
    names = [str(item.get("name", "")) for item in events]
    if len(events) < 5:
        findings.append("EVENTS_TOO_FEW: " + str(len(events)) + " < 5")
    if len(set(names)) != len(names):
        findings.append("DUPLICATE_EVENT_NAME: event names must be unique")
    for index, name in enumerate(names):
        if not EVENT_NAME.match(name):
            findings.append("BAD_EVENT_NAME: events[" + str(index) + "] " + repr(name) + " is not snake_case")
    kpis = doc.get("kpis") or []
    kpi_names = [str(item.get("name", "")) for item in kpis]
    if len(kpis) < 2:
        findings.append("KPIS_TOO_FEW: " + str(len(kpis)) + " < 2")
    if len(set(kpi_names)) != len(kpi_names):
        findings.append("DUPLICATE_KPI_NAME: KPI names must be unique")
    for index, item in enumerate(kpis):
        if len(str(item.get("formula", "")).strip()) < 8:
            findings.append("KPI_WITHOUT_FORMULA: kpis[" + str(index) + "] has no recomputable definition")

    covered = set()
    for index, item in enumerate(doc.get("goals") or []):
        for ref in [str(v) for v in item.get("kpis", [])]:
            if ref not in kpi_names:
                findings.append("UNKNOWN_KPI_REF: goals[" + str(index) + "] cites " + repr(ref))
        for ref in [str(v) for v in item.get("eventNames", [])]:
            if ref not in names:
                findings.append("UNKNOWN_EVENT_REF: goals[" + str(index) + "] cites " + repr(ref))
            else:
                covered.add(ref)
    for name in names:
        if name not in covered:
            findings.append("UNCOVERED_EVENT: " + name + " answers no analytics goal")

    privacy = doc.get("privacy") or {}
    pii = [str(v) for v in privacy.get("piiEvents", [])]
    for ref in pii:
        if ref not in names:
            findings.append("UNKNOWN_PII_EVENT: privacy.piiEvents cites " + repr(ref))
    if pii and privacy.get("consentRequired") is not True:
        findings.append("PII_WITHOUT_CONSENT: personal-data events require consentRequired=true")
    if pii and int(privacy.get("dataRetentionDays", 0) or 0) < 1:
        findings.append("PII_WITHOUT_RETENTION: personal-data events require a retention period")

    findings += blanks(doc, "output")
    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
