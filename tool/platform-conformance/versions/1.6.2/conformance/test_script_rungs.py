import unittest

from conformance.conform import classify


SCRIPT_ITEM = [{'id': 'action:script', 'kind': 'action', 'requiredBy': ['tool:repo-lint@0.5.1']}]


class ScriptRungMigrationTests(unittest.TestCase):
    def supported(self):
        return {
            'descriptor': {'actions': {'script': {'supported': True}}},
            'checks': {'scriptEnvironment': True},
            'gapPlan': {'action:script': {'path': 'add scriptEnvironmentRungs to runner config',
                                          'costMinutes': 15}},
        }

    def config(self, rungs=None):
        result = {'executionBackend': 'legacy-backend.json',
                  'scriptEnvironment': 'runtime/script-env'}
        if rungs is not None:
            result['scriptEnvironmentRungs'] = rungs
        return result

    def test_legacy_single_backend_does_not_claim_script_dispatch(self):
        rows, missing = classify(SCRIPT_ITEM, self.supported(), self.config())
        self.assertEqual(rows[0]['verdict'], 'unverified')
        self.assertIn('scriptEnvironmentRungs', rows[0]['reason'])
        self.assertEqual(rows[0]['remediation']['costMinutes'], 15)
        self.assertEqual(missing, [])

    def test_explicit_rung_and_legacy_evidence_alias_can_pass(self):
        rungs = [{'execPath': 'kernel-sandbox', 'executionBackend': 'runtime/backend.json',
                  'requiresSealedEnvironment': True}]
        config = self.config(rungs)
        config['environmentManifest'] = 'runtime/environment.json'
        rows, missing = classify(SCRIPT_ITEM, self.supported(), config)
        self.assertEqual(rows[0]['verdict'], 'pass')
        self.assertNotIn('remediation', rows[0])
        self.assertEqual(missing, [])

    def test_malformed_rung_does_not_pass(self):
        rows, missing = classify(SCRIPT_ITEM, self.supported(), self.config([{'execPath': 'unknown'}]))
        self.assertEqual(rows[0]['verdict'], 'unverified')
        self.assertIn('scriptEnvironmentRungs', rows[0]['reason'])
        self.assertEqual(missing, [])

    def test_malformed_field_types_do_not_crash_or_pass(self):
        malformed = [{'execPath': [], 'executionBackend': 7, 'requiresSealedEnvironment': 'false'}]
        rows, missing = classify(SCRIPT_ITEM, self.supported(), self.config(malformed))
        self.assertEqual(rows[0]['verdict'], 'unverified')
        self.assertIn('scriptEnvironmentRungs', rows[0]['reason'])
        self.assertEqual(missing, [])

    def test_legacy_script_environment_check_remains_readable_but_requires_rung(self):
        capabilities = {
            'checks': {'scriptEnvironment': True},
            'gapPlan': {'action:script': {'path': 'add an explicit rung', 'costMinutes': 15}},
        }
        rows, missing = classify(SCRIPT_ITEM, capabilities, self.config())
        self.assertEqual(rows[0]['verdict'], 'unverified')
        self.assertIn('scriptEnvironmentRungs', rows[0]['reason'])
        self.assertEqual(missing, [])

        rungs = [{'execPath': 'kernel-sandbox', 'executionBackend': 'runtime/backend.json',
                  'requiresSealedEnvironment': True}]
        config = self.config(rungs)
        config['environmentManifest'] = 'runtime/environment.json'
        rows, missing = classify(SCRIPT_ITEM, capabilities, config)
        self.assertEqual(rows[0]['verdict'], 'pass')
        self.assertEqual(missing, [])

    def test_explicitly_absent_platform_does_not_need_a_rung(self):
        capabilities = {
            'descriptor': {'actions': {'script': {'supported': False}}},
            'declaredAbsent': {'action:script': 'no sealed script isolation environment'},
            'gapPlan': {'action:script': {'path': 'install an isolated script environment',
                                          'costMinutes': 60}},
        }
        rows, missing = classify(SCRIPT_ITEM, capabilities, self.config())
        self.assertEqual(rows[0]['verdict'], 'declaredAbsent')
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
