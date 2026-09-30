#!/usr/bin/env python3
"""Run the reproducible three-layer figure QA pipeline.

The plotting module must expose ``build_figure`` and return a Matplotlib
Figure.  All generated files stay under the explicitly supplied project root.
The final visual review remains a separate evidence step because a renderer
cannot decide whether a legend is semantically obscuring the data.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import inspect
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any


STAGES = ("SOURCE_PREFLIGHT", "RENDER_PREVIEW", "LAYOUT_QA", "PDF_GEOMETRY_QA")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_path(root: Path, value: str, *, must_exist: bool = False) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        raise ValueError("参数必须是项目内相对路径")
    resolved = (root / candidate).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("路径越出项目根目录")
    if must_exist and not resolved.exists():
        raise FileNotFoundError(value)
    return resolved


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"契约必须是 JSON 对象: {path}")
    return payload


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_plot_module(path: Path):
    module_name = f"figure_source_{hashlib.sha256(str(path).encode()).hexdigest()[:12]}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载绘图源码: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def call_builder(builder: Any, root: Path, contract: dict[str, Any]) -> Any:
    signature = inspect.signature(builder)
    known = {
        "project": root,
        "project_root": root,
        "root": root,
        "contract": contract,
        "config": contract,
    }
    kwargs = {
        name: known[name]
        for name, parameter in signature.parameters.items()
        if name in known
        and parameter.kind in (parameter.POSITIONAL_OR_KEYWORD, parameter.KEYWORD_ONLY)
    }
    result = builder(**kwargs)
    if isinstance(result, tuple) and result and hasattr(result[0], "savefig"):
        result = result[0]
    if not hasattr(result, "savefig") or not hasattr(result, "axes"):
        raise TypeError("build_figure 必须返回 Matplotlib Figure")
    return result


def run_source_preflight(source: Path, *, strict: bool = False) -> dict[str, Any]:
    validator = Path(__file__).resolve().with_name("validate_figure.py")
    # Panel alignment is measured by this orchestrator after rendering.  The
    # flag keeps the static source check from requiring a duplicate call.
    command = [
        sys.executable,
        str(validator),
        str(source),
        "--backend",
        "python",
        "--json",
        "--runtime-panel-gate",
        "--runtime-exports",
    ]
    if strict:
        command.append("--strict")
    completed = subprocess.run(
        command,
        cwd=source.parent,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        payload = {"summary": {"ready": False}, "raw_stdout": completed.stdout[-4000:]}
    payload["returncode"] = completed.returncode
    if completed.stderr:
        payload["stderr"] = completed.stderr[-4000:]
    return payload


def relative_or_none(root: Path, path: Path | None) -> str | None:
    return path.relative_to(root).as_posix() if path is not None else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--source", required=True, help="项目内绘图源码")
    parser.add_argument("--contract", required=True, help="项目内 figure contract JSON")
    parser.add_argument("--output-dir", required=True, help="项目内 QA 输出目录")
    parser.add_argument("--pdf", help="已有 PDF；不提供时从 build_figure 导出")
    parser.add_argument("--iteration", default="01")
    parser.add_argument("--strict", action="store_true", help="将 PDF WARN 和源代码 WARN 视为阻断")
    args = parser.parse_args(argv)

    root = args.project.resolve()
    root.mkdir(parents=True, exist_ok=True)
    source = project_path(root, args.source, must_exist=True)
    contract_path = project_path(root, args.contract, must_exist=True)
    output_dir = project_path(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    contract = load_json(contract_path)
    figure_id = str(contract.get("figure_id") or source.stem)
    report: dict[str, Any] = {
        "schema": "ai-figure-qa/v1",
        "figure_id": figure_id,
        "iteration": str(args.iteration),
        "source": relative_or_none(root, source),
        "contract": relative_or_none(root, contract_path),
        "source_sha256": sha256_file(source),
        "contract_sha256": sha256_file(contract_path),
        "stages": {},
        "artifacts": {},
        "status": "PARTIAL",
        "visual_review": {"status": "NOT_RUN"},
    }

    preflight = run_source_preflight(source, strict=args.strict)
    report["stages"]["SOURCE_PREFLIGHT"] = preflight
    if not preflight.get("summary", {}).get("ready", False):
        report["status"] = "FAILED"
        report["blockedReasons"] = ["源代码预检未通过；修复 FAIL/WARN 后重新运行"]
        write_json(output_dir / "figure_qa.json", report)
        print(json.dumps(report, ensure_ascii=False))
        return 1

    os.environ.setdefault("MPLBACKEND", "Agg")
    scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(scripts_dir))
    try:
        from layout_tools import finalize_figure
        from visual_qa import audit_layout, render_preview
        from audit_panel_alignment import require_matplotlib_panel_alignment
        import audit_pdf_text
    except ImportError as exc:
        report["status"] = "BLOCKED"
        report["blockedReasons"] = [f"缺少图表 QA 运行依赖: {exc}"]
        write_json(output_dir / "figure_qa.json", report)
        print(json.dumps(report, ensure_ascii=False))
        return 2

    try:
        module = load_plot_module(source)
        builder = getattr(module, str(contract.get("build_function", "build_figure")), None)
        if builder is None:
            raise AttributeError("绘图源码必须提供 build_figure()，以便执行导出前包围盒检查")
        figure = call_builder(builder, root, contract)
        layout_cfg = contract.get("layout", {}) if isinstance(contract.get("layout", {}), dict) else {}
        layout_used = finalize_figure(figure, prefer=str(layout_cfg.get("engine", "constrained")))
        report["stages"]["RENDER_PREVIEW"] = {"status": "PASS", "layout_engine": layout_used}

        preview = output_dir / "preview.png"
        render_preview(figure, str(preview), dpi=int(contract.get("preview_dpi", 150)))
        report["artifacts"]["preview"] = relative_or_none(root, preview)
        report["artifacts"]["preview_sha256"] = sha256_file(preview)

        issues = audit_layout(figure)
        report["stages"]["LAYOUT_QA"] = {
            "status": "FAIL" if any(level == "FAIL" for level, _ in issues) else "PASS",
            "issues": [{"severity": level, "message": message} for level, message in issues],
        }
        if any(level == "FAIL" for level, _ in issues):
            raise RuntimeError("导出前布局检查存在 FAIL")

        panel_cfg = contract.get("panels", [])
        alignment_cfg = contract.get("alignment", {}) if isinstance(contract.get("alignment", {}), dict) else {}
        alignment_json = output_dir / "alignment.json"
        alignment_svg = output_dir / "alignment.svg"
        panel_ids = [str(item.get("id")) for item in panel_cfg if isinstance(item, dict) and item.get("id")]
        require_alignment = len(panel_ids) >= 2 or len(figure.axes) >= 2
        if require_alignment:
            exclusions = []
            for index in alignment_cfg.get("exclude_axes", []):
                try:
                    exclusions.append(figure.axes[int(index)])
                except (IndexError, TypeError, ValueError):
                    raise ValueError(f"alignment.exclude_axes 无效: {index}")
            kwargs: dict[str, Any] = {
                "json_out": alignment_json,
                "overlay_svg": alignment_svg,
                "tolerance_pt": float(alignment_cfg.get("tolerance_pt", 1.5)),
                "gutter_tolerance_pt": float(alignment_cfg.get("gutter_tolerance_pt", 1.5)),
                "require_panel_labels": bool(alignment_cfg.get("require_panel_labels", False)),
                "strict": True,
                "exclude_axes": exclusions,
            }
            if panel_ids and len(panel_ids) == len([ax for ax in figure.axes if ax.get_visible()]):
                kwargs["panel_ids"] = panel_ids
            for key in ("row_groups", "column_groups", "exemptions"):
                if key in alignment_cfg:
                    kwargs[key] = alignment_cfg[key]
            require_matplotlib_panel_alignment(figure, **kwargs)
            report["artifacts"]["alignment"] = relative_or_none(root, alignment_json)
            report["artifacts"]["alignment_overlay"] = relative_or_none(root, alignment_svg)
            report["stages"]["LAYOUT_QA"]["alignment"] = "PASS"
        else:
            report["stages"]["LAYOUT_QA"]["alignment"] = "NOT_APPLICABLE"

        pdf_path = project_path(root, args.pdf, must_exist=True) if args.pdf else output_dir / f"{figure_id}.pdf"
        if not args.pdf:
            figure.savefig(pdf_path, bbox_inches="tight")
        svg_path = output_dir / f"{figure_id}.svg"
        png_path = output_dir / f"{figure_id}.png"
        if not args.pdf:
            figure.savefig(svg_path, bbox_inches="tight")
            figure.savefig(png_path, dpi=int(contract.get("final_dpi", 300)), bbox_inches="tight")
        report["artifacts"]["pdf"] = relative_or_none(root, pdf_path)
        report["artifacts"]["pdf_sha256"] = sha256_file(pdf_path)
        if svg_path.exists():
            report["artifacts"]["svg"] = relative_or_none(root, svg_path)
            report["artifacts"]["svg_sha256"] = sha256_file(svg_path)
        if png_path.exists():
            report["artifacts"]["png"] = relative_or_none(root, png_path)
            report["artifacts"]["png_sha256"] = sha256_file(png_path)

        collision_module = __import__("audit_figure_collisions")
        collision = collision_module.audit_pdf(pdf_path)
        collision_json = output_dir / "collision.json"
        write_json(collision_json, collision)
        report["artifacts"]["collision"] = relative_or_none(root, collision_json)
        report["artifacts"]["collision_sha256"] = sha256_file(collision_json)

        # Keep a review-only copy of the final PDF with every detected text or
        # graphic collision boxed.  It is never used as a submission artifact.
        collision_overlay = output_dir / "collision_diagnostic.pdf"
        collision_module.write_overlay_pdf(pdf_path, collision_overlay, collision.get("findings", []))
        report["artifacts"]["collision_overlay"] = relative_or_none(root, collision_overlay)
        report["artifacts"]["collision_overlay_sha256"] = sha256_file(collision_overlay)

        text_cfg = contract.get("text_policy", {})
        if not isinstance(text_cfg, dict):
            raise ValueError("text_policy 必须是 JSON 对象")
        minimum_text_pt = float(text_cfg.get("min_pt", 5.0))
        if minimum_text_pt <= 0:
            raise ValueError("text_policy.min_pt 必须为正数")
        text_audit = audit_pdf_text.audit_pdf(pdf_path.read_bytes(), minimum_pt=minimum_text_pt)
        text_json = output_dir / "pdf_text.json"
        write_json(text_json, {"pdf": relative_or_none(root, pdf_path), **text_audit})
        report["artifacts"]["pdf_text"] = relative_or_none(root, text_json)
        report["artifacts"]["pdf_text_sha256"] = sha256_file(text_json)
        text_status = (
            "NOT AUDITABLE"
            if not text_audit.get("auditable")
            else "FAIL"
            if text_audit.get("below_minimum_count", 0)
            else "WARN"
            if text_audit.get("warnings")
            else "PASS"
        )
        collision_status = "PASS" if collision.get("verdict") == "PASS" else collision.get("verdict", "NOT_RUN")
        pdf_status = (
            "FIX BEFORE DELIVERY"
            if collision_status in {"FIX BEFORE DELIVERY", "NOT AUDITABLE"} or text_status in {"FAIL", "NOT AUDITABLE"}
            else "REVIEW REQUIRED"
            if collision.get("summary", {}).get("warn", 0) or text_status == "WARN"
            else "PASS"
        )
        report["stages"]["PDF_GEOMETRY_QA"] = {
            "status": pdf_status,
            "summary": collision.get("summary", {}),
            "collision": collision_status,
            "pdf_text": text_status,
            "pdf_text_summary": {
                "minimum_required_pt": text_audit.get("minimum_required_pt"),
                "minimum_found_pt": text_audit.get("minimum_found_pt"),
                "text_run_count": text_audit.get("text_run_count"),
                "below_minimum_count": text_audit.get("below_minimum_count"),
                "warning_count": len(text_audit.get("warnings", [])),
            },
        }
        if collision.get("verdict") in {"FIX BEFORE DELIVERY", "NOT AUDITABLE"}:
            raise RuntimeError("最终 PDF 几何碰撞检查未通过")
        if text_status in {"FAIL", "NOT AUDITABLE"}:
            raise RuntimeError("最终 PDF 字体大小检查未通过")
        if args.strict and collision.get("summary", {}).get("warn", 0):
            raise RuntimeError("严格模式下最终 PDF 存在未豁免 WARN")
        if args.strict and text_audit.get("warnings"):
            raise RuntimeError("严格模式下最终 PDF 字体审计存在 WARN")
        report["status"] = "PASS"
    except Exception as exc:
        report["status"] = "BLOCKED" if isinstance(exc, (ImportError, ModuleNotFoundError)) else "FAILED"
        report.setdefault("blockedReasons", []).append(str(exc))
        report["errorType"] = type(exc).__name__
        report["traceback"] = traceback.format_exc(limit=8)

    write_json(output_dir / "figure_qa.json", report)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
