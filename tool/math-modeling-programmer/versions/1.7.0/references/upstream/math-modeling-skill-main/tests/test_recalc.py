import subprocess
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook


SCRIPTS = Path(__file__).resolve().parents[1] / "tools" / "xlsx" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import recalc


class RecalcTests(unittest.TestCase):
    def test_timeout_is_reported_as_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            Workbook().save(path)
            with patch.object(recalc, "get_soffice_env", return_value={}), patch.object(
                recalc.subprocess, "run", side_effect=subprocess.TimeoutExpired(["soffice"], 1)
            ):
                result = recalc.recalc(path, timeout=1)

        self.assertIn("error", result)
        self.assertIn("超时", result["error"])

    def test_success_uses_temporary_output_and_counts_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            workbook = Workbook()
            workbook.active["A1"] = "=1+1"
            workbook.save(path)

            def fake_run(command, **_kwargs):
                output_dir = Path(command[command.index("--outdir") + 1])
                shutil.copy2(path, output_dir / path.name)
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch.object(recalc, "get_soffice_env", return_value={}), patch.object(
                recalc.subprocess, "run", side_effect=fake_run
            ):
                result = recalc.recalc(path)

        self.assertIn("status", result, result)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["total_formulas"], 1)


if __name__ == "__main__":
    unittest.main()
