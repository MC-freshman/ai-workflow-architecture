from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import unittest
import shutil

from reference.adapter import AdapterError, complete_run, parse_message, prepare_run
from scripts.switch_default import switch_default


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT / "examples" / "repository"


class ReferenceAdapterTests(unittest.TestCase):
    def test_parse_rejects_unknown_entry(self) -> None:
        with self.assertRaises(AdapterError):
            parse_message("/unknown item task")

    def test_workflow_run_is_locked_and_completes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            prepared = prepare_run("/wf hello-world greet", REPOSITORY, Path(temp))
            lock = prepared["lock"]
            self.assertEqual(lock["resource"]["version"], "1.0.0")
            self.assertIsNone(lock["workflow"])
            completed = complete_run(Path(prepared["runDir"]), "hello")
            self.assertEqual(completed["status"], "completed")

    def test_agent_honors_exact_workflow_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            prepared = prepare_run("/wfa reviewer review", REPOSITORY, Path(temp))
            lock = prepared["lock"]
            self.assertEqual(lock["resource"]["id"], "reviewer")
            self.assertEqual(lock["workflow"]["id"], "hello-world")
            self.assertEqual(lock["workflow"]["version"], "1.0.0")

    def test_parallel_runs_have_unique_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: prepare_run("/wf hello-world parallel", REPOSITORY, root), range(16)))
            directories = {item["runDir"] for item in results}
            self.assertEqual(len(directories), 16)
            for directory in directories:
                data = json.loads((Path(directory) / "run-lock.json").read_text(encoding="utf-8"))
                self.assertEqual(data["status"], "prepared")

    def test_default_switch_is_validated_and_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            copied = Path(temp) / "repository"
            shutil.copytree(REPOSITORY, copied)
            pointer = switch_default(copied, "wf", "hello-world", "1.0.0")
            data = json.loads(pointer.read_text(encoding="utf-8"))
            self.assertEqual(data["version"], "1.0.0")
            self.assertEqual(list(pointer.parent.glob(".current-*.json")), [])


if __name__ == "__main__":
    unittest.main()
