#!/usr/bin/env python3
"""game-scope-check 交付物完整性门禁（Z10 §6.2 批 B 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（范围评估包），写入
game-scope-check-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

上游把规则写成了法律，这里逐条机械化：MoSCoW 百分比必须落在 60/25/15 的 ±5 点内、
分数低于 2.0 的功能不得留在 Must/Should 且必须进入砍单、Won't Have 至少 2 条、
缓冲不得低于 20%、冻结日必须早于里程碑 3 天，以及分配小时数必须与功能清单自洽。
"""
import json
import sys
from datetime import date

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
TARGETS = {"must": 60.0, "should": 25.0, "could": 15.0}
DRIFT = 5.0
CUT_SCORE = 2.0
MIN_BUFFER = 20.0
FREEZE_LEAD_DAYS = 3


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
    with open("game-scope-check-check.json", "w", encoding="utf-8") as stream:
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

    blockers = deliverable.get("blockers") or []
    if deliverable.get("status") == "blocked" and blockers and all(str(item).startswith("MISSING_INFO") for item in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(item) for item in blockers])
        return 2

    features = deliverable.get("features") or []
    ids = [str(item.get("id", "")) for item in features]
    if len(features) < 3:
        findings.append("FEATURES_TOO_FEW: " + str(len(features)) + " < 3")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_FEATURE_ID: feature ids must be unique")
    scores = [item.get("score") for item in features]
    for index in range(1, len(scores)):
        if scores[index] > scores[index - 1]:
            findings.append("SCORES_OUT_OF_ORDER: features[" + str(index) + "] scores above the entry before it")
            break
    buckets = {"must": [], "should": [], "could": [], "wont": []}
    for index, item in enumerate(features):
        moscow = item.get("moscow")
        if moscow not in buckets:
            findings.append("BAD_MOSCOW: features[" + str(index) + "] has " + repr(moscow))
            continue
        buckets[moscow].append(item)
        hours = item.get("estimateHours")
        if not isinstance(hours, (int, float)) or isinstance(hours, bool) or hours <= 0:
            findings.append("DISHONEST_ESTIMATE: features[" + str(index) + "] has no positive hour estimate")
        score = item.get("score")
        if isinstance(score, (int, float)) and score < CUT_SCORE and moscow in {"must", "should"}:
            findings.append("UNDERSCORED_IN_PLAN: " + str(item.get("id")) + " scores " + str(score) + " but stays in " + moscow)
        if isinstance(score, (int, float)) and score < CUT_SCORE and not deliverable.get("cuts"):
            findings.append("NO_CUT_LIST: a feature below " + str(CUT_SCORE) + " requires a cut list")

    if len(buckets["wont"]) < 2:
        findings.append("WONT_HAVE_EMPTY: an honest scope check names at least 2 features in Won't Have (found " + str(len(buckets["wont"])) + ")")

    allocation = deliverable.get("allocation") or {}
    planned = sum(item.get("estimateHours", 0) for item in buckets["must"] + buckets["should"] + buckets["could"])
    for bucket, target in TARGETS.items():
        declared = allocation.get(bucket)
        if not isinstance(declared, (int, float)) or isinstance(declared, bool):
            findings.append("MISSING_ALLOCATION: allocation." + bucket + " is not a number")
            continue
        counted = sum(item.get("estimateHours", 0) for item in buckets[bucket])
        if abs(declared - counted) > 0.01:
            findings.append("ALLOCATION_MISMATCH: allocation." + bucket + " declares " + str(declared) +
                            "h but the feature list sums to " + str(round(counted, 2)) + "h")
        if planned > 0:
            percent = declared / planned * 100.0
            if abs(percent - target) > DRIFT:
                findings.append("MOSCOW_DRIFT: " + bucket + " holds " + str(round(percent, 1)) + "% of planned hours, target " +
                                str(target) + "% ±" + str(DRIFT))

    capacity = deliverable.get("capacity") or {}
    net = capacity.get("netHours")
    buffer_hours = capacity.get("bufferHours")
    buffer_percent = capacity.get("bufferPercent")
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in (net, buffer_hours, buffer_percent)) and net:
        expected = buffer_hours / net * 100.0
        if abs(expected - buffer_percent) > 1.0:
            findings.append("BUFFER_INCONSISTENT: bufferPercent " + str(buffer_percent) + " does not match " +
                            str(round(expected, 1)) + "% implied by bufferHours/netHours")
        if buffer_percent < MIN_BUFFER:
            findings.append("BUFFER_TOO_SMALL: " + str(buffer_percent) + "% < " + str(MIN_BUFFER) + "%")
        if abs((planned + buffer_hours) - net) > max(1.0, net * 0.01):
            findings.append("CAPACITY_UNBALANCED: planned " + str(round(planned, 2)) + "h + buffer " + str(buffer_hours) +
                            "h != net " + str(net) + "h")
    else:
        findings.append("MISSING_CAPACITY: capacity needs numeric netHours, bufferHours and bufferPercent")

    cuts = deliverable.get("cuts") or []
    cut_ids = [str(item.get("featureId", "")) for item in cuts]
    for index, ref in enumerate(cut_ids):
        if ref not in ids:
            findings.append("UNKNOWN_CUT_REF: cuts[" + str(index) + "] cites " + repr(ref))
    for item in features:
        score = item.get("score")
        if isinstance(score, (int, float)) and score < CUT_SCORE and str(item.get("id")) not in cut_ids:
            findings.append("UNCUT_LOW_SCORE: " + str(item.get("id")) + " scores below " + str(CUT_SCORE) + " and is not in the cut list")

    freeze = deliverable.get("freeze") or {}
    try:
        milestone = date.fromisoformat(str(freeze.get("milestoneDate")))
        frozen = date.fromisoformat(str(freeze.get("freezeDate")))
        if (milestone - frozen).days != FREEZE_LEAD_DAYS:
            findings.append("FREEZE_NOT_THREE_DAYS: freeze date is " + str((milestone - frozen).days) +
                            " day(s) before the milestone, expected " + str(FREEZE_LEAD_DAYS))
    except ValueError:
        findings.append("BAD_FREEZE_DATE: freeze.milestoneDate and freeze.freezeDate must be YYYY-MM-DD")

    signals = deliverable.get("signals") or []
    if len(set(map(str, signals))) != len(signals):
        findings.append("DUPLICATE_SIGNAL: scope creep signals repeat")

    if not blockers and deliverable.get("status") in {"partial", "blocked"}:
        findings.append("UNEXPLAINED_PARTIAL: status " + str(deliverable.get("status")) + " without blockers")
    if not (deliverable.get("unavailableChecks") or []):
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")

    findings += blanks(deliverable, "output")

    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
