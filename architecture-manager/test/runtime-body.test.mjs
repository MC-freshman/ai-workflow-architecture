import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {join} from 'node:path';
import {intakeFixture} from './support/intake-fixture.mjs';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {buildRuntimeBodyPlan,applyRuntimeBody,verifyRuntimeBody} from '../src/domains/intake/runtime-body.mjs';
import {withProcessScope} from '../src/infrastructure/process-scope.mjs';

test('runtime body directories retain dependencies and restoration supplies the exact installed tree',async t=>{
  const f=intakeFixture(t),directory=join(f.base,'program');for(const name of ['node_modules/pkg','dist','venv'])fs.mkdirSync(join(directory,name),{recursive:true});fs.writeFileSync(join(directory,'app.exe'),Buffer.from('MZ\0test body; never executed'));fs.writeFileSync(join(directory,'node_modules/pkg/index.js'),'export const x=1;');fs.writeFileSync(join(directory,'dist/main.js'),'console.log("body fixture");');fs.writeFileSync(join(directory,'venv/runtime.txt'),'runtime dependency');
  const intake=await scanExternalBody({workspaceRoot:f.root,type:'platform',sourcePath:directory,entryPath:'app.exe'});assert.equal(intake.files.filter(row=>row.included).length,4);const plan=buildRuntimeBodyPlan({intake,platformId:f.platformId,resourceId:'client'}),result=await applyRuntimeBody({plan},{auditRoot:f.auditRoot});assert(result.restored);assert(verifyRuntimeBody({plan}).ok);assert(fs.existsSync(join(result.bodyPath,'node_modules/pkg/index.js')));assert.equal((await applyRuntimeBody({plan},{auditRoot:f.auditRoot})).status,'already-applied');
  fs.writeFileSync(join(result.bodyPath,'extra.exe'),'unexpected extra');assert(!verifyRuntimeBody({plan}).ok);await assert.rejects(applyRuntimeBody({plan},{auditRoot:f.auditRoot}),/EXTERNAL_CHANGE/);
});
test('cancelled copy resumes its verified prefix without a second full backup or leftover partial trees',async t=>{
  const f=intakeFixture(t),source=join(f.base,'app.exe');fs.writeFileSync(source,Buffer.concat([Buffer.from('MZ\0'),Buffer.alloc(3*1024*1024,42)]));const intake=await scanExternalBody({workspaceRoot:f.root,type:'software',sourcePath:source}),plan=buildRuntimeBodyPlan({intake,platformId:f.platformId,resourceId:'app'}),signal=new SharedArrayBuffer(4);
  await assert.rejects(withProcessScope({signal},()=>applyRuntimeBody({plan},{auditRoot:f.auditRoot,onProgress:event=>{if(event.phase==='备份本体' && event.bytesDone>0)Atomics.store(new Int32Array(signal),0,1);}})),/TASK_CANCELLED/);
  const progress=[];await applyRuntimeBody({plan},{auditRoot:f.auditRoot,onProgress:event=>progress.push(event)});assert(verifyRuntimeBody({plan}).ok);assert(progress.some(event=>event.reusedBytes>0));const stage=join(f.root,f.platformId,'runtime/tmp/manager-bodies',plan.target.installationId);assert(!fs.readdirSync(stage).some(name=>name.endsWith('.partial')));
  const manifest=JSON.parse(fs.readFileSync(join(plan.target.backup,'MANIFEST.json')));assert(manifest.restoreDrill.performed);assert.equal(manifest.files.length,1);
});
