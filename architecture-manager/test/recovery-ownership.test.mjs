import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/core/hash.mjs';
import {restoreOwnedFiles,removeOwnedDirectory} from '../src/transactions/recovery.mjs';

function fixture(t) {const root=mkdtempSync(join(tmpdir(),'manager-ownership-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-ownership-'));rmSync(root,{recursive:true,force:true});});return root;}
test('restoration rejects an external edit and leaves all checkpoint targets untouched',t=>{
  const root=fixture(t),first=join(root,'first.md'),second=join(root,'second.md');
  writeFileSync(first,'ours');writeFileSync(second,'external newest edit');
  const result=restoreOwnedFiles([{target:first,before:'old first',afterSha256:sha256('ours')},{target:second,before:'old second',afterSha256:sha256('ours')}],'test');
  assert.equal(result.ok,false);assert.equal(readFileSync(first,'utf8'),'ours');assert.equal(readFileSync(second,'utf8'),'external newest edit');
});
test('owned changes restore old bytes or remove only a newly created file',t=>{
  const root=fixture(t),first=join(root,'first.md'),second=join(root,'second.md');writeFileSync(first,'ours');writeFileSync(second,'new');
  assert.equal(restoreOwnedFiles([{target:first,before:'old',afterSha256:sha256('ours')},{target:second,before:null,afterSha256:sha256('new')}],'test').ok,true);
  assert.equal(readFileSync(first,'utf8'),'old');assert.equal(existsSync(second),false);
});
test('directory rollback preserves externally changed or added files',t=>{
  const root=fixture(t),directory=join(root,'new-release');mkdirSync(directory);writeFileSync(join(directory,'ours.md'),'ours');writeFileSync(join(directory,'external.md'),'user work');
  assert.equal(removeOwnedDirectory(directory,new Map([['ours.md',sha256('ours')]])).ok,false);assert.equal(readFileSync(join(directory,'external.md'),'utf8'),'user work');
  rmSync(join(directory,'external.md'));assert.equal(removeOwnedDirectory(directory,new Map([['ours.md',sha256('ours')]])).ok,true);assert.equal(existsSync(directory),false);
});
