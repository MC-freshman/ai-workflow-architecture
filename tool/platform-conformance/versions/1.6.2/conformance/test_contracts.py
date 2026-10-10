"""ENTRY-04/CON-* : the standalone runtime-contracts validator self-checks green
from its published package (proves F03 decoupling: no repo_lint import needed).
Run: PCONF_CONFIG=<platform config> python -m unittest -v conformance.test_contracts
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from . import env_config

# D-29: the shared suite must not bake in one machine's absolute root.
TOOL = Path(env_config.load()["toolRoot"])


class ContractsSelfCheck(unittest.TestCase):
    def setUp(self):
        cur = TOOL / "runtime-contracts" / "current.json"
        self.assertTrue(cur.is_file(), "runtime-contracts current.json missing")
        version = json.loads(cur.read_text(encoding="utf-8-sig"))["version"]
        self.validator = TOOL / "runtime-contracts" / "versions" / version / "contracts" / "runtime" / "validate_contracts.py"
        self.assertTrue(self.validator.is_file(), "validator not found in published package")

    def test_package_runs_standalone(self):
        # The migrated validator must not import repo_lint; run it in an isolated temp root.
        src = self.validator.read_text(encoding="utf-8")
        self.assertNotIn("repo_lint", src, "contract validator must not depend on repo_lint")
        with tempfile.TemporaryDirectory() as td:
            report = Path(td) / "report.json"
            proc = subprocess.run([sys.executable, "-B", str(self.validator),
                                   "--runtime-root", td, "--report", str(report)],
                                  capture_output=True, text=True, timeout=180)
            self.assertEqual(proc.returncode, 0, "validator exit != 0: " + (proc.stdout + proc.stderr)[-400:])
            data = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(data["failed"], 0, "contract cases failed: %d" % data["failed"])
            self.assertGreaterEqual(data["passed"], 40, "too few contract assertions ran")


if __name__ == "__main__":
    unittest.main()
