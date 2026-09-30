"""Renderer-neutral collision audit for generated visualization layouts.

The renderer adapter emits a JSON document with canvas dimensions and element
bounding boxes in top-left-origin pixel coordinates. This module detects
clipping, overlapping subplots, legend/text collisions, and missing geometry.
It deliberately does not guess from source code: no measured boxes means
REVIEW_REQUIRED.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Box:
    element_id: str
    element_type: str
    x: float
    y: float
    width: float
    height: float
    allow_overlap_with: frozenset[str]

    @property
    def x2(self) -> float:
        return self.x + self.width

    @property
    def y2(self) -> float:
        return self.y + self.height


def _box(raw: dict[str, Any], index: int) -> Box:
    try:
        element_id = str(raw["id"])
        element_type = str(raw.get("type", "unknown"))
        x, y = float(raw["x"]), float(raw["y"])
        width, height = float(raw["width"]), float(raw["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"element {index} has an invalid bounding box: {exc}") from exc
    if not element_id or width <= 0 or height <= 0:
        raise ValueError(f"element {index} must have a non-empty id and positive size")
    allowed = frozenset(str(value) for value in raw.get("allowOverlapWith", []))
    return Box(element_id, element_type, x, y, width, height, allowed)


def _intersection(left: Box, right: Box, tolerance: float) -> tuple[float, float] | None:
    width = min(left.x2, right.x2) - max(left.x, right.x)
    height = min(left.y2, right.y2) - max(left.y, right.y)
    if width > tolerance and height > tolerance:
        return width, height
    return None


def audit_geometry(document: dict[str, Any], tolerance: float = 1.0) -> dict[str, Any]:
    canvas = document.get("canvas") or {}
    try:
        canvas_width, canvas_height = float(canvas["width"]), float(canvas["height"])
    except (KeyError, TypeError, ValueError) as exc:
        return {"verdict": "REVIEW_REQUIRED", "issues": [{"severity": "FAIL", "code": "invalid-canvas", "message": str(exc)}], "evidence": {}}
    raw_elements = document.get("elements")
    if not isinstance(raw_elements, list) or not raw_elements:
        return {"verdict": "REVIEW_REQUIRED", "issues": [{"severity": "REVIEW", "code": "missing-geometry", "message": "No measured element boxes were supplied."}], "evidence": {"canvas": {"width": canvas_width, "height": canvas_height}, "elementCount": 0}}

    issues: list[dict[str, Any]] = []
    boxes: list[Box] = []
    for index, raw in enumerate(raw_elements):
        try:
            box = _box(raw, index)
        except ValueError as exc:
            issues.append({"severity": "FAIL", "code": "invalid-box", "message": str(exc)})
            continue
        boxes.append(box)
        if box.x < -tolerance or box.y < -tolerance or box.x2 > canvas_width + tolerance or box.y2 > canvas_height + tolerance:
            issues.append({"severity": "FAIL", "code": "clipped", "elements": [box.element_id], "message": f"{box.element_id} lies outside the canvas."})

    for index, left in enumerate(boxes):
        for right in boxes[index + 1 :]:
            if right.element_id in left.allow_overlap_with or left.element_id in right.allow_overlap_with:
                continue
            overlap = _intersection(left, right, tolerance)
            if overlap is None:
                continue
            issues.append({
                "severity": "FAIL",
                "code": "overlap",
                "elements": [left.element_id, right.element_id],
                "types": [left.element_type, right.element_type],
                "overlapPx": {"width": round(overlap[0], 3), "height": round(overlap[1], 3)},
                "message": f"{left.element_id} overlaps {right.element_id}.",
            })

    verdict = "FAIL" if any(issue["severity"] == "FAIL" for issue in issues) else "PASS"
    return {
        "verdict": verdict,
        "issues": issues,
        "evidence": {
            "canvas": {"width": canvas_width, "height": canvas_height},
            "elementCount": len(boxes),
            "measuredElementIds": [box.element_id for box in boxes],
            "tolerancePx": tolerance,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit measured visualization element boxes")
    parser.add_argument("document", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--tolerance", type=float, default=1.0)
    args = parser.parse_args(argv)
    try:
        result = audit_geometry(json.loads(args.document.read_text(encoding="utf-8")), args.tolerance)
    except (OSError, json.JSONDecodeError) as exc:
        result = {"verdict": "REVIEW_REQUIRED", "issues": [{"severity": "FAIL", "code": "input-error", "message": str(exc)}], "evidence": {}}
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 1 if result["verdict"] == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
