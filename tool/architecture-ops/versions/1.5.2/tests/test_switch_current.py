import base64
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from architecture_ops import switch_current


ROOT_KEYS = {
    "workflow": ("toolRoot", "workflows"),
    "agent": ("agentRoot", "agents"),
    "software": ("softwareRoot", "software"),
    "contracts": ("toolRoot", "contracts"),
    "governance": ("toolRoot", "governance"),
}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def seal(release):
    rows = []
    for path in sorted(item for item in release.rglob("*") if item.is_file() and item.name != "SHA256SUMS"):
        rel = path.relative_to(release).as_posix()
        rows.append(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + rel)
    (release / "SHA256SUMS").write_text("\n".join(rows) + "\n", encoding="ascii")


class SwitchCurrentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="switch-current-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def fixture(self, kind):
        platform_root = self.base / "codex"
        checkpoint = platform_root / "runtime" / "maintenance" / "P3"
        checkpoint.mkdir(parents=True, exist_ok=True)
        root_key, section = ROOT_KEYS[kind]
        repo = self.base / "shared" / (root_key + "-" + kind)
        repo.mkdir(parents=True, exist_ok=True)
        ident = "sample-resource"
        for version in ("1.0.0", "1.1.0"):
            release = repo / ident / "versions" / version
            release.mkdir(parents=True)
            write_json(release / "manifest.json", {"id": ident, "version": version})
            write_json(release / "SOURCE.json", {"schema": "ai-governance-source/v1"})
            seal(release)
        pointer = repo / ident / "current.json"
        prior = {"schema": switch_current.POINTER_SCHEMAS[kind], "id": ident,
                 "version": "1.0.0", "hashManifest": "SHA256SUMS"}
        write_json(pointer, prior)
        entry = {"id": ident, "current": ident + "/current.json", "enabled": True}
        if kind == "agent":
            entry["version"] = "1.0.0"
        registry_path = repo / "registry.json"
        write_json(registry_path, {section: [entry]})
        config = {"platform": "codex", "platformRoot": str(platform_root), root_key: str(repo)}
        config_path = platform_root / "bridge" / "runner-config.json"
        write_json(config_path, config)
        args = SimpleNamespace(config=str(config_path), kind=kind, id=ident,
                                from_version="1.0.0", to="1.1.0", checkpoint=str(checkpoint))
        return pointer, registry_path, args

    def test_all_shared_registry_kinds_apply_verify_and_byte_exact_revert(self):
        for kind in ROOT_KEYS:
            with self.subTest(kind=kind):
                pointer, registry, args = self.fixture(kind)
                original = pointer.read_bytes()
                registry_original = registry.read_bytes()
                planned = switch_current.plan(args)
                plan_path = planned["plan"]

                applied = switch_current.apply(SimpleNamespace(plan=plan_path))
                self.assertTrue(applied["applied"])
                if kind == "agent":
                    self.assertEqual(json.loads(registry.read_text(encoding="utf-8"))["agents"][0]["version"], "1.1.0")
                self.assertTrue(switch_current.verify(SimpleNamespace(plan=plan_path))["verified"])
                reverted = switch_current.revert(SimpleNamespace(plan=plan_path))

                self.assertTrue(reverted["byteExact"])
                self.assertEqual(pointer.read_bytes(), original)
                self.assertEqual(registry.read_bytes(), registry_original)

    def test_changed_pointer_fails_compare_and_swap_without_overwrite(self):
        pointer, _registry, args = self.fixture("workflow")
        plan_path = switch_current.plan(args)["plan"]
        changed = {"schema": switch_current.POINTER_SCHEMAS["workflow"], "id": "sample-resource",
                   "version": "1.2.0", "hashManifest": "SHA256SUMS"}
        write_json(pointer, changed)
        before = pointer.read_bytes()

        with self.assertRaises(switch_current.Refusal):
            switch_current.apply(SimpleNamespace(plan=plan_path))

        self.assertEqual(pointer.read_bytes(), before)

    def test_apply_resumes_a_checkpointed_partial_agent_switch(self):
        pointer, registry, args = self.fixture("agent")
        pointer_before = pointer.read_bytes()
        registry_before = registry.read_bytes()
        plan_path = switch_current.plan(args)["plan"]
        plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
        pointer.write_bytes(base64.b64decode(plan["newPointerBase64"]))

        result = switch_current.apply(SimpleNamespace(plan=plan_path))

        self.assertTrue(result["applied"])
        self.assertTrue(switch_current.verify(SimpleNamespace(plan=plan_path))["verified"])
        self.assertEqual(json.loads(registry.read_text(encoding="utf-8"))["agents"][0]["version"], "1.1.0")
        switch_current.revert(SimpleNamespace(plan=plan_path))
        self.assertEqual(pointer.read_bytes(), pointer_before)
        self.assertEqual(registry.read_bytes(), registry_before)

    def test_unlisted_target_release_file_is_rejected(self):
        pointer, _registry, args = self.fixture("agent")
        root = Path(json.loads(Path(args.config).read_text(encoding="utf-8"))["agentRoot"])
        (root / args.id / "versions" / args.to / "orphan.txt").write_text("unlisted", encoding="utf-8")

        with self.assertRaisesRegex(switch_current.Refusal, "coverage differ"):
            switch_current.plan(args)

    def test_checkpoint_outside_calling_platform_runtime_is_rejected(self):
        _pointer_path, _registry, args = self.fixture("software")
        args.checkpoint = str(self.base / "shared-checkpoints")

        with self.assertRaisesRegex(switch_current.Refusal, "platform's runtime/maintenance"):
            switch_current.plan(args)


if __name__ == "__main__":
    unittest.main(verbosity=2)
