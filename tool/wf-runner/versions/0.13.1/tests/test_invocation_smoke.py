"""Contract-level tests; no business task or platform provider is executed."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from invocation_smoke import invocation_smoke
from runtime_core import Rejected


class FakeEngine:
    def __init__(self, failed=None):
        self.requests = []
        self.failed = failed
        self.revision = 0

    def dispatch(self, request):
        self.requests.append(copy.deepcopy(request))
        self.revision += 1
        if request['operation'] == self.failed:
            raise Rejected('CAPABILITY_UNAVAILABLE', 'registered profile missing')
        return {'ok': True, 'result': {'state': {'stateRevision': self.revision, 'status': 'stopped' if request['operation']=='stop' else 'claimed'}, 'task': {'action': 'prompt'}}}

    def store(self, _run):
        return self

    def observe(self):
        return {'stateRevision': self.revision}


class SmokeInterface(unittest.TestCase):
    def request(self):
        return {'schemaVersion':'ai-run-protocol/v1.1','kind':'request','operation':'prepare','requestId':'request','idempotencyKey':'key','runId':'fresh-run','payload':{'target':{'mode':'workflow','id':'task','version':'1.0.0'},'inputSources':[]}}

    def reject(self, error, request):
        return {'ok':False,'error':{'code':error.code,'message':str(error)},'operation':request['operation']}

    def test_only_three_existing_operations_and_no_request_mutation(self):
        engine=FakeEngine();request=self.request();before=copy.deepcopy(request)
        result=invocation_smoke(engine,request,self.reject)
        self.assertTrue(result['ok']);self.assertEqual(request,before)
        self.assertEqual([row['operation'] for row in engine.requests],['prepare','next','stop'])
        self.assertEqual(engine.requests[1]['expectedStateRevision'],1)
        self.assertEqual(engine.requests[2]['expectedStateRevision'],2)
        self.assertEqual(result['runnerStarts'],1);self.assertFalse(result['businessStagesExecuted'])
        self.assertEqual(set(result['timings']),{'prepareMs','nextMs','stopMs'})

    def test_a_prepare_rejection_never_calls_next_or_stop(self):
        engine=FakeEngine('prepare');result=invocation_smoke(engine,self.request(),self.reject)
        self.assertEqual(result['error']['code'],'CAPABILITY_UNAVAILABLE')
        self.assertEqual(len(engine.requests),1);self.assertFalse(result['ok'])

    def test_next_failure_preserves_classification_and_stops_current_revision(self):
        engine=FakeEngine('next');result=invocation_smoke(engine,self.request(),self.reject)
        self.assertFalse(result['ok']);self.assertEqual(result['error']['code'],'CAPABILITY_UNAVAILABLE')
        self.assertEqual([row['operation'] for row in engine.requests],['prepare','next','stop'])
        self.assertEqual(engine.requests[-1]['expectedStateRevision'],2)

    def test_resume_and_unrelated_operations_never_dispatch(self):
        for changes in ({'operation':'execute'},{'payload':{'resume':True,'target':{'mode':'workflow'}}},{'payload':{'target':{'mode':'software'}}}):
            request=self.request();request.update(changes);engine=FakeEngine()
            with self.assertRaises(ValueError): invocation_smoke(engine,request,self.reject)
            self.assertEqual(engine.requests,[])


if __name__=='__main__': unittest.main()
