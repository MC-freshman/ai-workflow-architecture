#!/usr/bin/env python3
"""game-team-orchestrator 交付物完整性门禁（Z10 §6.2 批 B 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（编排计划包），写入
game-team-orchestrator-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

上游是"多 agent 派发"工作流，而引擎 0.6.0 之前 peer/subworkflow 执行路径未转正，
因此迁移后的交付物是**编排计划**：每人一份工作包、依赖图无环、跨层不得跳跃（跳过层级
即违规）、每条依赖边都必须有交接文档、冲突必须有上报路径，并且必须显式声明
`executionMode: plan-only`——本轮没有真的派发任何 agent。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
SPAWN_MARKERS = ("spawn", "派发", "peer", "subagent", "子代理")


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
    with open("game-team-orchestrator-check.json", "w", encoding="utf-8") as stream:
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

    blockers = deliverable.get("blockers") or []
    if deliverable.get("status") == "blocked" and blockers and all(str(item).startswith("MISSING_INFO") for item in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(item) for item in blockers])
        return 2

    if deliverable.get("executionMode") != "plan-only":
        findings.append("CLAIMS_DISPATCH: executionMode must be plan-only; agent dispatch is NOT_RUN before engine 0.6.0")

    packages = deliverable.get("workPackages") or []
    ids = [str(item.get("id", "")) for item in packages]
    tiers = {str(item.get("id", "")): item.get("tier") for item in packages}
    if len(packages) < 3:
        findings.append("PACKAGES_TOO_FEW: " + str(len(packages)) + " < 3")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_PACKAGE_ID: work package ids must be unique")
    graph = {}
    for index, item in enumerate(packages):
        if not str(item.get("owner", "")).strip():
            findings.append("OWNERLESS_PACKAGE: workPackages[" + str(index) + "] has no single owner")
        if item.get("tier") not in (1, 2, 3):
            findings.append("BAD_TIER: workPackages[" + str(index) + "] declares tier " + repr(item.get("tier")))
        dependencies = [str(value) for value in item.get("dependsOn", [])]
        if str(item.get("id", "")) in dependencies:
            findings.append("SELF_DEPENDENCY: workPackages[" + str(index) + "] depends on itself")
        for ref in dependencies:
            if ref not in ids:
                findings.append("UNKNOWN_PACKAGE_DEPENDENCY: workPackages[" + str(index) + "] depends on " + repr(ref))
        for ref in dependencies:
            if ref in tiers:
                here, there = item.get("tier"), tiers[ref]
                if isinstance(here, int) and isinstance(there, int) and abs(here - there) > 1:
                    findings.append("TIER_SKIPPED: " + str(item.get("id")) + " (tier " + str(here) +
                                    ") hands off to " + ref + " (tier " + str(there) + ")")
        graph[str(item.get("id", ""))] = [ref for ref in dependencies if ref in ids]
    loop = cycle(graph)
    if loop:
        findings.append("DEPENDENCY_CYCLE: " + " -> ".join(loop))

    handoffs = deliverable.get("handoffs") or []
    edges = set()
    for item in handoffs:
        if str(item.get("from", "")) not in ids or str(item.get("to", "")) not in ids:
            continue
        edges.add((str(item.get("from")), str(item.get("to"))))
    for index, item in enumerate(handoffs):
        if not str(item.get("artifact", "")).strip():
            findings.append("MISSING_ARTIFACT: handoffs[" + str(index) + "] names no handoff document")
        if not (item.get("decisions") or []):
            findings.append("HANDOFF_WITHOUT_DECISIONS: handoffs[" + str(index) + "] carries no decision context")
        if not (item.get("openQuestions") or []):
            findings.append("HANDOFF_WITHOUT_OPEN_QUESTIONS: handoffs[" + str(index) + "] carries no open questions")
    for item in packages:
        target = str(item.get("id", ""))
        for ref in [str(value) for value in item.get("dependsOn", [])]:
            if ref in ids and (ref, target) not in edges:
                findings.append("UNDOCUMENTED_HANDOFF: " + ref + " -> " + target + " has no handoff document")

    conflicts = deliverable.get("conflicts") or []
    for index, item in enumerate(conflicts):
        between = [str(value) for value in item.get("between", [])]
        if len(between) != 2 or len(set(between)) != 2:
            findings.append("BAD_CONFLICT_PAIR: conflicts[" + str(index) + "] needs two distinct owners")
        if not str(item.get("routedTo", "")).strip():
            findings.append("UNROUTED_CONFLICT: conflicts[" + str(index) + "] has no escalation target")
        if item.get("status") not in {"open", "routed", "resolved"}:
            findings.append("BAD_CONFLICT_STATUS: conflicts[" + str(index) + "] has " + repr(item.get("status")))

    unavailable = [str(item).lower() for item in (deliverable.get("unavailableChecks") or [])]
    if not unavailable:
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")
    elif not any(any(marker in entry for marker in SPAWN_MARKERS) for entry in unavailable):
        findings.append("SPAWN_NOT_MARKED_NOT_RUN: agent dispatch/spawning must be recorded as NOT_RUN in unavailableChecks")

    if not blockers and deliverable.get("status") in {"partial", "blocked"}:
        findings.append("UNEXPLAINED_PARTIAL: status " + str(deliverable.get("status")) + " without blockers")

    findings += blanks(deliverable, "output")

    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
