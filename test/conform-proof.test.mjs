import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join,relative} from 'node:path';
import {parseTestEvidence,sourceSnapshot} from '../scripts/conform-proof.mjs';

const tap=(tests,pass,fail=0,skipped=0,cancelled=0)=>`# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n# cancelled ${cancelled}\n`;
test('empty, entirely skipped, truncated, cancelled and inconsistent summaries cannot produce a green conform',()=>{
  for(const text of ['',tap(0,0),tap(3,0,0,3),tap(3,2,0,0,1),tap(3,2),'# tests 3\n# pass 3\n'])assert.equal(parseTestEvidence(text).valid,false,text);
  assert.equal(parseTestEvidence(tap(243,241,0,2)).valid,true);assert.equal(parseTestEvidence(tap(3,2,1)).valid,false);
});
test('test-source or package changes alter the proof even when result counts are unchanged',t=>{
  const root=fs.mkdtempSync(join(os.tmpdir(),'am-conform-proof-'));t.after(()=>{assert.ok(relative(os.tmpdir(),root).startsWith('am-conform-proof-'));fs.rmSync(root,{recursive:true,force:true});});
  for(const dir of ['src','scripts','test']) {fs.mkdirSync(join(root,dir));fs.writeFileSync(join(root,dir,'example.mjs'),'first');}
  for(const name of ['package.json','package-lock.json','eslint.config.mjs'])fs.writeFileSync(join(root,name),'first');
  const first=sourceSnapshot(root);fs.writeFileSync(join(root,'test/example.mjs'),'changed test');assert.notDeepEqual(sourceSnapshot(root),first);
  const second=sourceSnapshot(root);fs.writeFileSync(join(root,'package.json'),'changed dependency');assert.notDeepEqual(sourceSnapshot(root),second);assert.ok(second.some(r=>r.path==='test/example.mjs'));
});
