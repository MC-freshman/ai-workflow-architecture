import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {join} from 'node:path';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {discoverManagementNode,managementNodeCandidates,managementRuntimePlan,installManagementRuntime} from '../src/domains/platforms/management-runtime.mjs';

const ELECTRON_EXEC = 'Architecture Manager.exe';
// Discovery only accepts a node that lives outside the workspace root or inside the platform's
// own directory, so fixtures for "installed on this machine" live in a sibling temp root.
function workspace(t){
  const root=mkdtempSync(join(tmpdir(),'manager-node-ws-'));
  const outside=mkdtempSync(join(tmpdir(),'manager-node-ext-'));
  t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
  return {root,outside};
}
function fakeNode(base,name,bytes='fake-node-a'){
  const directory=join(base,name);mkdirSync(directory,{recursive:true});
  const file=join(directory,'node.exe');writeFileSync(file,bytes);
  return {directory,file};
}
function electronExec(base){
  const directory=join(base,'app');mkdirSync(directory,{recursive:true});
  const file=join(directory,ELECTRON_EXEC);writeFileSync(file,'fake electron host');
  return file;
}
const ok=(version='v24.18.0')=>({status:0,stdout:version});
const thrown=(fn)=>{try{fn();}catch(error){return error;}throw Error('expected the call to throw');};

test('a Node that exists but cannot launch is reported as NODE_SPAWN_FAILED instead of a missing install',(t)=>{
  const {root,outside}=workspace(t);
  const first=fakeNode(outside,'first'),second=fakeNode(outside,'second','fake-node-b');
  const base={root,platformId:'demo',env:{PATH:`${first.directory};${second.directory}`},execPath:electronExec(outside),resolver:()=>[]};
  const probe=candidate=>candidate===first.file?{error:{code:'EBUSY'},status:null,stderr:''}:ok();
  const chosen=discoverManagementNode({...base,probe});
  assert.equal(chosen.source,second.file,'a later healthy candidate still wins');
  assert.equal(chosen.attempts[0].outcome,'launch-failed');
  assert.equal(chosen.attempts[0].errorCode,'EBUSY');

  const error=thrown(()=>discoverManagementNode({...base,probe:()=>({error:{code:'EBUSY'},status:null,stderr:'resource busy'})}));
  assert.match(error.message,/^NODE_SPAWN_FAILED:/);
  assert.match(error.message,/errorCode=EBUSY/);
  assert.match(error.message,/candidate=.*first[\\/]node\.exe/);
  assert.doesNotMatch(error.message,/MANAGEMENT_NODE_REQUIRED/);
});
test('a non-zero launch exit is a launch failure too and carries exit code and stderr',(t)=>{
  const {root,outside}=workspace(t),only=fakeNode(outside,'only');
  const error=thrown(()=>discoverManagementNode({root,platformId:'demo',env:{PATH:only.directory},execPath:electronExec(outside),resolver:()=>[],probe:()=>({status:1,stdout:'',stderr:'permission denied'})}));
  assert.match(error.message,/^NODE_SPAWN_FAILED:/);
  assert.match(error.message,/exitCode=1/);
  assert.match(error.message,/permission denied/);
});
test('no Node anywhere reports NODE_NOT_FOUND with the searched outcome breakdown',(t)=>{
  const {root,outside}=workspace(t);
  const error=thrown(()=>discoverManagementNode({root,platformId:'demo',env:{PATH:'',ProgramFiles:join(outside,'missing-pf'),LOCALAPPDATA:join(outside,'missing-lad')},execPath:electronExec(outside),resolver:()=>[],probe:()=>ok()}));
  assert.match(error.message,/^NODE_NOT_FOUND:/);
  assert.match(error.message,/outcomes=missing=/);
});
test('multiple candidates are probed in order: an unsupported version is skipped, not fatal',(t)=>{
  const {root,outside}=workspace(t);
  const old=fakeNode(outside,'old'),fresh=fakeNode(outside,'fresh','fake-node-b');
  const probe=candidate=>candidate===old.file?{status:0,stdout:'v16.20.0'}:ok('v22.22.2');
  const chosen=discoverManagementNode({root,platformId:'demo',env:{PATH:`${old.directory};${fresh.directory}`},execPath:electronExec(outside),resolver:()=>[],probe});
  assert.equal(chosen.source,fresh.file);
  assert.equal(chosen.attempts[0].outcome,'version-unsupported');
  assert.equal(chosen.attempts[0].version,'v16.20.0');

  const error=thrown(()=>discoverManagementNode({root,platformId:'demo',env:{PATH:old.directory},execPath:electronExec(outside),resolver:()=>[],probe:()=>({status:0,stdout:'v16.20.0'})}));
  assert.match(error.message,/^NODE_VERSION_UNSUPPORTED:/);
  assert.match(error.message,/minimum=v18/);
});
test('the packaged Electron executable is never a candidate; a real node execPath leads',(t)=>{
  const {root,outside}=workspace(t);
  const host=electronExec(outside),node=fakeNode(outside,'dev');
  const target=join(root,'demo','runtime','manager-node','node.exe');
  const electronForm=managementNodeCandidates({env:{PATH:node.directory,ProgramFiles:join(outside,'pf')},execPath:host,resolver:()=>[],target});
  assert(!electronForm.includes(host),'electron host must not be probed as node');
  assert.equal(electronForm[0],node.file);
  assert.ok(electronForm.some(candidate=>candidate===join(outside,'pf','nodejs','node.exe')),'installed-node fallback folders are searched');
  const devForm=managementNodeCandidates({env:{PATH:''},execPath:node.file,resolver:()=>[]});
  assert.equal(devForm[0],node.file,'dev mode keeps process.execPath first');
  assert.deepEqual(managementNodeCandidates({env:{PATH:`${node.directory};${node.directory}`},execPath:node.file,resolver:()=>[],target}),[node.file,target],'duplicate candidates collapse and the installed platform runtime stays last');
});
test('plan keeps its payload shape and install reuses the same discovered source without a second discovery',(t)=>{
  const {root,outside}=workspace(t);
  const node=fakeNode(outside,'a'),other=fakeNode(outside,'b','different-bytes');
  const options={env:{PATH:node.directory},execPath:electronExec(outside),resolver:()=>[],probe:()=>ok()};
  const plan=managementRuntimePlan(root,'demo',options);
  assert.equal(plan.source,node.file);
  assert.deepEqual(Object.keys(plan).sort(),['beforeSha256','bytes','sha256','source','target']);
  assert.equal(plan.target,join(fs.realpathSync(root),'demo','runtime','manager-node','node.exe'));
  assert.equal(plan.beforeSha256,null);
  assert.throws(()=>installManagementRuntime({workspaceRoot:root,target:{platformId:'demo'},payload:{managementRuntime:{...plan,source:other.file}}}),/MANAGEMENT_RUNTIME_DRIFT/,'install never re-discovers: a swapped source is drift, not a silent re-pick');
});
test('a candidate inside the workspace but outside this platform stays out of scope, not a launch failure',(t)=>{
  const {root}=workspace(t),foreign=fakeNode(root,'other-platform');
  const error=thrown(()=>discoverManagementNode({root,platformId:'demo',env:{PATH:foreign.directory},execPath:electronExec(root),resolver:()=>[],probe:()=>ok()}));
  assert.match(error.message,/^NODE_NOT_FOUND:/);
  assert.match(error.message,/out-of-scope=/);
});
