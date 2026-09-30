#!/usr/bin/env python3
"""game-market-research 交付物完整性门禁（Z10 §6.2 批 C2）。

读取 output.json，写 game-market-research-check.json，退出 0/1/2。
上游的硬规则：市场规模必须自洽（SOM ≤ SAM ≤ TAM）、每个数字都要有来源、
受众占比不得凭空超过 100%、差异化主张不得重复。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")


def _load(fs):
    try:
        with open("output.json", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except FileNotFoundError:
        fs.append("MISSING_INPUT: output.json was not sealed")
    except ValueError as exc:
        fs.append("UNPARSEABLE_INPUT: output.json: " + str(exc))
    return None


def _check(status, findings, reason=None):
    with open("game-market-research-check.json", "w", encoding="utf-8") as stream:
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


def main():
    findings = []
    doc = _load(findings)
    if doc is None:
        _check("violations", findings)
        return 1
    blockers = doc.get("blockers") or []
    if doc.get("status") == "blocked" and blockers and all(str(i).startswith("MISSING_INFO") for i in blockers):
        _check("missing-info", ["MISSING_INFO: " + str(i) for i in blockers])
        return 2

    for index, item in enumerate(doc.get("competitors") or []):
        if len(str(item.get("source", "")).strip()) < 5:
            findings.append("UNCITED_COMPETITOR: competitors[" + str(index) + "] gives no source")
        for field in ("strengths", "weaknesses"):
            if len(str(item.get(field, "")).strip()) < 10:
                findings.append("THIN_COMPETITOR_FIELD: competitors[" + str(index) + "] has no usable " + field)

    market = doc.get("market") or {}
    tam, sam, som = market.get("tamUsd"), market.get("samUsd"), market.get("somUsd")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in (tam, sam, som)):
        findings.append("MARKET_NOT_QUANTIFIED: market needs positive numeric tamUsd/samUsd/somUsd")
    elif not (som <= sam <= tam):
        findings.append("MARKET_SIZE_ORDER: som (" + str(som) + ") <= sam (" + str(sam) + ") <= tam (" + str(tam) + ") must hold")
    if len(market.get("sources") or []) < 2:
        findings.append("UNCITED_MARKET: market sizing needs at least two sources")

    segments = (doc.get("audience") or {}).get("segments") or []
    if len(segments) < 2:
        findings.append("SEGMENTS_TOO_FEW: " + str(len(segments)) + " < 2")
    share = 0.0
    for index, item in enumerate(segments):
        if not isinstance(item.get("sizePct"), (int, float)) or isinstance(item.get("sizePct"), bool):
            findings.append("SEGMENT_WITHOUT_SIZE: segments[" + str(index) + "] has no numeric sizePct")
        else:
            share += item["sizePct"]
        if len(str(item.get("needs", "")).strip()) < 10:
            findings.append("THIN_SEGMENT_NEEDS: segments[" + str(index) + "] states no need")
    if share > 100.5:
        findings.append("AUDIENCE_OVERFLOW: segment shares sum to " + str(round(share, 1)) + "% > 100%")

    differentiators = (doc.get("positioning") or {}).get("differentiators") or []
    if len(differentiators) < 2:
        findings.append("DIFFERENTIATORS_TOO_FEW: " + str(len(differentiators)) + " < 2")
    if len(set(map(str, differentiators))) != len(differentiators):
        findings.append("DUPLICATE_DIFFERENTIATOR: positioning repeats a differentiator")

    findings += blanks(doc, "output")
    _check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
