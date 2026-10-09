import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readJson} from '../src/core/json.mjs';
import {verifyFrozenDirectory} from '../src/domains/resources/integrity.mjs';
import {validateFrozenResource} from '../src/domains/resources/versions.mjs';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const file=process.argv[2];
const proof=readJson(file),root=proof.workspaceRoot,home=path.dirname(file);
assert.equal(proof.schema,'architecture-manager-release-proof/v1');
for(const entry of proof.artifacts) assert.equal(sha(path.join(home,entry.path)),entry.sha256,'Evidence changed: '+entry.path);
const baseline=readJson(path.join(home,proof.baseline)),candidate=readJson(path.join(home,proof.candidate));
assert.equal(baseline.attempts.length,3);assert.equal(candidate.attempts.length,3);
const median=values=>[...values].sort((a,b)=>a-b)[1];
const semantic=['kind','id','version','prepare','claimed','stopped','taskAction','status','errorCode'];
for(let cell=0;cell<2;cell++) {
  const oldRows=[],newRows=[];
  for(let attempt=0;attempt<3;attempt++) {
    const old=readJson(path.join(home,`P7-baseline-${attempt}/matrix.json`)).rows[cell];
    const fresh=readJson(path.join(home,`P7-candidate-final-${attempt}/matrix.json`)).rows[cell];
    assert.deepEqual(Object.fromEntries(semantic.map(key=>[key,fresh[key] ?? null])),Object.fromEntries(semantic.map(key=>[key,old[key] ?? null])));
    assert.equal(old.status,'PASS');assert.equal(fresh.runnerStarts,1);
    assert.equal(baseline.attempts[attempt].runnerStartsPerSuccessfulCell,3);
    oldRows.push(old.durationMs);newRows.push(fresh.durationMs);
  }
  assert(median(newRows)<=median(oldRows)*.8,'Performance target was not achieved');
}
for(const reportName of proof.errors) {
  const report=readJson(path.join(home,reportName));
  for(const row of report.cases) {
    assert(row.equivalent,row.case);assert(row.answers.every(answer=>answer.runCreated===false));
  }
}
const cancelled=readJson(path.join(home,proof.cancel));
assert(cancelled.ok && cancelled.exitCode===125 && cancelled.after==='stopped' && cancelled.cleanup.ok);
for(const entry of cancelled.artifacts) {assert(entry.sha256);assert.equal(sha(entry.path),entry.sha256);}
for(const release of proof.releases) {
  const result=validateFrozenResource(root,'tool',release.id,release.version);
  assert.equal(result.sumsSha256,release.sumsSha256);
}
const origins=readJson(path.join(home,proof.origins));
for(const [id,origin] of Object.entries(origins.baseline)) assert.equal(verifyFrozenDirectory(path.join(root,'tool',id,'versions',origin.version)).sumsSha256,origin.originSha256);
console.log(JSON.stringify({ok:true,proofSha256:sha(file),runnerStarts:'3→1',representativeCells:2,attemptsPerCell:3,errorsEquivalent:true,cancellationClosed:true,oldReleasesUnchanged:true}));
