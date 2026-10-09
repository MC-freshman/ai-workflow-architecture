import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {draftTextSource} from '../src/domains/intake/sources.mjs';
import {suggestBodyImport,nextImportVersion,buildAutomaticTextBodyPlan} from '../src/domains/intake/automatic.mjs';
import {seedRuntimeReleases} from './support/resources.mjs';
import {buildOnboardingConfigPlan,applyOnboardingConfig} from '../src/onboarding-config.mjs';
import {execFileSync} from 'node:child_process';

function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'auto-intake-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const put=(path,value)=>{fs.mkdirSync(dirname(join(root,path)),{recursive:true});fs.writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value));};seedRuntimeReleases(root);return {root,put,id:'intake-owner'};}
test('metadata fills identity and exact next semver; Chinese names get a stable safe identifier',async t=>{
 const f=fixture(t),intake=draftTextSource({workspaceRoot:f.root,platformId:f.id,type:'skill',files:{'SKILL.md':'---\nname: 测试技能\n---\n# 正文\nKeep this exact body.'},entryPath:'SKILL.md'});
 const result=await suggestBodyImport({intake});assert.match(result.fields.resourceId,/^skill-[a-f0-9]{10}$/);assert.equal(result.fields.displayName,'测试技能');assert.equal(result.content,intake.draftFiles['SKILL.md']);assert.equal(result.writePerformed,false);
 for(const version of ['1.9.1','1.10.0'])fs.mkdirSync(join(f.root,'tool/skills',result.fields.resourceId,'versions',version),{recursive:true});assert.equal(nextImportVersion(f.root,'skill',result.fields.resourceId),'1.10.1');
});
test('one automatic prompt workflow plan keeps original body and creates real sealed publication inputs',async t=>{
 const f=fixture(t);for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']])f.put(repo+'/registry.json',{schema:'ai-'+repo+'-registry/v1',version:1,[key]:[]});
 const python=execFileSync(process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python',['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
 applyOnboardingConfig(buildOnboardingConfigPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,fields:{pythonExecutable:python}}),{auditRoot:join(f.root,'audit')});
 const body='# 自动规划\nDo the supplied request.';const intake=draftTextSource({workspaceRoot:f.root,platformId:f.id,type:'tool',files:{'my-workflow.md':body},entryPath:'my-workflow.md'});
 const plan=await buildAutomaticTextBodyPlan({intake,platformId:f.id});assert.equal(plan.kind,'body-import');assert.equal(plan.target.resourceId,'my-workflow');assert.equal(plan.target.version,'1.0.0');assert.equal(plan.automatic.bodyExecuted,false);assert(plan.payload.files.some(row=>row.path==='prompt.md' && row.content.includes(body)));assert(plan.payload.sums.includes('manifest.json'));assert(plan.payload.changes.some(row=>row.path==='tool/my-workflow/current.json'));
});
test('software and unresolved entries do not silently become workflow plans',async t=>{
 const f=fixture(t);await assert.rejects(buildAutomaticTextBodyPlan({intake:{type:'software',workspaceRoot:f.root},platformId:f.id}),/CONFIGURATION_REQUIRED/);
});
