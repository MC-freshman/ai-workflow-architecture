"""Independent boundary and compatibility tests using isolated repositories."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(os.environ.get(
    "REPO_LINT_SCRIPT", Path(__file__).resolve().parents[1] / "scripts" / "repo_lint.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("repo_lint_under_test", SCRIPT)
repo_lint = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = repo_lint
SPEC.loader.exec_module(repo_lint)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def seal(release: Path) -> None:
    lines = []
    for path in sorted(release.rglob("*")):
        if path.is_file() and path.name != "SHA256SUMS":
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            lines.append(f"{digest}  {path.relative_to(release).as_posix()}")
    (release / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


class RepositoryFixture:
    def __init__(self, root: Path):
        self.root = root
        self.tool = root / "tool"
        self.agent = root / "agent"
        self.tool_registry = {
            "schema": "ai-tool-registry/v2", "version": 1,
            "workflows": [], "packs": [], "skills": [],
        }
        self.agent_registry = {
            "schema": "ai-agent-registry/v2", "version": 1, "agents": [],
        }
        self.save_registries()

    def save_registries(self) -> None:
        write_json(self.tool / "registry.json", self.tool_registry)
        write_json(self.agent / "registry.json", self.agent_registry)

    def register(self, kind: str, resource_id: str, version: str) -> Path:
        root = self.agent if kind == "agent" else self.tool
        parent = root / "packs" / resource_id if kind == "pack" else root / resource_id
        release = parent / "versions" / version
        release.mkdir(parents=True, exist_ok=True)
        write_json(parent / "current.json", {
            "schema": f"ai-{kind}-pointer/v1", "id": resource_id,
            "version": version, "hashManifest": "SHA256SUMS",
        })
        registry = self.agent_registry if kind == "agent" else self.tool_registry
        registry[kind + "s"].append({
            "id": resource_id, "current": (parent / "current.json").relative_to(root).as_posix(),
            "enabled": True,
        })
        self.save_registries()
        return release

    def workflow(self, resource_id: str = "alpha", version: str = "1.0.0",
                 schema: str = "ai-workflow/v1", dependencies=None) -> Path:
        release = self.register("workflow", resource_id, version)
        write_json(release / "manifest.json", {
            "schema": schema, "id": resource_id, "displayName": resource_id,
            "version": version, "entry": "workflow.yaml",
            "inputSchema": "schemas/input.schema.json", "outputSchema": "schemas/output.schema.json",
            "permissions": {"filesystem": "read-only", "network": "deny", "process": "deny"},
            "dependencies": [] if dependencies is None else dependencies,
            "integrity": {"sha256Manifest": "SHA256SUMS"},
        })
        (release / "workflow.yaml").write_text(
            f"schema: ai-workflow-definition/v1\nid: {resource_id}\nversion: {version}\n"
            "stages:\n  - id: inspect\n    mode: serial\n    workers: []\n",
            encoding="utf-8",
        )
        for name in ("input", "output"):
            write_json(release / "schemas" / f"{name}.schema.json", {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object", "properties": {"value": {"type": "string"}},
                "required": ["value"], "additionalProperties": False,
            })
        seal(release)
        return release

    def expert(self, resource_id: str = "expert", workflows=None, locks=None, packs=None,
               skills=None) -> Path:
        release = self.register("agent", resource_id, "1.0.0")
        write_json(release / "manifest.json", {
            "schema": "ai-agent/v2", "id": resource_id, "version": "1.0.0",
            "displayName": resource_id, "role": "fixture reviewer", "prompt": "prompt.md",
            "toolLock": "tool-lock.json", "workflows": [] if workflows is None else workflows,
            "policies": ["policies/read-only.md"], "modelPolicy": {"mode": "inherit"},
            "input": {"type": "text"}, "output": {"type": "text"},
            "integrity": {"sha256Manifest": "SHA256SUMS"},
        })
        (release / "prompt.md").write_text("# Fixture reviewer\nReview supplied evidence.\n", encoding="utf-8")
        (release / "policies").mkdir()
        (release / "policies" / "read-only.md").write_text("Read only.\n", encoding="utf-8")
        write_json(release / "tool-lock.json", {
            "schema": "ai-tool-lock/v2", "workflows": {} if locks is None else locks,
            "skills": {} if skills is None else skills,
            "packs": {} if packs is None else packs, "profiles": {},
        })
        seal(release)
        return release

    def workflow_v2(self):
        release = self.workflow(schema="ai-workflow/v2.1", dependencies={})
        manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
        manifest["mode"] = "prompt-skill"
        write_json(release / "manifest.json", manifest)
        definition = {
            "schema": "ai-workflow-definition/v2", "id": "alpha", "version": "1.0.0",
            "mode": "prompt-skill", "maxParallel": 1, "roles": ["reviewer"],
            "stages": [{"id": "inspect", "action": "prompt", "worker": "reviewer",
                        "promptRef": "workflow.md#stage:inspect", "inputs": "schemas/input.schema.json",
                        "outputs": "schemas/output.schema.json", "onFail": "stop"}],
        }
        write_json(release / "workflow.yaml", definition)
        (release / "workflow.md").write_text(
            "<!-- stage:inspect -->\nInspect supplied evidence.\n<!-- /stage:inspect -->\n",
            encoding="utf-8")
        seal(release)
        return release, definition

    def pack(self, resource_id: str, conflicts=None) -> Path:
        release = self.register("pack", resource_id, "1.0.0")
        write_json(release / "manifest.json", {
            "schema": "ai-pack/v1", "id": resource_id, "version": "1.0.0",
            "displayName": resource_id, "skillIds": [], "skillVersions": {},
            "conflicts": [] if conflicts is None else conflicts,
            "integrity": {"sha256Manifest": "SHA256SUMS"},
        })
        seal(release)
        return release

    def skill(self, resource_id: str = "fixture-skill", version: str = "1.0.0") -> Path:
        parent = self.tool / "skills" / resource_id
        release = parent / "versions" / version
        release.mkdir(parents=True)
        write_json(parent / "current.json", {
            "schema": "ai-skill-pointer/v1", "id": resource_id, "version": version,
            "hashManifest": "SHA256SUMS",
        })
        write_json(release / "manifest.json", {
            "schema": "ai-skill/v1", "id": resource_id, "version": version,
            "kind": "atomic", "category": "skill", "entry": "SKILL.md",
            "input": {"type": "text"}, "output": {"type": "text"},
            "permissions": ["read-project"], "requires": [], "conflicts": [],
            "integrity": {"sha256Manifest": "SHA256SUMS"},
        })
        (release / "SKILL.md").write_text(
            "---\nname: fixture-skill\ndescription: Review fixture evidence.\n---\n"
            "# Fixture skill\nRead supplied evidence.\n", encoding="utf-8")
        catalog = self.tool / "_registry" / f"{resource_id}.json"
        write_json(catalog, {
            "schema": "ai-skill-catalog/v1", "sourceId": "fixture", "snapshot": "fixture-1",
            "skills": [{"id": resource_id, "version": version, "category": "skill"}],
        })
        self.tool_registry["skills"].append({
            "id": f"catalog-{resource_id}", "path": catalog.relative_to(self.tool).as_posix(),
            "kind": "skill-catalog", "enabled": True,
        })
        self.save_registries()
        seal(release)
        return release


class RepoLintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="repo-lint-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = RepositoryFixture(Path(self.temp.name))

    def scan(self, select=None):
        return repo_lint.scan(self.fixture.tool, self.fixture.agent, select=select)

    def assert_rule(self, report, rule, severity="error"):
        matches = [item for item in report["findings"]
                   if item["rule"] == rule and item["severity"] == severity]
        self.assertTrue(matches, f"Missing {severity} {rule}: {report['findings']!r}")

    def mutate_json(self, path, operation, reseal=True):
        data = json.loads(path.read_text(encoding="utf-8"))
        operation(data)
        write_json(path, data)
        if reseal:
            seal(path.parent)

    def cli(self, *extra):
        return subprocess.run([
            sys.executable, "-B", str(SCRIPT), "--tool-root", str(self.fixture.tool),
            "--agent-root", str(self.fixture.agent), "--scope", "snapshot", *map(str, extra),
        ], capture_output=True, text=True, timeout=30, check=False)

    def directory_link(self, link: Path, target: Path):
        if os.name == "nt":
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(link), str(target)],
                capture_output=True, text=True, timeout=10, check=False, errors="replace",
            )
            self.assertEqual(result.returncode, 0, (result.stdout or "") + (result.stderr or ""))
        else:
            link.symlink_to(target, target_is_directory=True)

    def test_empty_inventory_is_static_pass_never_runtime_pass(self):
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0)
        self.assertEqual(report["summary"]["exitCode"], 0)
        self.assertEqual(report["summary"]["resourceCount"], 0)
        self.assertEqual(report["decision"]["scope"], "inventory")
        self.assertEqual(report["decision"]["status"], "static-pass")
        self.assertEqual(report["decision"]["runtimeStatus"], "not-validated")

    def test_supported_v1_workflow_and_v2_agent_are_accepted(self):
        self.fixture.workflow()
        self.fixture.expert(workflows=["alpha"], locks={"alpha": "1.0.0"})
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])
        self.assertEqual(report["decision"]["runtimeStatus"], "not-validated")

    def test_supported_v2_workflow_manifest_is_accepted(self):
        self.fixture.workflow(schema="ai-workflow/v2", dependencies={"skills": []})
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])

    def test_valid_v2_prompt_definition_static_pass_does_not_prove_runtime(self):
        self.fixture.workflow_v2()
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])
        self.assertEqual(report["decision"]["status"], "static-pass")
        self.assertEqual(report["decision"]["runtimeStatus"], "not-validated")

    def test_v2_1_manifest_contract_requires_permissions_and_valid_dependencies(self):
        release, _ = self.fixture.workflow_v2()
        manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
        for case in ("missing-permissions", "invalid-dependencies"):
            with self.subTest(case=case):
                candidate = json.loads(json.dumps(manifest))
                if case == "missing-permissions":
                    candidate.pop("permissions")
                else:
                    candidate["dependencies"] = "not-an-object"
                write_json(release / "manifest.json", candidate)
                seal(release)
                report = self.scan()
                self.assert_rule(report, "R4")
                self.assertEqual(report["decision"]["status"], "blocked")

    def test_v2_undeclared_worker_is_rejected(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["worker"] = "undeclared-reviewer"
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assert_rule(self.scan(), "R6")

    def test_v2_unknown_action_is_rejected(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["action"] = "run-anything"
        write_json(release / "workflow.yaml", definition)
        seal(release)
        report = self.scan()
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_v2_invalid_prompt_anchors_are_rejected(self):
        release, _ = self.fixture.workflow_v2()
        examples = {
            "missing": "# Plain prompt\n",
            "unclosed": "<!-- stage:inspect -->\n",
            "duplicate": ("<!-- stage:inspect --><!-- /stage:inspect -->\n" * 2),
            "nested": "<!-- stage:inspect --><!-- stage:nested --><!-- /stage:nested --><!-- /stage:inspect -->",
            "crossing": "<!-- stage:inspect --><!-- stage:other --><!-- /stage:inspect --><!-- /stage:other -->",
        }
        for name, text in examples.items():
            with self.subTest(case=name):
                (release / "workflow.md").write_text(text, encoding="utf-8")
                seal(release)
                self.assert_rule(self.scan(), "R7")

    def test_v2_missing_script_is_rejected_without_execution(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0].update(action="script", script="scripts/missing.py", arguments={})
        definition["stages"][0].pop("promptRef")
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assert_rule(self.scan(), "R7")

    def test_v2_missing_required_gate_is_blocked(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["gates"] = ["output-validation"]
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assert_rule(self.scan(), "R8")

    def test_v2_empty_required_gate_declaration_is_blocked(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["gates"] = ["output-validation"]
        definition["gateDefinitions"] = {"output-validation": {}}
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assert_rule(self.scan(), "R8")

    def test_v2_repair_requires_entry_and_limit(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0]["onFail"] = "repair"
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assertEqual(self.scan()["decision"]["status"], "blocked")
        definition["stages"][0]["repairPromptRef"] = "workflow.md#stage:inspect"
        write_json(release / "workflow.yaml", definition)
        seal(release)
        self.assertEqual(self.scan()["decision"]["status"], "blocked")

    def test_v2_placeholder_schema_blocks_new_candidate(self):
        release, _ = self.fixture.workflow_v2()
        write_json(release / "schemas" / "output.schema.json", {})
        seal(release)
        self.assert_rule(self.scan(), "R9")

    def test_v2_peer_agent_remains_blocked(self):
        release, definition = self.fixture.workflow_v2()
        definition["stages"][0].update(action="peer-agent", peers=["reviewer"])
        definition["stages"][0].pop("promptRef")
        write_json(release / "workflow.yaml", definition)
        seal(release)
        report = self.scan()
        self.assertEqual(report["decision"]["status"], "blocked")
        self.assertEqual(report["decision"]["runtimeStatus"], "not-validated")

    def test_agent_invalid_peer_lock_is_rejected(self):
        release = self.fixture.expert()
        self.mutate_json(release / "manifest.json", lambda data: data.update(peerLock="peer-lock.json"))
        write_json(release / "peer-lock.json", {"schema": "ai-peer-lock/v1", "peers": []})
        seal(release)
        self.assert_rule(self.scan(), "R14")

    def test_agent_legacy_policy_labels_are_not_treated_as_file_paths(self):
        release = self.fixture.expert()
        self.mutate_json(release / "manifest.json", lambda data: data.update(
            policies=["project-scoped", "no-credentials"]))
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])
        self.assertEqual(report["decision"]["status"], "static-pass")
        self.assertFalse(any(item["code"] == "missing-file" for item in report["findings"]))

    def test_agent_policy_file_must_exist(self):
        release = self.fixture.expert()
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])
        policy = release / "policies" / "read-only.md"
        policy.unlink()
        seal(release)
        report = self.scan()
        self.assert_rule(report, "R4")
        self.assertTrue(any(
            item["rule"] == "R4" and item["code"] == "missing-file"
            and Path(item["path"]) == policy for item in report["findings"]
        ), report["findings"])
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_agent_invalid_policy_types_are_rejected(self):
        release = self.fixture.expert()
        for value in (None, "project-scoped", {"path": "policies/read-only.md"},
                      [None], [12], [{}]):
            with self.subTest(policies=value):
                self.mutate_json(release / "manifest.json", lambda data: data.update(policies=value))
                report = self.scan()
                self.assert_rule(report, "R4")
                self.assertEqual(report["decision"]["status"], "blocked")

    def test_malformed_v2_fields_are_findings_not_uncaught_errors(self):
        release, definition = self.fixture.workflow_v2()
        cases = [
            ("roles", None), ("schema", []), ("gateDefinitions", None),
            ("stage.action", []), ("stage.worker", {}), ("stage.gates", None),
            ("stage.gates", [{}]), ("stage.dependsOn", {}),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                candidate = json.loads(json.dumps(definition))
                if field.startswith("stage."):
                    candidate["stages"][0][field.split(".", 1)[1]] = value
                else:
                    candidate[field] = value
                    if field == "gateDefinitions":
                        candidate["stages"][0]["gates"] = ["gate"]
                write_json(release / "workflow.yaml", candidate)
                seal(release)
                self.assertEqual(self.scan()["decision"]["status"], "blocked")

    def test_non_string_manifest_schema_is_a_finding(self):
        release = self.fixture.workflow()
        self.mutate_json(release / "manifest.json", lambda data: data.update(schema=[]))
        self.assert_rule(self.scan(), "R4")

    def test_non_object_registry_is_rejected(self):
        write_json(self.fixture.tool / "registry.json", [])
        self.assert_rule(self.scan(), "R1")

    def test_pointer_identity_mismatch_is_blocked(self):
        self.fixture.workflow()
        self.mutate_json(self.fixture.tool / "alpha" / "current.json",
                         lambda data: data.update(id="other"), reseal=False)
        report = self.scan()
        self.assert_rule(report, "R2")
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_missing_pointer_target_is_reported(self):
        self.fixture.workflow()
        self.mutate_json(self.fixture.tool / "alpha" / "current.json",
                         lambda data: data.update(version="9.9.9"), reseal=False)
        self.assert_rule(self.scan(), "R1")

    def test_manifest_identity_mismatch_is_reported(self):
        release = self.fixture.workflow()
        self.mutate_json(release / "manifest.json", lambda data: data.update(id="other"))
        self.assert_rule(self.scan(), "R2")

    def test_unknown_schema_cannot_claim_static_pass(self):
        release = self.fixture.workflow()
        self.mutate_json(release / "manifest.json", lambda data: data.update(schema="ai-workflow/v99"))
        self.assert_rule(self.scan(), "R4")

    def test_malformed_manifest_json_is_a_finding_not_an_exception(self):
        release = self.fixture.workflow()
        (release / "manifest.json").write_text('{"schema": ', encoding="utf-8")
        seal(release)
        report = self.scan()
        self.assertGreater(report["summary"]["errors"], 0)
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_required_manifest_field_is_validated(self):
        release = self.fixture.workflow()
        self.mutate_json(release / "manifest.json", lambda data: data.pop("entry"))
        self.assert_rule(self.scan(), "R4")

    def test_duplicate_checksum_entry_is_reported(self):
        release = self.fixture.workflow()
        sums = release / "SHA256SUMS"
        content = sums.read_text(encoding="utf-8")
        sums.write_text(content + content.splitlines()[0] + "\n", encoding="utf-8")
        self.assert_rule(self.scan(), "R3")

    def test_missing_file_and_unlisted_file_are_distinct_findings(self):
        release = self.fixture.workflow()
        (release / "schemas" / "output.schema.json").unlink()
        (release / "unlisted.txt").write_text("unexpected\n", encoding="utf-8")
        report = self.scan()
        findings = [item for item in report["findings"] if item["rule"] == "R3"]
        self.assertGreaterEqual(len({item["code"] for item in findings}), 2, findings)
        self.assertTrue(any("unlisted.txt" in item["path"] for item in findings), findings)
        self.assertTrue(any("output.schema.json" in item["path"] for item in findings), findings)

    def test_changed_file_hash_is_reported(self):
        release = self.fixture.workflow()
        with (release / "workflow.yaml").open("a", encoding="utf-8") as handle:
            handle.write("# changed after release\n")
        self.assert_rule(self.scan(), "R3")

    def test_duplicate_yaml_keys_are_rejected(self):
        release = self.fixture.workflow()
        with (release / "workflow.yaml").open("a", encoding="utf-8") as handle:
            handle.write("stages: []\n")
        seal(release)
        self.assert_rule(self.scan(), "R5")

    def test_yaml_recursive_alias_is_rejected_without_recursing(self):
        release = self.fixture.workflow()
        (release / "workflow.yaml").write_text(
            "schema: ai-workflow-definition/v1\nid: alpha\nversion: 1.0.0\n"
            "stages: &cycle\n  - *cycle\n", encoding="utf-8")
        seal(release)
        self.assert_rule(self.scan(), "R5")

    def test_stage_cycle_is_rejected(self):
        release = self.fixture.workflow()
        (release / "workflow.yaml").write_text(
            "schema: ai-workflow-definition/v1\nid: alpha\nversion: 1.0.0\nstages:\n"
            "  - id: first\n    workers: []\n    dependsOn: [second]\n"
            "  - id: second\n    workers: []\n    dependsOn: [first]\n", encoding="utf-8")
        seal(release)
        self.assert_rule(self.scan(), "R5")

    def test_schema_invalid_and_legacy_placeholder_are_different_severities(self):
        release = self.fixture.workflow()
        write_json(release / "schemas" / "input.schema.json", {"type": "not-a-json-schema-type"})
        write_json(release / "schemas" / "output.schema.json", {})
        seal(release)
        report = self.scan()
        self.assert_rule(report, "R9", "error")
        self.assert_rule(report, "R9", "warning")

    def test_registry_paths_reject_parent_and_windows_absolute_forms(self):
        for bad_path in ("../escape/current.json", r"..\escape\current.json",
                         "C:/escape/current.json", r"C:\escape\current.json",
                         r"\\server\share\current.json"):
            with self.subTest(path=bad_path):
                self.fixture.tool_registry["workflows"] = [
                    {"id": "escape", "current": bad_path, "enabled": True}]
                self.fixture.save_registries()
                report = self.scan()
                self.assert_rule(report, "R1")
                self.assertEqual(report["decision"]["status"], "blocked")

    def test_checksum_path_cannot_escape_release(self):
        release = self.fixture.workflow()
        outside = self.fixture.root / "outside.txt"
        outside.write_text("external sentinel\n", encoding="utf-8")
        digest = hashlib.sha256(outside.read_bytes()).hexdigest()
        sums = release / "SHA256SUMS"
        with sums.open("a", encoding="utf-8") as handle:
            handle.write(f"{digest}  ../../../../outside.txt\n")
        self.assert_rule(self.scan(), "R3")
        self.assertEqual(outside.read_text(encoding="utf-8"), "external sentinel\n")

    def test_registry_junction_cannot_escape_shared_root(self):
        outside = self.fixture.root / "external"
        outside.mkdir()
        write_json(outside / "current.json", {
            "schema": "ai-workflow-pointer/v1", "id": "escaped", "version": "1.0.0",
        })
        self.directory_link(self.fixture.tool / "escaped", outside)
        self.fixture.tool_registry["workflows"].append({
            "id": "escaped", "current": "escaped/current.json", "enabled": True,
        })
        self.fixture.save_registries()
        self.assert_rule(self.scan(), "R1")

    def test_shared_repository_root_cannot_be_a_junction(self):
        alias = self.fixture.root / "tool-alias"
        self.directory_link(alias, self.fixture.tool)
        report = repo_lint.scan(alias, self.fixture.agent)
        self.assert_rule(report, "R1")
        self.assertEqual(report["decision"]["status"], "blocked")

    def test_published_cache_is_reported_even_when_in_checksum_list(self):
        release = self.fixture.workflow()
        (release / "__pycache__").mkdir()
        (release / "__pycache__" / "module.pyc").write_bytes(b"fixture cache")
        seal(release)
        self.assert_rule(self.scan(), "R11")

    def test_missing_exact_locked_workflow_version_is_reported(self):
        self.fixture.workflow()
        self.fixture.expert(workflows=["alpha"], locks={"alpha": "9.9.9"})
        self.assert_rule(self.scan(), "R12")

    def test_allowed_workflow_requires_tool_lock_coverage(self):
        self.fixture.workflow()
        self.fixture.expert(workflows=["alpha"], locks={})
        self.assert_rule(self.scan(), "R12")

    def test_floating_tool_lock_is_rejected(self):
        self.fixture.workflow()
        self.fixture.expert(workflows=["alpha"], locks={"alpha": "current"})
        self.assert_rule(self.scan(), "R12")

    def test_catalog_skill_is_discovered_and_exact_lock_is_accepted(self):
        self.fixture.skill()
        self.fixture.expert(skills={"fixture-skill": "1.0.0"})
        report = self.scan()
        self.assertEqual(report["summary"]["errors"], 0, report["findings"])
        self.assertEqual(report["summary"]["resourceCount"], 2)

    def test_missing_exact_skill_version_is_reported(self):
        self.fixture.skill()
        self.fixture.expert(skills={"fixture-skill": "9.9.9"})
        self.assert_rule(self.scan("agent:expert@1.0.0"), "R12")

    def test_conflicting_packs_block_only_the_combined_dependency_closure(self):
        self.fixture.pack("pack-a", conflicts=["pack-b"])
        self.fixture.pack("pack-b")
        self.assertEqual(self.scan()["summary"]["errors"], 0)
        self.fixture.expert(packs={"pack-a": "1.0.0", "pack-b": "1.0.0"})
        self.assert_rule(self.scan("agent:expert@1.0.0"), "R12")

    def test_unpinned_pack_requires_consuming_skill_lock(self):
        self.fixture.skill()
        pack = self.fixture.pack("selector-pack")
        self.mutate_json(pack / "manifest.json", lambda data: data.update(skillIds=["fixture-skill"]))
        self.assert_rule(self.scan(), "R12", "warning")
        expert = self.fixture.expert(packs={"selector-pack": "1.0.0"})
        self.assert_rule(self.scan("agent:expert@1.0.0"), "R12")
        self.mutate_json(expert / "tool-lock.json", lambda data: data.update(skills={"fixture-skill": "1.0.0"}))
        report = self.scan("agent:expert@1.0.0")
        self.assertEqual(report["decision"]["status"], "static-pass", report["findings"])

    def test_agent_must_authorize_transitive_workflow_dependency(self):
        self.fixture.workflow("beta")
        self.fixture.workflow("alpha", dependencies={"workflows": {"beta": "1.0.0"}})
        expert = self.fixture.expert(workflows=["alpha"], locks={"alpha": "1.0.0"})
        self.assert_rule(self.scan("agent:expert@1.0.0"), "R12")
        self.mutate_json(expert / "tool-lock.json", lambda data: data.update(
            workflows={"alpha": "1.0.0", "beta": "1.0.0"}))
        report = self.scan("agent:expert@1.0.0")
        self.assertEqual(report["decision"]["status"], "static-pass", report["findings"])

    def test_selection_is_not_blocked_by_unrelated_invalid_resource(self):
        self.fixture.workflow("alpha")
        release = self.fixture.workflow("legacy")
        self.mutate_json(release / "manifest.json", lambda data: data.update(schema="ai-workflow/v999"))
        self.assertGreater(self.scan()["summary"]["errors"], 0)
        report = self.scan("workflow:alpha@1.0.0")
        self.assertEqual(report["decision"]["blockingFindings"], [], report["findings"])
        self.assertEqual(report["decision"]["scope"], "selection")
        self.assertEqual(report["decision"]["status"], "static-pass")

    def test_cli_exit_codes_for_clean_warning_and_error(self):
        target = self.fixture.root / "report.json"
        clean = self.cli("--report", target)
        self.assertEqual(clean.returncode, 0, clean.stderr + clean.stdout)
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["summary"]["exitCode"], 0)
        release = self.fixture.workflow()
        write_json(release / "schemas" / "output.schema.json", {})
        seal(release)
        warning_target = self.fixture.root / "warning-report.json"
        warning = self.cli("--report", warning_target)
        # 0.3.0 runner policy: warnings do not fail the process; only blockers do.
        self.assertEqual(warning.returncode, 0, warning.stderr + warning.stdout)
        report = json.loads(warning_target.read_text(encoding="utf-8"))
        self.assertEqual(report["summary"]["exitCode"], 2)
        self.assertEqual(report["processExitPolicy"], "blockers-only")
        self.mutate_json(release / "manifest.json", lambda data: data.update(schema="ai-workflow/v999"))
        error = self.cli("--report", self.fixture.root / "error-report.json")
        self.assertEqual(error.returncode, 1, error.stderr + error.stdout)

    def test_cli_refuses_reports_within_shared_repositories(self):
        for root in (self.fixture.tool, self.fixture.agent):
            with self.subTest(root=root):
                target = root / "generated-report.json"
                result = self.cli("--report", target)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(target.exists(), result.stderr + result.stdout)
        safe_json = self.fixture.root / "safe-report.json"
        markdown = self.fixture.tool / "generated-report.md"
        result = self.cli("--report", safe_json, "--markdown", markdown)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(markdown.exists())

    def test_cli_rejects_report_junction_pointing_into_shared_repository(self):
        alias = self.fixture.root / "report-alias"
        self.directory_link(alias, self.fixture.tool)
        result = self.cli("--report", alias / "generated.json")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.fixture.tool / "generated.json").exists())

    def test_shipped_schemas_parse_and_report_satisfies_output_contract(self):
        root = SCRIPT.resolve().parents[1]
        for path in (root / 'schemas').glob('*.schema.json'):
            schema = repo_lint.read_json(path)
            repo_lint.jsonschema.Draft202012Validator.check_schema(schema)
        report = self.scan()
        # main() enriches the scanner report with the runner-facing fields; simulate them here.
        report["scope"] = "snapshot"
        report["processExitPolicy"] = "blockers-only"
        report["sharedWriteProbe"] = {"applied": False}
        repo_lint.jsonschema.validate(report, repo_lint.read_json(root / 'schemas' / 'output.schema.json'))

    def test_cli_rejects_duplicate_output_paths_before_writing(self):
        target = self.fixture.root / 'duplicate-output.json'
        result = self.cli('--report', target, '--markdown', target)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
