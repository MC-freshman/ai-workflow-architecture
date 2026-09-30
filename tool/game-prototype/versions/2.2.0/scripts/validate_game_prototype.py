#!/usr/bin/env python3
"""game-prototype 交付物完整性门禁（Z10 §6.2 批 A 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（原型计划包），写入
game-prototype-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

重点：原型的价值在于能证伪——判定规则必须引用真实指标、必须覆盖每个指标，
且至少要有一条规则允许得出“放弃/改向”的结论。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")

NEGATIVE_VERDICTS = {"iterate", "cut"}


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
    with open("game-prototype-check.json", "w", encoding="utf-8") as stream:
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

    plan = deliverable.get("prototypePlan") or {}
    if len(str(plan.get("hypothesis", "")).strip()) < 20:
        findings.append("THIN_HYPOTHESIS: prototypePlan.hypothesis is not falsifiable as written")
    build = [str(item) for item in plan.get("build", [])]
    cut = [str(item) for item in plan.get("cut", [])]
    if len(build) < 2:
        findings.append("BUILD_TOO_SMALL: prototypePlan.build needs at least 2 items")
    if not cut:
        findings.append("CUT_EMPTY: prototypePlan.cut must state what the prototype leaves out")
    overlap = sorted(set(build) & set(cut))
    for name in overlap:
        findings.append("SCOPE_CONFLICT: " + name + " is both built and cut")

    metrics = deliverable.get("metrics") or []
    metric_ids = [str(item.get("id", "")) for item in metrics]
    if len(metrics) < 3:
        findings.append("METRICS_TOO_FEW: " + str(len(metrics)) + " < 3")
    if len(set(metric_ids)) != len(metric_ids):
        findings.append("DUPLICATE_METRIC_ID: metric ids must be unique")
    for index, item in enumerate(metrics):
        if len(str(item.get("method", "")).strip()) < 5:
            findings.append("MISSING_METHOD: metrics[" + str(index) + "] states no measurement method")
        if not str(item.get("target", "")).strip():
            findings.append("MISSING_TARGET: metrics[" + str(index) + "] states no target value")

    rules = deliverable.get("decisionRules") or []
    rule_ids = [str(item.get("metricId", "")) for item in rules]
    if len(rules) < 3:
        findings.append("DECISION_RULES_TOO_FEW: " + str(len(rules)) + " < 3")
    for index, ref in enumerate(rule_ids):
        if ref not in metric_ids:
            findings.append("UNKNOWN_METRIC_REF: decisionRules[" + str(index) + "] cites " + repr(ref))
    for ident in metric_ids:
        if ident not in rule_ids:
            findings.append("UNDECIDED_METRIC: " + ident + " drives no decision rule")
    verdicts = {str(item.get("verdict", "")) for item in rules}
    if verdicts and not verdicts & NEGATIVE_VERDICTS:
        findings.append("NO_FAIL_CRITERION: decision rules cannot conclude iterate/cut, so the prototype cannot be falsified")
    for index, item in enumerate(rules):
        if len(str(item.get("action", "")).strip()) < 10:
            findings.append("THIN_RULE_ACTION: decisionRules[" + str(index) + "] states no follow-up action")

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
