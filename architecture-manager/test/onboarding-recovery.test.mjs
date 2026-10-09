import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { pendingFirstMatrix,mergeFirstMatrix } from '../src/onboarding-recovery.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'manager-recovery-'));const id='a-client';
  const directory=join(root,id,'runtime/manager-check/first');mkdirSync(directory,{recursive:true});
  const put=(name,value)=>{const path=join(directory,name);writeFileSync(path,JSON.stringify(value));return path;};
  const binding={configSha256:'config',versionsSha256:'versions',adapterSha256:'adapter'};
  const rows=[{kind:'workflow',id:'good',version:'1.0.0',status:'PASS'},{kind:'agent',id:'broken',version:'1.0.0',status:'FAIL'}];
  const matrixPath=put('matrix.json',{schema:'ai-invocation-matrix/v1',rows,summary:{PASS:1,'NEEDS-INPUT':0,EXPECTED:0,FAIL:1}});
  const conformPath=put('conform.json',{floorReached:true,counts:{pass:33,declaredAbsent:0,unverified:0}});
  const result={platformId:id,matrixPath,conformPath};const evidencePath=put('check.json',result);
  const previous={...binding,environmentBindingSha256:'environment',steps:[{step:'conform-and-first-matrix',status:'failed',result,evidencePath,evidenceSha256:sha256(readFileSync(evidencePath))}]};
  const patch={...result,configSha256:'config',matrixPath:put('patch.json',{rows:[{...rows[1],status:'PASS'}]}),issues:[],counts:{pass:1,fail:0,needsInput:0}};
  return {root,id,binding,previous,patch,put,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('first matrix recovery retains actual passing rows and replaces only the selected failures',()=>{
  const f=fixture();try {
    const recovery=pendingFirstMatrix(f.previous,f.root,f.id,f.binding,'environment');
    assert.equal(recovery.only,'agent:broken');
    const result=mergeFirstMatrix(recovery,f.patch,f.root,f.id);
    assert.equal(result.counts.pass,2);assert.equal(result.counts.fail,0);
    assert.equal(result.recovery.retainedRows,1);assert.equal(result.recovery.retestedRows,1);
    assert.equal(JSON.parse(readFileSync(recovery.matrixPath)).summary.FAIL,1,'old failed report is immutable');
    assert.equal(JSON.parse(readFileSync(result.matrixPath)).rows[0].id,'good');
  }finally{f.cleanup();}
});

test('configuration drift and cancelled attempts without a complete report cannot reuse a first matrix',()=>{
  const f=fixture();try {
    assert.equal(pendingFirstMatrix(f.previous,f.root,f.id,{...f.binding,versionsSha256:'new'},'environment'),null);
    assert.equal(pendingFirstMatrix({...f.previous,steps:[]},f.root,f.id,f.binding,'environment'),null);
    const recovery=pendingFirstMatrix(f.previous,f.root,f.id,f.binding,'environment');
    f.put('matrix.json',{rows:[]});
    assert.throws(()=>mergeFirstMatrix(recovery,f.patch,f.root,f.id),/ONBOARDING_RESUME_DRIFT/);
    assert.throws(()=>pendingFirstMatrix({...f.previous,pendingMatrixRecovery:recovery},f.root,f.id,f.binding,'environment'),/ONBOARDING_RESUME_DRIFT/);
  }finally{f.cleanup();}
});

test('a passing different resource or wrong version cannot replace the failed row',()=>{
  const f=fixture();try {
    const recovery=pendingFirstMatrix(f.previous,f.root,f.id,f.binding,'environment');
    for(const row of [{kind:'agent',id:'other',version:'1.0.0',status:'PASS'},{kind:'agent',id:'broken',version:'2.0.0',status:'PASS'}]) {
      f.put('patch.json',{rows:[row]});
      assert.throws(()=>mergeFirstMatrix(recovery,f.patch,f.root,f.id),/ONBOARDING_CHECK_FAILED/);
    }
  }finally{f.cleanup();}
});
