import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync,existsSync,statSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {certificationFixture} from './support/certification.mjs';
import {certificationSelection,selectCertification} from '../src/domains/certification/selection.mjs';
import {readCoverage,legacyCoverage,pendingCoverage} from '../src/domains/certification/evidence.mjs';
import {environmentBinding} from '../src/domains/certification/binding.mjs';
import {certificationSnapshot} from '../src/domains/certification/fingerprints.mjs';

test('unchanged certification reuses positive source rows; same-pins additions select exactly the added resource',t=>{
  const f=certificationFixture(t);f.baseline();let value=f.snapshot(),scope=certificationSelection(f.root,f.id,value,{mode:'full'});
  assert.deepEqual(scope.selected,[]);assert.equal(scope.reused.length,3);const reused=f.publish(scope,value);assert.equal(reused.provenance.actualRows,0);assert.equal(reused.provenance.reusedRows,3);assert.equal(reused.coverageComplete,true);
  seedRelease(f.root,'agent','new-expert','1.0.0');seedPointer(f.root,'agent','new-expert','1.0.0');f.registries.agent.agents.push({id:'new-expert',enabled:true,current:'new-expert/current.json'});f.put('agent/registry.json',f.registries.agent);
  value=f.snapshot();scope=certificationSelection(f.root,f.id,value,{mode:'full'});assert.deepEqual(scope.selected,['agent:new-expert']);const merged=f.publish(scope,value);assert.equal(merged.provenance.actualRows,1);assert.equal(merged.provenance.reusedRows,3);assert.equal(readCoverage(f.root,f.id).status,'valid');
});
test('Profile/provider changes select the dependent cells and unrelated registry metadata causes no test',t=>{
  const f=certificationFixture(t);f.baseline();f.put(f.id+'/bridge/capabilities.json',{profiles:{'python>=3.8':'3.12'},checks:{'runner-protocol-prepare':true,'terminal-stop-with-evidence':true}});
  let scope=certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'});assert.deepEqual(scope.selected,['agent:profile-task']);f.publish(scope);
  f.put(f.id+'/bridge/gateway.json',{bodies:{'demo-cli':'absent body'},launchProvider:['provider-two']});scope=certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'});assert.deepEqual(scope.selected,['software:demo-cli']);f.publish(scope);
  f.registries.tool.workflows[0].displayName='unrelated label';f.put('tool/registry.json',f.registries.tool);assert.deepEqual(certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'}).selected,[]);
});
test('pointer/dependency changes and modified frozen bytes cannot hide behind unchanged engine pins',t=>{
  const f=certificationFixture(t);f.baseline();seedRelease(f.root,'tool','expert-task','1.1.0');seedPointer(f.root,'tool','expert-task','1.1.0');assert.deepEqual(certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'}).selected,['workflow:expert-task']);
  const path=join(f.root,'tool/expert-task/versions/1.1.0/prompt.md');writeFileSync(path,'tampered frozen bytes');assert.throws(()=>f.snapshot(),/RELEASE_HASH_MISMATCH/);
});
test('damaged sources, cross-platform evidence, empty selections and different returned rows fail closed',t=>{
  const f=certificationFixture(t),baseline=f.baseline();assert.throws(()=>certificationSelection(f.root,f.id,f.snapshot(),{mode:'quick',only:'unknown'}),/EMPTY_SELECTION/);
  let scope=certificationSelection(f.root,f.id,f.snapshot(),{mode:'quick'});assert.throws(()=>f.publish(scope,f.snapshot(),[f.positive({...f.snapshot().cells['workflow:expert-task'],id:'wrong'})]),/SELECTION_MISMATCH/);
  writeFileSync(baseline.actual,'{}');assert.equal(readCoverage(f.root,f.id).status,'invalid');assert.equal(certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'}).kind,'full');assert.equal(readCoverage(f.root,'other-client').status,'missing');
});
test('first/full certification is never manufactured by a zero-row or single-row smoke report',t=>{
  const f=certificationFixture(t),value=f.snapshot();const scope=selectCertification(value,null,{mode:'quick'});const result=f.publish(scope,value);assert.notEqual(result.coverageComplete,true);assert.equal(existsSync(join(f.root,f.id,'runtime/manager-check/coverage-latest.json')),false);
  assert.notEqual(f.publish({...scope,selected:[]},value).coverageComplete,true);
});
test('interrupted first matrix retains only actual unchanged PASS rows and tests unfinished cells',t=>{
  const f=certificationFixture(t),value=f.snapshot(),path=f.put(f.id+'/runtime/manager-check/first/partial.json',{schema:'ai-invocation-matrix-partial/v1',certifiable:false,rows:[f.positive(value.cells['workflow:expert-task'])]});
  const snap=f.put(f.id+'/runtime/manager-check/first/scope-snapshot.json',{snapshot:value,selection:{kind:'full'}});
  f.put(f.id+'/runtime/manager-check/latest.json',{stage:'check-cancelled',partialPath:path,partialSha256:f.hash(path),scopeSnapshotPath:snap,scopeSnapshotSha256:f.hash(snap)});
  const baseline=pendingCoverage(f.root,f.id,value);assert.equal(baseline.resumeFirst,true);const scope=certificationSelection(f.root,f.id,value,{mode:'full'});assert.equal(scope.kind,'resume-first');assert.deepEqual(scope.selected,['agent:profile-task','software:demo-cli']);assert.equal(f.publish(scope,value).coverageComplete,true);
});
test('major generation and changed validation rules cannot reuse incompatible results',t=>{
  const f=certificationFixture(t);f.baseline();const value=f.snapshot(),saved=readCoverage(f.root,f.id).coverage;
  const next=structuredClone(value);next.pins.runner.version='0.13.0';assert.equal(selectCertification(next,saved,{mode:'quick'}).kind,'full');
  next.pins.runner.version=value.pins.runner.version;next.rulesSha256='new rules';assert.equal(selectCertification(next,saved,{mode:'full'}).selected.length,3);
});
test('legacy complete evidence migrates without another matrix only when its complete binding still matches',t=>{
  const f=certificationFixture(t),baseline=f.baseline(),snapshot=f.snapshot(),proof={matrixPath:baseline.actual,matrixSha256:f.hash(baseline.actual),conformPath:baseline.conform,conformSha256:f.hash(baseline.conform),configSha256:snapshot.configSha256};
  const previous={firstCertification:proof,configSha256:snapshot.configSha256,environmentBindingSha256:environmentBinding(f.root,f.id)};
  const migrated=legacyCoverage(f.root,f.id,previous,snapshot);assert.equal(migrated.migratedWithExactBinding,true);assert.deepEqual(selectCertification(snapshot,migrated,{mode:'full'}).selected,[]);
  f.put(f.id+'/bridge/gateway.json',{changed:true});const changed=f.snapshot();assert.equal(legacyCoverage(f.root,f.id,previous,changed).migratedWithExactBinding,false);
});
test('content hashing reuses unchanged bytes but detects same-size edits even if mtime is restored',t=>{
  const f=certificationFixture(t);const cold=certificationSnapshot(f.root,f.id,f.config,{persistCache:true}),warm=certificationSnapshot(f.root,f.id,f.config);assert.equal(cold.digest,warm.digest);assert.ok(warm.cache.reused>cold.cache.reused);
  const path=join(f.root,'tool/expert-task/versions/1.0.0/prompt.md'),metadata=statSync(path),bytes=readFileSync(path);bytes[bytes.length-2]=bytes[bytes.length-2]===65?66:65;writeFileSync(path,bytes);utimesSync(path,metadata.atime,metadata.mtime);assert.throws(()=>certificationSnapshot(f.root,f.id,f.config),/RELEASE_HASH_MISMATCH/);
});
test('registry metadata changes can migrate the old shared digest from Git while changed private bindings cannot',t=>{
  const f=certificationFixture(t),base=f.baseline(),snapshot=f.snapshot();
  const git=(...args)=>execFileSync('git',['-C',f.root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('add','--','tool','agent','software');git('commit','-m','frozen source');
  const previous={git:{head:git('rev-parse','HEAD')},environmentBindingSha256:environmentBinding(f.root,f.id),configSha256:snapshot.configSha256,firstCertification:{matrixPath:base.actual,matrixSha256:f.hash(base.actual),conformPath:base.conform,conformSha256:f.hash(base.conform),configSha256:snapshot.configSha256}};
  f.registries.tool.workflows[0].displayName='changed label';f.put('tool/registry.json',f.registries.tool);
  let current=f.snapshot(),migrated=legacyCoverage(f.root,f.id,previous,current);assert.equal(migrated.sharedMetadataReconstructed,true);assert.deepEqual(selectCertification(current,migrated,{mode:'full'}).selected,[]);
  seedRelease(f.root,'agent','new-expert','1.0.0');seedPointer(f.root,'agent','new-expert','1.0.0');f.registries.agent.agents.push({id:'new-expert',enabled:true,current:'new-expert/current.json'});f.put('agent/registry.json',f.registries.agent);current=f.snapshot();migrated=legacyCoverage(f.root,f.id,previous,current);assert.deepEqual(selectCertification(current,migrated,{mode:'full'}).selected,['agent:new-expert']);
  f.put(f.id+'/bridge/gateway.json',{changed:true});assert.equal(legacyCoverage(f.root,f.id,previous,f.snapshot()).sharedMetadataReconstructed,false);
});
test('a partial incremental attempt retains its newly passing cells and retries only failures',t=>{
  const f=certificationFixture(t);f.baseline();
  seedRelease(f.root,'agent','new-expert','1.0.0');seedPointer(f.root,'agent','new-expert','1.0.0');f.registries.agent.agents.push({id:'new-expert',enabled:true,current:'new-expert/current.json'});f.put('agent/registry.json',f.registries.agent);
  f.put(f.id+'/bridge/capabilities.json',{profiles:{'python>=3.8':'3.12'}});
  const snapshot=f.snapshot(),scope=certificationSelection(f.root,f.id,snapshot,{mode:'full'});
  const rows=scope.selected.map(key=>({...f.positive(snapshot.cells[key]),status:key==='agent:profile-task'?'FAIL':'PASS'}));
  const attempt=f.publish(scope,snapshot,rows),snapshotPath=f.put(f.id+'/runtime/manager-check/partial/scope.json',{snapshot,baselineRows:scope.baseline.rows,fullAnchor:scope.baseline.fullAnchor,selection:{kind:'incremental'}});
  f.put(f.id+'/runtime/manager-check/pending-latest.json',{stage:'check-failed',matrixActualPath:attempt.actual,matrixActualSha256:f.hash(attempt.actual),scopeSnapshotPath:snapshotPath,scopeSnapshotSha256:f.hash(snapshotPath)});
  const retry=certificationSelection(f.root,f.id,f.snapshot(),{mode:'full'});assert.deepEqual(retry.selected,['agent:profile-task']);const finished=f.publish(retry,snapshot);assert.equal(finished.coverageComplete,true);assert.equal(finished.provenance.actualRows,1);assert.equal(finished.provenance.reusedRows,3);
});
