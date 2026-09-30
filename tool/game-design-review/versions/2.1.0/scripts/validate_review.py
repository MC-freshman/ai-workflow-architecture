#!/usr/bin/env python3
"""Deterministic design-review integrity checker for game-design-review 2.1.0 (M4-10).

Runs inside the review attempt's evidence directory. Reads intake.json and review.json (sealed copies), writes
review-check.json, and exits 0 (pass) / 1 (violations, repairable) / 2 (missing information).
"""
import json
import re
import sys

SEVERITIES = ("critical", "major", "minor")



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
    with open("review-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


def main():
    findings = []
    intake = load("intake.json", findings)
    review = load("review.json", findings)
    if intake is None or review is None:
        write_check("violations", findings)
        return 1
    if intake.get("missing"):
        write_check("missing-info", ["MISSING_INFO: " + item for item in intake["missing"]])
        return 2

    sections = intake.get("sections", [])
    by_section = {}
    for section in sections:
        ident = section.get("id")
        if ident in by_section:
            findings.append("DUPLICATE_SECTION_ID: " + str(ident))
        by_section[ident] = section
    absent = {ident for ident, section in by_section.items() if not section.get("present", True)}

    items = review.get("findings", [])
    seen = set()
    counts = {severity: 0 for severity in SEVERITIES}
    for item in items:
        ident = item.get("id")
        if not ident or ident in seen:
            findings.append("DUPLICATE_OR_MISSING_FINDING_ID: " + str(ident))
        seen.add(ident)
        severity = item.get("severity")
        if severity not in SEVERITIES:
            findings.append("BAD_SEVERITY: " + str(ident) + " -> " + repr(severity))
        else:
            counts[severity] += 1
        section = item.get("section")
        if section not in by_section:
            findings.append("UNKNOWN_SECTION: " + str(ident) + " -> " + str(section))
        elif section in absent and severity != "critical":
            findings.append("ABSENT_SECTION_NOT_CRITICAL: " + str(ident) + " cites missing section " + str(section))
        for field in ("evidence", "recommendation"):
            if not str(item.get(field, "")).strip():
                findings.append("EMPTY_" + field.upper() + ": " + str(ident))

    summary = review.get("summary", {})
    for severity in SEVERITIES:
        if summary.get(severity) is not None and summary[severity] != counts[severity]:
            findings.append("SUMMARY_MISMATCH: " + severity + " declared " + str(summary[severity]) + " but counted " + str(counts[severity]))

    if not items:
        findings.append("NO_FINDINGS: a review without findings must say so explicitly in summary.notes")
    status = "violations" if findings else "pass"
    write_check(status, findings)
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
