import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRelease,seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {readAnchorReport,listAnchorPlatforms} from '../src/domains/certification/anchor-report.mjs';
import {buildAnchorMaterialisationPlan,applyAnchorMaterialisation} from '../src/domains/certification/anchor-plans.mjs';

function seedPlatform(root,platformId,{bridgeDefault='0.6.3'}={}) {
  const write=(relative,value)=>{mkdirSync(dirname(join(root,relative)),{recursive:true});writeFileSync(join(root,relative),JSON.stringify(value,null,2)+'\n');};
  write(`${platformId}/bridge.json`,{schema:'ai-platform-bridge/v1.1',platform:platformId,displayName:platformId,defaults:{workflowVersions:{'repo-lint':bridgeDefault}},runner:{enabled:true,version:'0.12.0',config:join(root,platformId,'bridge',`${platformId}-config.json`)}});
  write(`${platformId}/bridge/${platformId}-config.json`,{platform:platformId,runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),bridge:join(root,platformId,'bridge.json')});
}

test('the report names every platform that carries a bridge, and says why the anchor is unavailable',(t)=>{
  const root=mkdtempSync(join(tmpdir(),'anchor-report-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedRuntimeReleases(root);
  seedPlatform(root,'one-client');
  seedPlatform(root,'two-client');
  mkdirSync(join(root,'inbox','archive'),{recursive:true});          // a directory without a bridge is not a platform
  mkdirSync(join(root,'versions'),{recursive:true});
  assert.deepEqual(listAnchorPlatforms({workspaceRoot:root}),['one-client','two-client']);

  // No usable engine on disk ⇒ no anchor may be computed, and the report must carry the refusal
  // instead of throwing at the caller.
  const refused=readAnchorReport({workspaceRoot:root});
  assert.equal(refused.materialised,false);
  assert.equal(refused.anchor,null);
  assert.equal(refused.refusal.code,'ANCHOR_ENGINE_UNAVAILABLE','the base fixture engine carries no invocation smoke interface');
  assert.ok(refused.refusal.rejected.some((row)=>row.axis==='engine' && row.reason==='NO_INVOCATION_SMOKE_INTERFACE'));
  assert.equal(refused.platforms.length,2);
  assert.equal(refused.writePerformed,false);

  // A usable engine and judge make the anchor computable, and the per-platform rows compare against it.
  const copyDirectory=(from,to)=>{for(const entry of readdirSync(from,{withFileTypes:true})){const source=join(from,entry.name),target=join(to,entry.name);if(entry.isDirectory()){mkdirSync(target,{recursive:true});copyDirectory(source,target);}else writeFileSync(target,readFileSync(source));}};
  copyDirectory('E:/ai/tool/wf-runner/versions/0.12.2',join(root,'tool/wf-runner/versions/0.12.2'));
  seedRelease(root,'tool','repo-lint','0.6.5',{'scripts/repo_lint.py':'# fixture only\n'});
  seedRelease(root,'tool','architecture-ops','1.5.2',{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version:'1.5.2',interface:{invocationSmoke:'ai-invocation-smoke/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedRelease(root,'tool','platform-conformance','1.5.1',{'manifest.json':{schema:'ai-governance-tool/v1',id:'platform-conformance',version:'1.5.1'},'conformance/conform.py':'# fixture only\n'});
  seedPointer(root,'tool','platform-conformance','1.5.1');
  // Per-platform comparison is against the materialised anchor, so write it exactly as the plan would.
  const plan=buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'});
  applyAnchorMaterialisation(plan,{auditRoot:join(root,'..','anchor-audit')});
  const report=readAnchorReport({workspaceRoot:root});
  assert.equal(report.anchor.judge.version,'1.5.2');
  assert.equal(typeof report.computedDigest,'string');
  assert.equal(report.materialised,true);
  assert.equal(report.matchesComputed,true);
  assert.equal(report.refusal,null);
  const row=report.platforms.find((item)=>item.platformId==='one-client');
  assert.equal(row.ok,true);
  const changedKeys=row.anchor.differences.map((difference)=>difference.key);
  assert.deepEqual(changedKeys.sort(),['bridge.defaults.repo-lint','bridge.runner.version','config.invocationMatrixRelease','config.runner','config.scannerRelease']);
  assert.deepEqual(row.software,{gatewayDeclared:false,runtimeDeclared:false,environmentDeclared:false});
  // Reading the report must not have written anything into the workspace.
  assert.deepEqual(readdirSync(join(root,'one-client','bridge')).sort(),['one-client-config.json']);
  assert.equal(readdirSync(join(root,'versions')).sort().join(','),'anchor.json','the only file the report can find is the anchor it reads, never a new one');
});
