import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {seedRuntimeReleases} from './support/resources.mjs';
import {buildAutomaticOnboardingPlan,applyAutomaticOnboarding,verifyAutomaticOnboarding} from '../src/domains/onboarding/onboarding-auto.mjs';
import {readOnboardingConfig} from '../src/domains/onboarding/onboarding-config.mjs';
import {readOnboardingState} from '../src/domains/onboarding/onboarding-state.mjs';
import {onboardingResumePreview,assertResumePreview,archiveAutomaticJournal,reconcileAutomaticJournal,onboardingDeferrals,inputInvalidations} from '../src/domains/platforms/onboarding-resume.mjs';
import {sha256} from '../src/core/hash.mjs';

function fixture(t){
  const root=fs.mkdtempSync(join(tmpdir(),'onboarding-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));seedRuntimeReleases(root);
  const put=(file,value)=>{fs.mkdirSync(dirname(join(root,file)),{recursive:true});fs.writeFileSync(join(root,file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']])put(repo+'/registry.json',{[key]:[]});
  for(const name of ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md'])put(name,'# Fixture governance\n');
  put('.gitignore','*/runtime/\ninbox/\naudit/\n');const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git('init');git('config','core.autocrlf','false');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','rollback anchor');return {root,put,git,id:'local-client',auditRoot:join(root,'audit')};
}
test('real automatic partial setup saves configuration/Git without installing or certifying deferred modules',async t=>{
  const f=fixture(t),input={workspaceRoot:f.root,platformId:f.id,confirmed:true,deferred:['environment','software'],fields:{displayName:'Partial'}};
  const plan=buildAutomaticOnboardingPlan(input),result=await applyAutomaticOnboarding(plan,{auditRoot:f.auditRoot});
  assert.equal(result.status,'configured-pending',JSON.stringify(result));assert(verifyAutomaticOnboarding(plan).ok);assert.equal(verifyAutomaticOnboarding(plan).architectureComplete,false);assert(!result.steps.some(row=>['environment','capabilities','client','certification'].includes(row.step) && row.status==='passed'));
  const state=readOnboardingState({workspaceRoot:f.root,platformId:f.id});assert.equal(state.status,'configured-pending');assert.equal(state.git.scope,'configuration-only');assert(!fs.existsSync(join(f.root,f.id,'runtime/manager-check')));assert(!fs.existsSync(join(f.root,f.id,'runtime/manager-environments')));assert(f.git('log','-1','--format=%s').includes('graphical onboarding'));
  assert.equal((await applyAutomaticOnboarding(plan,{auditRoot:f.auditRoot})).writePerformed,false,'same approval does not execute twice');
  const beforeConfiguration=result.steps.find(row=>row.step==='configuration').completedAt;
  const next=buildAutomaticOnboardingPlan({...input,deferred:['environment']});const resumed=await applyAutomaticOnboarding(next,{auditRoot:f.auditRoot});
  assert.equal(resumed.planId,result.planId);assert.equal(resumed.steps.find(row=>row.step==='configuration').completedAt,beforeConfiguration,'unchanged configuration is reused when the deferral selection changes');
  assert(!resumed.pending.some(row=>row.step==='software'));assert(resumed.pending.some(row=>row.step==='environment'));assert.equal(resumed.status,'configured-pending');
});
test('independent client/provider changes require explicit reconciliation, archive old bytes, and reject another drift',async t=>{
  const f=fixture(t),input={workspaceRoot:f.root,platformId:f.id,confirmed:true,deferred:['environment','software','git'],fields:{displayName:'Partial'}};
  const plan=buildAutomaticOnboardingPlan(input),first=await applyAutomaticOnboarding(plan,{auditRoot:f.auditRoot});assert.equal(first.status,'configured-pending');
  const journalFile=join(f.root,f.id,'runtime/maintenance/manager-onboarding/automatic.json'),clientFile=join(f.root,f.id,'bridge/client-adapter.json'),old=fs.readFileSync(journalFile);
  const client=JSON.parse(fs.readFileSync(clientFile));client.userComment='GUI client configuration';fs.writeFileSync(clientFile,JSON.stringify(client,null,2)+'\n');
  const strict=buildAutomaticOnboardingPlan(input);assert.equal(strict.target.recovery.changes.length,1);await assert.rejects(applyAutomaticOnboarding(strict,{auditRoot:f.auditRoot}),/ONBOARDING_RESUME_DRIFT/);assert.equal(sha256(fs.readFileSync(journalFile)),sha256(old),'refusal does not replace the original journal');
  const reconcile=buildAutomaticOnboardingPlan({...input,resumeMode:'reconcile'});assert(reconcile.target.recovery.invalidatedSteps.includes('client'));assert(!reconcile.target.recovery.invalidatedSteps.includes('environment'));
  const result=await applyAutomaticOnboarding(reconcile,{auditRoot:f.auditRoot});assert.equal(result.planId,first.planId);assert.equal(result.status,'configured-pending');assert.equal(result.reconciliations.length,1);const snapshot=result.history.find(row=>row.sha256===sha256(old));assert(snapshot);assert.equal(sha256(fs.readFileSync(snapshot.path)),snapshot.sha256);assert(fs.existsSync(snapshot.path+'.SHA256SUMS'));
  const stale=buildAutomaticOnboardingPlan({...input,resumeMode:'reconcile'});fs.writeFileSync(clientFile,'{}');await assert.rejects(applyAutomaticOnboarding(stale,{auditRoot:f.auditRoot}),/ONBOARDING_RESUME_PREVIEW_CHANGED/);
});
test('software mutation invalidates its probe/certification, version changes need restart, and no arbitrary skip is accepted',t=>{
  const f=fixture(t),path=f.id+'/bridge/software-gateway-config.json',journal=f.id+'/runtime/maintenance/manager-onboarding/automatic.json';f.put(path,{bodies:{}});f.put(journal,{schema:'architecture-manager-auto/v1',platformId:f.id,planId:'original',steps:[{step:'environment',status:'passed'},{step:'providers',status:'passed'},{step:'certification',status:'passed'}],inputs:{fields:{runnerVersion:'1.0.0',contractsVersion:'1.0.0',scannerVersion:'1.0.0'}},finalTargets:{[path]:sha256(fs.readFileSync(join(f.root,path)))}});f.put(path,{bodies:{sample:'chosen-program'}});
  const versions={runner:{version:'1.0.1'},contracts:{version:'1.0.0'},scanner:{version:'1.0.0'}},preview=onboardingResumePreview(f.root,f.id,'reconcile',versions);assert(preview.invalidatedSteps.includes('providers'));assert(!preview.invalidatedSteps.includes('environment'));assert.throws(()=>assertResumePreview(f.root,f.id,preview,versions),/VERSION_CHANGED/);
  const old=JSON.parse(fs.readFileSync(join(f.root,journal))),updated=reconcileAutomaticJournal(old,preview);assert.deepEqual(updated.steps.map(row=>row.step),['environment']);assert.throws(()=>onboardingDeferrals(['configuration']),/DEFERRAL_INVALID/);assert.match(onboardingDeferrals(['software']).certification,/软件绑定/);
  assert(archiveAutomaticJournal(join(f.root,journal)).sha256);assert(readOnboardingConfig);
  const changedInputs=inputInvalidations({inputs:{fields:{clientExecutable:'old'}},versions},{fields:{clientExecutable:'new'}},versions);
  assert(changedInputs.includes('client'));assert(!changedInputs.includes('environment'),'client-only changes do not repeat the sealed installation');
});
