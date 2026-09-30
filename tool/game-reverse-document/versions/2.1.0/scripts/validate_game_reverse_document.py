#!/usr/bin/env python3
"""game-reverse-document 交付物完整性门禁（Z10 §6.2 批 C2）。

读取 output.json，写 game-reverse-document-check.json，退出 0/1/2。
上游的硬规则：逆向文档必须标注证据与置信度、系统依赖不得有环、交互必须落在已记录的系统上、
必须列出未知项（没有 gap 的逆向文档说明没有真正复盘）。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
CONFIDENCE = ("high", "medium", "low")


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
    with open("game-reverse-document-check.json", "w", encoding="utf-8") as stream:
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


def cycle(graph):
    state, path = {}, []

    def visit(node):
        if state.get(node) == "open":
            return path[path.index(node):] + [node]
        if state.get(node) == "done":
            return None
        state[node] = "open"
        path.append(node)
        for neighbour in graph.get(node, []):
            loop = visit(neighbour)
            if loop:
                return loop
        path.pop()
        state[node] = "done"
        return None

    for node in graph:
        loop = visit(node)
        if loop:
            return loop
    return None


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

    overview = doc.get("overview") or {}
    if len(str(overview.get("evidence", "")).strip()) < 5:
        findings.append("NO_EVIDENCE: overview.evidence must name the inspected artefacts")
    if overview.get("confidence") not in CONFIDENCE:
        findings.append("BAD_CONFIDENCE: overview.confidence must be high/medium/low")

    mechanics = doc.get("mechanics") or []
    if len(mechanics) < 3:
        findings.append("MECHANICS_TOO_FEW: " + str(len(mechanics)) + " < 3")
    for index, item in enumerate(mechanics):
        for parameter in item.get("parameters") or []:
            if parameter.get("confidence") not in CONFIDENCE:
                findings.append("UNMARKED_CONFIDENCE: mechanics[" + str(index) + "] parameter " +
                                repr(parameter.get("name")) + " states no confidence")
        if len(str(item.get("description", "")).strip()) < 10:
            findings.append("THIN_MECHANIC: mechanics[" + str(index) + "] describes nothing")

    systems = doc.get("systems") or []
    ids = [str(item.get("id", "")) for item in systems]
    if len(systems) < 3:
        findings.append("SYSTEMS_TOO_FEW: " + str(len(systems)) + " < 3")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_SYSTEM_ID: system ids must be unique")
    graph = {}
    for index, item in enumerate(systems):
        deps = [str(v) for v in item.get("dependsOn", [])]
        for ref in deps:
            if ref not in ids:
                findings.append("UNKNOWN_SYSTEM_REF: systems[" + str(index) + "] depends on " + repr(ref))
        if not (item.get("signals") or []):
            findings.append("SYSTEM_WITHOUT_SIGNAL: systems[" + str(index) + "] names no observable signal")
        graph[str(item.get("id", ""))] = [ref for ref in deps if ref in ids]
    loop = cycle(graph)
    if loop:
        findings.append("DEPENDENCY_CYCLE: " + " -> ".join(loop))

    for index, item in enumerate(doc.get("interactions") or []):
        for side in ("from", "to"):
            if str(item.get(side, "")) not in ids:
                findings.append("UNKNOWN_INTERACTION_REF: interactions[" + str(index) + "] " + side + " is " +
                                repr(item.get(side)))
    if len(doc.get("interactions") or []) < 2:
        findings.append("INTERACTIONS_TOO_FEW: a reverse doc maps at least two system interactions")

    if not (doc.get("gaps") or []):
        findings.append("NO_GAPS: an undocumented area with zero gaps means the pass was not honest")

    findings += blanks(doc, "output")
    _check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
