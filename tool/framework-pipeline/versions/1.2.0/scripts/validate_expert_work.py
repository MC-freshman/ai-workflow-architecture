#!/usr/bin/env python3
"""expert-task WORK 阶段门禁（Z10 S3-6a）。

在 WORK 尝试的证据目录内运行：读取 output.json（WORK 交付物），写入 expert-work-check.json，
退出 0（通过）/ 1（违规，可由 repair 修复）/ 2（信息缺失，非 repair 场景）。

只检查 schema 表达不了的东西：deliverable 三要素是否齐全、是否用占位文本充数、
未执行的检查是否老实记进 unavailableChecks、以及总状态与逐项状态是否自相矛盾。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>", "n/a")
DELIVERABLE_STATUS = ("delivered", "partial", "blocked", "not-run")


def write_check(status, findings, reason=None):
    with open("expert-work-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


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


def placeholders(value, path):
    found = []
    if isinstance(value, str):
        lowered = value.lower()
        for token in PLACEHOLDERS:
            if token in lowered:
                found.append("PLACEHOLDER_TEXT: " + path + " contains " + token)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += placeholders(item, path + "[" + str(index) + "]")
    elif isinstance(value, dict):
        for key, item in value.items():
            found += placeholders(item, path + "." + str(key))
    return found


def main():
    findings = []
    work = load("output.json", findings)
    if work is None:
        write_check("missing-info", findings)
        return 2

    deliverables = work.get("deliverables")
    if not isinstance(deliverables, list) or not deliverables:
        findings.append("NO_DELIVERABLE: deliverables must list at least one produced artifact")
        deliverables = []

    for index, item in enumerate(deliverables):
        label = "deliverables[" + str(index) + "]"
        if not isinstance(item, dict):
            findings.append("MALFORMED_DELIVERABLE: " + label + " is not an object")
            continue
        if not str(item.get("name") or "").strip():
            findings.append("MISSING_FIELD: " + label + ".name is required by the WORK prompt")
        if not (str(item.get("path") or "").strip() or str(item.get("inline") or "").strip()):
            findings.append("MISSING_FIELD: " + label + " needs path or inline")
        status = item.get("status")
        if not isinstance(status, str) or status not in DELIVERABLE_STATUS:
            findings.append("BAD_STATUS: " + label + ".status must be one of " + ", ".join(DELIVERABLE_STATUS))

    unavailable = work.get("unavailableChecks") or []
    if not isinstance(unavailable, list):
        findings.append("MALFORMED_FIELD: unavailableChecks must be a list")
        unavailable = []
    for index, item in enumerate(unavailable):
        if not str(item).strip():
            findings.append("EMPTY_ENTRY: unavailableChecks[" + str(index) + "] is blank")

    status = work.get("status")
    if status == "pass" and any(isinstance(item, dict) and item.get("status") == "blocked" for item in deliverables):
        findings.append("STATUS_CONTRADICTION: overall pass while a deliverable is blocked")
    if status == "pass" and any(isinstance(item, dict) and item.get("status") == "not-run" for item in deliverables) and not unavailable:
        findings.append("UNREPORTED_NOT_RUN: a deliverable is not-run but unavailableChecks is empty")

    findings += placeholders(deliverables, "deliverables")
    findings += placeholders(work.get("summary"), "summary")

    if findings:
        write_check("violations", findings)
        return 1
    write_check("passed", [], reason="WORK deliverables satisfy the prompt-level invariants")
    return 0


if __name__ == "__main__":
    sys.exit(main())
