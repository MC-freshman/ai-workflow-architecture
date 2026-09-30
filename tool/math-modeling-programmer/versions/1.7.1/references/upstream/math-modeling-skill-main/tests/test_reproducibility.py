import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "references" / "roles" / "编程手" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_env
import repro_manifest


class DynamicDependencyTests(unittest.TestCase):
    def test_only_checks_selected_features(self):
        checked = []

        def fake_find_spec(module):
            checked.append(module)
            return object()

        with patch.object(check_env.importlib.util, "find_spec", side_effect=fake_find_spec):
            report = check_env.check_features(["graph"])

        self.assertTrue(report["ok"])
        self.assertEqual(checked, ["networkx"])


class ReproManifestTests(unittest.TestCase):
    def test_records_hash_seed_parameters_and_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "input.csv"
            data.write_text("x,y\n1,2\n", encoding="utf-8")

            manifest = repro_manifest.build_manifest(
                inputs=[data],
                seed=42,
                parameters={"alpha": 0.1},
                command="python 问题1_求解.py --seed 42",
                packages=[],
            )

        self.assertEqual(manifest["random_seed"], 42)
        self.assertEqual(manifest["key_parameters"], {"alpha": 0.1})
        self.assertEqual(manifest["reproduce_command"], "python 问题1_求解.py --seed 42")
        self.assertRegex(manifest["input_files"][0]["sha256"], r"^[0-9a-f]{64}$")

    def test_refuses_project_root_inside_skill_root(self):
        with self.assertRaisesRegex(ValueError, "PROJECT_ROOT"):
            repro_manifest.resolve_output(repro_manifest.SKILL_ROOT, "results/repro.json")

    def test_refuses_output_that_points_back_into_skill_root(self):
        relative = repro_manifest.SKILL_ROOT.relative_to(repro_manifest.SKILL_ROOT.parent) / "results/repro.json"
        with self.assertRaisesRegex(ValueError, "SKILL_ROOT"):
            repro_manifest.resolve_output(repro_manifest.SKILL_ROOT.parent, relative)

    def test_can_record_matlab_runtime_and_toolboxes(self):
        manifest = repro_manifest.build_manifest(
            inputs=[],
            seed=7,
            parameters={},
            command='matlab -batch "main(7)"',
            packages=[],
            runtime_name="matlab",
            runtime_version="R2025b",
            dependencies={"Optimization Toolbox": "25.2"},
        )

        self.assertEqual(manifest["runtime"]["name"], "matlab")
        self.assertEqual(manifest["runtime"]["version"], "R2025b")
        self.assertEqual(manifest["runtime"]["dependencies"]["Optimization Toolbox"], "25.2")


if __name__ == "__main__":
    unittest.main()
