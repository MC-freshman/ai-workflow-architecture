from __future__ import annotations

import csv
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import sys as _sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def load_module(relative: str):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    _sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def run_script(script: str, *args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPTS / script), *args], cwd=cwd, text=True, encoding="utf-8", errors="replace", capture_output=True, check=False)


class UpgradeTests(unittest.TestCase):
    def test_v02_init_and_stage_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            result = run_script("init_project.py", ".", "--project-id", "T1", cwd=project)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((project / "stage_state.json").is_file())
            blocked = run_script("stage_machine.py", "advance", "--project", ".", "--to", "AUDIT", cwd=project)
            self.assertEqual(blocked.returncode, 1)
            self.assertIn("blocked", blocked.stdout)

    def test_v03_experiment_and_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "src").mkdir()
            (project / "configs").mkdir()
            (project / "src" / "main.py").write_text("import os\nprint(os.environ.get('MODEL_SEED'))\n", encoding="utf-8")
            config = {"entrypoint": "src/main.py", "input_files": [], "runs": [{"id": "EXP-1", "seed": 7}]}
            config_path = project / "configs" / "experiment.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            result = run_script("run_experiments.py", "configs/experiment.json", "--project", ".", cwd=project)
            self.assertEqual(result.returncode, 0, result.stderr)
            metadata = json.loads((project / "experiments" / "EXP-1" / "metadata.json").read_text(encoding="utf-8"))
            self.assertEqual(metadata["seed"], 7)
            validation_config = project / "configs" / "validation.json"
            validation_config.write_text(json.dumps({"checks": [{"type": "file_exists", "path": "experiments/EXP-1/metadata.json"}]}), encoding="utf-8")
            checked = run_script("run_validations.py", "configs/validation.json", "--project", ".", cwd=project)
            self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_v04_figure_and_pdf_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "figures").mkdir()
            (project / "reports").mkdir()
            # Minimal valid SVG exercises the dependency-free path.
            (project / "figures" / "f.svg").write_text('<svg viewBox="0 0 10 10"></svg>', encoding="utf-8")
            register = run_script("register_figure.py", "--project", ".", "--figure-id", "FIG-1", "--claim", "test", "--path", "figures/f.svg", cwd=project)
            self.assertEqual(register.returncode, 0, register.stderr)
            checked = run_script("check_figures.py", "--project", ".", cwd=project)
            self.assertEqual(checked.returncode, 0, checked.stdout)
            pdf = project / "reports" / "test.pdf"
            pdf.write_bytes(b"%PDF-1.4\n1 0 obj /Type /Page >>\n%%EOF")
            pdf_check = run_script("check_pdf.py", str(pdf), cwd=project)
            self.assertEqual(pdf_check.returncode, 0, pdf_check.stdout)

    def test_v05_adapters_and_cases(self):
        registry = load_module("adapters/registry.py")
        self.assertEqual(registry.suggest("网络节点转发社群")[0].name, "network_propagation")
        result = subprocess.run([sys.executable, str(ROOT / "evals" / "validate_cases.py"), str(ROOT / "evals" / "cases.json")], cwd=ROOT, text=True, encoding="utf-8", errors="replace", capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_v10_mcp_dispatch(self):
        server_module = load_module("scripts/mcp_server.py")
        with tempfile.TemporaryDirectory() as directory:
            server = server_module.RestrictedServer(Path(directory))
            initialize = server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
            self.assertEqual(initialize["result"]["serverInfo"]["version"], "1.0.0")
            tools = server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            self.assertIn("freeze_project", {item["name"] for item in tools["result"]["tools"]})
            self.assertIn("run_task_batch", {item["name"] for item in tools["result"]["tools"]})
            init_result = server.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "project_init", "arguments": {"project_id": "MCP"}}})
            self.assertFalse(init_result["result"]["isError"])
            self.assertTrue((Path(directory) / "project_manifest.json").is_file())
            status_result = server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "task_status", "arguments": {}}})
            self.assertFalse(status_result["result"]["isError"])

    def test_freeze_gate_requires_paper_task_review(self):
        stage = load_module("scripts/stage_machine.py")
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "tasks").mkdir()
            (project / "tasks" / "task_registry.jsonl").write_text(
                json.dumps({"task_id": "EDA-1", "paper_candidate": True, "review_status": "PENDING"}) + "\n",
                encoding="utf-8",
            )
            missing = stage.missing(project, "FREEZE")
            self.assertTrue(any("EDA-1" in item for item in missing))
            (project / "tasks" / "task_registry.jsonl").write_text(
                json.dumps({"task_id": "EDA-1", "paper_candidate": True, "review_status": "ACCEPTED"}) + "\n",
                encoding="utf-8",
            )
            self.assertFalse(any("EDA-1" in item for item in stage.missing(project, "FREEZE")))


if __name__ == "__main__":
    unittest.main()
