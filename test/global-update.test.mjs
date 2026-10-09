import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {seedRelease,seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {buildGlobalUpdatePlan,applyGlobalUpdate,cancelGlobalUpdate,buildGlobalUpdateRestorePlan,applyGlobalUpdateRestore,readGlobalUpdateHistory,sharedUpdateTarget} from '../src/domains/platforms/global-update.mjs';
import {collectResourceRequirements} from '../src/domains/platforms/resource-environment.mjs';
import {sha256} from '../src/core/hash.mjs';

const encode=value=>JSON.stringify(value,null,2)+'\n';
function fixture(t) {
  const base=mkdtempSync(join(tmpdir(),'manager-global-update-')),root=join(base,'workspace');mkdirSync(root);
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const put=(path,value)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:encode(value));return file;};
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
  seedRuntimeReleases(root);
  seedRelease(root,'tool','repo-lint','0.7.0');seedPointer(root,'tool','repo-lint','0.7.0');
  const original=JSON.parse(readFileSync(join(root,'tool/wf-runner/versions/0.12.0/manifest.json')));
  seedRelease(root,'tool','wf-runner','0.13.0',{'manifest.json':{...original,version:'0.13.0',dependencies:{workflows:{'repo-lint':'0.7.0'}}},'cli.py':'# fixture entry\n'});seedPointer(root,'tool','wf-runner','0.13.0');
  for(const id of ['architecture-ops','platform-conformance']){seedRelease(root,'tool',id,'1.0.0');seedPointer(root,'tool',id,'1.0.0');}
  seedRelease(root,'software','_gateway','1.0.0',{'manifest.json':{schema:'ai-software-gateway/v1',id:'_gateway',version:'1.0.0',displayName:'Test gateway',invocable:false,kind:'local-process',runtime:{type:'python-cli',entry:'gateway.py',python:'>=3.9'},contract:{},integrity:{sha256Manifest:'SHA256SUMS'}},'gateway.py':'# fixture gateway\n'});seedPointer(root,'software','_gateway','1.0.0');
  for(const version of ['1.0.0','1.1.0','9.0.0'])seedRelease(root,'agent','writer',version);seedPointer(root,'agent','writer','1.1.0');
  put('tool/registry.json',{workflows:[{id:'wf-runner',enabled:true},{id:'repo-lint',enabled:true}]});put('agent/registry.json',{agents:[{id:'writer',enabled:true}]});put('software/registry.json',{software:[]});
  const python=process.env.MANAGER_TEST_PYTHON || execFileSync('python',['-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
  for(const id of ['alpha','beta']) {
    put(id+'/bridge.json',{platform:id,shared:{readOnly:true},runner:{enabled:true,version:'0.12.0',python},defaults:{agentVersions:{writer:'1.0.0'},workflowVersions:{'repo-lint':'0.6.3'}}});
    put(id+'/bridge/runner-config.json',{platform:id,runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),capabilities:join(root,id,'bridge/capabilities.json'),contextWindowTokens:128000,interpreters:{'.py':python},custom:'keep'});
    put(id+'/bridge/capabilities.json',{schema:'ai-platform-capabilities/v1',platform:id});put(id+'/runtime/runs/in-flight/run-lock.json',{version:'0.12.0'});
  }
  put('.gitignore','/alpha/runtime/\n/beta/runtime/\n');for(const path of ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md'])put(path,'# Fixture governance\n');
  git('init');git('config','user.name','Update Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','--','.');git('commit','-m','baseline');
  const remote=join(base,'remote.git');execFileSync('git',['init','--bare',remote],{windowsHide:true,stdio:'ignore'});git('remote','add','origin',remote);git('push','-u','origin',git('branch','--show-current'));
  const auditRoot=join(base,'audit'),counts={prepare:0,check:0};
  const services={prepare:async()=>{counts.prepare++;},nativeStatus:()=>({nativeVendorClientVerified:true,proofScope:'unit-fixture-condition'}),check:async({platformId})=>{
    counts.check++;const directory=join(root,platformId,'runtime/check-fixture');mkdirSync(directory,{recursive:true});
    const conformPath=put(platformId+'/runtime/check-fixture/conform.json',{floorReached:true,fixture:true});const matrixPath=put(platformId+'/runtime/check-fixture/matrix.json',{rows:[{status:'PASS'}],fixture:true});
    return {stage:'callable',coverageComplete:true,issues:[],conformPath,matrixPath,counts:{pass:1,fail:0},fixture:true};
  }};
  return {base,root,put,git,services,counts,auditRoot};
}
test('global update fixes current once, updates two isolated platforms, keeps current and in-flight locks, and reuses unchanged evidence',async t=>{
  const f=fixture(t),before=sha256(readFileSync(join(f.root,'agent/writer/current.json'))),lock=readFileSync(join(f.root,'alpha/runtime/runs/in-flight/run-lock.json'));
  const plan=buildGlobalUpdatePlan({workspaceRoot:f.root,push:true});assert.deepEqual(plan.target.platformIds,['alpha','beta']);assert.equal(plan.payload.shared.resources.find(row=>row.id==='writer').version,'1.1.0');
  const result=await applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services:f.services});assert.equal(result.status,'complete',JSON.stringify(result.results.map(row=>({id:row.platformId,error:row.error,status:row.status}))));assert.equal(f.counts.check,2);
  for(const id of ['alpha','beta']){const config=JSON.parse(readFileSync(join(f.root,id,'bridge/runner-config.json')));assert.equal(config.runner,join(f.root,'tool/wf-runner/versions/0.13.0'));assert.equal(config.custom,'keep');assert.equal(JSON.parse(readFileSync(join(f.root,id,'bridge.json'))).defaults.agentVersions.writer,undefined);}
  assert.equal(sha256(readFileSync(join(f.root,'agent/writer/current.json'))),before);assert.deepEqual(readFileSync(join(f.root,'alpha/runtime/runs/in-flight/run-lock.json')),lock);
  const again=buildGlobalUpdatePlan({workspaceRoot:f.root,push:true});const second=await applyGlobalUpdate(again,{auditRoot:f.auditRoot,services:f.services});assert.ok(second.results.every(row=>row.status==='no-change'));assert.equal(f.counts.check,2);
});
test('one platform pending does not block the other, and continuing a stopped plan does not repeat completed preparation',async t=>{
  const f=fixture(t),plan=buildGlobalUpdatePlan({workspaceRoot:f.root,push:true});let first=true;
  const services={...f.services,prepare:async()=>{f.counts.prepare++;if(first){first=false;cancelGlobalUpdate({workspaceRoot:f.root});throw Error('TASK_CANCELLED');}}};
  const stopped=await applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services});assert.equal(stopped.status,'stopped');assert.equal(readGlobalUpdateHistory({workspaceRoot:f.root,auditRoot:f.auditRoot}).plan.planId,plan.planId);
  const resumed=await applyGlobalUpdate(buildGlobalUpdatePlan({workspaceRoot:f.root,resumePlan:plan}),{auditRoot:f.auditRoot,services:{...f.services,nativeStatus:(_root,id)=>({nativeVendorClientVerified:id==='beta'})}});
  assert.equal(resumed.results.find(row=>row.platformId==='alpha').status,'pending');assert.equal(resumed.results.find(row=>row.platformId==='beta').status,'complete');
});
test('external changes are preserved and stale shared targets are refused',async t=>{
  const f=fixture(t),plan=buildGlobalUpdatePlan({workspaceRoot:f.root});f.put('alpha/bridge/runner-config.json',{external:'keep'});
  const result=await applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services:f.services});assert.equal(result.results[0].status,'external-change');assert.deepEqual(JSON.parse(readFileSync(join(f.root,'alpha/bridge/runner-config.json'))),{external:'keep'});
  seedPointer(f.root,'agent','writer','9.0.0');await assert.rejects(applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services:f.services}),/GLOBAL_UPDATE_SHARED_CHANGED/);
});
test('restoration refuses to overwrite an external edit and restores only owned configuration',async t=>{
  const f=fixture(t),plan=buildGlobalUpdatePlan({workspaceRoot:f.root});const before=readFileSync(join(f.root,'alpha/bridge.json'));
  await applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services:f.services});const restore=buildGlobalUpdateRestorePlan({workspaceRoot:f.root,updatePlan:plan});
  f.put('alpha/bridge.json',{external:true});assert.equal(applyGlobalUpdateRestore(restore,{auditRoot:f.auditRoot}).ok,false);assert.deepEqual(JSON.parse(readFileSync(join(f.root,'alpha/bridge.json'))),{external:true});
  const after=plan.payload.platforms.find(row=>row.platformId==='alpha').nextBridge;f.put('alpha/bridge.json',after);assert.equal(applyGlobalUpdateRestore(restore,{auditRoot:f.auditRoot}).ok,true);assert.deepEqual(readFileSync(join(f.root,'alpha/bridge.json')),before);
  assert.ok(readGlobalUpdateHistory({workspaceRoot:f.root,auditRoot:f.auditRoot}).result.results.every(row=>row.status==='restored'));
  await assert.rejects(applyGlobalUpdate(plan,{auditRoot:f.auditRoot,services:f.services}),/GLOBAL_UPDATE_ALREADY_RESTORED/);
});
test('dependency closure reads x-runtimeRequirements and rejects actual version conflicts and bad seals',t=>{
  const f=fixture(t),manifest=JSON.parse(readFileSync(join(f.root,'agent/writer/versions/1.1.0/manifest.json')));
  seedRelease(f.root,'agent','writer','1.1.0',{'manifest.json':{...manifest,'x-runtimeRequirements':{ownership:'platform/runtime',profile:'portable-resource-python',packages:{numpy:'1.26.4'}}}});
  const requirements=collectResourceRequirements(f.root,[{repository:'agent',id:'writer',version:'1.1.0'}]);assert.equal(requirements.packages.numpy,'1.26.4');
  seedRelease(f.root,'agent','other','1.0.0',{'manifest.json':{...manifest,id:'other',version:'1.0.0','x-runtimeRequirements':{ownership:'platform/runtime',packages:{numpy:'2.0.0'}}}});
  assert.throws(()=>collectResourceRequirements(f.root,[{repository:'agent',id:'writer',version:'1.1.0'},{repository:'agent',id:'other',version:'1.0.0'}]),/RUNTIME_DEPENDENCY_CONFLICT/);
  f.put('agent/writer/versions/1.1.0/prompt.md','tamper');assert.throws(()=>collectResourceRequirements(f.root,sharedUpdateTarget(f.root).resources),/RELEASE_HASH_MISMATCH/);
});
