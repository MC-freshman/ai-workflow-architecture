"""ENTRY-04: registry resource typing is machine-readable and consistent, so the
/wf + /wfa denominator excludes non-invocable resources BY TYPE (never as an
EXPECTED 'failure'). Run: PCONF_CONFIG=<platform config> python -m unittest conformance.test_entry04
"""
import json
from pathlib import Path

from . import env_config
import unittest

NON_INVOCABLE_KINDS = {"engine", "contracts", "pack", "skill-catalog", "governance-tool"}
INVOCABLE_WORKFLOW_KINDS = {"workflow", "governance-workflow"}


class Entry04(unittest.TestCase):
    def setUp(self):
        cfg = env_config.load()
        self.tool = Path(cfg["toolRoot"])
        self.reg = json.loads((self.tool / "registry.json").read_text(encoding="utf-8-sig"))

    def test_workflow_entries_are_typed(self):
        for e in self.reg.get("workflows", []):
            self.assertIn("kind", e, "workflow entry missing kind: " + e["id"])
            self.assertIn("invocable", e, "workflow entry missing invocable: " + e["id"])

    def test_engine_is_not_invocable(self):
        wf = {e["id"]: e for e in self.reg.get("workflows", [])}
        self.assertEqual(wf["wf-runner"]["kind"], "engine")
        self.assertFalse(wf["wf-runner"]["invocable"], "engine must be invocable=false")

    def test_invocable_flag_agrees_with_kind(self):
        for e in self.reg.get("workflows", []):
            if e["invocable"]:
                self.assertIn(e["kind"], INVOCABLE_WORKFLOW_KINDS,
                              "invocable=true with non-callable kind: " + e["id"])
            else:
                self.assertIn(e["kind"], NON_INVOCABLE_KINDS,
                              "invocable=false with callable kind: " + e["id"])

    def test_support_arrays_are_non_invocable(self):
        for e in self.reg.get("packs", []) + self.reg.get("skills", []) + self.reg.get("contracts", []):
            self.assertFalse(e.get("invocable", False), "non-workflow resource must be invocable=false: " + e["id"])


if __name__ == "__main__":
    unittest.main()
