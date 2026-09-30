"""Deterministic plan-integrity checker for game-sprint-plan 2.1.0 (M4-06).

Runs inside the review attempt's evidence directory. Reads intake.json,
capacity.json, plan.json (sealed copies), writes plan-check.json, and exits
0 (pass) / 1 (violations, repairable) / 2 (missing information — wait for user).
"""
import json
import sys

TIER_LIMITS = {"must": 0.60, "should": 0.25, "could": 0.15}


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


def main():
    findings = []
    intake = load("intake.json", findings)
    capacity = load("capacity.json", findings)
    plan = load("plan.json", findings)
    if intake is None or capacity is None or plan is None:
        write_check("violations", findings)
        return 1

    if intake.get("missing"):
        write_check("missing-info", ["MISSING_INFO: " + item for item in intake["missing"]])
        return 2

    tasks = intake.get("tasks", [])
    members = capacity.get("members", [])
    assignments = plan.get("assignments", [])
    by_id = {}

    for task in tasks:
        ident = task.get("id")
        if ident in by_id:
            findings.append("DUPLICATE_TASK_ID: " + str(ident))
        by_id[ident] = task
    for task in tasks:
        for dep in task.get("dependsOn", []):
            if dep not in by_id:
                findings.append("UNKNOWN_DEPENDENCY: " + task.get("id", "?") + " -> " + dep)
            elif dep == task.get("id"):
                findings.append("SELF_DEPENDENCY: " + str(dep))
    if has_cycle(tasks, by_id):
        findings.append("DEPENDENCY_CYCLE: the dependsOn graph is not acyclic")

    days_by_name = {member.get("name"): member for member in members}
    if len(days_by_name) != len(members):
        findings.append("DUPLICATE_MEMBER_NAME")
    declared = float(capacity.get("effectiveCapacityHours", -1))
    raw = sum(float(m["availableDays"]) * float(m["productiveHoursPerDay"]) for m in members)
    buffer_percent = float(capacity.get("bufferPercent", 0))
    recomputed = raw * (1.0 - buffer_percent / 100.0)
    if abs(declared - recomputed) > 1e-6:
        findings.append("CAPACITY_MISMATCH: declared " + repr(declared) + " != members*buffer " + repr(recomputed) + " (buffer must be deducted exactly once)")

    tier_totals = {"must": 0.0, "should": 0.0, "could": 0.0}
    for task in tasks:
        estimate = float(task.get("estimateHours", 0))
        if estimate <= 0 or estimate > 8:
            findings.append("ESTIMATE_OUT_OF_RANGE: " + str(task.get("id")) + " = " + repr(estimate) + "h (must be 0 < h <= 8)")
        tier = task.get("tier")
        if tier in tier_totals:
            tier_totals[tier] += estimate

    if declared >= 0:
        for tier, limit in TIER_LIMITS.items():
            load_share = tier_totals[tier] / declared if declared > 0 else 0
            if load_share > limit + 1e-9:
                findings.append("TIER_OVERLOAD: " + tier + " at " + format(load_share * 100, ".1f") + "% of capacity (limit " + str(int(limit * 100)) + "%)")
        total = sum(tier_totals.values())
        if total > declared + 1e-6:
            findings.append("OVER_CAPACITY: planned " + repr(total) + "h > effective capacity " + repr(declared) + "h")

    assigned_ids = set()
    for entry in assignments:
        task_id = entry.get("taskId")
        assigned_ids.add(task_id)
        if task_id not in by_id:
            findings.append("ASSIGNMENT_UNKNOWN_TASK: " + str(task_id))
        owner = entry.get("owner")
        if owner not in days_by_name:
            findings.append("ASSIGNMENT_UNKNOWN_OWNER: " + str(owner))
    must_ids = {t["id"] for t in tasks if t.get("tier") == "must"}
    unassigned_must = sorted(must_ids - assigned_ids)
    if unassigned_must:
        findings.append("UNASSIGNED_MUST: " + ", ".join(unassigned_must))

    status = "violations" if findings else "pass"
    write_check(status, findings)
    return 0 if status == "pass" else 1


def has_cycle(tasks, by_id):
    state = {}

    def visit(ident):
        if state.get(ident) == 1:
            return True
        if state.get(ident) == 2:
            return False
        if ident not in by_id:
            return False
        state[ident] = 1
        for dep in by_id[ident].get("dependsOn", []):
            if dep in by_id and visit(dep):
                return True
        state[ident] = 2
        return False

    return any(visit(task["id"]) for task in tasks)


def write_check(status, findings):
    with open("plan-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": (findings[0] if findings else "plan integrity passed"), "findings": findings}, stream, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    sys.exit(main())
