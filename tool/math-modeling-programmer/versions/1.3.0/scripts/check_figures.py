#!/usr/bin/env python3
"""Perform dependency-light figure registry and file quality checks."""

from __future__ import annotations

import argparse
import csv
import json
import re
import struct
from pathlib import Path


SUPPORTED = {"png", "pdf", "svg"}


def project_file(root: Path, value: str, *, required: bool = False) -> Path | None:
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_absolute():
        return None
    resolved = (root / candidate).resolve()
    if root not in resolved.parents or (required and not resolved.is_file()):
        return None
    return resolved


def check_qa_evidence(root: Path, row: dict[str, str]) -> tuple[list[str], list[str], dict[str, object]]:
    """Require hash-bound deterministic and visual evidence for checked figures."""
    errors: list[str] = []
    warnings: list[str] = []
    evidence: dict[str, object] = {}
    status = row.get("status", "DRAFT")
    qa_path = project_file(root, row.get("qa_report_path", ""), required=True)
    review_path = project_file(root, row.get("visual_review_path", ""), required=True)
    if status in {"CHECKED", "FROZEN"} and (qa_path is None or review_path is None):
        errors.append(f"{row.get('figure_id')}: CHECKED/FROZEN 必须提供 qa_report_path 和 visual_review_path")
        return errors, warnings, evidence
    if qa_path is None:
        if row.get("qa_report_path"):
            warnings.append(f"{row.get('figure_id')}: QA 报告路径无效或文件不存在")
        return errors, warnings, evidence
    try:
        qa = json.loads(qa_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{row.get('figure_id')}: QA 报告不可读: {exc}")
        return errors, warnings, evidence
    evidence["qa"] = qa
    if status in {"CHECKED", "FROZEN"} and qa.get("status") != "PASS":
        errors.append(f"{row.get('figure_id')}: QA 报告状态不是 PASS")
    if review_path is None:
        return errors, warnings, evidence
    try:
        review = json.loads(review_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{row.get('figure_id')}: 视觉复核记录不可读: {exc}")
        return errors, warnings, evidence
    evidence["visual_review"] = review
    if status in {"CHECKED", "FROZEN"}:
        if review.get("decision") != "PASS":
            errors.append(f"{row.get('figure_id')}: 视觉复核决策不是 PASS")
        checks = review.get("checks", {})
        missing_checks = [name for name, value in checks.items() if value != "PASS"]
        if missing_checks:
            errors.append(f"{row.get('figure_id')}: 视觉复核存在未通过检查: {', '.join(missing_checks)}")
        preview_path = project_file(root, str(review.get("preview", "")), required=True)
        if preview_path is None:
            errors.append(f"{row.get('figure_id')}: 视觉复核预览文件无效")
    return errors, warnings, evidence


def png_info(path: Path) -> dict:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
        return {"valid": False, "message": "PNG 文件头无效"}
    width, height = struct.unpack(">II", data[16:24])
    dpi = None
    marker = b"pHYs"
    position = data.find(marker)
    if position >= 0 and position + 13 <= len(data):
        x_ppm, y_ppm, unit = struct.unpack(">IIB", data[position + 4:position + 13])
        if unit == 1:
            dpi = round(x_ppm * 0.0254, 2)
    return {"valid": True, "width_px": width, "height_px": height, "dpi": dpi}


def svg_info(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")[:5000]
    if "<svg" not in text:
        return {"valid": False, "message": "缺少 svg 根元素"}
    view_box = re.search(r"viewBox\s*=\s*[\"']([^\"']+)", text, flags=re.I)
    return {"valid": True, "viewBox": view_box.group(1) if view_box else None}


def pdf_info(path: Path) -> dict:
    data = path.read_bytes()
    if not data.startswith(b"%PDF-"):
        return {"valid": False, "message": "PDF 文件头无效"}
    pages = len(re.findall(rb"/Type\s*/Page(?:\s|/|>)", data))
    return {"valid": True, "pages": pages}


def inspect(path: Path) -> dict:
    suffix = path.suffix.lower().lstrip(".")
    if suffix == "png":
        return {"format": suffix, **png_info(path)}
    if suffix == "svg":
        return {"format": suffix, **svg_info(path)}
    if suffix == "pdf":
        return {"format": suffix, **pdf_info(path)}
    return {"format": suffix, "valid": False, "message": f"不支持的格式: {suffix}"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Check registered figures")
    parser.add_argument("--project", type=Path, default=Path("."))
    parser.add_argument("--registry", default="figures/figure_registry.csv")
    parser.add_argument("--output", default="reports/figure_check.json")
    args = parser.parse_args()
    root = args.project.resolve()
    registry = root / args.registry
    errors = []
    warnings = []
    figures = []
    source_map = {}
    if not registry.is_file():
        parser.error(f"找不到图表登记表: {args.registry}")
    with registry.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"figure_id", "claim", "path", "source_result_ids", "status"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            errors.append(f"登记表缺少字段: {', '.join(sorted(missing))}")
        for row in reader:
            figure_path = (root / row.get("path", "")).resolve()
            if root not in figure_path.parents or not figure_path.is_file():
                errors.append(f"{row.get('figure_id')}: 图表文件不存在或越界")
                continue
            info = inspect(figure_path)
            item = {"figure_id": row.get("figure_id"), "claim": row.get("claim"), "path": row.get("path"), "status": row.get("status"), "inspection": info}
            figures.append(item)
            source_map[row.get("figure_id", "")] = row.get("source_result_ids", "")
            if not info.get("valid"):
                errors.append(f"{row.get('figure_id')}: {info.get('message', '文件无效')}")
            if info.get("format") == "png" and info.get("dpi") is not None and info["dpi"] < 300:
                warnings.append(f"{row.get('figure_id')}: PNG DPI 低于 300")
            if not row.get("claim", "").strip():
                errors.append(f"{row.get('figure_id')}: 缺少一句话结论")
            if not row.get("source_result_ids", "").strip():
                warnings.append(f"{row.get('figure_id')}: 未登记来源结果 ID")
            qa_errors, qa_warnings, qa_evidence = check_qa_evidence(root, row)
            errors.extend(qa_errors)
            warnings.extend(qa_warnings)
            if qa_evidence:
                item["qa_evidence"] = qa_evidence
    result_ids = set()
    result_registry = root / "results" / "result_registry.jsonl"
    if result_registry.is_file():
        for line in result_registry.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    payload = json.loads(line)
                    result_ids.add(str(payload.get("result_id", "")))
                except json.JSONDecodeError:
                    warnings.append("结果登记表存在无效 JSON 行")
    for item in figures:
        source_ids = source_map.get(item["figure_id"], "")
        for source_id in filter(None, (value.strip() for value in source_ids.split(";"))):
            if result_ids and source_id not in result_ids:
                warnings.append(f"{item['figure_id']}: 来源结果不存在 {source_id}")
    payload = {"status": "failed" if errors else "success", "figures": figures, "errors": errors, "warnings": warnings}
    output = Path(args.output) if Path(args.output).is_absolute() else root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "figures": len(figures), "errors": len(errors), "warnings": len(warnings), "output": str(output)}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
