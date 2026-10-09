import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,readFileSync,existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/core/hash.mjs';
import {seedRelease,seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {computeAnchor,readAnchorState,anchorAlignment,ANCHOR_RELATIVE_PATH} from '../src/domains/certification/anchor.mjs';
import {buildAnchorMaterialisationPlan,applyAnchorMaterialisation,verifyAnchorMaterialisation,buildAnchorAlignmentPlan,applyAnchorAlignment,verifyAnchorAlignment} from '../src/domains/certification/anchor-plans.mjs';

const RELEASE_SOURCE='E:/ai/tool';
const auditRoot=()=>join(mkdtempSync(join(tmpdir(),'anchor-audit-')),'audit');

function copyDirectory(from,to) {
  for(const entry of readdirSync(from,{withFileTypes:true})) {
    const source=join(from,entry.name),target=join(to,entry.name);
    if(entry.isDirectory()) { mkdirSync(target,{recursive:true});copyDirectory(source,target); }
    else if(entry.isFile()) writeFileSync(target,readFileSync(source));
  }
}

function seal(directory) {
  const rows=[];
  const walk=(current,prefix='')=>{
    for(const entry of readdirSync(current,{withFileTypes:true})) {
      if(entry.name==='SHA256SUMS') continue;
      const relative=prefix?`${prefix}/${entry.name}`:entry.name;
      if(entry.isDirectory()) walk(join(current,entry.name),relative);
      else rows.push(`${sha256(readFileSync(join(current,entry.name)))}  ${relative}`);
    }
  };
  walk(directory);
  writeFileSync(join(directory,'SHA256SUMS'),rows.sort().join('\n')+'\n');
}

function seedEngine(root,version,{declares}={}) {
  const to=join(root,'tool/wf-runner/versions',version);
  mkdirSync(to,{recursive:true});
  copyDirectory(join(RELEASE_SOURCE,'wf-runner','versions',version),to);
  const manifestPath=join(to,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.version=version;
  if(declares!==undefined) manifest.dependencies={workflows:{'repo-lint':declares},skills:{},packs:{}};
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  seal(to);
  return to;
}

function seedJudge(root,version) {
  return seedRelease(root,'tool','architecture-ops',version,{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version,interface:{invocationSmoke:'ai-invocation-smoke/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
}

function seedConformance(root,version) {
  seedRelease(root,'tool','platform-conformance',version,{'manifest.json':{schema:'ai-governance-tool/v1',id:'platform-conformance',version},'conformance/conform.py':'# fixture only\n'});
  seedPointer(root,'tool','platform-conformance',version);
}

function anchoredWorkspace() {
  const root=mkdtempSync(join(tmpdir(),'manager-anchor-plans-'));
  seedRuntimeReleases(root);
  seedRelease(root,'tool','repo-lint','0.6.5',{'scripts/repo_lint.py':'# fixture only\n'});
  seedEngine(root,'0.12.2');
  seedJudge(root,'1.5.2');
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedConformance(root,'1.5.1');
  return root;
}

function seedPlatformConfig(root,platformId,{runner,contracts,scanner,matrix,bridgeDefault,extra={}}) {
  const write=(relative,value)=>{mkdirSync(join(root,relative.split('/').slice(0,-1).join('/')),{recursive:true});writeFileSync(join(root,relative),JSON.stringify(value,null,2)+'\n');};
  write(`${platformId}/bridge/${platformId}-config.json`,{platform:platformId,platformRoot:join(root,platformId),toolRoot:join(root,'tool'),agentRoot:join(root,'agent'),softwareRoot:join(root,'software'),runsRoot:join(root,platformId,'runtime/runs'),runner:join(root,'tool/wf-runner/versions',runner),contracts:join(root,'tool/runtime-contracts/versions',contracts),scannerRelease:join(root,'tool/repo-lint/versions',scanner),bridge:join(root,platformId,'bridge.json'),...(matrix?{invocationMatrixRelease:join(root,'tool/architecture-ops/versions',matrix)}:{}),...extra});
  write(`${platformId}/bridge.json`,{schema:'ai-platform-bridge/v1.1',platform:platformId,displayName:platformId,runtimeRoot:join(root,platformId,'runtime'),modes:['workflow','agent-workflow'],defaults:{workflowVersions:{'repo-lint':bridgeDefault}},runner:{enabled:true,version:runner,config:join(root,platformId,'bridge',`${platformId}-config.json`)}});
}

test('materialising the anchor writes one file, re-derives to the same digest, and then reports no change',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  const plan=buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'});
  assert.equal(plan.kind,'anchor-generation');assert.equal(plan.writePerformed,false);assert.equal(plan.changed,true);
  assert.equal(plan.steps[0].operation,'create-anchor');
  assert.equal(plan.steps[0].target,'versions/anchor.json');
  assert.ok(plan.payload.rejected.length>=1,'the plan carries why the losing candidates lost');

  const receipt=applyAnchorMaterialisation(plan,{auditRoot:auditRoot()});
  assert.equal(receipt.status,'applied');assert.equal(receipt.writePerformed,true);
  assert.equal(existsSync(join(root,ANCHOR_RELATIVE_PATH)),true);
  assert.equal(verifyAnchorMaterialisation(plan).ok,true);

  const state=readAnchorState({workspaceRoot:root});
  assert.equal(state.exists,true);
  assert.equal(state.matchesComputed,true,'the written anchor still describes this workspace');

  const second=buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T13:00:00.000Z'});
  assert.equal(second.changed,false);assert.equal(second.target.noChange,true);
  const noop=applyAnchorMaterialisation(second,{auditRoot:auditRoot()});
  assert.equal(noop.status,'no-change');assert.equal(noop.writePerformed,false);
});

test('aligning a platform writes only the two configuration files and keeps unrelated keys',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  applyAnchorMaterialisation(buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'}),{auditRoot:auditRoot()});
  seedPlatformConfig(root,'lagging',{runner:'0.12.0',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.1',bridgeDefault:'0.6.3',extra:{projectWriteRoots:['E:/ai/lagging/workspaces'],interpreters:{'.py':'python.exe'}}});
  const before=readFileSync(join(root,'lagging/bridge.json'),'utf8');
  assert.match(before,/"schema": "ai-platform-bridge\/v1.1"/);

  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'lagging',now:'2026-10-06T12:05:00.000Z'});
  assert.equal(plan.kind,'platform-anchor-alignment');
  assert.deepEqual(plan.payload.files.map((file)=>file.path).sort(),['lagging/bridge.json','lagging/bridge/lagging-config.json']);
  assert.equal(plan.target.declaredAfter.runner,'0.12.2');
  assert.equal(plan.target.declaredAfter.scannerRelease,'0.6.5');
  assert.equal(plan.target.declaredAfter.bridgeDefault,'0.6.5');
  assert.deepEqual(plan.payload.warnings,[],'engine 0.12.0 declaring 0.6.3 is a lag, not a pairing mismatch');

  const receipt=applyAnchorAlignment(plan,{auditRoot:auditRoot()});
  assert.equal(receipt.status,'applied');
  const config=JSON.parse(readFileSync(join(root,'lagging/bridge/lagging-config.json'),'utf8'));
  assert.equal(config.runner.endsWith('0.12.2'),true);
  assert.equal(config.scannerRelease.endsWith('0.6.5'),true);
  assert.equal(config.invocationMatrixRelease.endsWith('1.5.2'),true);
  assert.deepEqual(config.projectWriteRoots,['E:/ai/lagging/workspaces'],'unrelated keys survive the write');
  assert.equal(config.interpreters['.py'],'python.exe');
  const bridge=JSON.parse(readFileSync(join(root,'lagging/bridge.json'),'utf8'));
  assert.equal(bridge.runner.version,'0.12.2');
  assert.equal(bridge.defaults.workflowVersions['repo-lint'],'0.6.5');
  assert.equal(verifyAnchorAlignment(plan).ok,true);
  assert.equal(anchorAlignment({workspaceRoot:root,platformId:'lagging'}).aligned,true);
});

test('the pair warning travels with the plan instead of refusing it, and the warning names both versions',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  applyAnchorMaterialisation(buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'}),{auditRoot:auditRoot()});
  seedPlatformConfig(root,'mixed',{runner:'0.12.2',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.2',bridgeDefault:'0.6.3'});
  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'mixed'});
  assert.equal(plan.payload.warnings.length,1);
  assert.match(plan.payload.warnings[0],/VERSION_PAIR_MISMATCH: platform scannerRelease 0\.6\.3 differs from the pinned engine's declared repo-lint 0\.6\.5/);
  const receipt=applyAnchorAlignment(plan,{auditRoot:auditRoot()});
  assert.equal(receipt.status,'applied','a named pairing warning must not block the alignment it is describing');
  assert.equal(anchorAlignment({workspaceRoot:root,platformId:'mixed'}).aligned,true);
});

test('an interrupted alignment restores every file it had already written',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  applyAnchorMaterialisation(buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'}),{auditRoot:auditRoot()});
  seedPlatformConfig(root,'interrupted',{runner:'0.12.0',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.1',bridgeDefault:'0.6.3'});
  const configPath=join(root,'interrupted/bridge/interrupted-config.json');
  const bridgePath=join(root,'interrupted/bridge.json');
  const configBefore=readFileSync(configPath,'utf8'),bridgeBefore=readFileSync(bridgePath,'utf8');
  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'interrupted'});
  assert.throws(()=>applyAnchorAlignment(plan,{auditRoot:auditRoot(),failAfterFiles:1}),/SIMULATED_INTERRUPT/);
  assert.equal(readFileSync(configPath,'utf8'),configBefore,'the written file is restored byte for byte');
  assert.equal(readFileSync(bridgePath,'utf8'),bridgeBefore,'the untouched file stays untouched');
  assert.equal(anchorAlignment({workspaceRoot:root,platformId:'interrupted'}).aligned,false);
});

test('an alignment plan refuses to apply after the platform configuration changed under it',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  applyAnchorMaterialisation(buildAnchorMaterialisationPlan({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'}),{auditRoot:auditRoot()});
  seedPlatformConfig(root,'drifted',{runner:'0.12.0',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.1',bridgeDefault:'0.6.3'});
  const plan=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'drifted'});
  const configPath=join(root,'drifted/bridge/drifted-config.json');
  const document=JSON.parse(readFileSync(configPath,'utf8'));
  document.interpreters={'.py':'changed-underneath.exe'};
  writeFileSync(configPath,JSON.stringify(document,null,2)+'\n');
  assert.throws(()=>applyAnchorAlignment(plan,{auditRoot:auditRoot()}),/INTEGRATION_BASELINE_MISMATCH|PLAN_PAYLOAD_MISMATCH/);
});

test('without a materialised anchor no alignment plan can be built',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.equal(existsSync(join(root,ANCHOR_RELATIVE_PATH)),false);
  assert.throws(()=>buildAnchorAlignmentPlan({workspaceRoot:root,platformId:'lagging'}),/ANCHOR_NOT_MATERIALISED/);
});
