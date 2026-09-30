#!/usr/bin/env python3
"""game-localization-manager 交付物完整性门禁（Z10 §6.2 批 C1）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json，写 game-localization-manager-check.json，
退出 0/1/2。

上游的硬规则：存在硬编码字符串就不能宣称就绪、工作量与预算必须可复算、
语言代码必须规范唯一、每门语言都必须有排期与预算。
"""
import json
import re
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
LANGUAGE_CODE = re.compile(r"^[a-z]{2}(-[A-Z]{2})?$")


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
    with open("game-localization-manager-check.json", "w", encoding="utf-8") as stream:
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

    readiness = doc.get("readiness") or {}
    hardcoded = int(readiness.get("hardcodedStrings", 0) or 0)
    in_images = int(readiness.get("textInImages", 0) or 0)
    if readiness.get("externalized") is not True and hardcoded == 0:
        findings.append("READINESS_CONTRADICTION: externalized is false yet no hardcoded strings are reported")
    if (hardcoded or in_images) and doc.get("status") == "pass":
        findings.append("NOT_READY_CLAIMED_READY: " + str(hardcoded) + " hardcoded string(s) and " + str(in_images) +
                        " text-in-image item(s) must be remediated before a pass verdict")
    if (hardcoded or in_images) and not (doc.get("remediation") or []):
        findings.append("NO_REMEDIATION: outstanding i18n debt needs a remediation roadmap")

    effort = doc.get("effort") or {}
    words = effort.get("wordCount")
    per_kword = effort.get("hoursPerKWord")
    total = effort.get("totalHours")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (words, per_kword, total)):
        findings.append("EFFORT_NOT_QUANTIFIED: effort needs numeric wordCount, hoursPerKWord and totalHours")
    elif abs(words / 1000.0 * per_kword - total) > max(1.0, total * 0.02):
        findings.append("EFFORT_MISMATCH: wordCount/1000 * hoursPerKWord = " + str(round(words / 1000.0 * per_kword, 2)) +
                        "h but totalHours is " + str(total))

    languages = doc.get("languages") or []
    codes = [str(item.get("code", "")) for item in languages]
    if not languages:
        findings.append("NO_LANGUAGES: the plan names no target language")
    if len(set(codes)) != len(codes):
        findings.append("DUPLICATE_LANGUAGE: language codes must be unique")
    language_hours = 0.0
    for index, item in enumerate(languages):
        if not LANGUAGE_CODE.match(str(item.get("code", ""))):
            findings.append("BAD_LANGUAGE_CODE: languages[" + str(index) + "] " + repr(item.get("code")) + " is not BCP-47 shaped")
        for field in ("schedule", "budgetUsd"):
            if item.get(field) in (None, "", []):
                findings.append("INCOMPLETE_LANGUAGE: languages[" + str(index) + "] has no " + field)
        if isinstance(item.get("hours"), (int, float)) and not isinstance(item.get("hours"), bool):
            language_hours += item["hours"]
    if isinstance(total, (int, float)) and not isinstance(total, bool) and language_hours > total + 1:
        findings.append("LANGUAGE_HOURS_EXCEED_TOTAL: languages sum to " + str(round(language_hours, 2)) + "h > totalHours " + str(total))

    findings += blanks(doc, "output")
    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
