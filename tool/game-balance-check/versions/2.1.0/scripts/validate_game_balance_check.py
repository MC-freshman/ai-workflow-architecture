#!/usr/bin/env python3
"""game-balance-check 交付物完整性门禁（Z10 §6.2 批 B 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（平衡报告包），写入
game-balance-check-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

门禁做的是可复算的算术：指标的 verdict 必须与 observed/target/tolerance 自洽、
经济净流量必须等于水龙头减水槽、每条失衡都必须被至少一条调参建议覆盖、
严重失衡必须带可验证的预期效果。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
SEVERITIES = ("critical", "major", "minor")
EPSILON = 0.01


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
    with open("game-balance-check-check.json", "w", encoding="utf-8") as stream:
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


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


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

    metrics = deliverable.get("metrics") or []
    metric_ids = [str(item.get("id", "")) for item in metrics]
    if len(metrics) < 3:
        findings.append("METRICS_TOO_FEW: " + str(len(metrics)) + " < 3")
    if len(set(metric_ids)) != len(metric_ids):
        findings.append("DUPLICATE_METRIC_ID: metric ids must be unique")
    for index, item in enumerate(metrics):
        observed, target, tolerance = item.get("observed"), item.get("target"), item.get("tolerance")
        if not all(number(value) for value in (observed, target, tolerance)) or tolerance < 0:
            findings.append("UNQUANTIFIED_METRIC: metrics[" + str(index) + "] needs numeric observed/target and a non-negative tolerance")
            continue
        expected = "pass" if abs(observed - target) <= tolerance else "fail"
        if item.get("verdict") != expected:
            findings.append("VERDICT_MISMATCH: metrics[" + str(index) + "] declares " + str(item.get("verdict")) +
                            " but |" + str(observed) + " - " + str(target) + "| vs tolerance " + str(tolerance) +
                            " implies " + expected)

    economy = deliverable.get("economy") or {}
    faucets = economy.get("faucets") or []
    sinks = economy.get("sinks") or []
    if not faucets or not sinks:
        findings.append("ECONOMY_INCOMPLETE: economy needs at least one faucet and one sink")
    inflow = sum(item.get("rate", 0) for item in faucets if number(item.get("rate")))
    outflow = sum(item.get("rate", 0) for item in sinks if number(item.get("rate")))
    declared_flow = economy.get("netFlow")
    if number(declared_flow):
        if abs(declared_flow - (inflow - outflow)) > max(EPSILON, abs(inflow) * 0.001):
            findings.append("NET_FLOW_MISMATCH: declared netFlow " + str(declared_flow) + " but faucets(" +
                            str(round(inflow, 4)) + ") - sinks(" + str(round(outflow, 4)) + ") = " +
                            str(round(inflow - outflow, 4)))
    else:
        findings.append("MISSING_NET_FLOW: economy.netFlow must be a number")

    imbalances = deliverable.get("imbalances") or []
    imbalance_ids = [str(item.get("id", "")) for item in imbalances]
    if len(set(imbalance_ids)) != len(imbalance_ids):
        findings.append("DUPLICATE_IMBALANCE_ID: imbalance ids must be unique")
    for index, item in enumerate(imbalances):
        if item.get("severity") not in SEVERITIES:
            findings.append("BAD_SEVERITY: imbalances[" + str(index) + "] has " + repr(item.get("severity")))
        if len(str(item.get("recommendation", "")).strip()) < 10:
            findings.append("MISSING_FIX: imbalances[" + str(index) + "] states no recommendation")
        if len(str(item.get("expectedEffect", "")).strip()) < 10:
            findings.append("MISSING_EFFECT: imbalances[" + str(index) + "] states no expected effect")

    recommendations = deliverable.get("recommendations") or []
    if len(recommendations) < 3:
        findings.append("RECOMMENDATIONS_TOO_FEW: " + str(len(recommendations)) + " < 3")
    addressed = set()
    for index, item in enumerate(recommendations):
        if len(str(item.get("action", "")).strip()) < 10:
            findings.append("THIN_RECOMMENDATION: recommendations[" + str(index) + "] states no action")
        if len(str(item.get("expectedImpact", "")).strip()) < 5:
            findings.append("MISSING_IMPACT: recommendations[" + str(index) + "] states no expected impact")
        for ref in [str(value) for value in item.get("addresses", [])]:
            if ref not in imbalance_ids:
                findings.append("UNKNOWN_IMBALANCE_REF: recommendations[" + str(index) + "] cites " + repr(ref))
            else:
                addressed.add(ref)
    for ident in imbalance_ids:
        if ident not in addressed:
            findings.append("UNADDRESSED_IMBALANCE: " + ident + " is reported but no recommendation covers it")

    if not blockers and deliverable.get("status") in {"partial", "blocked"}:
        findings.append("UNEXPLAINED_PARTIAL: status " + str(deliverable.get("status")) + " without blockers")
    if not (deliverable.get("unavailableChecks") or []):
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")

    findings += blanks(deliverable, "output")

    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
