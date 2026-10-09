import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRelease,seedRuntimeReleases} from './support/resources.mjs';
import {recommendedCertificationPair} from '../src/domains/certification/releases.mjs';
import {buildOnboardingConfigPlan} from '../src/onboarding-config.mjs';
import {validateFrozenResource} from '../src/domains/resources/versions.mjs';
test('recommendation excludes candidates and requires the exact paired checker; selection is explicit',t=>{
  const root=mkdtempSync(join(tmpdir(),'manager-cert-pair-'));t.after(()=>rmSync(root,{recursive:true,force:true}));seedRuntimeReleases(root);seedRelease(root,'tool','repo-lint','0.6.5',{'scripts/repo_lint.py':'# fixture only\n'});
  const manifest=JSON.parse(readFileSync(join(root,'tool/wf-runner/versions/0.12.0/manifest.json')));manifest.version='0.12.2';manifest.dependencies.workflows={'repo-lint':'0.6.5'};manifest.interface={transport:'cli-json',execution:'prepare-next-stop-only','x-invocationSmoke':'ai-invocation-smoke/v1'};
  const source={schema:'ai-governance-source/v1',releaseStatus:'candidate'};
  seedRelease(root,'tool','architecture-ops','1.5.2',{'manifest.json':{schema:'ai-governance-tool/v1',id:'architecture-ops',version:'1.5.2',interface:{invocationSmoke:'ai-invocation-smoke/v1'}},'architecture_ops/invocation_matrix.py':'# fixture only\n'});
  seedRelease(root,'tool','wf-runner','0.12.2',{'manifest.json':manifest,'SOURCE.json':source,'cli.py':'# fixture only\n'});
  assert.equal(recommendedCertificationPair(root),null);assert.throws(()=>validateFrozenResource(root,'tool','wf-runner','0.12.2'),/RESOURCE_VERSION_CANDIDATE/);
  seedRelease(root,'tool','wf-runner','0.12.2',{'manifest.json':manifest,'SOURCE.json':{...source,publishedAt:'2026-09-25'},'cli.py':'# fixture only\n'});
  assert.equal(validateFrozenResource(root,'tool','wf-runner','0.12.2').manifest.version,'0.12.2');
  assert.equal(recommendedCertificationPair(root),null,'A stale staging label is not a performance recommendation');
  seedRelease(root,'tool','wf-runner','0.12.2',{'manifest.json':manifest,'SOURCE.json':{...source,releaseStatus:'published'},'cli.py':'# fixture only\n'});
  const pair=recommendedCertificationPair(root);assert.equal(pair.runnerVersion,'0.12.2');assert.equal(pair.scannerVersion,'0.6.5');assert.equal(pair.matrixVersion,'1.5.2');assert.equal(pair.adopted,false);
  // A requested checker that disagrees with the engine's own declaration is a named warning, not a
  // refusal: the declared pairing is what gets applied, and the request stays on the record.
  const mismatched=buildOnboardingConfigPlan({workspaceRoot:root,platformId:'new-client',confirmed:true,fields:{runnerVersion:'0.12.2',scannerVersion:'0.6.3'}});
  assert.equal(mismatched.warnings.length,1);assert.match(mismatched.warnings[0],/^VERSION_PAIR_MISMATCH: requested checker 0\.6\.3 differs from the checker the selected engine declares \(0\.6\.5\)/);
  assert.equal(mismatched.target.pairing.mismatch,true);assert.equal(mismatched.target.pairing.requested,'0.6.3');assert.equal(mismatched.target.pairing.applied,'0.6.5');
  const mismatchedConfig=JSON.parse(mismatched.payload.files.find(file=>file.path.endsWith('/new-client-config.json')).content);
  assert(mismatchedConfig.scannerRelease.endsWith('0.6.5'),'the engine-declared checker is applied');
  const mismatchedBridge=JSON.parse(mismatched.payload.files.find(file=>file.path.endsWith('/bridge.json')).content);
  assert.equal(mismatchedBridge.defaults.workflowVersions['repo-lint'],'0.6.5','the platform default follows the applied checker, never the refused request');
  const plan=buildOnboardingConfigPlan({workspaceRoot:root,platformId:'new-client',confirmed:true,fields:pair});assert.equal(plan.writePerformed,false);assert.deepEqual(plan.warnings,[]);const configuration=JSON.parse(plan.payload.files.find(file=>file.path.endsWith('/new-client-config.json')).content);assert(configuration.scannerRelease.endsWith('0.6.5'));assert(configuration.invocationMatrixRelease.endsWith('1.5.2'));
});
