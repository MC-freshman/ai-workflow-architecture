import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {seedRelease} from './support/resources.mjs';
import {certificationFixture} from './support/certification.mjs';
import {resourceProofBinding} from '../src/domains/platforms/resource-proof.mjs';
import {resourceEnvironmentMatches} from '../src/domains/platforms/resource-environment.mjs';
import {sha256} from '../src/core/hash.mjs';

test('restore proof rejects missing, changed, foreign and failed evidence, and accepts legacy own backup',t=>{
  const f=certificationFixture(t),path=f.put(`inbox/backup/${f.id}/restore.json`,{pass:true,filesCompared:3,differences:[]});
  const env={schema:'ai-resource-environment/v1',platform:f.id,ownership:'platform/runtime',restoreEvidence:path,restoreEvidenceSha256:sha256(readFileSync(path)),packages:{invented:'1.0'},python:join(f.root,f.id,'runtime/missing-python')};
  assert.equal(resourceProofBinding(f.root,f.id,env).valid,true);
  assert.equal(resourceProofBinding(f.root,f.id,{...env,restoreEvidence:path+'missing'}).valid,false);
  assert.equal(resourceProofBinding(f.root,f.id,{...env,restoreEvidenceSha256:'0'.repeat(64)}).valid,false);
  assert.equal(resourceProofBinding(f.root,'other',env).valid,false);
  const manifest=f.put(f.id+'/runtime/env.json',env);
  assert.equal(resourceEnvironmentMatches(f.root,f.id,manifest,{packages:{invented:'1.0'}}),false,'a declaration cannot substitute for installed packages');
  f.put(`inbox/backup/${f.id}/restore.json`,{pass:false,filesCompared:3});assert.equal(resourceProofBinding(f.root,f.id,env).valid,false);
});

test('same-path restore changes invalidate only cells with resource packages',t=>{
  const f=certificationFixture(t),directory=join(f.root,'agent/profile-task/versions/1.0.0');
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')));manifest['x-runtimeRequirements']={ownership:'platform/runtime',profile:'portable-resource-python',packages:{openpyxl:'3.1.5'}};
  seedRelease(f.root,'agent','profile-task','1.0.0',{'manifest.json':manifest});
  const proof=f.put(f.id+'/runtime/restore.json',{pass:true,filesCompared:3});
  f.config.resourceEnvironmentManifest=f.put(f.id+'/runtime/env.json',{schema:'ai-resource-environment/v1',platform:f.id,ownership:'platform/runtime',restoreEvidence:proof,restoreEvidenceSha256:sha256(readFileSync(proof))});
  f.put(f.id+'/bridge/runner-config.json',f.config);const before=f.snapshot();
  f.put(f.id+'/runtime/restore.json',{pass:false,filesCompared:3});const after=f.snapshot();
  assert.notEqual(before.cells['agent:profile-task'].configurationSha256,after.cells['agent:profile-task'].configurationSha256);
  for(const key of ['workflow:expert-task','software:demo-cli'])assert.equal(before.cells[key].configurationSha256,after.cells[key].configurationSha256);
});
