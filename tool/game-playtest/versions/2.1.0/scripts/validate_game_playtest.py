#!/usr/bin/env python3
"""game-playtest 交付物完整性门禁（Z10 §6.2 批 B 迁移）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json（试玩报告包），写入
game-playtest-check.json，退出 0（通过）/ 1（违规，可修复）/ 2（信息缺失）。

上游的硬规则在这里变成可判定项：问题必须可观察且绑定决策、测试者至少 5 人且不得是
开发成员、结论必须引用行为观察（行为数据优先于口头数据）、每个问题都要有结论或显式
标记未回答、主持人不得参与游玩。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
MIN_TESTERS = 5
MIN_OBJECTIVES = 3
MAX_OBJECTIVES = 5


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
    with open("game-playtest-check.json", "w", encoding="utf-8") as stream:
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

    objectives = deliverable.get("objectives") or []
    objective_ids = [str(item.get("id", "")) for item in objectives]
    if not MIN_OBJECTIVES <= len(objectives) <= MAX_OBJECTIVES:
        findings.append("OBJECTIVE_COUNT: a playtest needs " + str(MIN_OBJECTIVES) + "-" + str(MAX_OBJECTIVES) +
                        " specific questions, found " + str(len(objectives)))
    if len(set(objective_ids)) != len(objective_ids):
        findings.append("DUPLICATE_OBJECTIVE_ID: objective ids must be unique")
    for index, item in enumerate(objectives):
        if item.get("observable") is not True:
            findings.append("UNOBSERVABLE_OBJECTIVE: objectives[" + str(index) + "] is not answerable by observation")
        if len(str(item.get("metric", "")).strip()) < 3:
            findings.append("OBJECTIVE_WITHOUT_METRIC: objectives[" + str(index) + "] states no measurement")
        if len(str(item.get("decision", "")).strip()) < 8:
            findings.append("OBJECTIVE_WITHOUT_DECISION: objectives[" + str(index) + "] informs no decision")

    testers = deliverable.get("testers") or []
    tester_ids = [str(item.get("id", "")) for item in testers]
    if len(testers) < MIN_TESTERS:
        findings.append("TESTERS_TOO_FEW: " + str(len(testers)) + " < " + str(MIN_TESTERS) + " turns data into anecdotes")
    if len(set(tester_ids)) != len(tester_ids):
        findings.append("DUPLICATE_TESTER_ID: tester ids must be unique")
    for index, item in enumerate(testers):
        if item.get("fromDevelopmentTeam") is not False:
            findings.append("DEVELOPER_AS_TESTER: testers[" + str(index) + "] is not marked as an outside tester")

    observations = deliverable.get("observations") or []
    observation_ids = [str(item.get("id", "")) for item in observations]
    if not observations:
        findings.append("NO_OBSERVATIONS: behavioral data is the point of a playtest")
    if len(set(observation_ids)) != len(observation_ids):
        findings.append("DUPLICATE_OBSERVATION_ID: observation ids must be unique")
    for index, item in enumerate(observations):
        if str(item.get("testerId", "")) not in tester_ids:
            findings.append("UNKNOWN_TESTER_REF: observations[" + str(index) + "] cites " +
                            repr(item.get("testerId")) + ", which is not a tester of this session")
        if len(str(item.get("behaviour", "")).strip()) < 10:
            findings.append("THIN_OBSERVATION: observations[" + str(index) + "] records no observable behaviour")

    result_links = deliverable.get("findings") or []
    finding_ids = [str(item.get("id", "")) for item in result_links]
    if len(set(finding_ids)) != len(finding_ids):
        findings.append("DUPLICATE_FINDING_ID: finding ids must be unique")
    answered = set()
    for index, item in enumerate(result_links):
        ref = str(item.get("objectiveId", ""))
        if ref not in objective_ids:
            findings.append("UNKNOWN_OBJECTIVE_REF: findings[" + str(index) + "] cites " + repr(ref))
        else:
            answered.add(ref)
        cited = [str(value) for value in item.get("observationIds", [])]
        if not cited:
            findings.append("UNCITED_FINDING: findings[" + str(index) + "] cites no behavioural observation")
        for value in cited:
            if value not in observation_ids:
                findings.append("UNKNOWN_OBSERVATION_REF: findings[" + str(index) + "] cites " + repr(value))
        if len(str(item.get("interpretation", "")).strip()) < 10:
            findings.append("THIN_INTERPRETATION: findings[" + str(index) + "] states no interpretation")
        if len(str(item.get("action", "")).strip()) < 10:
            findings.append("MISSING_ACTION: findings[" + str(index) + "] recommends nothing")
    unanswered = [str(item.get("id")) for item in objectives if str(item.get("id")) not in answered and not item.get("unanswered")]
    for ident in unanswered:
        findings.append("UNANSWERED_OBJECTIVE: " + ident + " has no finding and is not marked unanswered")

    protocol = deliverable.get("protocol") or {}
    if protocol.get("facilitatorPlays") is not False:
        findings.append("FACILITATOR_PLAYS: the facilitator must observe, not play")
    if int(protocol.get("sessionMinutes", 0) or 0) <= 0:
        findings.append("MISSING_SESSION_PLAN: protocol.sessionMinutes must be positive")

    if not blockers and deliverable.get("status") in {"partial", "blocked"}:
        findings.append("UNEXPLAINED_PARTIAL: status " + str(deliverable.get("status")) + " without blockers")
    if not (deliverable.get("unavailableChecks") or []):
        findings.append("CAPABILITY_BOUNDARY_MISSING: unavailableChecks must record the NOT_RUN capabilities")

    findings += blanks(deliverable, "output")

    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
