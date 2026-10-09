import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {writeFileSync,readFileSync,renameSync} from 'node:fs';
import {intakeFixture} from './support/intake-fixture.mjs';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {buildAgentSkillBodyPlan,readBodyEditor,listBodyDependencies} from '../src/domains/intake/shared-body.mjs';
import {applyIntakePublication,verifyIntakePublication} from '../src/domains/intake/publication.mjs';
import {readCatalogEntry,readSkillContent} from '../src/catalog.mjs';
import {sha256} from '../src/core/hash.mjs';
import {verifyFrozenDirectory} from '../src/domains/resources/integrity.mjs';

test('a raw skill and raw expert join without current files, exact skill/workflow pins remain readable',async t=>{
  const f=intakeFixture(t),source=join(f.base,'SKILL.md');writeFileSync(source,'\uFEFF# My skill\nOriginal source is retained.\n');
  const intake=await scanExternalBody({workspaceRoot:f.root,type:'skill',sourcePath:source}),skill=await buildAgentSkillBodyPlan({intake,platformId:f.platformId,resourceId:'my-skill',version:'1.0.0'});await applyIntakePublication(skill,{auditRoot:f.auditRoot});assert((await verifyIntakePublication({plan:skill})).ok);
  assert.equal(readSkillContent({workspaceRoot:f.root,catalogId:'skills-my-skill',id:'my-skill',version:'1.0.0'}).content,'# My skill\nOriginal source is retained.\n');assert.deepEqual(readFileSync(join(f.root,skill.target.destination,'original/SKILL.md')),readFileSync(source));
  f.git('add','--','tool');f.git('commit','-m','skill baseline');const agentSource=join(f.base,'expert.md');writeFileSync(agentSource,'# My expert\nUse the exact imported skill.\n');
  const expertIntake=await scanExternalBody({workspaceRoot:f.root,type:'agent',sourcePath:agentSource}),agent=await buildAgentSkillBodyPlan({intake:expertIntake,platformId:f.platformId,resourceId:'my-expert',version:'1.0.0',runnerWorkflow:'fixture-workflow',dependencies:{workflows:{'fixture-workflow':'1.0.0'},skills:{'my-skill':'1.0.0'}}});await applyIntakePublication(agent,{auditRoot:f.auditRoot});
  assert.equal(readCatalogEntry({workspaceRoot:f.root,kind:'agent',id:'my-expert'}).manifest.runnerWorkflow,'fixture-workflow');const lock=JSON.parse(readFileSync(join(f.root,agent.target.destination,'tool-lock.json')));assert.equal(lock.skills['my-skill'],'1.0.0');assert.equal(listBodyDependencies({workspaceRoot:f.root}).skills[0].version,'1.0.0');
  assert(readFileSync(join(f.root,agent.target.destination,'prompt.md'),'utf8').includes('Original source is retained.'));assert.equal(readFileSync(join(f.root,agent.target.destination,'body.md'),'utf8'),readFileSync(agentSource,'utf8'));
});
test('editing one skill in an existing multi-skill catalog keeps all other rows and avoids duplicate registration',async t=>{
  const f=intakeFixture(t),source=join(f.base,'SKILL.md');writeFileSync(source,'# Original skill');const intake=await scanExternalBody({workspaceRoot:f.root,type:'skill',sourcePath:source}),first=await buildAgentSkillBodyPlan({intake,platformId:f.platformId,resourceId:'my-skill',version:'1.0.0'});await applyIntakePublication(first,{auditRoot:f.auditRoot});
  const old=join(f.root,'tool/_registry/skills-my-skill.json'),catalog=JSON.parse(readFileSync(old));catalog.skills.push({id:'other-skill',version:'1.0.0',sourceId:'existing-source'});renameSync(old,join(f.root,'tool/_registry/skills-existing.json'));writeFileSync(join(f.root,'tool/_registry/skills-existing.json'),JSON.stringify(catalog));
  const registry=JSON.parse(readFileSync(join(f.root,'tool/registry.json')));registry.skills=[{id:'skills-existing',path:'_registry/skills-existing.json',kind:'skill-catalog',enabled:true,invocable:false}];writeFileSync(join(f.root,'tool/registry.json'),JSON.stringify(registry));f.git('add','--','tool');f.git('commit','-m','existing multi catalog baseline');
  const editor=await readBodyEditor({workspaceRoot:f.root,platformId:f.platformId,type:'skill',resourceId:'my-skill'}),plan=await buildAgentSkillBodyPlan({intake:editor.intake,platformId:f.platformId,...editor.fields,content:'Updated',existingManifest:editor.fields.manifest});await applyIntakePublication(plan,{auditRoot:f.auditRoot});const after=JSON.parse(readFileSync(join(f.root,'tool/_registry/skills-existing.json')));assert.deepEqual(after.skills[1],catalog.skills[1]);assert.equal(after.skills[0].version,'1.0.1');assert.equal(JSON.parse(readFileSync(join(f.root,'tool/registry.json'))).skills.length,1);
});
test('full text edits produce a new skill version and preserve both old source and old frozen bytes',async t=>{
  const f=intakeFixture(t),source=join(f.base,'SKILL.md');writeFileSync(source,'# Skill\n'+('complete text\n'.repeat(3000)));const rawHash=sha256(readFileSync(source));
  const intake=await scanExternalBody({workspaceRoot:f.root,type:'skill',sourcePath:source}),first=await buildAgentSkillBodyPlan({intake,platformId:f.platformId,resourceId:'my-skill',version:'1.0.0'});await applyIntakePublication(first,{auditRoot:f.auditRoot});f.git('add','--','tool');f.git('commit','-m','first skill');
  const oldSeal=sha256(readFileSync(join(f.root,first.target.destination,'SHA256SUMS'))),editor=await readBodyEditor({workspaceRoot:f.root,platformId:f.platformId,type:'skill',resourceId:'my-skill'});assert(editor.content.length>32768);assert.equal(editor.fields.version,'1.0.1');
  const update=await buildAgentSkillBodyPlan({intake:editor.intake,platformId:f.platformId,...editor.fields,content:editor.content+'New paragraph.\n',existingManifest:editor.fields.manifest});await applyIntakePublication(update,{auditRoot:f.auditRoot});
  assert.equal(sha256(readFileSync(join(f.root,first.target.destination,'SHA256SUMS'))),oldSeal);assert.equal(sha256(readFileSync(source)),rawHash);assert.equal(JSON.parse(readFileSync(join(f.root,'tool/skills/my-skill/current.json'))).version,'1.0.1');assert.equal(listBodyDependencies({workspaceRoot:f.root}).skills[0].version,'1.0.1');
});
test('an expert without a main workflow, floating pin, empty body, or raw secret cannot become a callable registration',async t=>{
  const f=intakeFixture(t),source=join(f.base,'expert.md');writeFileSync(source,'# Expert\nRead provided data.');const intake=await scanExternalBody({workspaceRoot:f.root,type:'agent',sourcePath:source}),base={intake,platformId:f.platformId,resourceId:'expert',version:'1.0.0'};
  await assert.rejects(buildAgentSkillBodyPlan(base),/MAIN_WORKFLOW_REQUIRED/);await assert.rejects(buildAgentSkillBodyPlan({...base,runnerWorkflow:'fixture-workflow',dependencies:{workflows:{'fixture-workflow':'current'}}}),/NOT_PINNED/);
  await assert.rejects(buildAgentSkillBodyPlan({...base,content:' '}),/TEXT_REQUIRED/);await assert.rejects(buildAgentSkillBodyPlan({...base,content:'{"password":"do-not-publish"}'}),/RAW_SECRET/);
});
test('the agent prompt context rejects a rewritten skill seal after preview instead of attaching stale text to a new pin',async t=>{
  const f=intakeFixture(t),source=join(f.base,'SKILL.md');writeFileSync(source,'Original exact skill');const intake=await scanExternalBody({workspaceRoot:f.root,type:'skill',sourcePath:source}),skill=await buildAgentSkillBodyPlan({intake,platformId:f.platformId,resourceId:'my-skill',version:'1.0.0'});await applyIntakePublication(skill,{auditRoot:f.auditRoot});f.git('add','--','tool');f.git('commit','-m','skill baseline');
  const expert=join(f.base,'expert.md');writeFileSync(expert,'Use exact context');const agent=await buildAgentSkillBodyPlan({intake:await scanExternalBody({workspaceRoot:f.root,type:'agent',sourcePath:expert}),platformId:f.platformId,resourceId:'expert',version:'1.0.0',runnerWorkflow:'fixture-workflow',dependencies:{workflows:{'fixture-workflow':'1.0.0'},skills:{'my-skill':'1.0.0'}}});
  const release=join(f.root,skill.target.destination),checked=verifyFrozenDirectory(release);writeFileSync(join(release,'SKILL.md'),'Externally rewritten frozen text');writeFileSync(join(release,'SHA256SUMS'),[...checked.files.keys()].map(path=>sha256(readFileSync(join(release,path)))+'  '+path).sort().join('\n')+'\n');
  await assert.rejects(applyIntakePublication(agent,{auditRoot:f.auditRoot}),/RESOURCE_CONTEXT_CHANGED/);
});
