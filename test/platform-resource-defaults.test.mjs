import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {sha256File} from '../src/core/hash.mjs';
import {readPlatformResourceVersions,buildPlatformResourceDefaultPlan} from '../src/domains/platforms/resource-defaults.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';

function fixture(t){
  const root=fs.mkdtempSync(join(tmpdir(),'platform-defaults-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(name,value)=>{fs.mkdirSync(dirname(join(root,name)),{recursive:true});fs.writeFileSync(join(root,name),typeof value==='string'?value:JSON.stringify(value));};
  for(const id of ['first','second']){put(id+'/bridge.json',{platform:id,shared:{readOnly:true},defaults:{workflowVersions:{},agentVersions:{}},unrelated:'keep'});put(id+'/bridge/runner-config.json',{platform:id,platformRoot:join(root,id)});put(id+'/runtime/runs/existing/run-lock.json',{workflowVersion:'1.9.1'});}
  put('tool/registry.json',{workflows:[{id:'flow',enabled:true}]});put('agent/registry.json',{agents:[{id:'expert',enabled:true}]});
  for(const version of ['1.9.1','1.10.0']){seedRelease(root,'tool','flow',version);seedRelease(root,'agent','expert',version,{'manifest.json':{schema:'ai-agent/v2',id:'expert',version,prompt:'prompt.md',toolLock:'tool-lock.json',workflows:['flow']},'tool-lock.json':{schema:'ai-tool-lock/v2',workflows:{flow:'1.9.1'}}});}
  for(const repository of ['tool','agent'])seedPointer(root,repository,repository==='tool'?'flow':'expert','1.10.0');
  return {root,put,input:{workspaceRoot:root,platformId:'first',repository:'agent',resourceId:'expert',targetVersion:'1.9.1'},auditRoot:join(root,'audit')};
}
test('platform choice and rollback affect only future runs of one platform; shared defaults and agent locks survive',t=>{
  const f=fixture(t),unchanged=['second/bridge.json','first/runtime/runs/existing/run-lock.json','tool/flow/current.json','agent/expert/current.json','agent/expert/versions/1.9.1/tool-lock.json'].map(name=>[name,sha256File(join(f.root,name))]);
  const plan=buildPlatformResourceDefaultPlan(f.input),result=applyPlan({plan,auditRoot:f.auditRoot});assert.equal(result.scope,'platform-local');assert.equal(result.sharedCurrentChanged,false);assert.equal(result.writePerformed,true);assert.equal(result.effectiveVersion,'1.9.1');assert.equal(verifyPlanTarget({plan}).ok,true);assert(fs.existsSync(result.receiptPath));assert(fs.existsSync(result.checkpointPath));
  const row=readPlatformResourceVersions(f.input).rows.find(row=>row.resourceId==='expert');assert.equal(row.sharedVersion,'1.10.0');assert.equal(row.platformVersion,'1.9.1');assert.equal(row.resolvedFrom,'platform-local');
  assert.equal(applyPlan({plan,auditRoot:f.auditRoot}).status,'already-applied');
  const reset=buildPlatformResourceDefaultPlan({...f.input,targetVersion:null});assert.equal(applyPlan({plan:reset,auditRoot:f.auditRoot}).effectiveVersion,'1.10.0');assert.equal(readPlatformResourceVersions(f.input).rows.find(row=>row.resourceId==='expert').platformVersion,null);
  for(const [name,hash] of unchanged)assert.equal(sha256File(join(f.root,name)),hash,name);
});
test('stale bridge, shared pointer and dependency bytes cannot be silently accepted',t=>{
  const f=fixture(t),plan=buildPlatformResourceDefaultPlan(f.input),before=fs.readFileSync(join(f.root,'first/bridge.json'));
  f.put('first/bridge.json',{platform:'first',defaults:{agentVersions:{}},changed:true});assert.throws(()=>applyPlan({plan,auditRoot:f.auditRoot}),/BASELINE_MISMATCH/);fs.writeFileSync(join(f.root,'first/bridge.json'),before);
  seedPointer(f.root,'agent','expert','1.9.1');assert.throws(()=>applyPlan({plan,auditRoot:f.auditRoot}),/BASELINE_MISMATCH/);seedPointer(f.root,'agent','expert','1.10.0');
  fs.appendFileSync(join(f.root,'tool/flow/versions/1.9.1/prompt.md'),'tamper');assert.throws(()=>buildPlatformResourceDefaultPlan(f.input),/HASH_MISMATCH/);assert.deepEqual(fs.readFileSync(join(f.root,'first/bridge.json')),before);
});
test('checkpoint interruption releases the lock and leaves the original bridge intact',t=>{
  const f=fixture(t),before=fs.readFileSync(join(f.root,'first/bridge.json')),plan=buildPlatformResourceDefaultPlan(f.input);
  assert.throws(()=>applyPlan({plan,auditRoot:f.auditRoot,failAfterCheckpoint:true}),/SIMULATED_INTERRUPT/);assert.deepEqual(fs.readFileSync(join(f.root,'first/bridge.json')),before);assert(!fs.existsSync(join(f.root,'first/runtime/maintenance/manager-defaults/bridge.lock')));
  assert.equal(applyPlan({plan,auditRoot:f.auditRoot}).ok,true);
});
test('engine paired selection and forged platform identity fail before any write',t=>{
  const f=fixture(t);f.put('first/bridge/runner-config.json',{scannerRelease:join(f.root,'tool/flow/versions/1.10.0')});assert.throws(()=>buildPlatformResourceDefaultPlan({...f.input,repository:'tool',resourceId:'flow'}),/PAIRING_REQUIRED/);
  f.put('first/bridge.json',{platform:'second'});assert.throws(()=>buildPlatformResourceDefaultPlan(f.input),/SCOPE_MISMATCH/);
});
test('a dead owner lock is archived for recovery; a live owner blocks before mutation',t=>{
  const f=fixture(t),lock=join(f.root,'first/runtime/maintenance/manager-defaults/bridge.lock');fs.mkdirSync(dirname(lock),{recursive:true});
  fs.writeFileSync(lock,JSON.stringify({schema:'architecture-manager-default-lock/v1',pid:process.pid}));const plan=buildPlatformResourceDefaultPlan(f.input);assert.throws(()=>applyPlan({plan,auditRoot:f.auditRoot}),/RESOURCE_BUSY/);
  const child=spawnSync(process.execPath,['-e',''],{windowsHide:true});fs.writeFileSync(lock,JSON.stringify({schema:'architecture-manager-default-lock/v1',pid:child.pid}));assert.equal(applyPlan({plan,auditRoot:f.auditRoot}).ok,true);assert(fs.readdirSync(dirname(lock)).some(name=>name.endsWith('.expired')));
});
test('installed standalone AI command uses the same executor and rejects another platform',t=>{
  const f=fixture(t),command=new URL('../src/runtime/platform_defaults.mjs',import.meta.url),config=join(f.root,'first/bridge/runner-config.json');
  const invoke=payload=>{const child=spawnSync(process.execPath,[command.pathname.replace(/^\/(\w:)/,'$1'),config],{input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,env:{...process.env,LOCALAPPDATA:join(f.root,'local-app-data')}});return JSON.parse(child.stdout);};
  assert.equal(invoke({operation:'set',kind:'agent',resourceId:'expert',version:'1.9.1',confirm:true,platformId:'second'}).error,'PLATFORM_SCOPE_MISMATCH');
  assert.equal(invoke({operation:'set',kind:'agent',resourceId:'expert',version:'1.9.1'}).error,'TRANSACTION_CONFIRMATION_REQUIRED');
  const result=invoke({operation:'set',kind:'agent',resourceId:'expert',version:'1.9.1',confirm:true});assert.equal(result.ok,true);assert.equal(result.result.effectiveVersion,'1.9.1');assert.equal(result.result.scope,'platform-local');
  const rows=invoke({operation:'get'}).result.rows;assert.equal(rows.find(row=>row.resourceId==='expert').effectiveVersion,readPlatformResourceVersions(f.input).rows.find(row=>row.resourceId==='expert').effectiveVersion);
  assert.equal(invoke({operation:'set',kind:'agent',resourceId:'expert',version:null,confirm:true}).result.resolvedFrom,'shared-current');
});
