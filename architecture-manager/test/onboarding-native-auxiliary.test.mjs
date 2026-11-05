import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {seedRuntimeReleases} from './support/resources.mjs';
import {buildAutomaticOnboardingPlan,verifyAutomaticOnboarding} from '../src/domains/onboarding/onboarding-auto.mjs';
import {ONBOARDING_STEP_SEQUENCE} from '../src/domains/platforms/adoption-completion.mjs';

function fixture(t){
  const root=fs.mkdtempSync(join(tmpdir(),'onboarding-aux-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));seedRuntimeReleases(root);
  const put=(file,value)=>{fs.mkdirSync(dirname(join(root,file)),{recursive:true});fs.writeFileSync(join(root,file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']])put(repo+'/registry.json',{[key]:[]});
  for(const name of ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md'])put(name,'# Fixture governance\n');
  put('.gitignore','*/runtime/\ninbox/\naudit/\n');const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git('init');git('config','core.autocrlf','false');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','rollback anchor');return {root,put,git,id:'local-client'};
}

test('the plan validates nativeVerification and records it in the frozen inputs',t=>{
  const f=fixture(t);
  const auxiliary=buildAutomaticOnboardingPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,deferred:['environment','software','git'],fields:{displayName:'Partial'},nativeVerification:'auxiliary'});
  assert.equal(auxiliary.target.inputs.nativeVerification,'auxiliary');
  assert.throws(()=>buildAutomaticOnboardingPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,nativeVerification:'skip'}),/ONBOARDING_NATIVE_VERIFICATION_INVALID/);
  const required=buildAutomaticOnboardingPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,deferred:['environment','software','git'],fields:{displayName:'Partial'}});
  assert.equal(required.target.inputs.nativeVerification,'auxiliary','owner ruling 2026-10-14: auxiliary is the default for every platform (usability first, native receipt auxiliary)');
});

// Owner ruling 2026-10-28: full adoption means every onboarding step ran through,
// so the journal has to carry the whole sequence for the auxiliary ruling to be
// exercised -- a journal holding only the native step is incomplete on its face.
function journalSteps(nativeStatus){
  return ONBOARDING_STEP_SEQUENCE.map(name=>{
    if(name==='l1-dual-cell')return {step:name,status:'passed',result:{schema:'architecture-manager-l1-check/v1',status:'passed',cells:[{kind:'workflow',id:'alpha-flow',version:'1.0.0',status:'PASS'},{kind:'agent',id:'beta-agent',version:'2.0.0',status:'PASS'}],matrixPath:'m.json',matrixSha256:'a'.repeat(64),checkedAt:'2026-10-28T07:00:00.000Z'}};
    if(name==='certification')return {step:name,status:'passed',result:{coverageComplete:true,checkedAt:'2026-10-28T07:00:00.000Z'}};
    if(name==='native')return {step:name,status:nativeStatus,reason:nativeStatus==='auxiliary'?'D-152 vendor defect; auxiliary per owner ruling':'not verified'};
    return {step:name,status:'passed',result:{}};
  });
}

test('owner ruling 2026-10-13: with every step run through, auxiliary native does not gate architectureComplete',t=>{
  const f=fixture(t);
  const plan=buildAutomaticOnboardingPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,deferred:['environment','software','git'],fields:{displayName:'Partial'},nativeVerification:'auxiliary'});
  const journal=f.id+'/runtime/maintenance/manager-onboarding/automatic.json';
  f.put(journal,{schema:'architecture-manager-auto/v1',platformId:f.id,planId:plan.planId,lastAppliedPlanId:plan.planId,status:'complete',steps:journalSteps('auxiliary'),inputs:plan.target.inputs,inputsSha256:plan.target.inputsSha256,pending:[],auxiliary:[{step:'native',reason:'D-152 vendor defect; auxiliary per owner ruling'}],native:{nativeVendorClientVerified:false,auxiliary:true,reason:'D-152'},pendingSoftware:[],finalTargets:{},startedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
  const verified=verifyAutomaticOnboarding(plan);
  assert.equal(verified.ok,true);
  assert.equal(verified.architectureComplete,true,'auxiliary native must not gate architectureComplete');
  assert.equal(verified.native.nativeVendorClientVerified,false,'the verification itself stays honestly unverified');
  assert.equal(verified.auxiliary.length,1);
  // Required-mode semantics: the native step that did not run through does gate.
  f.put(journal,{schema:'architecture-manager-auto/v1',platformId:f.id,planId:plan.planId,lastAppliedPlanId:plan.planId,status:'complete',steps:journalSteps('pending'),inputs:plan.target.inputs,inputsSha256:plan.target.inputsSha256,pending:[{step:'native',reason:'not verified'}],auxiliary:[],native:{nativeVendorClientVerified:false},pendingSoftware:[],finalTargets:{},startedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
  assert.equal(verifyAutomaticOnboarding(plan).architectureComplete,false);
  // 2026-10-28 ruling: a journal that only ever walked the native step is not
  // full adoption, even when that step is auxiliary.
  f.put(journal,{schema:'architecture-manager-auto/v1',platformId:f.id,planId:plan.planId,lastAppliedPlanId:plan.planId,status:'complete',steps:[{step:'native',status:'auxiliary',reason:'D-152 vendor defect; auxiliary per owner ruling'}],inputs:plan.target.inputs,inputsSha256:plan.target.inputsSha256,pending:[],auxiliary:[{step:'native',reason:'D-152'}],native:{nativeVendorClientVerified:false,auxiliary:true},pendingSoftware:[],finalTargets:{},startedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
  assert.equal(verifyAutomaticOnboarding(plan).architectureComplete,false,'early journals that never ran the current step sequence are not silently mapped to complete');
});
