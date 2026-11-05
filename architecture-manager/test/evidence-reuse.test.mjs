import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/core/hash.mjs';
import {bindingMatches,reusableEvidence} from '../src/domains/certification/evidence-reuse.mjs';
import {readFirstCertification} from '../src/domains/onboarding/onboarding-state.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'manager-reuse-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-reuse-'));rmSync(root,{recursive:true,force:true});});
  const id='codex',directory=join(root,id,'runtime','manager-check');mkdirSync(directory,{recursive:true});
  const binding={configSha256:'config',versionsSha256:'versions',adapterSha256:'adapter'},environmentHash='environment',previous={...binding,environmentBindingSha256:environmentHash};
  const path=join(directory,'proof.json');writeFileSync(path,'original');return {root,id,path,binding,environmentHash,previous,expectedSha256:sha256(readFileSync(path))};
}
test('evidence reuse requires all four bindings and the exact existing evidence bytes',t=>{
  const f=fixture(t);assert(reusableEvidence(f));
  for(const key of ['configSha256','versionsSha256','adapterSha256'])assert(!reusableEvidence({...f,binding:{...f.binding,[key]:'changed'}}));
  assert(!reusableEvidence({...f,environmentHash:'changed'}));assert(!bindingMatches({}, {}, undefined));
  writeFileSync(f.path,'tampered');assert(!reusableEvidence(f));rmSync(f.path);assert(!reusableEvidence(f));
});
test('first certification uses the same four bindings and both report hashes, including legacy steps',t=>{
  const f=fixture(t),matrixPath=f.path,conformPath=join(f.root,f.id,'runtime','manager-check','conform.json');
  writeFileSync(matrixPath,JSON.stringify({rows:[{status:'PASS'}],summary:{PASS:1}}));writeFileSync(conformPath,JSON.stringify({floorReached:true}));
  const proof={...f.previous,matrixPath,conformPath,matrixSha256:sha256(readFileSync(matrixPath)),conformSha256:sha256(readFileSync(conformPath))};
  const previous={...f.previous,firstCertification:proof};assert(readFirstCertification(previous,f.root,f.id,f.binding,f.environmentHash));
  assert.equal(readFirstCertification(previous,f.root,f.id,{...f.binding,versionsSha256:'changed'},f.environmentHash),null);
  const legacy={...f.previous,steps:[{step:'conform-and-first-matrix',status:'passed',result:{...proof,platformId:f.id,counts:{pass:1}}}]};assert(readFirstCertification(legacy,f.root,f.id,f.binding,f.environmentHash));
  delete legacy.steps[0].result.conformSha256;assert.equal(readFirstCertification(legacy,f.root,f.id,f.binding,f.environmentHash),null,'existence alone cannot certify old evidence');
  writeFileSync(conformPath,'tampered');assert.equal(readFirstCertification(previous,f.root,f.id,f.binding,f.environmentHash),null);
});
