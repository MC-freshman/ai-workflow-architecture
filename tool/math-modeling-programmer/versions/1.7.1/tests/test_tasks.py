from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run_script(script: str, *args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args],
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


class TaskWorkflowTests(unittest.TestCase):
    def test_init_scaffolds_task_layer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            result = run_script("init_project.py", ".", "--project-id", "TASKS", cwd=project)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((project / "tasks" / "manifests" / "example.json").is_file())
            self.assertTrue((project / "tasks" / "task_registry.csv").is_file())
            self.assertTrue((project / "scripts" / "run_tasks.py").is_file())
            self.assertTrue((project / "TASK_WORKFLOW_USAGE.md").is_file())
            self.assertTrue((project / "TEAM_HANDOFF_USAGE.md").is_file())

    def test_batch_dependency_cache_and_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "src").mkdir()
            (project / "configs").mkdir()
            (project / "data" / "raw").mkdir(parents=True)
            (project / "data" / "raw" / "input.txt").write_text("fixture", encoding="utf-8")
            (project / "src" / "task_entrypoint.py").write_text(
                "from pathlib import Path\n"
                "import os\n"
                "task_id = os.environ['TASK_ID']\n"
                "if task_id == 'B':\n"
                "    assert Path('results/A.txt').is_file()\n"
                "Path('results').mkdir(exist_ok=True)\n"
                "Path('results', task_id + '.txt').write_text(os.environ['TASK_MODE'], encoding='utf-8')\n"
                "Path(os.environ['TASK_OUTPUT_DIR']).mkdir(parents=True, exist_ok=True)\n"
                "Path(os.environ['TASK_OUTPUT_DIR'], 'context.txt').write_text(task_id, encoding='utf-8')\n",
                encoding="utf-8",
            )
            manifest = {
                "manifest_id": "TEST-BATCH",
                "entrypoint": "src/task_entrypoint.py",
                "shared_inputs": ["data/raw/input.txt"],
                "output_root": "experiments/tasks",
                "tasks": [
                    {"task_id": "A", "kind": "eda", "title": "A", "args": [], "outputs": ["results/A.txt"]},
                    {"task_id": "B", "kind": "eda", "title": "B", "args": [], "outputs": ["results/B.txt"], "dependencies": ["A"]},
                ],
            }
            manifest_path = project / "configs" / "tasks.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            first = run_script("run_tasks.py", "configs/tasks.json", "--project", ".", cwd=project)
            self.assertEqual(first.returncode, 0, first.stderr)
            first_payload = json.loads(first.stdout)
            self.assertEqual(first_payload["counts"]["PASS"], 2)
            second = run_script("run_tasks.py", "configs/tasks.json", "--project", ".", cwd=project)
            self.assertEqual(second.returncode, 0, second.stderr)
            second_payload = json.loads(second.stdout)
            self.assertEqual(second_payload["counts"]["CACHED"], 2)
            reviewed = run_script("review_task.py", "--project", ".", "--task-id", "A", "--decision", "ACCEPTED", cwd=project)
            self.assertEqual(reviewed.returncode, 0, reviewed.stderr)
            status = run_script("run_tasks.py", "configs/tasks.json", "--project", ".", "--status", cwd=project)
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertEqual(json.loads(status.stdout)["counts"]["ACCEPTED"], 1)

    def test_failed_dependency_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "src").mkdir()
            (project / "configs").mkdir()
            (project / "src" / "fail.py").write_text("raise SystemExit(3)\n", encoding="utf-8")
            manifest = {
                "manifest_id": "TEST-BLOCK",
                "entrypoint": "src/fail.py",
                "tasks": [
                    {"task_id": "FAIL", "kind": "eda", "title": "fail", "args": [], "outputs": ["results/fail.txt"]},
                    {"task_id": "DOWNSTREAM", "kind": "eda", "title": "downstream", "args": [], "outputs": ["results/downstream.txt"], "dependencies": ["FAIL"]},
                ],
            }
            path = project / "configs" / "tasks.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            result = run_script("run_tasks.py", "configs/tasks.json", "--project", ".", cwd=project)
            self.assertEqual(result.returncode, 1)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["counts"]["FAIL"], 1)
            self.assertEqual(payload["counts"]["BLOCKED"], 1)


if __name__ == "__main__":
    unittest.main()
