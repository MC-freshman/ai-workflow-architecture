import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('matrix_under_test',Path(__file__).resolve().parents[1]/'architecture_ops/invocation_matrix.py')
matrix=importlib.util.module_from_spec(spec);spec.loader.exec_module(matrix)


class MatrixProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='matrix-progress-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.software=self.root/'software';self.software.mkdir()
        self.write(self.software/'registry.json',{'software':[{'id':name,'enabled':True,'current':name+'/current.json'} for name in ('selected','unselected')]})
        for name in ('selected','unselected'): self.write(self.software/name/'current.json',{'version':'1.0.0'})
        self.environment=self.root/'software-environment.json'; self.write(self.environment,{'bodies':{'selected':{},'unselected':{}}})
        self.config={'platform':'test-platform','platformRoot':str(self.root/'platform'),'toolRoot':str(self.root/'tool'),'agentRoot':str(self.root/'agent'),'runner':str(self.root/'runner'),'softwareRoot':str(self.software),'softwareGateway':'gateway.py','softwareGatewayConfig':str(self.root/'gateway.json'),'softwareEnvironment':str(self.environment)}
        self.write(self.root/'tool/registry.json',{'workflows':[]});self.write(self.root/'agent/registry.json',{'agents':[]})
        self.config_path=self.root/'config.json';self.write(self.config_path,self.config)

    def write(self,path,value): path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value),encoding='utf-8')

    def test_filter_before_any_gateway_call(self):
        calls=[]
        def answer(config,gateway,request):
            calls.append(request['softwareId']);return {'ok':True,'frozen':True,'capabilities':['version']},None,None
        with patch.object(matrix,'gateway_message',answer):
            rows,_=matrix.software_cells(self.config,self.software,{},'stamp',{'workflow:alpha'})
            self.assertEqual(rows,[]);self.assertEqual(calls,[])
            rows,_=matrix.software_cells(self.config,self.software,{},'stamp',{'software:selected'})
        self.assertEqual(calls,['selected']);self.assertEqual([row['id'] for row in rows],['selected'])

    def test_incremental_report_is_never_certifiable(self):
        path=self.root/'partial.json'; output=io.StringIO()
        with contextlib.redirect_stdout(output):
            rows=matrix.ProgressRows(path,'config.json',2,True)
            rows.append({'id':'alpha','kind':'workflow','status':'PASS'})
        report=json.loads(path.read_text());events=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(report['completed'],1);self.assertFalse(report['complete']);self.assertFalse(report['certifiable'])
        self.assertEqual(events[-1]['row']['id'],'alpha');self.assertIn('durationMs',events[-1]['row'])

    def test_unknown_selection_and_empty_inventory_fail_without_gateway(self):
        for only in ('missing',None):
            if only is None: self.write(self.software/'registry.json',{'software':[]})
            output=self.root/('unknown.json' if only else 'empty.json')
            argv=['matrix','--config',str(self.config_path),'--out',str(output),'--progress-jsonl']+(['--only',only] if only else [])
            with patch.object(sys,'argv',argv), patch.object(matrix,'gateway_message',side_effect=AssertionError('unselected gateway called')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(matrix.main(),1)
            report=json.loads(output.read_text());self.assertEqual(report['summary']['FAIL'],1)
            self.assertEqual(report['rows'][0]['errorCode'],'HARNESS_EMPTY_SELECTION')


if __name__=='__main__':unittest.main()
