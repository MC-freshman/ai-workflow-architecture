from __future__ import annotations

import sys
import unittest

import matplotlib.pyplot as plt


ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from composition_audit import audit_composition


class CompositionAuditTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_flags_wide_legend_in_right_sidecar(self):
        fig, ax = plt.subplots(figsize=(8, 6))
        for index in range(6):
            ax.plot([0, 1], [index, index], label=f"F{index + 1}")
        fig.legend(loc="center left", bbox_to_anchor=(0.90, 0.82), ncols=3, frameon=False)
        result = audit_composition(fig)
        codes = {item["code"] for item in result["issues"]}
        self.assertIn("legend-orientation-mismatch", codes)
        self.assertIn("sidecar-empty", codes)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["legends"][0]["recommended_side"], "top")

    def test_compact_top_legend_passes_without_caption(self):
        fig, ax = plt.subplots(figsize=(8, 6), layout="constrained")
        for index in range(6):
            ax.plot([0, 1], [index, index], label=f"F{index + 1}")
        fig.legend(loc="outside upper center", ncols=6, frameon=False)
        result = audit_composition(fig)
        self.assertNotIn("sidecar-empty", {item["code"] for item in result["issues"]})
        self.assertNotIn("legend-orientation-mismatch", {item["code"] for item in result["issues"]})


if __name__ == "__main__":
    unittest.main()
