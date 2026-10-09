import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import gate_exec
import engine
from runtime_core import Rejected


class Contracts:
    class Lint:
        @staticmethod
        def read_json(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

    def __init__(self):
        self.lint = self.Lint()

    @staticmethod
    def canonical(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                          allow_nan=False).encode("utf-8")

    @classmethod
    def hash(cls, value):
        return hashlib.sha256(cls.canonical(value)).hexdigest()

    @staticmethod
    def read(path):
        return json.loads(Path(path).read_text(encoding="utf-8"))


class ProcessGateIdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wf-process-gate-")
        self.addCleanup(self.temp.cleanup)
        self.store_root = Path(self.temp.name) / "run"
        self.work = self.store_root / "work" / "project"
        self.evidence = self.store_root / "evidence" / "draft" / "1"
        self.workflow = self.store_root / "workflow"
        for path in (self.work, self.evidence, self.workflow):
            path.mkdir(parents=True, exist_ok=True)
        (self.workflow / "gate.py").write_text(
            "from pathlib import Path\n"
            "counter = Path('counter.txt')\n"
            "count = int(counter.read_text()) + 1 if counter.exists() else 1\n"
            "counter.write_text(str(count))\n"
            "Path('result.txt').write_text('accepted')\n",
            encoding="utf-8")
        self.contracts = Contracts()
        self.declaration = {
            "type": "process",
            "interpreter": "runner-python",
            "cwd": "work",
            "argv": ["workflow:gate.py"],
            "expectArtifacts": [{"target": "work:result.txt"}],
            "expectExit": [0],
            "timeoutSeconds": 5,
        }
        self.identity = {
            "runId": "run-process-gate-test",
            "stageId": "draft",
            "attempt": 1,
            "gateId": "side-effect-check",
            "inputSha256": "a" * 64,
            "outputManifestSha256": "b" * 64,
        }

    def evaluate(self, identity=None):
        return gate_exec.evaluate(
            self.contracts, self.store_root, self.workflow, self.declaration,
            "evidence/draft/1", "side-effect-check", None,
            execution_identity=identity or self.identity)

    def test_identical_submit_reuses_durable_result_without_rerunning_process(self):
        first = self.evaluate()
        second = self.evaluate()

        self.assertEqual(first, second)
        self.assertEqual((self.work / "counter.txt").read_text(encoding="utf-8"), "1")
        self.assertEqual(first["status"], "pass")

    def test_engine_submission_path_reuses_process_gate_outcome(self):
        output_path = self.evidence / "output.json"
        output_path.write_text('{"ok":true}\n', encoding="utf-8")
        output = {"path": "evidence/draft/1/output.json",
                  "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
                  "size": output_path.stat().st_size}
        output_manifest_sha256 = self.contracts.hash([output])
        gate_document = {
            "schema": "ai-gate-evidence/v1",
            "gateId": "side-effect-check",
            "type": "process",
            "status": "pass",
            "executorVersion": gate_exec.EXECUTOR_VERSION,
            "targets": [],
        }
        gate_path = self.evidence / "gate.json"
        gate_path.write_text(json.dumps(gate_document), encoding="utf-8")
        gate_evidence = {"path": "evidence/draft/1/gate.json",
                         "sha256": hashlib.sha256(gate_path.read_bytes()).hexdigest(),
                         "size": gate_path.stat().st_size}
        payload = {
            "stageId": "draft",
            "attempt": 1,
            "inputSha256": self.identity["inputSha256"],
            "outputs": [output],
            "gates": [{"gateId": "side-effect-check", "inputSha256": self.identity["inputSha256"],
                       "outputManifestSha256": output_manifest_sha256, "evidence": gate_evidence,
                       "status": "pass"}],
        }
        plan = {"workflowRoot": str(self.workflow), "manifest": {"id": "example-workflow"},
                "legacyOutputSchema": {"type": "object", "required": ["ok"],
                                       "properties": {"ok": {"const": True}}},
                "gateDefinitions": {"side-effect-check": self.declaration}}
        stage = {"id": "draft", "gates": ["side-effect-check"]}
        runner = engine.Engine.__new__(engine.Engine)
        runner.c = self.contracts
        store = type("Store", (), {"root": self.store_root})()

        first = runner.check_submission(store, plan, stage, payload)
        second = runner.check_submission(store, plan, stage, payload)

        self.assertEqual(first, second)
        self.assertEqual((self.work / "counter.txt").read_text(encoding="utf-8"), "1")

    def test_changed_binding_conflicts_instead_of_running_process_again(self):
        self.evaluate()
        changed = dict(self.identity, outputManifestSha256="c" * 64)

        with self.assertRaises(Rejected) as caught:
            self.evaluate(changed)

        self.assertEqual(caught.exception.code, "IDEMPOTENCY_CONFLICT")
        self.assertEqual((self.work / "counter.txt").read_text(encoding="utf-8"), "1")

    def test_unfinished_intent_fails_closed_without_replaying_process(self):
        gate_exec._reserve_process_gate(
            self.contracts, self.store_root, "evidence/draft/1", self.declaration,
            "side-effect-check", self.identity)

        with self.assertRaises(Rejected) as caught:
            self.evaluate()

        self.assertEqual(caught.exception.code, "UNKNOWN_OUTCOME")
        self.assertFalse((self.work / "counter.txt").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
