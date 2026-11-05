import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,readFileSync,existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/core/hash.mjs';
import {seedRelease,seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions/router.mjs';
import {buildAnchorMaterialisationPlan,buildAnchorAlignmentPlan} from '../src/domains/certification/anchor-plans.mjs';
import {anchorAlignment} from '../src/domains/certification/anchor.mjs';

// The UI never calls a plan's apply function directly: it goes through the transaction dispatcher
// that also owns the audit trail. This test drives exactly that path for both anchor kinds.
const auditRoot=t=>{const base=mkdtempSync(join(tmpdir(),'anchor-dispatch-audit-'));t.after(()=>rmSync(base,{recursive:true,force:true}));return join(base,'audit');};

function copyDirectory(from,to){for(const entry of readdirSync(from,{withFileTypes:true})){const source=join(from,entry.name),target=join(to,entry.name);if(entry.isDirectory()){mkdirSync(target,{recursive:true});copyDirectory(source,target);}else if(entry.isFile())writeFileSync(target,readFileSync(source));}}

function seedWorkspace() {
  const root=mkdtempSync(join(tmpdir(),'anchor-dispatch-'));
  seedRuntimeReleases(root);
  // The contracts axis of the anchor comes from the shared pointer, so the fixture states that
  // pointer explicitly instead of relying on whatever the base fixture happens to pin.
  seedRelease(root,'tool','runtime-contracts','1.5.2',{'manifest.json':{schema:'ai-contract-package/v1',id:'runtime-contracts',version:'1.5.2',entry:'contracts/runtime/validate_contracts.py'},'contracts/runtime/validate_contracts.py':'# fixture only\n'});
  seedPointer(root,'tool','runtime-contracts','1.5.2');
  seedRelease(root,'tool','repo-lint','0.6.5',{'scripts/repo_lint.py':'# fixture only\n'});
  copyDirectory('E:/ai/tool/wf-runner/versions/0.12.2',join(root,'tool/wf-runner/versions/0.12.2'));
  seedRelease(root,'tool','architecture-ops','1.5.2',{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version:'1.5.2',interface:{invocationSmoke:'ai-invocation-smoke/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedRelease(root,'tool','platform-conformance','1.5.1',{'manifest.json':{schema:'ai-governance-tool/v1',id:'platform-conformance',version:'1.5.1'},'conformance/conform.py':'# fixture only\n'});
  seedPointer(root,'tool','platform-conformance','1.5.1');
  const write=(relative,value)=>{mkdirSync(dirname(join(root,relative)),{recursive:true});writeFileSync(join(root,relative),JSON.stringify(value,null,2)+'\n');};
  write('lagging/bridge/lagging-config.json',{platform:'lagging',platformRoot:join(root,'lagging'),toolRoot:join(root,'tool'),agentRoot:join(root,'agent'),softwareRoot:join(root,'software'),runsRoot:join(root,'lagging/runtime/runs'),runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),bridge:join(root,'lagging/bridge.json'),projectWriteRoots:['E:/ai/lagging/workspaces']});  write('lagging/bridge.json',{schema:'ai-platform-bridge/v1.1',platform:'lagging',displayName:'lagging',runtimeRoot:join(root,'lagging/runtime'),modes:['workflow','agent-workflow'],defaults:{workflowVersions:{'repo-lint':'0.6.3'}},runner:{enabled:true,version:'0.12.0',config:join(root,'lagging/bridge/lagging-config.json')}});
  return root;
}

test('both anchor plan kinds apply and verify through the transaction dispatcher the UI uses',(t)=>{
  const root=seedWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  const audit=auditRoot(t);

  // The alignment plan must refuse while no anchor is on disk: there is nothing to align to.
  assert.throws(()=>buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'lagging'}),/ANCHOR_NOT_MATERIALISED/);

  const materialise=buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'});
  assert.equal(materialise.steps[0].operation,'create-anchor');
  assert.equal(materialise.payload.files[0].beforeSha256,null,'nothing exists yet, so the plan carries no baseline');
  const materialised=applyPlan({plan:materialise,auditRoot:audit});
  assert.equal(materialised.status,'applied');
  assert.equal(verifyPlanTarget({plan:materialise}).ok,true);
  assert.equal(existsSync(join(root,'versions/anchor.json')),true);
  // Re-applying the same plan is answered as already applied, and writes nothing further.
  const afterFirst=readFileSync(join(root,'versions/anchor.json'),'utf8');
  const again=applyPlan({plan:materialise,auditRoot:audit});
  assert.equal(again.status,'already-applied');
  assert.equal(again.writePerformed,false);
  assert.equal(readFileSync(join(root,'versions/anchor.json'),'utf8'),afterFirst);

  const before=readFileSync(join(root,'lagging/bridge/lagging-config.json'),'utf8');
  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'lagging',now:'2026-10-06T12:05:00.000Z'});
  assert.equal(plan.steps.length,2);
  assert.equal(plan.steps.every((step)=>step.checkpoint===true),true);

  const applied=applyPlan({plan,auditRoot:audit});
  assert.equal(applied.status,'applied',`expected a first write, got ${applied.status}; files=${JSON.stringify(plan.payload.files.map((file)=>({path:file.path,before:file.beforeSha256,next:file.newSha256})))}; exists=${existsSync(join(root,'versions/anchor.json'))}`);
  assert.equal(applied.writePerformed,true);
  const verification=verifyPlanTarget({plan});
  assert.equal(verification.ok,true,`verification failed: files=${JSON.stringify(verification.files)} differences=${JSON.stringify(verification.differences)}`);
  assert.deepEqual(verification.differences,[]);

  const config=JSON.parse(readFileSync(join(root,'lagging/bridge/lagging-config.json'),'utf8'));
  assert.equal(config.runner.endsWith('0.12.2'),true);
  assert.equal(config.contracts.endsWith('1.5.2'),true);
  assert.equal(config.scannerRelease.endsWith('0.6.5'),true);
  assert.equal(config.invocationMatrixRelease.endsWith('1.5.2'),true);
  assert.deepEqual(config.projectWriteRoots,['E:/ai/lagging/workspaces']);
  const bridge=JSON.parse(readFileSync(join(root,'lagging/bridge.json'),'utf8'));
  assert.equal(bridge.runner.version,'0.12.2');
  assert.equal(bridge.defaults.workflowVersions['repo-lint'],'0.6.5');
  assert.notEqual(readFileSync(join(root,'lagging/bridge/lagging-config.json'),'utf8'),before);
  assert.equal(anchorAlignment({workspaceRoot:root,platformId:'lagging'}).aligned,true);

  // The audit trail records both transactions, which is what makes the change readable afterwards.
  const events=readFileSync(join(audit,'events.jsonl'),'utf8').trim().split('\n').map((line)=>JSON.parse(line));
  const domains=events.filter(event=>event.phase==='domain');
  assert.deepEqual(domains.map((event)=>event.action),['anchor-generation','platform-anchor-alignment']);
  assert.equal(domains.every((event)=>event.status==='applied' && event.writePerformed===true),true);
  const operations=events.filter(event=>event.phase==='operation');
  assert.deepEqual(operations.map(event=>event.status),['started','completed','started','already-applied','started','completed']);
  for(let index=0;index<operations.length;index+=2)assert.equal(operations[index].operationId,operations[index+1].operationId);
  assert.equal(new Set(operations.map(event=>event.operationId)).size,3);
  assert(domains.every(event=>operations.some(operation=>operation.operationId===event.operationId)));
});

test('an alignment plan refuses to write when the platform changed after the plan was built',(t)=>{
  const root=seedWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  const audit=auditRoot(t);
  applyPlan({plan:buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'}),auditRoot:audit});
  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'lagging'});
  // Somebody edits the platform configuration between preview and confirmation.
  const configPath=join(root,'lagging/bridge/lagging-config.json');
  const document=JSON.parse(readFileSync(configPath,'utf8'));
  document.interpreters={'.py':'changed-underneath.exe'};
  writeFileSync(configPath,JSON.stringify(document,null,2)+'\n');
  assert.throws(()=>applyPlan({plan,auditRoot:audit}),/INTEGRATION_BASELINE_MISMATCH|PLAN_PAYLOAD_MISMATCH/,'a stale alignment plan must not write');
  const after=JSON.parse(readFileSync(configPath,'utf8'));
  assert.equal(after.runner.endsWith('0.12.0'),true,'the refused plan left the platform exactly as it was');
  assert.deepEqual(after.interpreters,{'.py':'changed-underneath.exe'},'the foreign edit survives untouched');
});
