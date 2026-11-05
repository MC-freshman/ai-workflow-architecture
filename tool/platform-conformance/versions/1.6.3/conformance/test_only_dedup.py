import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


class OnlyAgentContentDedup(unittest.TestCase):
    """D-144: the --only agent-content audit must run and append once per id, not seven times.

    The fixture carries no agent release bytes, so audit_agent legitimately fails closed and the
    command exits 1; that exit path is independent of this regression, which pins the report
    shape: exactly one agent-content row per requested id.
    """

    def test_agent_content_row_is_appended_once_per_id(self):
        with tempfile.TemporaryDirectory(prefix='only-dedup-') as temporary:
            root = pathlib.Path(temporary)
            capabilities = root / 'capabilities.json'
            capabilities.parent.mkdir(parents=True, exist_ok=True)
            capabilities.write_text(json.dumps({}), encoding='utf-8')
            for repo in ('tool', 'agent', 'software'):
                registry = root / repo / 'registry.json'
                registry.parent.mkdir(parents=True, exist_ok=True)
                registry.write_text(json.dumps({'workflows': [], 'agents': [], 'software': []}),
                                    encoding='utf-8')
            pointer = root / 'agent' / 'probe' / 'current.json'
            pointer.parent.mkdir(parents=True, exist_ok=True)
            pointer.write_text(json.dumps({'version': '1.0.0'}), encoding='utf-8')
            config = root / 'config.json'
            config.write_text(json.dumps({
                'toolRoot': str(root / 'tool'),
                'agentRoot': str(root / 'agent'),
                'softwareRoot': str(root / 'software'),
                'capabilities': str(capabilities),
            }), encoding='utf-8')
            release_root = pathlib.Path(__file__).resolve().parents[1]
            result = subprocess.run(
                [sys.executable, '-B', '-m', 'conformance.conform',
                 '--config', str(config), '--only', 'probe'],
                cwd=str(release_root), capture_output=True, text=True)
            report, _ = json.JSONDecoder().raw_decode(result.stdout)
            self.assertEqual(len(report['selectedAgentContent']), 1)
            self.assertEqual(report['perOnlyId']['probe']['rows'], 1)
            self.assertEqual(report['unknownOnlyIds'], [])
            self.assertEqual(report['selectedAgentContent'][0]['id'], 'probe')


if __name__ == '__main__':
    unittest.main()
