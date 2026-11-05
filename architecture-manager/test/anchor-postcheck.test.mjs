import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {executePostAlignmentChecks} from '../src/domains/onboarding/onboarding-state.mjs';
import {readOnboardingState} from '../src/domains/onboarding/onboarding-state.mjs';

// A platform that is configured but has never passed a first matrix. The post-alignment run must be
// able to act on it, must ask for the affected-cell mode only, and must never claim a client loop.
function seedConfiguredPlatform(root,platformId='aligned-client') {
  seedRuntimeReleases(root);
  for(const [repository,key] of [['tool','workflows'],['agent','agents'],['software','software']]) {
    mkdirSync(join(root,repository),{recursive:true});
    writeFileSync(join(root,repository,'registry.json'),JSON.stringify({[key]:[]},null,2)+'\n');
  }
  seedPointer(root,'tool','architecture-ops','1.5.0');
  const write=(relative,value)=>{mkdirSync(dirname(join(root,relative)),{recursive:true});writeFileSync(join(root,relative),JSON.stringify(value,null,2)+'\n');};
  write(`${platformId}/bridge/runner-config.json`,{
    platform:platformId,platformRoot:join(root,platformId),toolRoot:join(root,'tool'),agentRoot:join(root,'agent'),softwareRoot:join(root,'software'),
    runsRoot:join(root,platformId,'runtime/runs'),runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),
    scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),bridge:join(root,platformId,'bridge.json')});
  write(`${platformId}/bridge.json`,{schema:'ai-platform-bridge/v1.1',platform:platformId,displayName:platformId,runtimeRoot:join(root,platformId,'runtime'),shared:{toolRegistry:join(root,'tool/registry.json'),agentRegistry:join(root,'agent/registry.json'),readOnly:true},modes:['workflow','agent-workflow'],defaults:{workflowVersions:{'repo-lint':'0.6.3'}},runner:{enabled:true,version:'0.12.0',config:join(root,platformId,'bridge/runner-config.json')}});
  write(`${platformId}/bridge/client-adapter.json`,{schema:'architecture-manager-client/v1',platformId,kind:'cli',executable:'',args:[],probeTool:'',probeArguments:{},nativeVerified:false});
  return platformId;
}

function passingCheck(root,platformId,{coverageComplete}) {
  const out=join(root,platformId,'runtime/manager-check','fixture');
  mkdirSync(out,{recursive:true});
  const matrixPath=join(out,'matrix.json'),conformPath=join(out,'conform.json');
  writeFileSync(matrixPath,JSON.stringify({rows:[{kind:'workflow',id:'repo-lint',version:'0.6.3',status:'PASS'}],summary:{PASS:1,FAIL:0}},null,2));
  writeFileSync(conformPath,JSON.stringify({floorReached:true,counts:{pass:1,declaredAbsent:0,unverified:0}},null,2));
  return {platformId,stage:'check-failed',version:{configSha256:'fixture'},matrixPath,conformPath,counts:{pass:1,fail:0,expected:0,needsInput:0},issues:[],coverageComplete,evidencePath:matrixPath};
}

test('a post-alignment run asks for the affected-cell mode, records the anchor digest, and never claims a client loop',async(t)=>{
  const root=mkdtempSync(join(tmpdir(),'anchor-postcheck-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const platformId=seedConfiguredPlatform(root);
  const calls=[];
  const state=await executePostAlignmentChecks({workspaceRoot:root,platformId,anchorDigestSha256:'a'.repeat(64)},{
    check:async (input)=>{calls.push({platformId:input.platformId,mode:input.mode,only:input.only,stopOnFloorFailure:input.stopOnFloorFailure});return passingCheck(root,platformId,{coverageComplete:false});}
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].mode,'quick','an aligned platform is re-checked by affected cells, never by a full matrix');
  assert.equal(calls[0].only,null);
  assert.equal(calls[0].stopOnFloorFailure,true);
  assert.equal(state.anchorDigestSha256,'a'.repeat(64));
  assert.equal(state.firstCertification ?? null,null,'evidence that does not cover the inventory cannot become a first certification');
  assert.equal(state.status,'configured-pending','without a stored certification the record stays pending instead of claiming completion');
  assert.equal(state.writePerformed,true);
  assert.ok((state.steps || []).some((step)=>step.step==='post-alignment-check'),'the run leaves its own step behind');
  assert.equal((state.steps || []).some((step)=>step.step==='client-tool-loop'),false,'aligning a version is not a client verification');
});

test('a failing post-alignment check stops the record and keeps the failure readable',async(t)=>{
  const root=mkdtempSync(join(tmpdir(),'anchor-postcheck-fail-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const platformId=seedConfiguredPlatform(root);
  const state=await executePostAlignmentChecks({workspaceRoot:root,platformId},{
    check:async ()=>({platformId,stage:'check-failed',matrixPath:null,conformPath:null,counts:{pass:0,fail:1,expected:0,needsInput:0},issues:['调用检查有 1 条失败'],coverageComplete:false})
  });
  assert.equal(state.status,'failed');
  assert.equal(state.stoppedAt,'post-alignment-check');
  assert.match(state.error,/ONBOARDING_CHECK_FAILED/);
  const stored=readOnboardingState({workspaceRoot:root,platformId});
  assert.equal(stored.status,'failed');
  assert.equal(stored.stoppedAt,'post-alignment-check');
});
