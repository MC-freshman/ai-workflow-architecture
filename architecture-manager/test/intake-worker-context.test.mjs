import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {taskContext} from '../src/app/task-context.mjs';
import {runDomainTask} from '../src/infrastructure/tasks.mjs';
import {scanExternalBody} from '../src/domains/intake/sources.mjs';
import {intakeFixture} from './support/intake-fixture.mjs';
test('intake and placement-only UI requests reach the real Worker in their own workspace',async t=>{
  const f=intakeFixture(t),source=join(f.base,'agent.md');writeFileSync(source,'# Supplied expert\nRead only supplied material.\n');const intake=await scanExternalBody({workspaceRoot:f.root,type:'agent',sourcePath:source}),input={intake,platformId:f.platformId,resourceId:'worker-agent',version:'1.0.0',displayName:'Worker expert',runnerWorkflow:'fixture-workflow',dependencies:{workflows:{'fixture-workflow':'1.0.0'}}};
  const context=taskContext(input),plan=await runDomainTask({method:'buildAgentSkillBodyPlan',args:[input],...context,phase:'plan'});assert.equal(plan.kind,'body-import');assert.equal(plan.workspaceRoot,f.root);assert.equal(plan.target.platformId,f.platformId);
  assert.deepEqual(taskContext({placementPlan:{workspaceRoot:f.root,target:{platformId:f.platformId}}}),context);assert.throws(()=>taskContext({workspaceRoot:f.root,intake:{workspaceRoot:f.base}}),/IMPORT_TARGET_INVALID/);assert.throws(()=>taskContext({}),/WORKSPACE_REQUIRED/);
});
