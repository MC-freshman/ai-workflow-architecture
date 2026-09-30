#!/usr/bin/env python3
"""Record visual review evidence bound to the current rendered preview."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


CHECKS = (
    "glyphs",
    "clipping",
    "legend_data_occlusion",
    "annotation_overlap",
    "panel_alignment",
    "color_grayscale",
    "data_extent",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_report_artifact(root: Path, payload: dict, path_key: str, hash_key: str) -> str | None:
    """Verify an artifact hash recorded by run_figure_qa, when present."""
    path_value = payload.get("artifacts", {}).get(path_key)
    expected = payload.get("artifacts", {}).get(hash_key)
    if not path_value or not expected:
        return None
    artifact = relative(root, str(path_value))
    actual = sha256_file(artifact)
    if actual != expected:
        raise ValueError(f"QA 报告中的 {path_key} 哈希与当前文件不一致")
    return actual


def relative(root: Path, value: str, must_exist: bool = True) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        raise ValueError("参数必须是项目内相对路径")
    resolved = (root / candidate).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("路径越出项目根目录")
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(value)
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--qa-report", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--decision", choices=("PASS", "REWORK", "BLOCKED"), required=True)
    parser.add_argument("--reviewer-type", choices=("human", "multimodal-agent"), required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--observation", action="append", default=[])
    parser.add_argument("--check", action="append", choices=CHECKS, default=[])
    args = parser.parse_args()

    root = args.project.resolve()
    preview = relative(root, args.preview)
    qa_report = relative(root, args.qa_report)
    payload = json.loads(qa_report.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("QA 报告必须是 JSON 对象")
    expected_preview = payload.get("artifacts", {}).get("preview")
    if expected_preview and Path(expected_preview).as_posix() != preview.relative_to(root).as_posix():
        raise ValueError("视觉复核预览路径与 QA 报告不一致")
    actual_preview_sha = sha256_file(preview)
    expected_preview_sha = payload.get("artifacts", {}).get("preview_sha256")
    if expected_preview_sha and expected_preview_sha != actual_preview_sha:
        raise ValueError("QA 报告中的预览哈希与当前预览不一致")

    source_sha = None
    source_ref = payload.get("source")
    if source_ref:
        source = relative(root, str(source_ref))
        source_sha = sha256_file(source)
        if payload.get("source_sha256") and payload["source_sha256"] != source_sha:
            raise ValueError("QA 报告中的源代码哈希与当前源文件不一致")
    contract_sha = None
    contract_ref = payload.get("contract")
    if contract_ref:
        contract = relative(root, str(contract_ref))
        contract_sha = sha256_file(contract)
        if payload.get("contract_sha256") and payload["contract_sha256"] != contract_sha:
            raise ValueError("QA 报告中的 figure contract 哈希与当前文件不一致")
    verified_artifacts = {}
    for path_key, hash_key in (
        ("pdf", "pdf_sha256"),
        ("svg", "svg_sha256"),
        ("png", "png_sha256"),
        ("collision", "collision_sha256"),
        ("collision_overlay", "collision_overlay_sha256"),
        ("pdf_text", "pdf_text_sha256"),
    ):
        verified = verify_report_artifact(root, payload, path_key, hash_key)
        if verified:
            verified_artifacts[path_key] = verified

    qa_status = str(payload.get("status", ""))
    if args.decision == "PASS" and qa_status != "PASS":
        raise ValueError("decision=PASS 必须绑定 status=PASS 的 QA 报告")
    checks = {name: ("PASS" if name in args.check else "NOT_REVIEWED") for name in CHECKS}
    if args.decision == "PASS" and any(value != "PASS" for value in checks.values()):
        raise ValueError("decision=PASS 必须逐项通过全部视觉复核检查")
    record = {
        "schema": "ai-visual-review/v1",
        "figure_id": payload.get("figure_id"),
        "iteration": payload.get("iteration"),
        "preview": preview.relative_to(root).as_posix(),
        "preview_sha256": actual_preview_sha,
        "qa_report": qa_report.relative_to(root).as_posix(),
        "qa_report_sha256": sha256_file(qa_report),
        "source_sha256": source_sha,
        "contract_sha256": contract_sha,
        "verified_artifacts": verified_artifacts,
        "reviewer_type": args.reviewer_type,
        "reviewer": args.reviewer,
        "checks": checks,
        "observations": args.observation,
        "decision": args.decision,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    output = relative(root, args.output, must_exist=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "success", "decision": args.decision, "output": str(output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
