import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {withProcessScope,runScopedProcess} from '../src/infrastructure/process-scope.mjs';

function fixture(t) {
  const base=tmpdir(),root=mkdtempSync(join(base,'manager-owned-pipes-'));
  t.after(()=>{assert(relative(base,root).startsWith('manager-owned-pipes-'));rmSync(root,{recursive:true,force:true});});
  return {python:process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python',cwd:root,cancelPath:join(root,'cancel.flag'),signal:new SharedArrayBuffer(4),mode:'owned'};
}
test('owned Python controller drains large output while feeding exact Unicode input',t=>{
  const context=fixture(t),input='中文 batch\n'.repeat(50000),prefix='x'.repeat(1024*1024);
  const script='import sys,hashlib;sys.stdout.buffer.write(b"x"*1048576);sys.stdout.buffer.flush();data=sys.stdin.buffer.read();sys.stdout.write(hashlib.sha256(data).hexdigest())';
  const output=withProcessScope(context,()=>runScopedProcess(context.python,['-c',script],{input,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024}));
  assert.equal(output,prefix+createHash('sha256').update(input).digest('hex'));
});
test('owned controller still enforces timeout when a child never consumes input',t=>{
  const context=fixture(t),started=Date.now();
  assert.throws(()=>withProcessScope(context,()=>runScopedProcess(context.python,['-c','import time;time.sleep(30)'],{input:'x'.repeat(1024*1024),timeout:700})),error=>error.status===124);
  assert(Date.now()-started<10000);
});
