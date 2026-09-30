#!/usr/bin/env python3
"""game-brainstorm 交付物完整性门禁（Z10 §6.2 批 A 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（创意发散包），写入
game-brainstorm-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

schema 只能约束形状；这里约束的是发散与排序之间的一致性：每个概念被排序且只被
排序一次、排序确实是按分数降序、开放问题覆盖影响面。
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
    with open("game-brainstorm-check.json", "w", encoding="utf-8") as stream:
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

    concepts = deliverable.get("concepts") or []
    ids = [str(item.get("id", "")) for item in concepts]
    if len(concepts) < 3:
        findings.append("CONCEPTS_TOO_FEW: " + str(len(concepts)) + " < 3")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_CONCEPT_ID: concept ids must be unique")
    for index, item in enumerate(concepts):
        if len(str(item.get("coreLoop", "")).strip()) < 10:
            findings.append("THIN_CORE_LOOP: concepts[" + str(index) + "] has no core loop")
        if len(str(item.get("hook", "")).strip()) < 5:
            findings.append("MISSING_HOOK: concepts[" + str(index) + "] states no differentiator")

    ranking = deliverable.get("ranking") or []
    if len(ranking) < 3:
        findings.append("RANKING_TOO_SHORT: " + str(len(ranking)) + " < 3")
    ranked = [str(item.get("conceptId", "")) for item in ranking]
    for index, ref in enumerate(ranked):
        if ref not in ids:
            findings.append("UNKNOWN_CONCEPT_REF: ranking[" + str(index) + "] cites " + repr(ref))
    duplicates = {ref for ref in ranked if ranked.count(ref) > 1}
    for ref in sorted(duplicates):
        findings.append("DOUBLE_RANKED_CONCEPT: " + ref + " is ranked more than once")
    for ident in ids:
        if ident not in ranked:
            findings.append("UNRANKED_CONCEPT: " + ident + " is not ranked")
    scores = [item.get("score") for item in ranking]
    if any(not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 10 for score in scores):
        findings.append("BAD_SCORE: scores must be integers within 0..10")
    else:
        for index in range(1, len(scores)):
            if scores[index] > scores[index - 1]:
                findings.append("RANKING_OUT_OF_ORDER: ranking[" + str(index) + "] scores higher than the entry above it")
                break
    for index, item in enumerate(ranking):
        if len(str(item.get("rationale", "")).strip()) < 10:
            findings.append("THIN_RATIONALE: ranking[" + str(index) + "] gives no reason")

    questions = deliverable.get("openQuestions") or []
    if len(questions) < 2:
        findings.append("OPEN_QUESTIONS_TOO_FEW: " + str(len(questions)) + " < 2")
    texts = [str(item.get("question", "")) for item in questions]
    for index, text in enumerate(texts):
        if len(text.strip()) < 10:
            findings.append("THIN_QUESTION: openQuestions[" + str(index) + "] is not answerable")
    if len(set(texts)) != len(texts):
        findings.append("DUPLICATE_QUESTION: openQuestions repeats a question")

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
