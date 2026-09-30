from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures"


def run_script(script: str, *args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args],
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


class FigureQATests(unittest.TestCase):
    def test_pdf_text_audit_flags_small_text_run(self):
        sys.path.insert(0, str(SCRIPTS))
        import audit_pdf_text

        result = audit_pdf_text.audit_pdf(
            b"%PDF-1.4\nstream\nBT /F1 3 Tf (tiny) Tj ET\nendstream\n%%EOF",
            minimum_pt=5.0,
        )
        self.assertTrue(result["auditable"])
        self.assertEqual(result["below_minimum_count"], 1)

    def test_orchestrated_preflight_accepts_build_only_exports(self):
        sys.path.insert(0, str(SCRIPTS))
        import validate_figure

        source = '''
import matplotlib as mpl
import matplotlib.pyplot as plt
mpl.rcParams.update({"font.family": "sans-serif", "font.size": 7,
                     "svg.fonttype": "none", "pdf.fonttype": 42})
fig, ax = plt.subplots(figsize=(7.2, 3.2))
ax.plot([0, 1], [0, 1], label="Method X")
ax.legend()
'''
        findings = {row.check_id: row for row in validate_figure.validate_source(
            source, "python", runtime_panel_gate=True, runtime_exports=True
        )}
        self.assertEqual(findings["EXPORT-VECTOR"].level, "PASS")
        self.assertEqual(findings["EXPORT-RASTER"].level, "PASS")
        self.assertEqual(findings["RASTER-DPI"].level, "PASS")

    def test_visual_qa_flags_long_tick_labels(self):
        import matplotlib.pyplot as plt

        sys.path.insert(0, str(SCRIPTS))
        from visual_qa import audit_layout

        fig, ax = plt.subplots(figsize=(2.5, 2))
        ax.set_xticks(range(12), [f"非常长的标签-{index}" for index in range(12)])
        issues = audit_layout(fig)
        self.assertTrue(any(level == "WARN" for level, _ in issues))
        plt.close(fig)

    def test_pipeline_and_visual_review(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            source = project / "figures" / "good_figure.py"
            contract = project / "configs" / "figure_contract.json"
            source.parent.mkdir()
            contract.parent.mkdir()
            shutil.copy2(FIXTURES / "good_figure.py", source)
            contract.write_text(
                json.dumps({
                    "figure_id": "FIG-GOOD",
                    "claim": "Method X improves the score",
                    "entrypoint": "figures/good_figure.py",
                    "build_function": "build_figure",
                    "backend": "python",
                    "panels": [
                        {"id": "a", "role": "main", "unique_question": "main"},
                        {"id": "b", "role": "robustness", "unique_question": "robustness"},
                    ],
                    "alignment": {"require_panel_labels": True},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            qa_dir = project / "figures" / "qa" / "FIG-GOOD" / "01"
            qa = run_script(
                "run_figure_qa.py", "--project", str(project), "--source", "figures/good_figure.py",
                "--contract", "configs/figure_contract.json", "--output-dir", "figures/qa/FIG-GOOD/01",
                "--strict", cwd=project,
            )
            self.assertEqual(qa.returncode, 0, qa.stdout + qa.stderr)
            report = json.loads((qa_dir / "figure_qa.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["stages"]["PDF_GEOMETRY_QA"]["pdf_text"], "PASS")
            self.assertTrue((qa_dir / "collision_diagnostic.pdf").is_file())
            self.assertTrue((qa_dir / "pdf_text.json").is_file())
            self.assertEqual(report["artifacts"]["preview_sha256"], __import__("hashlib").sha256((qa_dir / "preview.png").read_bytes()).hexdigest())
            checks = ["glyphs", "clipping", "legend_data_occlusion", "annotation_overlap", "panel_alignment", "color_grayscale", "data_extent"]
            review_args = [
                "record_visual_review.py", "--project", str(project), "--preview", "figures/qa/FIG-GOOD/01/preview.png",
                "--qa-report", "figures/qa/FIG-GOOD/01/figure_qa.json", "--output", "figures/qa/FIG-GOOD/01/visual-review.json",
                "--decision", "PASS", "--reviewer-type", "multimodal-agent", "--reviewer", "test",
            ]
            for check in checks:
                review_args += ["--check", check]
            review = run_script(*review_args, cwd=project)
            self.assertEqual(review.returncode, 0, review.stdout + review.stderr)

    def test_checked_registry_requires_bound_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "figures" / "qa").mkdir(parents=True)
            (project / "reports").mkdir()
            (project / "figures" / "figure.svg").write_text('<svg viewBox="0 0 10 10"></svg>', encoding="utf-8")
            from PIL import Image

            preview = project / "figures" / "qa" / "preview.png"
            Image.new("RGB", (10, 10), "white").save(preview, dpi=(150, 150))
            qa_path = project / "figures" / "qa" / "figure_qa.json"
            qa_path.write_text(json.dumps({
                "schema": "ai-figure-qa/v1",
                "figure_id": "FIG-1",
                "iteration": "01",
                "status": "PASS",
                "source_sha256": "0" * 64,
                "artifacts": {"preview": "figures/qa/preview.png"},
                "stages": {},
                "visual_review": {"status": "NOT_RUN"},
            }), encoding="utf-8")
            review_path = project / "figures" / "qa" / "visual-review.json"
            review_path.write_text(json.dumps({
                "decision": "PASS",
                "preview": "figures/qa/preview.png",
                "checks": {name: "PASS" for name in ("glyphs", "clipping", "legend_data_occlusion", "annotation_overlap", "panel_alignment", "color_grayscale", "data_extent")},
            }), encoding="utf-8")
            registry = project / "figures" / "figure_registry.csv"
            registry.write_text(
                "figure_id,claim,path,source_result_ids,format,dpi,width_mm,height_mm,status,qa_report_path,visual_review_path,preview_path,source_hash,preview_hash,notes\n"
                "FIG-1,claim,figures/figure.svg,RES-1,svg,,,,CHECKED,figures/qa/figure_qa.json,figures/qa/visual-review.json,figures/qa/preview.png,,,\n",
                encoding="utf-8",
            )
            checked = run_script("check_figures.py", "--project", str(project), "--output", "reports/figure_check.json", cwd=project)
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)


if __name__ == "__main__":
    unittest.main()
