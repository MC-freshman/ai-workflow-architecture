"""CON-03 / ADR-2 / gate 1 format: every failure path emits exactly one
machine-readable JSON envelope on stdout, no traceback leak, v2 correlation fields.
Run: PCONF_CONFIG=<platform config> python -m unittest conformance.test_error_envelope
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from . import env_config


class ErrorEnvelope(unittest.TestCase):
    def setUp(self):
        self.config = env_config.config_path()
        cfg = env_config.load()
        self.cli = Path(cfg["runner"]) / "cli.py"
        self.tmp = Path(tempfile.mkdtemp(prefix="pconf-err-"))

    def _run(self, args):
        return subprocess.run([sys.executable, "-B", str(self.cli)] + args,
                              capture_output=True, text=True, timeout=120)

    def _assert_envelope(self, proc, expect_code=None):
        self.assertNotIn("Traceback", proc.stdout, "traceback leaked to stdout")
        lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
        self.assertEqual(len(lines), 1, "stdout must be exactly one JSON line, got %d" % len(lines))
        obj = json.loads(lines[0])
        self.assertFalse(obj.get("ok"), "expected ok:false")
        self.assertIn("code", obj.get("error", {}))
        for k in ("requestId", "operation", "phase", "outcome", "diagnosticRef"):
            self.assertIn(k, obj, "missing v2 field " + k)
        if expect_code:
            self.assertEqual(obj["error"]["code"], expect_code)

    def test_invalid_config_json(self):
        bad = self.tmp / "bad.json"; bad.write_text("{bad", encoding="utf-8")
        self._assert_envelope(self._run(["--config", str(bad)]), "INVALID_REQUEST")

    def test_malformed_request(self):
        req = self.tmp / "req.json"; req.write_text("{not json", encoding="utf-8")
        self._assert_envelope(self._run(["--config", str(self.config), "--request", str(req)]), "INVALID_REQUEST")

    def test_unknown_operation_not_ok(self):
        req = self.tmp / "op.json"
        req.write_text(json.dumps({"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
                                   "requestId": "x1", "idempotencyKey": "x1", "operation": "frobnicate",
                                   "runId": "r1", "payload": {}}), encoding="utf-8")
        self._assert_envelope(self._run(["--config", str(self.config), "--request", str(req)]))

    def test_engine_returns_clean_rejection_no_pseudo_success(self):
        # bad target must reject, never fabricate ok:true
        req = self.tmp / "tgt.json"
        req.write_text(json.dumps({"schemaVersion": "ai-run-protocol/v1.1", "kind": "request",
                                   "requestId": "x2", "idempotencyKey": "x2", "operation": "prepare",
                                   "runId": "r2", "payload": {"platform": "zcode", "parentRunId": None,
                                   "target": {"mode": "workflow", "id": "nope-xyz", "version": "9.9.9"},
                                   "parameters": {}, "inputSources": []}}), encoding="utf-8")
        self._assert_envelope(self._run(["--config", str(self.config), "--request", str(req)]))


if __name__ == "__main__":
    unittest.main()
