#!/usr/bin/env python3
"""game-code-review 交付物完整性门禁（Z10 §6.2 批 C2，单阶段：产物即消费方契约）。

读取 output.json（沿用旧消费方契约形状：scope / findings / unavailableChecks），
写 game-code-review-check.json，退出 0/1/2。

门禁只做机械可判定的事：路径必须是仓库内相对路径（不得逃逸、不得绝对路径、不得盘符）、
行号必须为正、结论必须按 (file, line) 排序、同一条结论不得重复、critical 必须给出足够理由。
"""
import json
import re
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
SEVERITIES = ("critical", "major", "minor")


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
    with open("game-code-review-check.json", "w", encoding="utf-8") as stream:
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


def safe_path(value):
    text = str(value)
    if not text or text.startswith("/") or text.startswith("\\"):
        return False
    if re.match(r"^[A-Za-z]:", text):
        return False
    parts = text.replace("\\", "/").split("/")
    return ".." not in parts and all(part not in ("", ".") for part in parts)


def main():
    findings = []
    doc = _load(findings)
    if doc is None:
        _check("violations", findings)
        return 1

    if doc.get("scope") != "static-local-review":
        findings.append("SCOPE_CHANGED: scope must stay static-local-review (legacy consumer contract)")

    rows = doc.get("findings") or []
    if not rows:
        findings.append("NO_FINDINGS: a review must state its findings explicitly")
    seen = set()
    for index, item in enumerate(rows):
        path = item.get("file")
        if not safe_path(path):
            findings.append("UNSAFE_PATH: findings[" + str(index) + "] cites " + repr(path) +
                            " which is not a repository-relative path")
        line = item.get("line")
        if not isinstance(line, int) or isinstance(line, bool) or line < 1:
            findings.append("BAD_LINE: findings[" + str(index) + "] line must be a positive integer")
        if item.get("severity") not in SEVERITIES:
            findings.append("BAD_SEVERITY: findings[" + str(index) + "] has " + repr(item.get("severity")))
        reason = str(item.get("reason", "")).strip()
        limit = 20 if item.get("severity") == "critical" else 8
        if len(reason) < limit:
            findings.append("THIN_REASON: findings[" + str(index) + "] needs at least " + str(limit) + " characters of reason")
        key = (str(path), line, str(item.get("severity")), reason)
        if key in seen:
            findings.append("DUPLICATE_FINDING: findings[" + str(index) + "] repeats an earlier row")
        seen.add(key)
    keys = [(str(item.get("file")), item.get("line") if isinstance(item.get("line"), int) else 0) for item in rows]
    for index in range(1, len(keys)):
        if keys[index] < keys[index - 1]:
            findings.append("FINDINGS_OUT_OF_ORDER: findings[" + str(index) + "] sorts before the row above it")
            break

    if not (doc.get("unavailableChecks") or []):
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")

    findings += blanks(doc, "output")
    _check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
