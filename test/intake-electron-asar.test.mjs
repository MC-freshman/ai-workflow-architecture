import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {intakeFixture} from './support/intake-fixture.mjs';

test('real Electron copies external ASAR bodies as opaque bytes and restores them',async t=>{
  const f=intakeFixture(t),source=join(f.base,'electron-body');fs.mkdirSync(join(source,'resources'),{recursive:true});
  fs.writeFileSync(join(source,'sample.exe'),Buffer.from('MZ never executed'));
  fs.writeFileSync(join(source,'resources/app.asar'),Buffer.from('opaque ASAR bytes\0do not expand'));
  const code=`const {app}=require('electron');const {Worker}=require('node:worker_threads');
app.whenReady().then(()=>{const worker=new Worker(${JSON.stringify(`
    const {parentPort}=require('node:worker_threads');
    (async()=>{const {scanExternalBody}=await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../src/domains/intake/sources.mjs',import.meta.url))).href)});
    const {buildRuntimeBodyPlan,applyRuntimeBody,verifyRuntimeBody}=await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../src/domains/intake/runtime-body.mjs',import.meta.url))).href)});
    const intake=await scanExternalBody({workspaceRoot:${JSON.stringify(f.root)},platformId:${JSON.stringify(f.platformId)},sourcePath:${JSON.stringify(source)},type:'software',entryPath:'sample.exe'});
    if(intake.files.length!==2 || !intake.files.some(row=>row.path==='resources/app.asar'))throw Error('ASAR_WAS_EXPANDED');
    const plan=buildRuntimeBodyPlan({intake,platformId:${JSON.stringify(f.platformId)},resourceId:'asar-body'});
    await applyRuntimeBody({plan},{auditRoot:${JSON.stringify(f.auditRoot)}});
    const verification=verifyRuntimeBody({plan});if(!verification.ok)throw Error('ASAR_RESTORE_FAILED');
    parentPort.postMessage({ok:true,files:intake.files.map(row=>row.path),verification});})().catch(error=>parentPort.postMessage({ok:false,error:error.stack}));
  `)},{eval:true});worker.once('message',answer=>{console.log(JSON.stringify(answer));app.exit(answer.ok?0:1);});worker.once('error',error=>{console.error(error);app.exit(1);});});`;
  const script=join(f.base,'proof.cjs');fs.writeFileSync(script,code);
  const executable=fileURLToPath(new URL('../node_modules/electron/dist/electron.exe',import.meta.url));
  const environment={...process.env,TEMP:join(f.base,'temp'),TMP:join(f.base,'temp')};delete environment.ELECTRON_RUN_AS_NODE;fs.mkdirSync(environment.TEMP);
  const child=spawn(executable,[script],{windowsHide:true,env:environment});let output='',errors='';
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>errors+=bytes);
  const timer=setTimeout(()=>child.kill(),30000);const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
  assert.equal(result.code,0,output+'\n'+errors);const answer=JSON.parse(output.trim().split(/\r?\n/).findLast(row=>row.startsWith('{')));assert(answer.ok);assert(answer.verification.ok);assert.deepEqual(answer.files,['resources/app.asar','sample.exe']);
});
