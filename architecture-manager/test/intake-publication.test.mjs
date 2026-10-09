import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {buildIntakePublicationPlan,applyIntakePublication,verifyIntakePublication,revertIntakePublication} from '../src/domains/intake/publication.mjs';
import {sha256} from '../src/core/hash.mjs';
import {withProcessScope} from '../src/infrastructure/process-scope.mjs';
import {seedRelease} from './support/resources.mjs';
import {buildSoftwareImportPlan} from '../src/software-intake.mjs';
import {listIntakeJournals,readIntakeJournal,buildIntakeRevertPlan} from '../src/domains/intake/journals.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
const json=value=>JSON.stringify(value,null,2)+'\n';
async function fixture(t) {
  const base=mkdtempSync(join(tmpdir(),'manager-publication-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const root=join(base,'workspace'),platformId='local-client';mkdirSync(join(root,platformId),{recursive:true});mkdirSync(join(root,'agent'));
  writeFileSync(join(root,platformId,'bridge.json'),json({schema:'ai-platform-bridge/v1',platform:platformId,shared:{readOnly:true}}));writeFileSync(join(root,'agent/registry.json'),json({schema:'ai-agent-registry/v2',version:1,agents:[]}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git('init');git('config','user.name','Import Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','--','agent/registry.json',platformId+'/bridge.json');git('commit','-m','rollback baseline');
  const source=join(base,'outside.md');writeFileSync(source,'# 原文专家\n原文保留。\n');const intake=await scanExternalBody({workspaceRoot:root,platformId,type:'agent',sourcePath:source});
  const make=(version='1.0.0',intakeOverride=intake)=>{
    const registry=JSON.parse(readFileSync(join(root,'agent/registry.json')));registry.version++;registry.agents=[{id:'imported-agent',enabled:true,current:'imported-agent/current.json',version}];
    const manifest={schema:'ai-agent/v2',id:'imported-agent',version,prompt:'prompt.md',toolLock:'tool-lock.json',workflows:[],permissions:{},integrity:{sha256Manifest:'SHA256SUMS'}};
    return buildIntakePublicationPlan({intake:intakeOverride,platformId,repository:'agent',resourceId:'imported-agent',version,files:{'manifest.json':json(manifest),'tool-lock.json':json({schema:'ai-tool-lock/v2',workflows:{},skills:{},packs:{},profiles:{}})},sourceFiles:[{sourcePath:'outside.md',path:'prompt.md'}],changes:[{path:'agent/imported-agent/current.json',content:json({schema:'ai-agent-pointer/v1',id:'imported-agent',version,hashManifest:'SHA256SUMS'})},{path:'agent/registry.json',content:json(registry)}]});
  };
  return {base,root,platformId,source,intake,make,git,auditRoot:join(base,'audit')};
}
test('new external agent is sealed, registered once and original bytes survive; shared version cannot be overwritten',async t=>{
  const f=await fixture(t),plan=f.make(),sourceHash=sha256(readFileSync(f.source));
  const applied=await applyIntakePublication(plan,{auditRoot:f.auditRoot});assert.equal(applied.status,'applied');assert((await verifyIntakePublication({plan})).ok);assert.equal(sha256(readFileSync(f.source)),sourceHash);assert.equal(readFileSync(join(f.root,plan.target.destination,'prompt.md'),'utf8'),readFileSync(f.source,'utf8'));
  const events=readFileSync(join(f.auditRoot,'events.jsonl'),'utf8');assert(events.includes('checkpointPath'));
  assert.equal((await applyIntakePublication(plan,{auditRoot:f.auditRoot})).status,'already-applied');assert.equal(readFileSync(join(f.auditRoot,'events.jsonl'),'utf8'),events);assert.throws(()=>f.make(),/RELEASE_VERSION_EXISTS/);
});
test('published-before-registration interruption resumes without replacing the release or replaying stage copies',async t=>{
  const f=await fixture(t),plan=f.make();await assert.rejects(applyIntakePublication(plan,{auditRoot:f.auditRoot,failAfterStep:'release'}),/SIMULATED_INTERRUPT/);
  const sum=readFileSync(join(f.root,plan.target.destination,'SHA256SUMS'));assert(!existsSync(join(f.root,'agent/imported-agent/current.json')));const result=await applyIntakePublication(plan,{auditRoot:f.auditRoot});assert(result.verification.ok);assert.deepEqual(readFileSync(join(f.root,plan.target.destination,'SHA256SUMS')),sum);
});
test('partial registration can be really restored; frozen release and unrelated external edits are preserved',async t=>{
  const f=await fixture(t),plan=f.make(),before=readFileSync(join(f.root,'agent/registry.json'));await assert.rejects(applyIntakePublication(plan,{auditRoot:f.auditRoot,failAfterStep:1}),/SIMULATED_INTERRUPT/);
  const restored=revertIntakePublication(plan,{auditRoot:f.auditRoot});assert(restored.publishedVersionRetained);assert.deepEqual(readFileSync(join(f.root,'agent/registry.json')),before);assert(!existsSync(join(f.root,'agent/imported-agent/current.json')));await assert.rejects(applyIntakePublication(plan,{auditRoot:f.auditRoot}),/ALREADY_REVERTED/);
  const next=f.make('1.0.1');await applyIntakePublication(next,{auditRoot:f.auditRoot});writeFileSync(join(f.root,'agent/imported-agent/current.json'),'external-new-content');assert.throws(()=>revertIntakePublication(next,{auditRoot:f.auditRoot}),/RECOVERY_EXTERNAL_CHANGE/);assert.equal(readFileSync(join(f.root,'agent/imported-agent/current.json'),'utf8'),'external-new-content');
});
test('source drift, uncommitted rollback baseline and path escape stop before publication',async t=>{
  const f=await fixture(t),plan=f.make();writeFileSync(f.source,'Changed original');await assert.rejects(applyIntakePublication(plan,{auditRoot:f.auditRoot}),/INTAKE_SOURCE_CHANGED/);assert(!existsSync(join(f.root,plan.target.destination)));
  writeFileSync(f.source,'# 原文专家\n原文保留。\n');writeFileSync(join(f.root,'agent/registry.json'),json({schema:'ai-agent-registry/v2',version:2,agents:[]}));const dirty=f.make();await assert.rejects(applyIntakePublication(dirty,{auditRoot:f.auditRoot}),/GIT_BASELINE_REQUIRED/);
  const escaped=structuredClone(dirty);escaped.payload.changes[0].path=f.platformId+'/bridge/../../foreign.json';await assert.rejects(applyIntakePublication(escaped,{auditRoot:f.auditRoot}),/UNSAFE_PATH|MUTATION_NOT_ALLOWED/);assert(!existsSync(join(f.root,'foreign.json')));
  const otherCatalog=structuredClone(dirty);otherCatalog.payload.changes.push({path:'tool/_registry/skills-imported-agent.json',content:'{}',before:null,beforeSha256:null,afterSha256:sha256('{}')});await assert.rejects(applyIntakePublication(otherCatalog,{auditRoot:f.auditRoot}),/MUTATION_NOT_ALLOWED/);
});
test('same ID upgrade preserves old sealed bytes and restores exact old pointer/registry after a real rollback commit',async t=>{
  const f=await fixture(t),first=f.make();await applyIntakePublication(first,{auditRoot:f.auditRoot});f.git('add','--','agent');f.git('commit','-m','first imported version');
  const pointer=readFileSync(join(f.root,'agent/imported-agent/current.json')),registry=readFileSync(join(f.root,'agent/registry.json')),old=sha256(readFileSync(join(f.root,first.target.destination,'SHA256SUMS')));
  const next=f.make('1.0.1');await applyIntakePublication(next,{auditRoot:f.auditRoot});assert.equal(sha256(readFileSync(join(f.root,first.target.destination,'SHA256SUMS'))),old);const result=revertIntakePublication(next,{auditRoot:f.auditRoot});assert(result.publishedVersionRetained);assert.deepEqual(readFileSync(join(f.root,'agent/imported-agent/current.json')),pointer);assert.deepEqual(readFileSync(join(f.root,'agent/registry.json')),registry);
});
test('copy cancellation preserves partial staging and resumes one sealed publication safely',async t=>{
  const f=await fixture(t);writeFileSync(f.source,'# Original\n'+('read-only text\n'.repeat(150000)));
  const intake=await scanExternalBody({workspaceRoot:f.root,platformId:f.platformId,type:'agent',sourcePath:f.source});
  const plan=f.make('1.0.0',intake);
  const signal=new SharedArrayBuffer(4);await assert.rejects(withProcessScope({signal},()=>applyIntakePublication(plan,{auditRoot:f.auditRoot,onProgress:event=>{if(event.phase==='复制原文')Atomics.store(new Int32Array(signal),0,1);}})),/TASK_CANCELLED/);
  assert(!existsSync(join(f.root,plan.target.destination)));const result=await applyIntakePublication(plan,{auditRoot:f.auditRoot});assert(result.verification.ok);assert.equal(readFileSync(join(f.root,plan.target.destination,'prompt.md'),'utf8'),readFileSync(f.source,'utf8'));
});
test('software placement, real backup restore and binding compose once across an interrupted publication',async t=>{
  const f=await fixture(t),body=join(f.base,'body.exe');writeFileSync(body,Buffer.from('MZ\0test body; never executed'));
  mkdirSync(join(f.root,'software'));writeFileSync(join(f.root,'software/registry.json'),json({schema:'ai-software-registry/v1',version:1,software:[]}));f.git('add','--','software/registry.json');f.git('commit','-m','software rollback baseline');
  const intake=await scanExternalBody({workspaceRoot:f.root,platformId:f.platformId,type:'software',sourcePath:body}),placementPlan=buildSoftwareImportPlan({workspaceRoot:f.root,platformId:f.platformId,softwareId:'fixture-body',sourcePath:body,intakeKind:'portable-file'});
  intake.workspaceRoot=f.root.replaceAll('\\','/');
  const seed=seedRelease(f.base,'software','fixture-body','1.0.0'),names=['manifest.json','capabilities.snapshot.json','schemas/input.json','schemas/output.json','README.md'];const files=Object.fromEntries(names.map(name=>[name,readFileSync(join(seed,name),'utf8')]));
  const plan=buildIntakePublicationPlan({intake,platformId:f.platformId,repository:'software',resourceId:'fixture-body',version:'1.0.0',files,placementPlan,changes:[{path:'software/fixture-body/current.json',content:json({schema:'ai-software-pointer/v1',id:'fixture-body',version:'1.0.0',hashManifest:'SHA256SUMS'})},{path:'software/registry.json',content:json({schema:'ai-software-registry/v1',version:2,software:[{id:'fixture-body',current:'fixture-body/current.json',enabled:true}]})},{path:f.platformId+'/bridge/body-binding.json',content:json({body:join(placementPlan.target.path,'body.exe')})}]});
  await assert.rejects(applyIntakePublication(plan,{auditRoot:f.auditRoot,failAfterStep:'placement'}),/SIMULATED_INTERRUPT/);const manifest=readFileSync(join(placementPlan.target.backup,'MANIFEST.json'));assert(JSON.parse(manifest).restoreDrill.performed);
  const result=await applyIntakePublication(plan,{auditRoot:f.auditRoot});assert(result.verification.ok);assert(result.verification.placement.ok);assert.equal(result.verification.functionExecuted,false);assert.deepEqual(readFileSync(join(placementPlan.target.backup,'MANIFEST.json')),manifest);
  const events=readFileSync(join(f.auditRoot,'events.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);assert.equal(events.filter(row=>row.action==='software-import' && row.status==='applied').length,1);assert.equal((await applyIntakePublication(plan,{auditRoot:f.auditRoot})).status,'already-applied');assert.deepEqual(readFileSync(body),readFileSync(join(placementPlan.target.path,'body.exe')));
});
test('the common apply/verify route and history produce a bound undo plan instead of trusting a different displayed target',async t=>{
  const f=await fixture(t),plan=f.make();await applyPlan({plan,auditRoot:f.auditRoot});assert((await verifyPlanTarget({plan})).ok);
  const input={workspaceRoot:f.root,platformId:f.platformId,planId:plan.planId};assert.equal(listIntakeJournals(input)[0].status,'complete');assert.equal(readIntakeJournal(input).plan.planId,plan.planId);
  const undo=buildIntakeRevertPlan(input),forged=structuredClone(undo);forged.target.resourceId='different-agent';assert.throws(()=>applyPlan({plan:forged,auditRoot:f.auditRoot}),/PLAN_PAYLOAD_MISMATCH/);
  await applyPlan({plan:undo,auditRoot:f.auditRoot});const checked=await verifyPlanTarget({plan:undo});assert(checked.ok && checked.publishedVersionRetained);assert.equal(listIntakeJournals(input)[0].status,'reverted');
});
