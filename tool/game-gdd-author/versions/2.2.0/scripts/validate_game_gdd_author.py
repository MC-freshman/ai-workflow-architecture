#!/usr/bin/env python3
"""game-gdd-author 交付物完整性门禁（Z10 §6.2 批 A 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（设计文档包），写入
game-gdd-author-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

重点：系统依赖图必须无环且不引用不存在的系统；每条验收标准必须指向真实系统；
每个系统至少有一条验收标准（否则该系统不可验收）。
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
    with open("game-gdd-author-check.json", "w", encoding="utf-8") as stream:
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


def cycle(graph):
    state = {}
    path = []

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
    deliverable = load("output.json", findings)
    if deliverable is None:
        write_check("violations", findings)
        return 1

    blocked = deliverable.get("status") == "blocked"
    blockers = deliverable.get("blockers") or []
    if blocked and blockers and all(str(item).startswith("MISSING_INFO") for item in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(item) for item in blockers])
        return 2

    gdd = deliverable.get("gdd") or {}
    pillars = gdd.get("pillars") or []
    if len(pillars) < 2:
        findings.append("PILLARS_TOO_FEW: gdd.pillars needs at least 2 entries")
    if len(set(pillars)) != len(pillars):
        findings.append("DUPLICATE_PILLAR: gdd.pillars repeats an entry")
    if len(str(gdd.get("playerExperience", "")).strip()) < 20:
        findings.append("THIN_PLAYER_EXPERIENCE: gdd.playerExperience does not describe play")

    systems = deliverable.get("systems") or []
    ids = [str(item.get("id", "")) for item in systems]
    if len(systems) < 3:
        findings.append("SYSTEMS_TOO_FEW: " + str(len(systems)) + " < 3")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_SYSTEM_ID: system ids must be unique")
    graph = {}
    for index, item in enumerate(systems):
        dependencies = [str(name) for name in item.get("dependencies", [])]
        for name in dependencies:
            if name not in ids:
                findings.append("UNKNOWN_SYSTEM_DEPENDENCY: systems[" + str(index) + "] depends on " + repr(name))
        if str(item.get("id", "")) in dependencies:
            findings.append("SELF_DEPENDENCY: systems[" + str(index) + "] depends on itself")
        graph[str(item.get("id", ""))] = [name for name in dependencies if name in ids]
    loop = cycle(graph)
    if loop:
        findings.append("DEPENDENCY_CYCLE: " + " -> ".join(loop))

    criteria = deliverable.get("acceptanceCriteria") or []
    criterion_ids = [str(item.get("id", "")) for item in criteria]
    if len(criteria) < 5:
        findings.append("ACCEPTANCE_CRITERIA_TOO_FEW: " + str(len(criteria)) + " < 5")
    if len(set(criterion_ids)) != len(criterion_ids):
        findings.append("DUPLICATE_CRITERION_ID: acceptance criteria ids must be unique")
    covered = set()
    for index, item in enumerate(criteria):
        ref = str(item.get("systemId", ""))
        if ref not in ids:
            findings.append("UNKNOWN_SYSTEM_REF: acceptanceCriteria[" + str(index) + "] cites " + repr(ref))
        else:
            covered.add(ref)
        if len(str(item.get("criterion", "")).strip()) < 10:
            findings.append("THIN_CRITERION: acceptanceCriteria[" + str(index) + "] is not checkable")
        if len(str(item.get("verification", "")).strip()) < 10:
            findings.append("MISSING_VERIFICATION: acceptanceCriteria[" + str(index) + "] states no verification")
    for ident in ids:
        if ident not in covered:
            findings.append("UNVERIFIABLE_SYSTEM: " + ident + " has no acceptance criterion")

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
