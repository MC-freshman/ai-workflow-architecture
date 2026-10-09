import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {intakeFixture} from './support/intake-fixture.mjs';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {buildAutomaticSoftwarePlan,matchSoftwareRecipes} from '../src/domains/intake/automatic-software.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
import {sha256File} from '../src/core/hash.mjs';
import {selectDeclaredEntry} from '../src/domains/intake/entry-selection.mjs';

test('manifest or unique canonical entry removes README ambiguity; multiple bodies remain explicit',()=>{
  const choices=[{path:'README.md'},{path:'prompt.md'},{path:'guides/notes.md'}];assert.equal(selectDeclaredEntry('agent',choices),'prompt.md');assert.equal(selectDeclaredEntry('agent',choices,{prompt:'guides/notes.md'}),'guides/notes.md');
  assert.equal(selectDeclaredEntry('agent',[{path:'a.md'},{path:'b.md'}]),null);assert.equal(selectDeclaredEntry('tool',[{path:'workflow.yaml'},{path:'prompt.md'}]),'workflow.yaml');
});

test('unknown GUI automatically publishes only a standard session and binds without starting the body',async t=>{
  const f=intakeFixture(t),python=process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python';
  const {execFileSync}=await import('node:child_process');const executable=execFileSync(python,['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
  fs.mkdirSync(join(f.root,f.platformId,'bridge'),{recursive:true});
  fs.writeFileSync(join(f.root,f.platformId,'bridge/runner-config.json'),JSON.stringify({platform:f.platformId,platformRoot:join(f.root,f.platformId),interpreters:{'.py':executable},softwareGateway:join(f.root,'software/_connector/versions/1.0.0/connector.py'),softwareGatewayConfig:join(f.root,f.platformId,'bridge/software-gateway-config.json')}));
  fs.writeFileSync(join(f.root,f.platformId,'bridge/software-gateway-config.json'),JSON.stringify({bodies:{},interpreters:{'.py':executable}}));
  f.git('add','--',f.platformId+'/bridge');f.git('commit','-m','GUI binding rollback baseline');
  const body=join(f.base,'example-desktop.exe'),bytes=Buffer.alloc(512);bytes.writeUInt16LE(0x5a4d);bytes.writeUInt32LE(64,60);bytes.writeUInt32LE(0x4550,64);bytes.writeUInt16LE(2,64+24+68);fs.writeFileSync(body,bytes);
  const intake=await scanExternalBody({workspaceRoot:f.root,platformId:f.platformId,type:'software',sourcePath:body}),plan=await buildAutomaticSoftwarePlan({intake,platformId:f.platformId});
  assert.equal(plan.target.mode,'gui-session');const result=await applyPlan({plan,auditRoot:f.auditRoot});assert.equal(result.bindingEstablished,true);assert.equal(result.functionExecuted,false);assert.equal((await verifyPlanTarget({plan})).ok,true);
  const directory=join(f.root,'software',plan.target.softwareId,'versions',plan.target.version),snapshot=JSON.parse(fs.readFileSync(join(directory,'capabilities.snapshot.json')));assert.equal(snapshot.frozen,false);assert.deepEqual(snapshot.capabilities.map(row=>row.name),['session']);assert.equal(fs.existsSync(body),true);
});
test('one confirmed existing-software plan really restores and binds once, preserves recipe and source, and records pending health honestly',async t=>{
  const f=intakeFixture(t);fs.mkdirSync(join(f.root,f.platformId,'bridge'),{recursive:true});
  fs.writeFileSync(join(f.root,f.platformId,'bridge/runner-config.json'),JSON.stringify({platform:f.platformId,platformRoot:join(f.root,f.platformId),softwareGatewayConfig:join(f.root,f.platformId,'bridge/software-gateway-config.json')}));
  fs.writeFileSync(join(f.root,f.platformId,'bridge/software-gateway-config.json'),JSON.stringify({bodies:{},interpreters:{}}));
  seedRelease(f.root,'software','fixture-cli','1.0.0');seedPointer(f.root,'software','fixture-cli','1.0.0');fs.writeFileSync(join(f.root,'software/registry.json'),JSON.stringify({schema:'ai-software-registry/v1',version:1,software:[{id:'fixture-cli',enabled:true,current:'fixture-cli/current.json'}]}));
  f.git('add','--',f.platformId+'/bridge','software');f.git('commit','-m','software binding rollback baseline');
  const body=join(f.base,'fixture.exe'),bytes=Buffer.alloc(512);bytes.writeUInt16LE(0x5a4d);bytes.writeUInt32LE(64,60);bytes.writeUInt32LE(0x4550,64);bytes.writeUInt16LE(3,64+24+68);fs.writeFileSync(body,bytes);
  const intake=await scanExternalBody({workspaceRoot:f.root,platformId:f.platformId,type:'software',sourcePath:body}),plan=await buildAutomaticSoftwarePlan({intake,platformId:f.platformId}),pointerSha=sha256File(join(f.root,'software/fixture-cli/current.json'));
  assert.equal(plan.target.softwareId,'fixture-cli');assert.equal(matchSoftwareRecipes(intake).length,1);
  const result=await applyPlan({plan,auditRoot:f.auditRoot});assert.equal(result.bindingEstablished,true);assert.equal(result.compatibilityVerified,false);assert.equal(result.functionExecuted,false);assert.equal((await verifyPlanTarget({plan})).ok,true);assert.equal(sha256File(result.bodyPath),sha256File(body));assert.equal(sha256File(join(f.root,'software/fixture-cli/current.json')),pointerSha);
  assert.equal((await applyPlan({plan,auditRoot:f.auditRoot})).status,'already-applied');const fresh=await buildAutomaticSoftwarePlan({intake,platformId:f.platformId});assert.equal(fresh.payload.placementPlan.planId,plan.payload.placementPlan.planId);
});
