import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {intakeFixture} from './support/intake-fixture.mjs';
import {seedRuntimeReleases} from './support/resources.mjs';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {buildPlatformBodyPlan} from '../src/domains/intake/platform-body.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
import {buildOnboardingClientPlan,applyOnboardingClient,probeOnboardingClient} from '../src/onboarding-client.mjs';
function setup(t) {
  const f=intakeFixture(t);seedRuntimeReleases(f.root);
  for(const path of ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md']){fs.mkdirSync(join(f.root,path,'..'),{recursive:true});fs.writeFileSync(join(f.root,path),'# Fixture governance\nCompletion requires real evidence.\n');}
  f.git('add','--','.');f.git('commit','-m','runtime and governance baseline');return {...f,python:execFileSync('python',['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim()};
}
test('a real externally supplied protocol client is installed, restored and challenged while the facade remains distinct',async t=>{
  const f=setup(t),source=join(f.base,'native-client.py');fs.copyFileSync(new URL('../src/runtime/cli_client.py',import.meta.url),source);const intake=await scanExternalBody({workspaceRoot:f.root,type:'platform',sourcePath:source}),plan=await buildPlatformBodyPlan({intake,platformId:'new-client',confirmed:true,fields:{pythonExecutable:f.python},clientMode:'json-cli',clientArgs:['{client-descriptor}']});
  assert(!fs.existsSync(join(f.root,'new-client')));const applied=await applyPlan({plan,auditRoot:f.auditRoot});assert.equal(applied.architectureComplete,false);assert((await verifyPlanTarget({plan})).ok);
  const proof=await probeOnboardingClient({workspaceRoot:f.root,platformId:'new-client'});assert.equal(proof.status,'passed');assert.equal(proof.importedClientVerified,true);assert.equal(proof.nativeVendorClientVerified,false);assert.equal(proof.receipt.businessRunExecuted,false);
  // Preparing the standard architecture service later must preserve the selected imported client.
  applyOnboardingClient(buildOnboardingClientPlan({workspaceRoot:f.root,platformId:'new-client'}),{auditRoot:f.auditRoot});const adapter=JSON.parse(fs.readFileSync(join(f.root,'new-client/bridge/client-adapter.json')));assert.equal(adapter.sourceBody.path,plan.target.nativeBodyPath);assert.equal(adapter.installedClient,false);
  fs.appendFileSync(plan.target.nativeBodyPath,'\n# external mutation');await assert.rejects(probeOnboardingClient({workspaceRoot:f.root,platformId:'new-client'}),/CLIENT_BODY_DRIFT/);
});
test('GUI-only bodies stay pending and forged executable plans fail before creating a platform',async t=>{
  const f=setup(t),source=join(f.base,'gui.exe');fs.writeFileSync(source,Buffer.from('MZ\0fixture body, never launched'));const intake=await scanExternalBody({workspaceRoot:f.root,type:'platform',sourcePath:source}),plan=await buildPlatformBodyPlan({intake,platformId:'gui-client',confirmed:true,fields:{pythonExecutable:f.python}}),forged=structuredClone(plan);forged.payload.native.executable=f.python;
  await assert.rejects(applyPlan({plan:forged,auditRoot:f.auditRoot}),/PLAN_PAYLOAD_MISMATCH/);assert(!fs.existsSync(join(f.root,'gui-client')));const result=await applyPlan({plan,auditRoot:f.auditRoot});assert.equal(result.nativeStatus,'interface-required');const probe=await probeOnboardingClient({workspaceRoot:f.root,platformId:'gui-client'});assert.equal(probe.status,'waiting-user');assert.equal(probe.nativeVendorClientVerified,false);
  const doc=fs.readFileSync(join(f.root,'AGENTS.md'),'utf8');assert(doc.includes('architecture-manager-platform:gui-client'));assert(doc.includes('全部通过才算完成'));assert(!doc.includes('gui-client 已接入完成'));
});
test('platform body continuation verifies settled configuration before continuing and preserves external edits',async t=>{
  const f=setup(t),source=join(f.base,'native-client.py');fs.copyFileSync(new URL('../src/runtime/cli_client.py',import.meta.url),source);const intake=await scanExternalBody({workspaceRoot:f.root,type:'platform',sourcePath:source}),plan=await buildPlatformBodyPlan({intake,platformId:'resume-client',confirmed:true,fields:{pythonExecutable:f.python},clientMode:'json-cli',clientArgs:['{client-descriptor}']});
  await assert.rejects(applyPlan({plan,auditRoot:f.auditRoot,onProgress:progress=>{if(progress.step==='configuration')throw Error('USER_STOP_AT_SAFE_POINT');}}),/USER_STOP_AT_SAFE_POINT/);
  const bridge=join(f.root,'resume-client/bridge.json'),before=fs.readFileSync(bridge);fs.appendFileSync(bridge,'\n');await assert.rejects(applyPlan({plan,auditRoot:f.auditRoot}),/IMPORT_EXTERNAL_CHANGE/);assert(fs.readFileSync(bridge).equals(Buffer.concat([before,Buffer.from('\n')])));
  fs.writeFileSync(bridge,before);const resumed=await applyPlan({plan,auditRoot:f.auditRoot});assert.equal(resumed.status,'body-installed-native-pending');assert((await verifyPlanTarget({plan})).ok);assert.equal((await applyPlan({plan,auditRoot:f.auditRoot})).status,'already-applied');
});
