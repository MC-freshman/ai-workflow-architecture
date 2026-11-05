import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRuntimeReleases} from './support/resources.mjs';
import {clientBinding} from '../src/domains/onboarding/onboarding-client.mjs';
import {environmentBinding} from '../src/domains/certification/binding.mjs';
import {buildOnboardingFinalizePlan,applyOnboardingFinalize} from '../src/domains/onboarding/onboarding-finalize.mjs';
import {readOnboardingState} from '../src/domains/onboarding/onboarding-state.mjs';

const PLATFORM='demo-platform';
const GOVERNANCE=['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md','.gitignore',`${PLATFORM}/bridge.json`];
const thrown=(fn)=>{try{fn();}catch(error){return error;}throw Error('expected the call to throw');};

// A workspace that has earned the "verified-awaiting-governance-git" state but whose governance
// texts are still uncommitted — the exact situation the finalize step exists for. No vendor
// client and no interpreter ever run: the binding is a hash of files on disk.
function finalizeFixture(t){
  const root=mkdtempSync(join(tmpdir(),'manager-finalize-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
  seedRuntimeReleases(root);
  put(`${PLATFORM}/bridge/${PLATFORM}-config.json`,{schema:'ai-platform-config/v1',platformId:PLATFORM,runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),commitIdentity:{name:'Fixture',email:'fixture@example.invalid'}});
  put(`${PLATFORM}/bridge/client-adapter.json`,{schema:'architecture-manager-client/v1',platformId:PLATFORM,kind:'cli',executable:'fixture-python.exe',args:[]});
  for(const path of GOVERNANCE)put(path,path.endsWith('.json')?{schema:'ai-platform-bridge/v1',platformId:PLATFORM}:`${path} baseline\n`);
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  git('add','--',...GOVERNANCE,`${PLATFORM}/bridge/${PLATFORM}-config.json`,`${PLATFORM}/bridge/client-adapter.json`);
  git('commit','-m','governance baseline');
  const binding=clientBinding(root,PLATFORM),environmentBindingSha256=environmentBinding(root,PLATFORM);
  const state={schema:'architecture-manager-onboarding/v1',platformId:PLATFORM,status:'verified-awaiting-governance-git',steps:[],...binding,environmentBindingSha256,firstCertification:{...binding,environmentBindingSha256,matrixPath:join(root,'matrix.json'),checkedAt:new Date().toISOString()}};
  const statePath=`${PLATFORM}/runtime/maintenance/manager-onboarding/state.json`;
  put(statePath,state);
  // The commit-worthy change: a governance text edited after the baseline commit.
  put('versions/更新日志.md','governance change awaiting commit\n');
  const auditRoot=join(root,'audit');
  return {root,auditRoot,state,statePath,put,git,head:()=>git('rev-parse','HEAD')};
}

test('finalize commits the governance texts and then marks the record complete',(t)=>{
  const f=finalizeFixture(t);
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  assert.equal(plan.target.requiresCommit,true);
  const before=f.head();
  const result=applyOnboardingFinalize(plan,{auditRoot:f.auditRoot});
  assert.equal(result.onboarding.status,'complete');
  assert.notEqual(f.head(),before,'the governance commit happened');
  assert.equal(f.git('status','--porcelain','--','versions/更新日志.md'),'','the change is committed, not left behind');
  assert.equal(readOnboardingState({workspaceRoot:f.root,platformId:PLATFORM}).status,'complete');
});
test('a record that cannot be marked refuses before any commit exists (D-157)',(t)=>{
  const f=finalizeFixture(t);
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  const before=f.head();
  // Break one binding hash after the plan was built: the plan payload is only the git plan, so
  // apply still reaches the state write — which is exactly what used to run after the commit.
  f.put(f.statePath,{...f.state,adapterSha256:'corrupt'.repeat(10)});
  const error=thrown(()=>applyOnboardingFinalize(plan,{auditRoot:f.auditRoot}));
  assert.match(error.message,/ONBOARDING_NOT_VERIFIED/);
  assert.doesNotMatch(error.message,/ONBOARDING_RECORD_INCOMPLETE/);
  assert.equal(f.head(),before,'no governance commit may be produced for an unmarkable record');
  assert.match(f.git('status','--porcelain','-z','--','versions/更新日志.md'),/更新日志/,'the change stays uncommitted');
  assert.equal(readOnboardingState({workspaceRoot:f.root,platformId:PLATFORM}).status,'verified-awaiting-governance-git');
});
// D-166 (fixed 2026-10-29): a rename inside the governance set now has a route — the destination
// replaces the departed source in the pending commit. The guard still fails closed on everything
// else: a destination that is not a governance text, and any unrelated staged file.
test('a governance text renamed inside the governance set is committed, closing D-166',(t)=>{
  const f=finalizeFixture(t);
  f.git('mv','--','versions/更新日志.md','versions/更新日志-2026.md');
  f.put('versions/更新日志-2026.md','renamed governance text\n');
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  assert.ok(plan.payload.gitPlan.target.paths.includes('versions/更新日志-2026.md'),'the destination enters the pending commit');
  assert.ok(!plan.payload.gitPlan.target.paths.includes('versions/更新日志.md'),'the departed source is not staged: git add cannot match it');
  assert.ok(plan.payload.gitPlan.target.renameSources.includes('versions/更新日志.md'),'but it reaches the commit line, so its deletion is recorded');
  const before=f.head();
  const result=applyOnboardingFinalize(plan,{auditRoot:f.auditRoot});
  assert.equal(result.onboarding.status,'complete');
  assert.notEqual(f.head(),before,'the rename is committed');
  assert.equal(f.git('ls-files','--','versions/更新日志.md').trim(),'','the departed source leaves the index');
  assert.match(f.git('-c','core.quotePath=false','ls-files','--','versions/更新日志-2026.md'),/更新日志-2026/,'the destination is tracked');
});
test('a rename whose destination is not a governance text is still refused',(t)=>{
  const f=finalizeFixture(t);
  f.git('mv','--','versions/更新日志.md','versions/更新日志.txt');
  f.put('versions/更新日志.txt','not a governance text\n');
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  assert.ok(!plan.payload.gitPlan.target.paths.includes('versions/更新日志.txt'),'an out-of-scope destination never enters the commit');
  const before=f.head();
  const error=thrown(()=>applyOnboardingFinalize(plan,{auditRoot:f.auditRoot}));
  assert.match(error.message,/GIT_UNRELATED_STAGED_FILES/);
  assert.equal(f.head(),before,'no commit for an out-of-scope rename');
});
test('an unrelated staged file is still refused once the rename route exists',(t)=>{
  const f=finalizeFixture(t);
  f.put('tool/unrelated.md','unrelated staged text\n');
  f.git('add','--','tool/unrelated.md');
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  const before=f.head();
  const error=thrown(()=>applyOnboardingFinalize(plan,{auditRoot:f.auditRoot}));
  assert.match(error.message,/GIT_UNRELATED_STAGED_FILES/);
  assert.equal(f.head(),before,'no commit while an unrelated file is staged');
});
test('a governance file that only the pending commit can make tracked is deferred, not refused',(t)=>{
  const f=finalizeFixture(t);
  const entry=`${PLATFORM}/bridge/entry-note.md`;
  f.put(entry,'new governance text\n');
  const plan=buildOnboardingFinalizePlan({workspaceRoot:f.root,platformId:PLATFORM});
  const tracked=(path)=>{try{return f.git('ls-files','--error-unmatch','--',path)===path;}catch{return false;}};
  assert.ok(plan.payload.gitPlan.target.paths.includes(entry),'the new text is part of the pending commit');
  assert.equal(tracked(entry),false,'it starts untracked: only the commit can make it tracked');
  const before=f.head();
  const result=applyOnboardingFinalize(plan,{auditRoot:f.auditRoot});
  assert.equal(result.onboarding.status,'complete');
  assert.notEqual(f.head(),before);
  assert.equal(tracked(entry),true,'the commit tracked it, as the preflight deferred');
});
