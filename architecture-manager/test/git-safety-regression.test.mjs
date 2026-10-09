import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {gitRaw,gitText} from '../src/infrastructure/git.mjs';
import {buildGitPlan,inspectGit,scanSensitivePaths} from '../src/git.mjs';
import {applyGitTransaction,verifyGitTransaction} from '../src/git-executor.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'am-git-regression-'));
  t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('am-git-regression-'));rmSync(root,{recursive:true,force:true});});
  gitText(root,['init','-b','main']);gitText(root,['config','user.name','Test']);gitText(root,['config','user.email','test@example.invalid']);
  writeFileSync(join(root,'selected.md'),'first\n');writeFileSync(join(root,'unrelated.md'),'first\n');
  gitText(root,['add','--','selected.md','unrelated.md']);gitText(root,['commit','-m','baseline']);
  return {root,auditRoot:join(root,'audit')};
}
test('generic GUI commit rejects unrelated staged content before changing the index',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'selected.md'),'selected\n');writeFileSync(join(f.root,'unrelated.md'),'unrelated\n');gitText(f.root,['add','--','unrelated.md']);
  const plan=buildGitPlan({workspaceRoot:f.root,action:'commit',paths:['selected.md'],message:'selected only'});
  const before=gitRaw(f.root,['diff','--cached','--binary']);
  assert.throws(()=>applyGitTransaction({...f,plan}),/GIT_UNRELATED_STAGED_FILES/);
  assert.equal(gitRaw(f.root,['diff','--cached','--binary']),before);
  assert.equal(gitText(f.root,['rev-parse','HEAD']),plan.target.headBefore);
});
test('NUL status preserves a leading space, Chinese/space/newline paths and rename source',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'selected.md'),'modified\n');writeFileSync(join(f.root,'中文 空格.md'),'new\n');
  gitText(f.root,['mv','unrelated.md','重命名 文档.md']);
  const status=inspectGit(f.root).status;
  assert.deepEqual(status.find(row=>row.path==='selected.md'),{code:' M',path:'selected.md'});
  assert.ok(status.some(row=>row.path==='中文 空格.md'));
  assert.equal(status.find(row=>row.path==='重命名 文档.md').originalPath,'unrelated.md');
});
test('directory and binary scanning finds both the fake secret and software body',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'payload'));writeFileSync(join(f.root,'payload','.env'),'secret=REVIEW_SENTINEL_NOT_A_CREDENTIAL');writeFileSync(join(f.root,'payload','dummy.exe'),Buffer.from([77,90,0,1]));
  const scan=scanSensitivePaths(f.root,['payload']);
  assert.equal(scan.clean,false);assert.ok(scan.findings.some(row=>row.path==='payload/.env'));assert.ok(scan.findings.some(row=>row.path==='payload/dummy.exe' && row.kind==='software-body-or-binary'));
});
test('option-shaped or absent remotes are rejected at preview and execution',t=>{
  const f=fixture(t);for(const remote of ['--force','--mirror','missing']) assert.throws(()=>buildGitPlan({workspaceRoot:f.root,action:'push',remote}),/INVALID_REMOTE/);
  gitText(f.root,['remote','add','origin',join(f.root,'missing.git')]);
  const plan=buildGitPlan({workspaceRoot:f.root,action:'push',remote:'origin'});plan.steps[0].remote='--force';
  assert.throws(()=>applyGitTransaction({...f,plan}),/INVALID_REMOTE/);
});
test('snapshot needs a real restore and rejects corruption and extra payload',t=>{
  const f=fixture(t),plan=buildGitPlan({workspaceRoot:f.root,action:'backup',backupName:'snapshot'});
  applyGitTransaction({...f,plan});assert.equal(verifyGitTransaction({plan}).ok,true);
  const destination=join(f.root,plan.target.destination);
  const original=readFileSync(join(destination,'repo.zip'));
  writeFileSync(join(destination,'repo.zip'),'corrupt');assert.equal(verifyGitTransaction({plan}).ok,false);
  writeFileSync(join(destination,'repo.zip'),original);writeFileSync(join(destination,'unlisted.md'),'extra');assert.equal(verifyGitTransaction({plan}).ok,false);
});
test('history backup restores repository history, staged changes and untracked working files',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'review-client'));
  writeFileSync(join(f.root,'selected.md'),'staged\n');gitText(f.root,['add','--','selected.md']);writeFileSync(join(f.root,'selected.md'),'working\n');writeFileSync(join(f.root,'untracked.md'),'private workspace\n');
  const plan=buildGitPlan({workspaceRoot:f.root,action:'backup',backupMode:'history',platformId:'review-client',backupName:'history'});
  const before=gitRaw(f.root,['diff','--cached','--binary']);
  applyGitTransaction({...f,plan});assert.equal(verifyGitTransaction({plan}).ok,true);
  const manifest=JSON.parse(readFileSync(join(f.root,plan.target.destination,'MANIFEST.json'),'utf8'));
  assert.equal(manifest.restoreVerified,true);assert.equal(manifest.containsUncommitted,true);assert.ok(manifest.changes.some(row=>row.path==='untracked.md'));
  assert.equal(gitRaw(f.root,['diff','--cached','--binary']),before);assert.equal(readFileSync(join(f.root,'selected.md'),'utf8'),'working\n');
});
