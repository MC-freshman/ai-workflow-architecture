"""CON-04 (D-11): a platform's declared evidenceBindings must be recomputable from disk.

Rules (normative for this suite; they were previously tribal knowledge inside one platform's
publish driver):
  configDigest      = sha256( bytes of the config file the suite is running with )
  runnerDigest      = sha256( bytes of <runner release>/manifest.json )
  runnerTreeDigest  = sha256( "\n".join( sha256(file bytes) + "  " + relative posix path )
                              over every file in the runner release except SHA256SUMS, sorted )
  environmentDigest = sha256( bytes of the file named by config.environmentManifest )

The point is not the digests, it is that a declaration that goes stale must fail a machine
check instead of quietly describing a configuration that no longer exists.
"""
import hashlib
import json
import unittest
from pathlib import Path

from . import env_config


def _sha(blob):
    return hashlib.sha256(blob).hexdigest()


def _tree_digest(root):
    names = sorted(p.relative_to(root).as_posix() for p in root.rglob("*")
                   if p.is_file() and p.name != "SHA256SUMS")
    return _sha("\n".join(_sha((root / name).read_bytes()) + "  " + name for name in names).encode("utf-8"))


class EvidenceBindings(unittest.TestCase):
    def setUp(self):
        self.config_path = env_config.config_path()
        self.config = env_config.load()
        capabilities = Path(self.config["capabilities"])
        if not capabilities.is_file():
            self.skipTest("config declares no readable capabilities document")
        document = json.loads(capabilities.read_text(encoding="utf-8-sig"))
        self.bindings = ((document.get("descriptor") or {}).get("evidenceBindings"))
        if self.bindings is None:
            self.skipTest("platform declares no descriptor/evidenceBindings")

    def test_schema_declares_the_binding_it_is_checked_against(self):
        contracts = Path(self.config["contracts"])
        schema = contracts / "contracts" / "runtime" / "platform-descriptor.schema.json"
        self.assertTrue(schema.is_file(), "contract package has no platform-descriptor schema")
        text = schema.read_text(encoding="utf-8-sig")
        self.assertIn("evidenceBindings", text,
                      "the suite's rule would be checking a field the contract does not declare")

    def test_config_digest_matches_the_file_being_run(self):
        self.assertEqual(self.bindings.get("configDigest"), _sha(self.config_path.read_bytes()),
                         "configDigest does not describe this config file - the declaration is stale")

    def test_runner_digest_matches_the_pinned_release_manifest(self):
        runner = Path(self.config["runner"])
        self.assertTrue(runner.is_dir(), "config.runner does not exist")
        self.assertEqual(self.bindings.get("runnerDigest"), _sha((runner / "manifest.json").read_bytes()),
                         "runnerDigest does not describe the manifest of the pinned runner release")

    def test_runner_tree_digest_matches_the_pinned_release_bytes(self):
        runner = Path(self.config["runner"])
        self.assertEqual(self.bindings.get("runnerTreeDigest"), _tree_digest(runner),
                         "runnerTreeDigest does not describe the pinned runner release byte-for-byte")

    def test_environment_digest_matches_the_declared_manifest(self):
        declared = self.bindings.get("environmentDigest")
        target = self.config.get("environmentManifest")
        if declared is None:
            self.skipTest("platform declares no environmentDigest")
        self.assertIsNotNone(target, "environmentDigest declared but config has no environmentManifest")
        manifest = Path(target)
        self.assertTrue(manifest.is_file(), "environmentManifest is declared but unreadable on disk")
        self.assertEqual(declared, _sha(manifest.read_bytes()),
                         "environmentDigest does not describe the sealed environment manifest on disk")

    def test_tampered_binding_is_caught(self):
        # The negative that makes this a check and not a description: flip one hex digit.
        runner = Path(self.config["runner"])
        self.assertNotEqual(_sha((runner / "manifest.json").read_bytes())[:-2] + "00",
                            self.bindings.get("runnerDigest"))
        mutated = _tree_digest(runner)
        self.assertEqual(mutated, self.bindings.get("runnerTreeDigest"))
        broken = mutated[:-2] + ("00" if mutated[-2:] != "00" else "01")
        self.assertNotEqual(broken, _tree_digest(runner), "a corrupted digest must differ from the real one")


if __name__ == "__main__":
    unittest.main()
