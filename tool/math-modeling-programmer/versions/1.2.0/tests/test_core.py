import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    path = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CoreTests(unittest.TestCase):
    def test_audit_rows(self):
        audit = load_script("audit_data.py")
        result = audit.audit_rows([{"x": "1", "label": "a"}, {"x": "2", "label": "a"}], "fixture.csv")
        self.assertEqual(result["rows"], 2)
        self.assertEqual(result["duplicate_rows"], 0)
        self.assertEqual(result["columns_report"]["x"]["inferred_type"], "numeric")

    def test_registry_template_fields(self):
        path = ROOT / "templates" / "result_registry.csv"
        with path.open(encoding="utf-8-sig", newline="") as handle:
            fields = set(csv.DictReader(handle).fieldnames or [])
        self.assertTrue({"experiment_id", "value", "evidence", "status"}.issubset(fields))

    def test_experiment_config_is_json(self):
        payload = json.loads((ROOT / "templates" / "experiment_config.json").read_text(encoding="utf-8"))
        self.assertIn("seeds", payload)
        self.assertIn("repetitions", payload)


if __name__ == "__main__":
    unittest.main()
