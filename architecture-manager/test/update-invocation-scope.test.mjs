import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {invocationFloor,floorReachedForScope} from '../src/domains/certification/floor-policy.mjs';
import {certificationSnapshot,certificationInventory} from '../src/domains/certification/fingerprints.mjs';
import {certificationSelection} from '../src/domains/certification/selection.mjs';
import {mergeCertification,readCoverage,matrixSummary} from '../src/domains/certification/evidence.mjs';
import {certificationFixture} from './support/certification.mjs';
import {seedRelease,seedPointer} from './support/resources.mjs';

const fullReport=()=>({floorReached:false,unionSourceGaps:[],verdicts:[
  {id:'action:prompt',kind:'action',requiredBy:['agent:profile-task@1.0.0'],verdict:'pass'},
  {id:'profile:administrator',kind:'profile',requiredBy:['software:demo-cli@1.0.0'],verdict:'declaredAbsent'},
  {id:'software:demo-cli',kind:'software',requiredBy:['software:demo-cli@1.0.0'],verdict:'unverified'}]});

test('software pending stays visible while a valid invocation floor can pass',()=>{
  const report=fullReport();assert.equal(invocationFloor(report).reached,true);
  assert.equal(floorReachedForScope(report,'full'),false);assert.equal(report.verdicts[2].verdict,'unverified');
  report.verdicts[0].verdict='unverified';assert.equal(invocationFloor(report).reached,false);
  report.verdicts[0].verdict='pass';report.unionSourceGaps=[{repo:'software'}];assert.equal(invocationFloor(report).reached,false);
  assert.equal(invocationFloor({floorReached:false,verdicts:[]}).reached,false);
});

test('invocation coverage has its own pointer and cannot certify full integration',t=>{
  const f=certificationFixture(t),snapshot=certificationSnapshot(f.root,f.id,f.config,{scope:'invocation'});
  assert(Object.values(snapshot.cells).every(row=>row.kind!=='software'));
  const selection=certificationSelection(f.root,f.id,snapshot,{mode:'full'});
  const prefix=f.id+'/runtime/manager-check/invocation-test',rows=selection.selected.map(key=>f.positive(snapshot.cells[key]));
  const actual=f.put(prefix+'/matrix.json',{schema:'ai-invocation-matrix/v1',rows,summary:matrixSummary(rows)});
  const conform=f.put(prefix+'/conform.json',fullReport());
  const result=mergeCertification(f.root,f.id,snapshot,selection,actual,conform,join(f.root,prefix));
  assert.equal(result.coverageComplete,true);assert.equal(result.coverage.scope,'invocation');
  assert.equal(readCoverage(f.root,f.id,{scope:'invocation'}).status,'valid');
  assert.equal(readCoverage(f.root,f.id).status,'missing');
  assert.equal(certificationSelection(f.root,f.id,snapshot,{mode:'full'}).selected.length,0);
});

test('update inventory excludes deprecated defaults while retaining deliberate platform pins',t=>{
  const f=certificationFixture(t);seedRelease(f.root,'tool','legacy-workflow','1.0.0');seedPointer(f.root,'tool','legacy-workflow','1.0.0');
  f.registries.tool.workflows.push({id:'legacy-workflow',current:'legacy-workflow/current.json',enabled:true,deprecated:true});f.put('tool/registry.json',f.registries.tool);
  assert(certificationInventory(f.root,f.id).some(row=>row.id==='legacy-workflow'));
  assert(!certificationInventory(f.root,f.id,{activeOnly:true}).some(row=>row.id==='legacy-workflow'));
  f.put(f.id+'/bridge.json',{defaults:{workflowVersions:{'legacy-workflow':'1.0.0'}}});
  assert(certificationInventory(f.root,f.id,{activeOnly:true}).some(row=>row.id==='legacy-workflow'));
});

test('current interrupted invocation rows take precedence over older legacy certification',t=>{
  const f=certificationFixture(t),old=f.baseline();
  f.put(f.id+'/runtime/maintenance/manager-onboarding/state.json',{firstCertification:{matrixPath:old.actual,matrixSha256:f.hash(old.actual),conformPath:old.conform,conformSha256:f.hash(old.conform)},environmentBindingSha256:'old-binding'});
  const snapshot=certificationSnapshot(f.root,f.id,f.config,{scope:'invocation'}),prefix=f.id+'/runtime/manager-check/interrupted';
  const partial=f.put(prefix+'/partial.json',{rows:[f.positive(snapshot.cells['workflow:expert-task'])]});
  const snap=f.put(prefix+'/scope.json',{snapshot,selection:{kind:'full'}});
  f.put(f.id+'/runtime/manager-check/pending-latest.json',{stage:'check-cancelled',scope:'invocation',partialPath:partial,partialSha256:f.hash(partial),scopeSnapshotPath:snap,scopeSnapshotSha256:f.hash(snap)});
  const selection=certificationSelection(f.root,f.id,snapshot,{mode:'full'});
  assert.equal(selection.kind,'resume-first');assert.deepEqual(selection.reused,['workflow:expert-task']);assert.deepEqual(selection.selected,['agent:profile-task']);
});
