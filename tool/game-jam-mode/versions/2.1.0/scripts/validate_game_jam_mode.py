#!/usr/bin/env python3
"""game-jam-mode 交付物完整性门禁（Z10 §6.2 批 C1）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json，写 game-jam-mode-check.json，退出 0/1/2。

上游的硬规则：时间盒是固定的（48 或 72 小时）、MVP 必须在中点前完成、提交窗口不得少于
4 小时、打磨只能排在 MVP 之后（依赖关系必须体现这个次序）。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
DURATIONS = (48, 72)
SUBMISSION_MIN_HOURS = 4


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
    with open("game-jam-mode-check.json", "w", encoding="utf-8") as stream:
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
    doc = load(findings)
    if doc is None:
        write_check("violations", findings)
        return 1
    blockers = doc.get("blockers") or []
    if doc.get("status") == "blocked" and blockers and all(str(i).startswith("MISSING_INFO") for i in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(i) for i in blockers])
        return 2

    jam = doc.get("jam") or {}
    duration = jam.get("durationHours")
    if duration not in DURATIONS:
        findings.append("BAD_JAM_DURATION: jam.durationHours must be 48 or 72, got " + repr(duration))

    tasks = doc.get("tasks") or []
    ids = [str(item.get("id", "")) for item in tasks]
    if len(tasks) < 4:
        findings.append("TASKS_TOO_FEW: " + str(len(tasks)) + " < 4")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_TASK_ID: task ids must be unique")
    tier = {}
    graph = {}
    for index, item in enumerate(tasks):
        ident = str(item.get("id", ""))
        tier[ident] = item.get("tier")
        if item.get("tier") not in ("mvp", "polish", "submission"):
            findings.append("BAD_TIER: tasks[" + str(index) + "] has " + repr(item.get("tier")))
        if not str(item.get("owner", "")).strip():
            findings.append("OWNERLESS_TASK: tasks[" + str(index) + "] has no owner")
        deps = [str(v) for v in item.get("dependsOn", [])]
        for ref in deps:
            if ref not in ids:
                findings.append("UNKNOWN_TASK_DEPENDENCY: tasks[" + str(index) + "] depends on " + repr(ref))
        graph[ident] = [ref for ref in deps if ref in ids]
    loop = cycle(graph)
    if loop:
        findings.append("TASK_CYCLE: " + " -> ".join(loop))
    rank = {"mvp": 0, "polish": 1, "submission": 2}
    for ident, item in zip(ids, tasks):
        mine = rank.get(item.get("tier"))
        upstream = [graph.get(ident, [])]
        deps = upstream[0] if upstream else []
        if item.get("tier") in ("polish", "submission") and not deps:
            findings.append("POLISH_BEFORE_MVP: " + ident + " is " + str(item.get("tier")) + " but depends on nothing")
        for ref in deps:
            theirs = rank.get(tier.get(ref))
            if mine is not None and theirs is not None and theirs > mine:
                findings.append("TIER_ORDER_VIOLATION: " + ident + " (" + str(item.get("tier")) + ") depends on " + ref +
                                " (" + str(tier.get(ref)) + ")")

    budget = doc.get("budget") or {}
    for bucket in ("mvpHours", "polishHours", "submissionHours"):
        if not isinstance(budget.get(bucket), (int, float)) or isinstance(budget.get(bucket), bool):
            findings.append("MISSING_BUDGET: budget." + bucket + " is not a number")
    if isinstance(budget.get("mvpHours"), (int, float)) and isinstance(duration, int) and budget["mvpHours"] > duration / 2.0:
        findings.append("MVP_PAST_HALFWAY: mvp budget " + str(budget["mvpHours"]) + "h exceeds half of the " + str(duration) + "h jam")
    if isinstance(budget.get("submissionHours"), (int, float)) and budget["submissionHours"] < SUBMISSION_MIN_HOURS:
        findings.append("SUBMISSION_WINDOW_TOO_SMALL: " + str(budget["submissionHours"]) + "h < " + str(SUBMISSION_MIN_HOURS) + "h")
    declared = sum(v for k, v in budget.items() if isinstance(v, (int, float)) and not isinstance(v, bool))
    planned = sum(item.get("estimateHours", 0) for item in tasks if isinstance(item.get("estimateHours"), (int, float)))
    if isinstance(duration, int) and abs(declared - duration) > 1:
        findings.append("BUDGET_MISMATCH: tiers sum to " + str(round(declared, 2)) + "h against a " + str(duration) + "h jam")
    if isinstance(duration, int) and planned > duration + 1:
        findings.append("TASKS_OVER_BUDGET: task estimates " + str(round(planned, 2)) + "h exceed the jam window")

    findings += blanks(doc, "output")
    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
