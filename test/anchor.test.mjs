import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/core/hash.mjs';
import {seedRelease,seedPointer,seedRuntimeReleases} from './support/resources.mjs';
import {computeAnchor,anchorDigest,anchorContent,anchorAlignment,readAnchorState,ANCHOR_RELATIVE_PATH} from '../src/domains/certification/anchor.mjs';

// The runner manifest and its entry definition are content-validated against the real v2.1 and
// workflow-definition contracts, so the fixture mirrors a real frozen release byte for byte and
// rewrites only the version and the declared checker. Inventing a manifest shape here would test
// the fixture instead of the rule.
const RELEASE_SOURCE='E:/ai/tool';

function copyDirectory(from,to) {
  for(const entry of readdirSync(from,{withFileTypes:true})) {
    const source=join(from,entry.name),target=join(to,entry.name);
    if(entry.isDirectory()) { mkdirSync(target,{recursive:true});copyDirectory(source,target); }
    else if(entry.isFile()) writeFileSync(target,readFileSync(source));
  }
}

function seal(directory) {
  const entries=[];
  const walk=(current,prefix='')=>{
    for(const entry of readdirSync(current,{withFileTypes:true})) {
      if(entry.name==='SHA256SUMS') continue;
      const relative=prefix?`${prefix}/${entry.name}`:entry.name;
      if(entry.isDirectory()) walk(join(current,entry.name),relative);
      else entries.push(`${sha256(readFileSync(join(current,entry.name)))}  ${relative}`);
    }
  };
  walk(directory);
  writeFileSync(join(directory,'SHA256SUMS'),entries.sort().join('\n')+'\n');
}

function seedEngine(root,version,{declares}={}) {
  const to=join(root,'tool/wf-runner/versions',version);
  mkdirSync(to,{recursive:true});
  copyDirectory(join(RELEASE_SOURCE,'wf-runner','versions',version),to);
  const manifestPath=join(to,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.version=version;
  if(declares!==undefined) {
    // integrity.sha256Manifest stays: the dependency walk uses the declaring manifest to seal the
    // checker it pulls in, so dropping it makes the fixture fail for a reason unrelated to the rule.
    manifest.dependencies={workflows:{'repo-lint':declares},skills:{},packs:{}};
  }
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  seal(to);
  return to;
}

function seedJudge(root,version) {
  return seedRelease(root,'tool','architecture-ops',version,{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version,interface:{invocationSmoke:'ai-invocation-smoke/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
}

function seedJudgeWithoutInterface(root,version) {
  return seedRelease(root,'tool','architecture-ops',version,{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version,interface:{matrixProgress:'ai-invocation-matrix-event/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
}

function seedConformance(root,version) {
  seedRelease(root,'tool','platform-conformance',version,{'manifest.json':{schema:'ai-governance-tool/v1',id:'platform-conformance',version},'conformance/conform.py':'# fixture only\n'});
  seedPointer(root,'tool','platform-conformance',version);
}

function seedPlatform(root,platformId,{runner,contracts,scanner,matrix,bridgeDefault}) {
  const write=(relative,value)=>{mkdirSync(dirname(join(root,relative)),{recursive:true});writeFileSync(join(root,relative),JSON.stringify(value,null,2)+'\n');};
  const config={platform:platformId,platformRoot:join(root,platformId),toolRoot:join(root,'tool'),agentRoot:join(root,'agent'),softwareRoot:join(root,'software'),runsRoot:join(root,platformId,'runtime/runs'),runner:join(root,'tool/wf-runner/versions',runner),contracts:join(root,'tool/runtime-contracts/versions',contracts),scannerRelease:join(root,'tool/repo-lint/versions',scanner),bridge:join(root,platformId,'bridge.json')};
  if(matrix) config.invocationMatrixRelease=join(root,'tool/architecture-ops/versions',matrix);
  write(`${platformId}/bridge/${platformId}-config.json`,config);
  write(`${platformId}/bridge.json`,{schema:'ai-platform-bridge/v1.1',platform:platformId,defaults:{workflowVersions:{'repo-lint':bridgeDefault}},runner:{enabled:true,version:runner,config:join(root,platformId,'bridge',`${platformId}-config.json`)}});
  return config;
}

function anchoredWorkspace() {
  const root=mkdtempSync(join(tmpdir(),'manager-anchor-'));
  seedRuntimeReleases(root);                                       // base fixtures incl. checker 0.6.3 and connector 1.0.7
  seedRelease(root,'tool','repo-lint','0.6.5',{'scripts/repo_lint.py':'# fixture only\n'});
  return root;
}

test('anchor takes the newest frozen engine whose declared checker is present, and names why the rest lost',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedEngine(root,'0.12.2');                                        // real bytes: declares repo-lint 0.6.5
  seedEngine(root,'0.12.1');                                        // real bytes, older
  seedJudge(root,'1.5.2');
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedConformance(root,'1.5.1');

  const anchor=computeAnchor({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'});
  assert.equal(anchor.schema,'ai-architecture-anchor/v1');
  assert.equal(anchor.engine.version,'0.12.2');
  assert.equal(anchor.checker.version,'0.6.5','the checker axis is the engine declaration, so the pair is exact by construction');
  assert.equal(anchor.judge.version,'1.5.2');
  assert.equal(anchor.contracts.version,'1.5.0','contracts come from the shared pointer, not from a string sort');
  assert.equal(anchor.conformance.version,'1.5.1');
  assert.equal(anchor.software.connector,'1.0.7');
  assert.deepEqual(anchor.software.recipes,[]);
  assert.equal(anchor.engine.declares['repo-lint'],anchor.checker.version);

  const engineRejections=anchor.rejected.filter((row)=>row.axis==='engine');
  assert.ok(engineRejections.some((row)=>row.version==='0.12.1' && row.reason==='ORDERED_BELOW_SELECTED'));
  assert.ok(engineRejections.some((row)=>row.version==='0.12.0' && row.reason==='ORDERED_BELOW_SELECTED'));
  assert.match(anchor.selectionRule,/never auto-promoted/);
});

test('an engine whose declared checker is not on disk is named as the reason it lost',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedEngine(root,'0.12.2',{declares:'0.6.4'});                     // newest, has the interface, but 0.6.4 is not in this workspace
  seedEngine(root,'0.12.1',{declares:'0.6.3'});                     // real 0.12.1 carries no invocation smoke interface
  seedJudge(root,'1.5.2');
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedConformance(root,'1.5.1');
  // Nothing may anchor here: the base engine fixture declares 0.6.3 but cannot answer the
  // one-process interface, so the run must refuse and say why rather than fall back.
  let error=null;
  try { computeAnchor({workspaceRoot:root}); } catch (thrown) { error=thrown; }
  assert.equal(error?.message,'ANCHOR_ENGINE_UNAVAILABLE');
  const reasons=error.rejected || [];
  assert.ok(reasons.some((row)=>row.version==='0.12.2' && /NOT_FROZEN_OR_INCOMPLETE/.test(row.reason)),
    'a declared checker that is not on disk must be named, not silently passed over');
  assert.ok(reasons.some((row)=>row.version==='0.12.1' && row.reason==='NO_INVOCATION_SMOKE_INTERFACE'));
});

test('engines without the one-process interface cannot anchor, and a workspace without one refuses to anchor',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedEngine(root,'0.12.1');                                        // real 0.12.1 declares no invocation smoke interface
  seedJudge(root,'1.5.2');
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedConformance(root,'1.5.1');
  let error=null;
  try { computeAnchor({workspaceRoot:root}); } catch (thrown) { error=thrown; }
  assert.equal(error?.message,'ANCHOR_ENGINE_UNAVAILABLE','an engine that cannot answer the one-process interface cannot anchor a certification matrix');
});

test('a workspace without a matrix-compatible judge refuses to anchor instead of falling back',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedEngine(root,'0.12.2');
  seedJudgeWithoutInterface(root,'1.5.1');
  seedPointer(root,'tool','architecture-ops','1.5.1');
  seedConformance(root,'1.5.1');
  let error=null;
  try { computeAnchor({workspaceRoot:root}); } catch (thrown) { error=thrown; }
  assert.equal(error?.message,'ANCHOR_JUDGE_UNAVAILABLE');
  assert.equal(readAnchorState({workspaceRoot:root}).exists,false,'a refused anchor leaves nothing behind');
});

test('alignment reports every key that differs from the anchor, and downgrades the pair question to a named warning',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedEngine(root,'0.12.2');
  seedJudge(root,'1.5.2');
  seedPointer(root,'tool','architecture-ops','1.5.2');
  seedConformance(root,'1.5.1');

  const anchor=computeAnchor({workspaceRoot:root,now:'2026-10-06T12:00:00.000Z'});
  mkdirSync(dirname(join(root,ANCHOR_RELATIVE_PATH)),{recursive:true});
  writeFileSync(join(root,ANCHOR_RELATIVE_PATH),anchorContent(anchor));
  const state=readAnchorState({workspaceRoot:root});
  assert.equal(state.exists,true);
  assert.equal(state.digest,anchorDigest(anchor));
  assert.equal(state.matchesComputed,true,'the materialised anchor must re-derive to itself');
  assert.equal(anchorContent(anchor).includes('generatedAt'),false,'the digest must not depend on when it was generated');

  seedPlatform(root,'aligned',{runner:'0.12.2',contracts:'1.5.0',scanner:'0.6.5',matrix:'1.5.2',bridgeDefault:'0.6.5'});
  const aligned=anchorAlignment({workspaceRoot:root,platformId:'aligned'});
  assert.equal(aligned.aligned,true);assert.deepEqual(aligned.differences,[]);assert.deepEqual(aligned.warnings,[]);
  assert.equal(aligned.anchorDigest,state.digest);assert.equal(aligned.writePerformed,false);
  assert.equal(aligned.declaredByEngine,'0.6.5');

  seedPlatform(root,'lagging',{runner:'0.12.0',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.1',bridgeDefault:'0.6.3'});
  const lagging=anchorAlignment({workspaceRoot:root,platformId:'lagging'});
  assert.equal(lagging.aligned,false);
  assert.deepEqual(lagging.differences.map((row)=>row.key).sort(),['bridge.defaults.repo-lint','bridge.runner.version','config.invocationMatrixRelease','config.runner','config.scannerRelease']);
  const scannerRow=lagging.differences.find((row)=>row.key==='config.scannerRelease');
  assert.equal(scannerRow.current,'0.6.3');assert.equal(scannerRow.expected,'0.6.5');
  assert.deepEqual(lagging.warnings,[],'a platform that is merely behind the anchor is not a pairing problem');

  // The combination the manager used to refuse outright: pinned engine 0.12.2 declares 0.6.5 while the pin says 0.6.3.
  seedPlatform(root,'mixed',{runner:'0.12.2',contracts:'1.5.0',scanner:'0.6.3',matrix:'1.5.2',bridgeDefault:'0.6.3'});
  const mixed=anchorAlignment({workspaceRoot:root,platformId:'mixed'});
  assert.equal(mixed.declaredByEngine,'0.6.5');
  assert.equal(mixed.warnings.length,1);
  assert.match(mixed.warnings[0],/^VERSION_PAIR_MISMATCH: platform scannerRelease 0\.6\.3 differs from the pinned engine's declared repo-lint 0\.6\.5$/);
  assert.equal(mixed.differences.some((row)=>row.key==='config.scannerRelease'),true,'the mismatch is reported as a difference, never as a refusal');
});

test('without a materialised anchor the alignment says so instead of inventing one',(t)=>{
  const root=anchoredWorkspace();t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=readAnchorState({workspaceRoot:root});
  assert.equal(state.exists,false);assert.equal(state.anchor,null);assert.equal(state.digest,null);
  const alignment=anchorAlignment({workspaceRoot:root,platformId:'aligned'});
  assert.equal(alignment.aligned,false);
  assert.deepEqual(alignment.warning,['ANCHOR_NOT_MATERIALISED']);
});
