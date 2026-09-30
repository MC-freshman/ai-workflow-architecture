#!/usr/bin/env python3
"""Deterministic post-mortem integrity checker for game-postmortem 2.1.0 (M4-10).

Runs inside the review attempt's evidence directory. Reads intake.json and analysis.json (sealed copies), writes
postmortem-check.json, and exits 0 (pass) / 1 (violations, repairable) / 2 (missing information).
"""
import json
import re
import sys

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RELATIVE_DUE = ("next-sprint", "next-milestone", "next-project")
KINDS = ("went-well", "went-wrong", "neutral")



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
    with open("postmortem-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


def main():
    findings = []
    intake = load("intake.json", findings)
    analysis = load("analysis.json", findings)
    if intake is None or analysis is None:
        write_check("violations", findings)
        return 1
    if intake.get("missing"):
        write_check("missing-info", ["MISSING_INFO: " + item for item in intake["missing"]])
        return 2

    periods = {row.get("id") for row in intake.get("periods", [])}
    timeline_ids = set()
    for entry in analysis.get("timeline", []):
        ident = entry.get("id")
        if not ident or ident in timeline_ids:
            findings.append("DUPLICATE_OR_MISSING_TIMELINE_ID: " + str(ident))
        timeline_ids.add(ident)
        if not DATE.match(str(entry.get("date", ""))):
            findings.append("BAD_DATE: " + str(ident) + " -> " + repr(entry.get("date")))
        if entry.get("kind") not in KINDS:
            findings.append("BAD_KIND: " + str(ident) + " -> " + repr(entry.get("kind")))
        if not str(entry.get("event", "")).strip():
            findings.append("EMPTY_EVENT: " + str(ident))
        if entry.get("period") is not None and entry["period"] not in periods:
            findings.append("UNKNOWN_PERIOD: " + str(ident) + " -> " + str(entry["period"]))
    if not timeline_ids:
        findings.append("NO_TIMELINE: a post-mortem requires a dated timeline")

    cause_ids = set()
    for cause in analysis.get("rootCauses", []):
        ident = cause.get("id")
        if not ident or ident in cause_ids:
            findings.append("DUPLICATE_OR_MISSING_CAUSE_ID: " + str(ident))
        cause_ids.add(ident)
        if not str(cause.get("description", "")).strip():
            findings.append("EMPTY_CAUSE: " + str(ident))
        evidence = cause.get("evidence", [])
        if not evidence:
            findings.append("CAUSE_WITHOUT_EVIDENCE: " + str(ident))
        for ref in evidence:
            if ref not in timeline_ids:
                findings.append("UNKNOWN_TIMELINE_REFERENCE: " + str(ident) + " -> " + str(ref))

    for item in analysis.get("actionItems", []):
        ident = item.get("id")
        if not str(item.get("owner", "")).strip():
            findings.append("ACTION_WITHOUT_OWNER: " + str(ident))
        due = str(item.get("due", ""))
        if not (DATE.match(due) or due in RELATIVE_DUE):
            findings.append("BAD_DUE: " + str(ident) + " -> " + repr(due))
        if not str(item.get("description", "")).strip():
            findings.append("EMPTY_ACTION: " + str(ident))
        addresses = item.get("addresses")
        if not addresses:
            findings.append("ACTION_WITHOUT_CAUSE: " + str(ident))
        else:
            for ref in addresses:
                if ref not in cause_ids:
                    findings.append("UNKNOWN_CAUSE_REFERENCE: " + str(ident) + " -> " + str(ref))

    summary = analysis.get("summary", {})
    if summary.get("timelineEntries") is not None and summary["timelineEntries"] != len(timeline_ids):
        findings.append("SUMMARY_MISMATCH: timelineEntries declared " + str(summary["timelineEntries"]) + " but counted " + str(len(timeline_ids)))
    if summary.get("actionItems") is not None and summary["actionItems"] != len(analysis.get("actionItems", [])):
        findings.append("SUMMARY_MISMATCH: actionItems declared " + str(summary["actionItems"]) + " but counted " + str(len(analysis.get("actionItems", []))))

    status = "violations" if findings else "pass"
    write_check(status, findings)
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
