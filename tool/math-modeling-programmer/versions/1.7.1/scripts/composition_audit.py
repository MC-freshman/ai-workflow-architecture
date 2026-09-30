#!/usr/bin/env python3
"""Measure figure composition efficiency after Matplotlib has rendered it.

Collision checks answer whether artists overlap. This module also answers whether
the chosen layout spends a disproportionate amount of canvas on an external
legend, a caption gap, or an unused margin. It reports deterministic findings;
the Agent remains responsible for choosing and rendering a repaired layout.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def height(self) -> float:
        return max(0.0, self.y1 - self.y0)

    @property
    def area(self) -> float:
        return self.width * self.height


def _from_mpl(value: Any) -> Box:
    return Box(float(value.x0), float(value.y0), float(value.x1), float(value.y1))


def _as_dict(box: Box) -> dict[str, float]:
    return {
        "x": round(box.x0, 2),
        "y": round(box.y0, 2),
        "width": round(box.width, 2),
        "height": round(box.height, 2),
    }


def _union(boxes: list[Box]) -> Box | None:
    if not boxes:
        return None
    return Box(
        min(item.x0 for item in boxes),
        min(item.y0 for item in boxes),
        max(item.x1 for item in boxes),
        max(item.y1 for item in boxes),
    )


def _intersection(left: Box, right: Box) -> Box | None:
    box = Box(max(left.x0, right.x0), max(left.y0, right.y0),
              min(left.x1, right.x1), min(left.y1, right.y1))
    return box if box.width > 0 and box.height > 0 else None


def _overlap(left: Box, right: Box) -> bool:
    return _intersection(left, right) is not None


def _visible_axes(fig, renderer) -> list[Box]:
    boxes = []
    for axis in fig.axes:
        if not axis.get_visible():
            continue
        try:
            boxes.append(_from_mpl(axis.get_window_extent(renderer)))
        except Exception:
            continue
    return boxes


def _legends(fig, renderer) -> list[tuple[str, Box]]:
    out: list[tuple[str, Box]] = []
    seen: set[int] = set()
    for index, legend in enumerate(getattr(fig, "legends", [])):
        if legend is None or not legend.get_visible() or id(legend) in seen:
            continue
        seen.add(id(legend))
        try:
            out.append((f"figure.legend[{index}]", _from_mpl(legend.get_window_extent(renderer))))
        except Exception:
            continue
    for index, axis in enumerate(fig.axes):
        legend = axis.get_legend()
        if legend is None or not legend.get_visible() or id(legend) in seen:
            continue
        seen.add(id(legend))
        try:
            out.append((f"axes[{index}].legend", _from_mpl(legend.get_window_extent(renderer))))
        except Exception:
            continue
    return out


def _bottom_figure_texts(fig, renderer, axes_box: Box, tolerance: float) -> list[dict[str, Any]]:
    found = []
    for index, text in enumerate(getattr(fig, "texts", [])):
        if not text.get_visible() or not text.get_text().strip():
            continue
        try:
            box = _from_mpl(text.get_window_extent(renderer))
        except Exception:
            continue
        if box.y1 <= axes_box.y0 - tolerance:
            found.append({
                "id": f"figure.text[{index}]",
                "text": text.get_text().strip().replace("\n", " ")[:160],
                "box": _as_dict(box),
                "gap_px": round(axes_box.y0 - box.y1, 2),
            })
    return found


def _side(legend: Box, axes: Box, tolerance: float = 4.0) -> str | None:
    if _overlap(legend, axes):
        return None
    distances = {
        "right": abs(legend.x0 - axes.x1),
        "left": abs(legend.x1 - axes.x0),
        "top": abs(legend.y0 - axes.y1),
        "bottom": abs(legend.y1 - axes.y0),
    }
    name, distance = min(distances.items(), key=lambda item: item[1])
    return name if distance <= max(tolerance, 0.04 * max(axes.width, axes.height)) else None


def _sidecar(side: str, legend: Box, axes: Box, canvas: Box) -> tuple[Box, float]:
    if side == "right":
        region = Box(axes.x1, axes.y0, canvas.x1, axes.y1)
    elif side == "left":
        region = Box(canvas.x0, axes.y0, axes.x0, axes.y1)
    elif side == "top":
        region = Box(axes.x0, axes.y1, axes.x1, canvas.y1)
    else:
        region = Box(axes.x0, canvas.y0, axes.x1, axes.y0)
    used = _intersection(region, legend)
    empty = 1.0 if region.area <= 0 else 1.0 - ((used.area if used else 0.0) / region.area)
    return region, max(0.0, min(1.0, empty))


def _candidate_costs(legend: Box, axes: Box, gap: float) -> dict[str, float]:
    return {
        "top": axes.width * (legend.height + gap),
        "bottom": axes.width * (legend.height + gap),
        "left": axes.height * (legend.width + gap),
        "right": axes.height * (legend.width + gap),
    }


def audit_composition(fig, contract: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return deterministic composition metrics and repair suggestions.

    ``contract.composition.mode`` may be ``compact`` (default), ``balanced`` or
    ``disabled``. Warnings become blocking when ``run_figure_qa.py --strict`` is
    used, which is required before a figure is marked CHECKED/FROZEN.
    """
    contract = contract or {}
    config = contract.get("composition", {})
    if not isinstance(config, dict):
        raise ValueError("composition 必须是 JSON 对象")
    mode = str(config.get("mode", "compact")).lower()

    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    canvas = _from_mpl(fig.bbox)
    axes = _visible_axes(fig, renderer)
    issues: list[dict[str, Any]] = []
    if not axes:
        return {
            "status": "FAIL",
            "mode": mode,
            "canvas": _as_dict(canvas),
            "issues": [{"severity": "FAIL", "code": "missing-axes", "message": "未找到可测量的坐标轴。"}],
            "suggestions": [],
        }
    axes_union = _union(axes)
    assert axes_union is not None
    legends = _legends(fig, renderer)
    legend_reports = []
    suggestions = []
    gap_px = float(config.get("candidate_gap_px", 12.0))
    max_empty = float(config.get("max_sidecar_empty_ratio", 0.65 if mode == "compact" else 0.80))
    max_outer = float(config.get("max_outer_margin_ratio", 0.15 if mode == "compact" else 0.16))
    min_axes_ratio = float(config.get("min_axes_area_ratio", 0.45 if mode == "compact" else 0.35))
    max_caption_gap = float(config.get("max_caption_gap_ratio", 0.08))
    for name, legend in legends:
        side = _side(legend, axes_union)
        report: dict[str, Any] = {
            "id": name,
            "box": _as_dict(legend),
            "external": side is not None,
            "side": side,
            "aspect_ratio": round(legend.width / legend.height, 3) if legend.height else None,
        }
        if side is None:
            legend_reports.append(report)
            continue
        region, empty = _sidecar(side, legend, axes_union, canvas)
        costs = _candidate_costs(legend, axes_union, gap_px)
        best_side = min(costs, key=costs.get)
        actual_cost = costs[side]
        report.update({
            "sidecar": _as_dict(region),
            "sidecar_empty_ratio": round(empty, 4),
            "candidate_added_area_px2": {key: round(value, 2) for key, value in costs.items()},
            "recommended_side": best_side,
            "cost_ratio_to_best": round(actual_cost / max(costs[best_side], 1.0), 3),
        })
        legend_reports.append(report)
        if side in {"left", "right"} and legend.width > 2.0 * max(legend.height, 1.0) and side != best_side:
            issues.append({
                "severity": "WARN",
                "code": "legend-orientation-mismatch",
                "message": f"{name} 宽而矮却放在{side}侧；候选布局建议放在{best_side}侧。",
            })
        if side in {"top", "bottom"} and legend.height > 1.2 * max(legend.width, 1.0) and side != best_side:
            issues.append({
                "severity": "WARN",
                "code": "legend-orientation-mismatch",
                "message": f"{name} 高而窄却放在{side}侧；候选布局建议放在{best_side}侧。",
            })
        if empty > max_empty:
            severity = "FAIL" if empty > min(0.95, max_empty + 0.20) else "WARN"
            issues.append({
                "severity": severity,
                "code": "sidecar-empty",
                "message": f"{name} 所在{side}侧栏空置率为 {empty:.1%}，超过 {max_empty:.1%}。",
            })
        suggestions.append({
            "legend": name,
            "try_in_order": [item[0] for item in sorted(costs.items(), key=lambda item: item[1])],
        })

    axes_area_ratio = axes_union.area / max(canvas.area, 1.0)
    if axes_area_ratio < min_axes_ratio:
        issues.append({
            "severity": "WARN",
            "code": "low-axes-area-ratio",
            "message": f"坐标轴包围区域仅占画布 {axes_area_ratio:.1%}，低于建议下限 {min_axes_ratio:.1%}。",
        })

    content = _union([axes_union, *[item[1] for item in legends]])
    assert content is not None
    outer_margins = {
        "left": max(0.0, content.x0 - canvas.x0) / max(canvas.width, 1.0),
        "right": max(0.0, canvas.x1 - content.x1) / max(canvas.width, 1.0),
        "bottom": max(0.0, content.y0 - canvas.y0) / max(canvas.height, 1.0),
        "top": max(0.0, canvas.y1 - content.y1) / max(canvas.height, 1.0),
    }
    for side, ratio in outer_margins.items():
        if ratio > max_outer:
            issues.append({
                "severity": "WARN",
                "code": "outer-margin",
                "message": f"{side}侧外边距占画布 {ratio:.1%}，超过 {max_outer:.1%}。",
            })

    bottom_texts = _bottom_figure_texts(fig, renderer, axes_union, tolerance=2.0)
    caption_gap_ratio = max((item["gap_px"] for item in bottom_texts), default=0.0) / max(canvas.height, 1.0)
    caption_policy = str(config.get("caption_policy", "document"))
    if bottom_texts and caption_policy == "document":
        issues.append({
            "severity": "WARN",
            "code": "in-figure-caption",
            "message": "检测到坐标轴下方的 figure.text；解释性文字应移到论文图注。",
        })
    elif bottom_texts and caption_gap_ratio > max_caption_gap:
        issues.append({
            "severity": "WARN",
            "code": "caption-gap",
            "message": f"图内说明与坐标轴间距占画布 {caption_gap_ratio:.1%}，超过 {max_caption_gap:.1%}。",
        })

    fail_count = sum(item["severity"] == "FAIL" for item in issues)
    warn_count = sum(item["severity"] == "WARN" for item in issues)
    status = "FAIL" if fail_count else "WARN" if warn_count else "PASS"
    return {
        "status": status,
        "mode": mode,
        "canvas": _as_dict(canvas),
        "axes": [_as_dict(item) for item in axes],
        "axes_union": _as_dict(axes_union),
        "axes_area_ratio": round(axes_area_ratio, 4),
        "legends": legend_reports,
        "outer_margins": {key: round(value, 4) for key, value in outer_margins.items()},
        "bottom_figure_texts": bottom_texts,
        "caption_gap_ratio": round(caption_gap_ratio, 4),
        "issues": issues,
        "suggestions": suggestions,
        "thresholds": {
            "max_sidecar_empty_ratio": max_empty,
            "max_outer_margin_ratio": max_outer,
            "min_axes_area_ratio": min_axes_ratio,
            "max_caption_gap_ratio": max_caption_gap,
        },
    }
