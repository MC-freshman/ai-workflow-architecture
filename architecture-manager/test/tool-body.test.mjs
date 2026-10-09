import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {intakeFixture} from './support/intake-fixture.mjs';
import {buildToolBodyPlan,readToolBodyEditor} from '../src/domains/intake/tool-body.mjs';
import {scanExternalBody,draftTextSource} from '../src/domains/intake/sources.mjs';
import {buildReleasePlan} from '../src/releases.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
import {sha256} from '../src/core/hash.mjs';

test('a new ID from a text body becomes a nonempty schema-valid registered workflow without original current files',async t=>{
  const f=intakeFixture(t),source=join(f.base,'instructions.md');writeFileSync(source,'Read supplied material and explain the result.');const intake=await scanExternalBody({workspaceRoot:f.root,type:'tool',sourcePath:source});
  const plan=await buildToolBodyPlan({intake,platformId:f.platformId,resourceId:'new-flow',version:'1.0.0'});assert(!existsSync(join(f.root,plan.target.destination)));await applyPlan({plan,auditRoot:f.auditRoot});assert((await verifyPlanTarget({plan})).ok);
  const release=join(f.root,plan.target.destination),manifest=JSON.parse(readFileSync(join(release,'manifest.json'))),definition=JSON.parse(readFileSync(join(release,'workflow.yaml')));assert.equal(manifest.schema,'ai-workflow/v2.1');assert.equal(definition.stages[0].action,'prompt');assert.equal(definition.stages.length,1);assert(readFileSync(join(release,'prompt.md'),'utf8').includes('Read supplied'));assert.equal(readFileSync(join(release,'original/instructions.md'),'utf8'),readFileSync(source,'utf8'));assert.equal(JSON.parse(readFileSync(join(f.root,'tool/new-flow/current.json'))).version,'1.0.0');
});
test('the existing release wizard creates a legal new ID and updates both identities when upgrading without editing YAML',async t=>{
  const f=intakeFixture(t),plan=await buildReleasePlan({workspaceRoot:f.root,platformId:f.platformId,repository:'tool',resourceId:'another-flow',targetVersion:'1.0.0'});await applyPlan({plan,auditRoot:f.auditRoot});f.git('add','--','tool');f.git('commit','-m','new workflow baseline');
  const old=sha256(readFileSync(join(f.root,plan.target.destination,'SHA256SUMS'))),upgrade=await buildReleasePlan({workspaceRoot:f.root,platformId:f.platformId,repository:'tool',resourceId:'another-flow',targetVersion:'1.1.0',upgradeFrom:'1.0.0'});await applyPlan({plan:upgrade,auditRoot:f.auditRoot});const next=join(f.root,upgrade.target.destination);
  assert.equal(JSON.parse(readFileSync(join(next,'manifest.json'))).version,'1.1.0');assert.equal(JSON.parse(readFileSync(join(next,'workflow.yaml'))).version,'1.1.0');assert.equal(sha256(readFileSync(join(f.root,plan.target.destination,'SHA256SUMS'))),old);assert.equal(JSON.parse(readFileSync(join(f.root,'tool/another-flow/current.json'))).version,'1.0.0');assert((await verifyPlanTarget({plan:upgrade})).ok);
});
test('a source script is frozen but never run by recognition, preview, publication or readback',async t=>{
  const f=intakeFixture(t),source=join(f.base,'body.py'),sentinel=join(f.base,'must-not-exist');writeFileSync(source,`from pathlib import Path\nPath(${JSON.stringify(sentinel.replaceAll('\\','/'))}).write_text('unexpected execution')\n`);
  const intake=await scanExternalBody({workspaceRoot:f.root,type:'tool',sourcePath:source}),plan=await buildToolBodyPlan({intake,platformId:f.platformId,resourceId:'script-flow',version:'1.0.0'});await applyPlan({plan,auditRoot:f.auditRoot});assert((await verifyPlanTarget({plan})).ok);assert(!existsSync(sentinel));assert.equal(JSON.parse(readFileSync(join(f.root,plan.target.destination,'workflow.yaml'))).stages[0].script,'original/body.py');
});
test('empty stages, cycles, floating dependencies and changed generated drafts cannot be published as usable workflows',async t=>{
  const f=intakeFixture(t),input={workspaceRoot:f.root,platformId:f.platformId,resourceId:'bad',version:'1.0.0'};
  await assert.rejects(buildToolBodyPlan({...input,stages:[]}),/STAGES_REQUIRED/);await assert.rejects(buildToolBodyPlan({...input,stages:[{id:'ONE',action:'prompt',dependsOn:['TWO']},{id:'TWO',action:'prompt',dependsOn:['ONE']}]}),/STAGE_CYCLE/);await assert.rejects(buildToolBodyPlan({...input,dependencies:{workflows:{'fixture-workflow':'latest'}}}),/NOT_PINNED/);
  const source=draftTextSource({workspaceRoot:f.root,platformId:f.platformId,type:'tool',files:{'body.md':'Initial draft'},entryPath:'body.md'}),plan=await buildToolBodyPlan({...input,intake:source});plan.payload.intake.draftFiles['body.md']='Changed after preview';await assert.rejects(applyPlan({plan,auditRoot:f.auditRoot}),/SOURCE_CHANGED/);assert(!existsSync(join(f.root,plan.target.destination)));
});
test('imported definitions retain all support files and stage details while the target identity is made explicit',async t=>{
  const f=intakeFixture(t),editor=await readToolBodyEditor({workspaceRoot:f.root,platformId:f.platformId,resourceId:'fixture-workflow'});assert(editor.stageBodies.INTAKE.includes('Describe'));
  const plan=await buildToolBodyPlan({workspaceRoot:f.root,platformId:f.platformId,intake:editor.intake,resourceId:'fixture-workflow',version:'1.0.1',manifest:editor.manifest,definition:editor.definition,dependencies:editor.fields.dependencies});await applyPlan({plan,auditRoot:f.auditRoot});const flow=JSON.parse(readFileSync(join(f.root,plan.target.destination,'workflow.yaml')));assert.equal(flow.stages[0].promptRef,'prompt.md#stage:INTAKE');assert.equal(flow.version,'1.0.1');assert.equal(JSON.parse(readFileSync(join(f.root,'tool/fixture-workflow/current.json'))).version,'1.0.1');
});
