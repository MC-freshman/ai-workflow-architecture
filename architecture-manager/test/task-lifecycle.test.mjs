import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskLifecycle } from '../src/core/task-lifecycle.mjs';
import { runOwnedProcess } from '../src/core/owned-process.mjs';

test('closing waits for cancellation evidence and refuses new work', async () => {
  let release, cancelled=false, saved=false;
  const gate=new Promise(resolve=>release=resolve);
  const lifecycle=taskLifecycle(()=>{cancelled=true;release();});
  const task=lifecycle.track(async()=>{await gate;await new Promise(resolve=>setTimeout(resolve,10));saved=true;});
  await lifecycle.close();await task;
  assert.equal(cancelled,true);assert.equal(saved,true);assert.equal(lifecycle.pending,0);
  await assert.rejects(lifecycle.track(()=>{}),/APPLICATION_CLOSING/);
});

test('close cancels its real descendant tree and leaves an independent process alive', {skip:process.platform!=='win32'}, async()=>{
  const python=execFileSync(process.env.ARCHITECTURE_MANAGER_TEST_PYTHON||'python',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
  const root=mkdtempSync(join(tmpdir(),'manager-close-tree-'));const heartbeat=join(root,'heartbeat');
  const child=join(root,'child.py');writeFileSync(child,'import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\nfor n in range(200):\n p.write_text(str(n))\n time.sleep(.1)\n');
  const independent=spawn(python,['-B','-c','import time;time.sleep(25)'],{windowsHide:true});
  let cancel;const lifecycle=taskLifecycle(()=>cancel?.());
  try {
    const task=lifecycle.track(()=>runOwnedProcess({python,args:['-B','-c','import subprocess,sys,time;subprocess.Popen([sys.executable,"-B",sys.argv[1],sys.argv[2]]);time.sleep(20)',child,heartbeat],cwd:root,registerCancel:value=>cancel=value,timeout:25000}));
    for(let n=0;n<100&&!existsSync(heartbeat);n++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(existsSync(heartbeat));await lifecycle.close();assert.equal((await task).cancelled,true);
    const value=readFileSync(heartbeat,'utf8');await new Promise(resolve=>setTimeout(resolve,400));assert.equal(readFileSync(heartbeat,'utf8'),value);
    assert.doesNotThrow(()=>process.kill(independent.pid,0));
  } finally { independent.kill();rmSync(root,{recursive:true,force:true}); }
});

test('timeout is distinct from user cancellation and owns the command tree', {skip:process.platform!=='win32'},async()=>{
  const python=execFileSync(process.env.ARCHITECTURE_MANAGER_TEST_PYTHON||'python',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
  const root=mkdtempSync(join(tmpdir(),'manager-timeout-tree-'));
  try {const result=await runOwnedProcess({python,args:['-B','-c','import time;time.sleep(5)'],cwd:root,timeout:200});assert.equal(result.timedOut,true);assert.equal(result.cancelled,false);assert.equal(result.exitCode,124);}
  finally {rmSync(root,{recursive:true,force:true});}
});
