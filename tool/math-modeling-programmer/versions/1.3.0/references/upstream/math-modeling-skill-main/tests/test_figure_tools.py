import importlib.util
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "references" / "roles" / "编程手" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import figure_audit
import plot_style


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    payload = kind + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)


def _write_png(path: Path, dpi: int) -> None:
    pixels_per_meter = round(dpi / 0.0254)
    content = [
        figure_audit.PNG_SIGNATURE,
        _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)),
        _png_chunk(b"pHYs", struct.pack(">IIB", pixels_per_meter, pixels_per_meter, 1)),
        _png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")),
        _png_chunk(b"IEND", b""),
    ]
    path.write_bytes(b"".join(content))


def _write_svg(path: Path, with_text: bool = True) -> None:
    body = '<text x="1" y="8">label</text>' if with_text else '<path d="M0 0 L1 1"/>'
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg">{body}</svg>', encoding="utf-8")


class PlotStyleTests(unittest.TestCase):
    def test_palette_is_unique_and_colorblind_oriented(self):
        self.assertEqual(len(plot_style.COLOR_SEQUENCE), len(set(plot_style.COLOR_SEQUENCE)))
        self.assertEqual(plot_style.PALETTE["primary"], "#0072B2")
        width, height = plot_style.figure_size("report")
        self.assertEqual(width, 6.3)
        self.assertAlmostEqual(height, 3.906)

    def test_refuses_output_inside_skill_root(self):
        with self.assertRaisesRegex(ValueError, "PROJECT_ROOT"):
            plot_style.resolve_output_stem(plot_style.SKILL_ROOT / "figures" / "result_demo")

    def test_copied_helper_allows_output_inside_project_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            copied = project / "utils" / "a" / "b" / "plot_style.py"
            copied.parent.mkdir(parents=True)
            copied.write_bytes((SCRIPTS / "plot_style.py").read_bytes())
            spec = importlib.util.spec_from_file_location("copied_plot_style", copied)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            try:
                resolved = module.resolve_output_stem(project / "figures" / "result_q1")
            except ValueError as error:
                self.fail(f"复制到 PROJECT_ROOT 后不应误判为 SKILL_ROOT：{error}")

            self.assertEqual(resolved, (project / "figures" / "result_q1").resolve())

    def test_copied_helper_still_refuses_the_real_skill_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            copied = Path(tmp) / "project" / "utils" / "a" / "b" / "plot_style.py"
            copied.parent.mkdir(parents=True)
            copied.write_bytes((SCRIPTS / "plot_style.py").read_bytes())
            spec = importlib.util.spec_from_file_location("guarded_copied_plot_style", copied)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            with self.assertRaisesRegex(ValueError, "PROJECT_ROOT"):
                module.resolve_output_stem(SCRIPTS / "forbidden")

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_real_export_passes_file_audit(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        with tempfile.TemporaryDirectory() as tmp:
            plot_style.apply_publication_style(language="en", width="single")
            fig, axis = plt.subplots()
            axis.plot([0, 1], [0, 1])
            axis.set(xlabel="Time (s)", ylabel="Value")
            outputs = plot_style.export_figure(fig, Path(tmp) / "result_demo")
            plt.close(fig)

            report = figure_audit.audit_figure_directory(tmp, require_categories=False)

        self.assertTrue(report["ok"], report["issues"])
        self.assertTrue(Path(outputs["grayscale"]).name.endswith("_grayscale.png"))
        metadata = report["files"]["result_demo.png"]
        self.assertEqual(metadata["width_px"], 1050)
        self.assertEqual(metadata["height_px"], 651)
        self.assertAlmostEqual(metadata["width_in"], 3.5, places=3)

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_layout_audit_detects_overlapping_ticks(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        fig, axis = plt.subplots(figsize=(2, 1.5), constrained_layout=False)
        axis.set_xticks(range(8), [f"very-long-category-{index}" for index in range(8)])
        issues = plot_style.audit_layout(fig)
        plt.close(fig)

        self.assertTrue(any("x 刻度标签重叠" in issue for issue in issues), issues)

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_publication_subplots_preserves_declared_panel_hierarchy(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        fig, axes = plot_style.publication_subplots(
            1, 2, width="double", aspect=0.5, width_ratios=[1.8, 1]
        )
        ratios = axes[0].get_subplotspec().get_gridspec().get_width_ratios()
        plt.close(fig)

        self.assertEqual(ratios, [1.8, 1])
        self.assertEqual(tuple(fig.get_size_inches()), (7.2, 3.6))

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_design_audit_rejects_dense_markers_and_nonzero_bar_baseline(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 2)
        axes[0].plot(range(30), range(30), marker="o")
        axes[1].bar(["A", "B"], [10, 12])
        axes[1].set_ylim(8, 14)
        issues = plot_style.audit_design(fig)
        plt.close(fig)

        messages = "\n".join(issues)
        self.assertIn("逐点绘制标记", messages)
        self.assertIn("柱状图未从零开始", messages)

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_design_audit_reads_left_title_negative_bars_and_figure_legend(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        plot_style.apply_publication_style(language="en", width="single")
        fig, axes = plt.subplots(1, 2)
        axes[0].set_title("This panel title is deliberately much too long", loc="left")
        axes[0].bar(["A", "B"], [-10, -12])
        axes[0].set_ylim(-14, -8)
        for index in range(6):
            axes[1].plot([0, 1], [index, index + 1], label=f"series-{index}")
        handles, labels = axes[1].get_legend_handles_labels()
        fig.legend(handles, labels)
        issues = plot_style.audit_design(fig)
        plt.close(fig)

        messages = "\n".join(issues)
        self.assertIn("标题过长", messages)
        self.assertIn("柱状图未从零开始", messages)
        self.assertIn("整图共享图例超过 5 项", messages)

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_design_audit_rejects_redundant_colorbar_for_annotated_2x2_matrix(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt
        import numpy as np

        fig, axis = plt.subplots()
        image = axis.imshow(np.array([[12, 3], [2, 9]]))
        for row in range(2):
            for column in range(2):
                axis.text(column, row, "1")
        fig.colorbar(image, ax=axis)
        issues = plot_style.audit_design(fig)
        plt.close(fig)

        self.assertTrue(any("冗余 colorbar" in issue for issue in issues), issues)

    @unittest.skipUnless(importlib.util.find_spec("matplotlib"), "需要 matplotlib")
    def test_design_audit_associates_colorbar_with_its_own_image(self):
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt
        import numpy as np

        fig, axes = plt.subplots(1, 2)
        axes[0].imshow(np.array([[12, 3], [2, 9]]))
        for row in range(2):
            for column in range(2):
                axes[0].text(column, row, "1")
        continuous = axes[1].imshow(np.arange(100).reshape(10, 10))
        fig.colorbar(continuous, ax=axes[1])
        issues = plot_style.audit_design(fig)
        plt.close(fig)

        self.assertFalse(any("冗余 colorbar" in issue for issue in issues), issues)

    def test_matlab_export_uses_design_audit(self):
        audit = (SCRIPTS / "audit_publication_figure.m").read_text(encoding="utf-8")
        exporter = (SCRIPTS / "export_publication_figure.m").read_text(encoding="utf-8")

        self.assertIn("MarkerIndices", audit)
        self.assertIn("柱状图未从零开始", audit)
        self.assertIn("limits(2) < -tolerance", audit)
        self.assertIn('isprop(ax, "Colorbar")', audit)
        self.assertIn("TightInset", audit)
        self.assertIn("audit_publication_figure(fig)", exporter)


class FigureAuditTests(unittest.TestCase):
    def test_accepts_three_candidates_per_category_with_svg_png_pairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            figures = Path(tmp)
            for prefix in ("raw", "process", "result"):
                for question in ("q1", "q2", "q3"):
                    stem = f"{prefix}_{question}_candidate"
                    _write_svg(figures / f"{stem}.svg")
                    _write_png(figures / f"{stem}.png", 300)

            report = figure_audit.audit_figure_directory(
                figures,
                questions=("q1", "q2", "q3"),
            )

        self.assertTrue(report["ok"], report["issues"])
        self.assertEqual(report["questions"], ["q1", "q2", "q3"])
        self.assertEqual(report["issues"], [])

    def test_rejects_global_shortage_and_uncovered_questions(self):
        with tempfile.TemporaryDirectory() as tmp:
            figures = Path(tmp)
            for stem in ("raw_q1_data", "process_q1_loss", "result_q1_solution"):
                _write_svg(figures / f"{stem}.svg")
                _write_png(figures / f"{stem}.png", 300)

            report = figure_audit.audit_figure_directory(
                figures,
                questions=("q1", "q2"),
            )

        self.assertFalse(report["ok"])
        messages = "\n".join(item["message"] for item in report["issues"])
        self.assertIn("raw_ 类候选图仅 1 张，低于每类最低 3 张", messages)
        self.assertIn("process_ 类候选图仅 1 张，低于每类最低 3 张", messages)
        self.assertIn("result_ 类候选图仅 1 张，低于每类最低 3 张", messages)
        self.assertIn("子问题 q2 缺少 raw_ 类候选图", messages)
        self.assertIn("子问题 q2 缺少 process_ 类候选图", messages)
        self.assertIn("子问题 q2 缺少 result_ 类候选图", messages)

    def test_requires_explicit_complete_question_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            figures = Path(tmp)
            for prefix in ("raw", "process", "result"):
                for index in range(3):
                    stem = f"{prefix}_q1_candidate_{index + 1}"
                    _write_svg(figures / f"{stem}.svg")
                    _write_png(figures / f"{stem}.png", 300)

            report = figure_audit.audit_figure_directory(figures)

        self.assertFalse(report["ok"])
        self.assertTrue(any("未提供全部子问题标识" in item["message"] for item in report["issues"]))

    def test_rejects_low_dpi_and_missing_editable_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            figures = Path(tmp)
            _write_svg(figures / "result_solution.svg", with_text=False)
            _write_png(figures / "result_solution.png", 96)

            report = figure_audit.audit_figure_directory(figures, require_categories=False)

        messages = "\n".join(item["message"] for item in report["issues"])
        self.assertFalse(report["ok"])
        self.assertIn("可编辑文本", messages)
        self.assertIn("低于 300 DPI", messages)

    def test_rejects_missing_format_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            figures = Path(tmp)
            _write_svg(figures / "raw_data.svg")

            report = figure_audit.audit_figure_directory(figures, require_categories=False)

        self.assertFalse(report["ok"])
        self.assertIn("缺少配对格式", report["issues"][0]["message"])


if __name__ == "__main__":
    unittest.main()
