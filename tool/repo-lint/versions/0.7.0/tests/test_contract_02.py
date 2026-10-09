"""0.2.0 boundary tests: x- extension slots, R15 registration, conditional peer-agent/subworkflow."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_repo_lint import RepositoryFixture, repo_lint, seal, write_json  # noqa: E402


class Contract02Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="repo-lint-02-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = RepositoryFixture(Path(self.temp.name))

    def scan(self, select=None, bridge=None):
        return repo_lint.scan(self.fixture.tool, self.fixture.agent, select=select, bridge=bridge)

    def findings(self, report, rule, severity=None, code=None):
        return [item for item in report["findings"]
                if item["rule"] == rule and (severity is None or item["severity"] == severity)
                and (code is None or item["code"] == code)]

    def register_extension(self, fields):
        write_json(self.fixture.tool / "_registry" / "x-fields.json",
                   {"schema": "ai-x-field-registry/v1", "fields": fields})

    def peer_workflow(self, peers=("peer-expert",), worker="none", outputs="schemas/output.schema.json",
                      subworkflow=None):
        release, definition = self.fixture.workflow_v2()
        stage = definition["stages"][0]
        stage.pop("promptRef")
        if subworkflow is None:
            stage.update(action="peer-agent", worker=worker, peers=list(peers))
        else:
            stage.update(action="subworkflow", worker=worker, subworkflow=subworkflow)
        if outputs is None:
            stage.pop("outputs")
        else:
            stage["outputs"] = outputs
        write_json(release / "workflow.yaml", definition)
        seal(release)
        return release, definition

    def orchestrator(self, peer_lock=None, workflows=("alpha",), locks=None, peers=None):
        release = self.fixture.expert(resource_id="orchestrator",
                                      workflows=list(workflows),
                                      locks={"alpha": "1.0.0"} if locks is None else locks)
        if peer_lock is not None:
            manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
            manifest["peerLock"] = "peer-lock.json"
            write_json(release / "manifest.json", manifest)
            write_json(release / "peer-lock.json",
                       {"schema": "ai-peer-lock/v1", "peers": peer_lock if peers is None else peers})
        seal(release)
        return release

    def bridge(self, capabilities=None):
        path = self.fixture.root / "platform-config.json"
        write_json(path, {"defaults": {"agentVersions": {}}, "capabilities": capabilities or {}})
        return path

    def extension_release(self):
        """A v2.1 manifest that already satisfies the contract, plus its v2 definition."""
        return self.fixture.workflow_v2()[0]

    def test_extension_fields_are_accepted_and_registered(self):
        release = self.extension_release()
        self.mutate_manifest(release, lambda data: data.update({"x-source": "upstream-2.0.1"}))
        self.register_extension(["x-source"])
        report = self.scan()
        self.assertEqual(self.findings(report, "R4", "error", "manifest-contract"), [])
        self.assertTrue(self.findings(report, "R15", "info", "extension-registered"))
        self.assertEqual(report["decision"]["status"], "static-pass")

    def test_unregistered_extension_field_is_a_warning(self):
        release = self.extension_release()
        self.mutate_manifest(release, lambda data: data.update({"x-source": "upstream-2.0.1"}))
        report = self.scan()
        self.assertTrue(self.findings(report, "R15", "warning", "extension-undeclared"))
        self.assertEqual(report["decision"]["status"], "static-pass")

    def test_non_extension_unknown_manifest_field_stays_blocked(self):
        release = self.extension_release()
        self.mutate_manifest(release, lambda data: data.update({"source": "upstream-2.0.1"}))
        report = self.scan()
        self.assertTrue(self.findings(report, "R4", "error", "manifest-contract"))
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_extension_field_inside_definition_stage_is_accepted(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["x-delegation"] = {"mode": "peer"}
        write_json(release / "workflow.yaml", definition)
        seal(release)
        report = self.scan()
        self.assertEqual(self.findings(report, "R5", "error", "definition-contract"), [])
        self.assertTrue(self.findings(report, "R15", "warning", "extension-undeclared"))

    def test_conforming_peer_stage_is_accepted_with_capability_declaration(self):
        self.peer_workflow()
        self.fixture.expert(resource_id="peer-expert")
        self.orchestrator(peer_lock={"peer-expert": "1.0.0"})
        report = self.scan(bridge=self.bridge({"peerDispatch": True}))
        self.assertEqual(self.findings(report, "R7", "error"), [])
        self.assertTrue(self.findings(report, "R7", "warning", "peer-stage-registered"))
        self.assertEqual(report["decision"]["status"], "static-pass")

    def test_peer_stage_without_declared_capability_is_blocked(self):
        self.peer_workflow()
        self.fixture.expert(resource_id="peer-expert")
        self.orchestrator(peer_lock={"peer-expert": "1.0.0"})
        report = self.scan(bridge=self.bridge())
        self.assertTrue(self.findings(report, "R7", "error", "peer-capability-undeclared"))

    def test_peer_stage_shape_violations_are_blocked(self):
        self.peer_workflow(peers=(), worker="reviewer", outputs=None)
        codes = {item["code"] for item in self.findings(self.scan(), "R7", "error")}
        self.assertLessEqual({"peer-list", "peer-worker", "missing-aggregate-outputs"}, codes)

    def test_agent_without_peer_lock_cannot_own_a_peer_workflow(self):
        self.peer_workflow()
        self.fixture.expert(resource_id="peer-expert")
        self.orchestrator(peer_lock=None)
        self.assertTrue(self.findings(self.scan(), "R7", "error", "peer-not-covered"))

    def test_agent_peer_lock_must_cover_every_declared_peer(self):
        self.peer_workflow(peers=("peer-expert", "peer-analyst"))
        self.fixture.expert(resource_id="peer-expert")
        self.fixture.expert(resource_id="peer-analyst")
        self.orchestrator(peer_lock={"peer-expert": "1.0.0"})
        self.assertTrue(self.findings(self.scan(), "R7", "error", "peer-not-covered"))

    def test_unregistered_peer_is_a_warning_not_an_error(self):
        self.peer_workflow(peers=("ghost-expert",))
        report = self.scan()
        self.assertTrue(self.findings(report, "R7", "warning", "peer-unregistered"))
        self.assertEqual(self.findings(report, "R7", "error"), [])

    def test_subworkflow_stage_requires_a_resolvable_version(self):
        self.fixture.workflow(resource_id="beta", version="1.0.0")
        self.peer_workflow(subworkflow={"id": "beta", "version": "9.9.9"})
        self.assertTrue(self.findings(self.scan(), "R7", "error", "subworkflow-unresolved"))

    def test_resolvable_subworkflow_stage_is_accepted(self):
        self.fixture.workflow(resource_id="beta", version="1.0.0")
        self.peer_workflow(subworkflow={"id": "beta", "version": "1.0.0"})
        report = self.scan()
        self.assertEqual(self.findings(report, "R7", "error"), [])
        self.assertTrue(self.findings(report, "R7", "warning", "subworkflow-stage-registered"))

    def mutate_manifest(self, release, operation):
        path = release / "manifest.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        operation(data)
        write_json(path, data)
        seal(release)


if __name__ == "__main__":
    unittest.main(verbosity=2)
