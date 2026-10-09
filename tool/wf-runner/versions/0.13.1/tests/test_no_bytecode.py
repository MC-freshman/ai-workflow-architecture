"""D-46: running the CLI without -B must not drop __pycache__ into the published tree.

The guard lives in cli.py before any package import; this test executes the CLI without -B and
asserts the tree stays clean (the integrity gate refuses a polluted tree, so the pollution used to
break every prepare until a human cleaned it)."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "cli.py"


def pyc_in_tree():
    return sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob("*")
                  if "__pycache__" in p.parts or p.suffix == ".pyc")


class NoBytecode(unittest.TestCase):
    def test_cli_without_b_flag_leaves_the_tree_clean(self):
        before = pyc_in_tree()
        proc = subprocess.run([sys.executable, str(CLI), "--help"],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        after = pyc_in_tree()
        self.assertEqual(before, after,
                         "D-46: __pycache__ appeared in the release tree after a plain (no -B) run: %r"
                         % [p for p in after if p not in before])


if __name__ == "__main__":
    unittest.main(verbosity=2)
