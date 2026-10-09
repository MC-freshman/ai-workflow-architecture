import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {certificationFixture} from './support/certification.mjs';
import {patchCertificationSelection} from '../src/core/certification-scope.mjs';
import {seedRelease} from './support/resources.mjs';
test('the legacy selection export delegates to validated resource and evidence rules',t=>{
  const f=certificationFixture(t),base=f.baseline(),proof={matrixPath:base.actual,matrixSha256:f.hash(base.actual),conformPath:base.conform,conformSha256:f.hash(base.conform)};
  assert.match(patchCertificationSelection(proof,f.root,f.id,f.config),/workflow:expert-task/);
  writeFileSync(base.actual,'{}');assert.equal(patchCertificationSelection(proof,f.root,f.id,f.config),null);
});
test('the legacy export refuses a changed engine generation rather than falling back to one cell',t=>{
  const f=certificationFixture(t),base=f.baseline();const report=JSON.parse(readFileSync(base.actual));report.runsRoot=join(base.directory,'matrix-runs/runs');f.put(f.id+'/runtime/manager-check/attempt-0/matrix-runs/config.json',f.config);writeFileSync(base.actual,JSON.stringify(report));
  const proof={matrixPath:base.actual,matrixSha256:f.hash(base.actual),conformPath:base.conform,conformSha256:f.hash(base.conform)};
  seedRelease(f.root,'tool','wf-runner','0.13.0');const next={...f.config,runner:join(f.root,'tool/wf-runner/versions/0.13.0')};
  assert.equal(patchCertificationSelection(proof,f.root,f.id,next),null);
});
