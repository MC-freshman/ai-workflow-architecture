#!/usr/bin/env python3
"""game-retrospective 交付物完整性门禁（Z10 §6.2 批 C2）。

读取 output.json，写 game-retrospective-check.json，退出 0/1/2。
上游的硬规则：六个透镜都要有"做对了什么"和"做错了什么"（只有好话的复盘不是复盘）、
砍单条目必须写明决策人、行动项必须挂回透镜、必须给出"最重要的一件事"。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
LENS_COUNT = 6


def _load(fs):
    try:
        with open("output.json", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except FileNotFoundError:
        fs.append("MISSING_INPUT: output.json was not sealed")
    except ValueError as exc:
        fs.append("UNPARSEABLE_INPUT: output.json: " + str(exc))
    return None


def _check(status, findings, reason=None):
    with open("game-retrospective-check.json", "w", encoding="utf-8") as stream:
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
    doc = _load(findings)
    if doc is None:
        _check("violations", findings)
        return 1
    blockers = doc.get("blockers") or []
    if doc.get("status") == "blocked" and blockers and all(str(i).startswith("MISSING_INFO") for i in blockers):
        _check("missing-info", ["MISSING_INFO: " + str(i) for i in blockers])
        return 2

    lenses = doc.get("lenses") or []
    ids = [str(item.get("id", "")) for item in lenses]
    if len(lenses) != LENS_COUNT:
        findings.append("LENS_COUNT: a retrospective walks " + str(LENS_COUNT) + " lenses, found " + str(len(lenses)))
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_LENS_ID: lens ids must be unique")
    for index, item in enumerate(lenses):
        for field in ("whatWorked", "whatDidNot"):
            if len(str(item.get(field, "")).strip()) < 10:
                findings.append("ONE_SIDED_LENS: lenses[" + str(index) + "] has nothing under " + field)
        if len(str(item.get("evidence", "")).strip()) < 5:
            findings.append("LENS_WITHOUT_EVIDENCE: lenses[" + str(index) + "] cites no evidence")

    for index, item in enumerate(doc.get("killList") or []):
        if len(str(item.get("reason", "")).strip()) < 10:
            findings.append("KILL_WITHOUT_REASON: killList[" + str(index) + "] states no reason")
        if len(str(item.get("decidedBy", "")).strip()) < 2:
            findings.append("KILL_WITHOUT_OWNER: killList[" + str(index) + "] names no decision owner")
    if not (doc.get("killList") or []):
        findings.append("EMPTY_KILL_LIST: a retrospective that kills nothing is not a retrospective")

    actions = doc.get("actions") or []
    if len(actions) < 2:
        findings.append("ACTIONS_TOO_FEW: " + str(len(actions)) + " < 2")
    for index, item in enumerate(actions):
        ref = str(item.get("lensId", ""))
        if ref not in ids:
            findings.append("UNKNOWN_LENS_REF: actions[" + str(index) + "] cites " + repr(ref))
        if not str(item.get("owner", "")).strip():
            findings.append("OWNERLESS_ACTION: actions[" + str(index) + "] has no owner")
        if len(str(item.get("action", "")).strip()) < 10:
            findings.append("THIN_ACTION: actions[" + str(index) + "] states no action")

    one = doc.get("oneThing") or {}
    if len(str(one.get("statement", "")).strip()) < 20:
        findings.append("MISSING_ONE_THING: oneThing.statement is missing or too thin")
    if not str(one.get("owner", "")).strip():
        findings.append("ONE_THING_WITHOUT_OWNER: oneThing.owner is missing")

    findings += blanks(doc, "output")
    _check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
