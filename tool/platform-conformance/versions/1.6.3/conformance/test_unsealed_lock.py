import copy
import importlib.util
import json
import unittest
from pathlib import Path

from . import env_config


class UnsealedRunLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tool = Path(env_config.load()['toolRoot'])
        pointer = json.loads((tool / 'runtime-contracts' / 'current.json').read_text(encoding='utf-8-sig'))
        validator_path = (tool / 'runtime-contracts' / 'versions' / pointer['version'] / 'contracts' / 'runtime'
                         / 'validate_contracts.py')
        spec = importlib.util.spec_from_file_location('runtime_contracts_validator', validator_path)
        cls.contracts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.contracts)
        cls.run_lock_validator = cls.contracts.validators()['run-lock.schema.json']

    def unsealed_lock(self, graph_lock):
        bundle = self.contracts.example_bundle(graph_lock=graph_lock)
        lock = copy.deepcopy(bundle['lock'])
        lock['selection']['environment'] = []
        lock['execution']['environmentSealed'] = False
        return lock

    def test_legacy_v12_lock_without_sealed_environment_is_legal(self):
        lock = self.unsealed_lock(False)
        self.assertEqual(lock['schemaVersion'], 'ai-run-lock/v1.2')
        self.assertEqual(list(self.run_lock_validator.iter_errors(lock)), [])

    def test_scenario_v13_lock_without_sealed_environment_is_legal(self):
        lock = self.unsealed_lock(True)
        self.assertEqual(lock['schemaVersion'], 'ai-run-lock/v1.3')
        self.assertEqual(list(self.run_lock_validator.iter_errors(lock)), [])

    def test_unsealed_lock_cannot_still_select_an_environment(self):
        for graph_lock in (False, True):
            with self.subTest(schemaVersion='v1.3' if graph_lock else 'v1.2'):
                lock = self.unsealed_lock(graph_lock)
                lock['selection']['environment'] = ['python']
                self.assertTrue(list(self.run_lock_validator.iter_errors(lock)))

    def test_v13_still_requires_its_scenario_fields_when_unsealed(self):
        lock = self.unsealed_lock(True)
        lock['execution'].pop('scenario')
        errors = list(self.run_lock_validator.iter_errors(lock))
        self.assertTrue(errors)
        self.assertIn('scenario', errors[0].message)


if __name__ == '__main__':
    unittest.main(verbosity=2)
