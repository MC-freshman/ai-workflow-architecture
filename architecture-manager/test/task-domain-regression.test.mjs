import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runDomainTask,cancelDomainTask} from '../src/infrastructure/tasks.mjs';
import {buildGitPlan} from '../src/git.mjs';
import {buildWorkspaceClonePlan} from '../src/workspace-bootstrap.mjs';
function fixture(t) {const root=mkdtempSync(join(tmpdir(),'manager-domain-task-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-domain-task-'));rmSync(root,{recursive:true,force:true});});return root;}
function git(root,...args) {return execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
function seed(root) {git(root,'init');git(root,'config','user.name','fixture');git(root,'config','user.email','fixture@example.invalid');git(root,'config','core.autocrlf','false');writeFileSync(join(root,'README.md'),'source\n');git(root,'add','--','README.md');git(root,'commit','-m','baseline');}
test('registered Python worker finishes a Git atomic transaction before honoring cancellation', {skip:!process.env.ARCHITECTURE_MANAGER_TEST_PYTHON},async t=>{
  const root=fixture(t);seed(root);mkdirSync(join(root,'codex/bridge'),{recursive:true});writeFileSync(join(root,'codex/bridge/runner-config.json'),JSON.stringify({platform:'codex',interpreters:{'.py':process.env.ARCHITECTURE_MANAGER_TEST_PYTHON}}));writeFileSync(join(root,'README.md'),'new bytes\n');
  const plan=buildGitPlan({workspaceRoot:root,action:'commit',message:'owned update',paths:['README.md']});
  let cancelled=false;const result=await runDomainTask({method:'applyPlan',args:[{plan,auditRoot:join(root,'codex/runtime/audit')}],workspaceRoot:root,workspaceSession:'one',onProgress:row=>{if(row.atomicStep && !cancelled) {cancelled=cancelDomainTask(row);}}});
  assert.equal(cancelled,true);assert.equal(result.status,'applied');assert.equal(result.stoppedAfterCompletion,true);assert.equal(git(root,'show','HEAD:README.md'),'new bytes');assert.equal(git(root,'diff','--cached'),'');
});
test('worker clone works without Python and publishes only a verified byte-preserving checkout', {skip:process.platform!=='win32'},async t=>{
  const parent=fixture(t),root=join(parent,'source'),destination=join(parent,'new-workspace');mkdirSync(root);seed(root);
  for(const dir of ['versions','tool','agent','software']) {mkdirSync(join(root,dir));writeFileSync(join(root,dir,'.keep'),'');}writeFileSync(join(root,'AGENTS.md'),'# fixture\n');git(root,'add','--','.');git(root,'commit','-m','architecture');
  const plan=buildWorkspaceClonePlan({remote:root,destination,confirmed:true});
  const result=await runDomainTask({method:'applyWorkspaceClone',args:[{plan},{auditRoot:join(parent,'audit')}],workspaceRoot:destination});
  assert.equal(result.status,'applied');assert.equal(result.bytePreservingCheckout,true);assert.equal(git(destination,'status','--porcelain'),'');assert.equal(readFileSync(join(destination,'README.md'),'utf8'),'source\n');
});
test('worker document subprocess uses Node mode and true cancellation cleans up its process tree', {skip:process.platform!=='win32'},async t=>{
  const root=fixture(t),site=join(root,'docs-site');mkdirSync(join(site,'scripts'),{recursive:true});writeFileSync(join(site,'package.json'),'{}');
  writeFileSync(join(site,'scripts/build.mjs'),"import fs from 'node:fs';if(process.env.ELECTRON_RUN_AS_NODE!=='1') throw Error('not Node mode');setInterval(()=>fs.writeFileSync('heartbeat',Date.now().toString()),60);");
  let stopped=false;const task=runDomainTask({method:'buildDocsSite',args:[root],workspaceRoot:root,onProgress:row=>{if(row.cancelEvent && !stopped) {stopped=true;const timer=setInterval(()=>{if(existsSync(join(site,'heartbeat'))) {clearInterval(timer);cancelDomainTask(row);}},50);timer.unref();}}});
  const result=await task;assert.equal(stopped,true);assert.equal(result.ok,false);assert.equal(result.stoppedAfterCompletion,true);
  const heartbeat=join(site,'heartbeat');assert.ok(existsSync(heartbeat));const before=readFileSync(heartbeat,'utf8');await new Promise(resolve=>setTimeout(resolve,200));assert.equal(readFileSync(heartbeat,'utf8'),before);
});
