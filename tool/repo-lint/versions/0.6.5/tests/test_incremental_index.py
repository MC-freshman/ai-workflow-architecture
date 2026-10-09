"""Mutation and boundary tests for content-derived indexes; no business dispatch."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_repo_lint import RepositoryFixture, repo_lint, write_json


class IncrementalIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='incremental-index-')
        self.addCleanup(self.temp.cleanup)
        self.fixture = RepositoryFixture(Path(self.temp.name))
        self.fixture.workflow('alpha')

    def scanner(self):
        return repo_lint.Scanner(self.fixture.tool, self.fixture.agent)

    def test_lazy_registration_does_not_read_unrelated_pointer(self):
        self.fixture.workflow('unrelated')
        original = repo_lint.read_json
        reads = []
        def observe(path):
            reads.append(str(path)); return original(path)
        with patch.object(repo_lint, 'read_json', observe):
            scanner = self.scanner(); scanner.discover(resolve_current=False)
            self.assertEqual(scanner.read_current('workflow','alpha'),'1.0.0')
        self.assertFalse(any('unrelated' in path for path in reads), reads)
        self.assertEqual(set(scanner.current), {('workflow','alpha')})

    def test_registry_content_change_disables_then_duplicate_blocks(self):
        scanner=self.scanner(); scanner.discover(resolve_current=False)
        self.assertIn('alpha', scanner.registered['workflow'])
        path=self.fixture.tool/'registry.json'; value=json.loads(path.read_text())
        row=next(row for row in value['workflows'] if row['id']=='alpha')
        row['enabled']=False; write_json(path,value)
        scanner=self.scanner(); scanner.discover(resolve_current=False)
        self.assertNotIn('alpha', scanner.registered['workflow'])
        row['enabled']=True; value['workflows'].append(dict(row)); write_json(path,value)
        scanner=self.scanner(); scanner.discover(resolve_current=False)
        self.assertTrue(any(row['code']=='duplicate-id' for row in scanner.findings))

    def test_pointer_content_change_invalidates_parsed_metadata(self):
        scanner=self.scanner(); scanner.discover(resolve_current=False)
        self.assertEqual(scanner.read_current('workflow','alpha'),'1.0.0')
        path=self.fixture.tool/'alpha/current.json'; value=json.loads(path.read_text())
        value['id']='wrong'; write_json(path,value)
        self.assertIsNone(scanner.read_current('workflow','alpha'))
        self.assertTrue(any(row['code']=='pointer-mismatch' for row in scanner.findings))

    def test_catalog_content_change_updates_enabled_index(self):
        self.fixture.skill('delta')
        scanner=self.scanner();scanner.discover(resolve_current=False)
        self.assertIn('delta',scanner.registered['skill'])
        catalog=self.fixture.tool/'_registry/delta.json';value=json.loads(catalog.read_text());value['skills'][0]['enabled']=False;write_json(catalog,value)
        scanner=self.scanner();scanner.discover(resolve_current=False)
        self.assertNotIn('delta',scanner.registered['skill'])

    def test_global_r2_changes_even_after_cached_manifest_and_definition(self):
        self.fixture.workflow('unrelated')
        self.scanner().run()
        folder=self.fixture.tool/'unrelated/versions/1.0.0'
        path=folder/'manifest.json'; value=json.loads(path.read_text()); value['id']='different'; write_json(path,value)
        scanner=repo_lint.Scanner(self.fixture.tool,self.fixture.agent,select='workflow:alpha@1.0.0')
        report=scanner.run()
        self.assertTrue(any(row['rule']=='R2' and row['id']=='unrelated' for row in report['decision']['blockingFindings']))
        value['id']='unrelated'; write_json(path,value)
        definition=folder/value['entry']; text=definition.read_text(); definition.write_text(text.replace('unrelated','different'),encoding='utf-8')
        report=repo_lint.Scanner(self.fixture.tool,self.fixture.agent,select='workflow:alpha@1.0.0').run()
        self.assertTrue(any(row['code']=='definition-mismatch' and row['id']=='unrelated' for row in report['decision']['blockingFindings']))

    def test_missing_file_not_satisfied_by_content_cache(self):
        path=self.fixture.tool/'registry.json'; repo_lint.read_json(path)
        path.unlink()
        with self.assertRaises(FileNotFoundError): repo_lint.read_json(path)

    def test_cached_root_cannot_turn_into_link(self):
        root=Path(self.temp.name); source=root/'ordinary'; outside=root/'outside'
        source.mkdir(); outside.mkdir(); (outside/'data.json').write_text('{}')
        repo_lint.safe_path(source,'data.json'); source.rmdir()
        if os.name=='nt':
            result=subprocess.run(['cmd','/c','mklink','/J',str(source),str(outside)],capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
        else: source.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(repo_lint.InvalidData): repo_lint.safe_path(source,'data.json')

    def test_cached_json_returns_independent_value(self):
        path=self.fixture.tool/'registry.json'; value=repo_lint.read_json(path); value['schema']='mutated'
        self.assertEqual(repo_lint.read_json(path)['schema'],'ai-tool-registry/v2')


if __name__=='__main__': unittest.main()
