import json
import pathlib
import tempfile
import unittest

from conformance.conform import classify


class SoftwareStateRegression(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='software-state-regression-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.software = self.root / 'software'
        self.items = [{'id': 'software:sample', 'kind': 'software', 'requiredBy': ['software:sample@1.0.0']}]
        self.config = {'softwareRoot': str(self.software), 'softwareGateway': 'gateway.py',
                       'softwareGatewayConfig': 'gateway.json', 'softwareEnvironment': str(self.root / 'bodies.json')}
        self.put(self.software / 'registry.json', {'software': [{'id': 'sample', 'current': 'sample/current.json'}]})
        self.put(self.software / 'sample/current.json', {'version': '1.0.0'})
        self.snapshot = self.software / 'sample/versions/1.0.0/capabilities.snapshot.json'
        self.put(self.snapshot, {'frozen': True})
        self.put(self.root / 'bodies.json', {'bodies': {'sample': {'digestStatus': 'ok'}}})

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def verdict(self):
        return classify(self.items, {}, self.config)[0][0]

    def test_verified_body_and_frozen_snapshot_pass(self):
        self.assertEqual(self.verdict()['verdict'], 'pass')

    def test_unfrozen_snapshot_stays_unverified(self):
        self.put(self.snapshot, {'frozen': False})
        row = self.verdict()
        self.assertEqual(row['verdict'], 'unverified')
        self.assertIn('not frozen', row['reason'])

    def test_missing_body_stays_unverified(self):
        self.put(self.root / 'bodies.json', {'bodies': {}})
        row = self.verdict()
        self.assertEqual(row['verdict'], 'unverified')
        self.assertIn('no verified body', row['reason'])

    def test_bad_body_digest_stays_unverified(self):
        self.put(self.root / 'bodies.json', {'bodies': {'sample': {'digestStatus': 'mismatch'}}})
        self.assertEqual(self.verdict()['verdict'], 'unverified')

    def test_broken_metadata_does_not_pass(self):
        (self.software / 'registry.json').write_text('{broken', encoding='utf-8')
        self.assertEqual(self.verdict()['verdict'], 'unverified')
