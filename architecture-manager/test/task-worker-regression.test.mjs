import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {runDomainTask,cancelDomainTask} from '../src/infrastructure/tasks.mjs';
import {withProcessScope,runScopedProcess} from '../src/infrastructure/process-scope.mjs';
import {taskClient,progressMatches,cancelTaskProgress} from '../src/renderer/shared/task-client.mjs';

function fixture(t) {const root=mkdtempSync(join(tmpdir(),'manager-task-worker-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-task-worker-'));rmSync(root,{recursive:true,force:true});});return root;}
test('worker queries remain asynchronous and progress belongs to one job/workspace session',async t=>{
  const root=fixture(t);mkdirSync(join(root,'versions'));writeFileSync(join(root,'versions/readme.md'),'# source');
  const events=[],jobId=randomUUID(),workspaceSession='session-one';
  let tick=false;const timeout=setTimeout(()=>tick=true,0);
  const result=await runDomainTask({method:'readDocument',args:[root,'versions/readme.md'],workspaceRoot:root,jobId,workspaceSession,phase:'query',onProgress:row=>events.push(row)});
  clearTimeout(timeout);assert.equal(tick,true);assert.equal(result.content,'# source');
  assert.ok(events.every(row=>row.jobId===jobId && row.workspaceSession===workspaceSession && row.workspaceRoot===root));
  assert.equal(events.at(-1).state,'settled');assert.equal(progressMatches(events[0],root,'different-session'),false);
  assert.equal(progressMatches(events[0],null,workspaceSession),true);
  assert.equal(progressMatches(events[0],'previous-workspace',workspaceSession),true);
});
test('task client attaches one unique request identity without changing domain input',async()=>{
  let captured;const raw={readDocument:(...args)=>{captured=args;return Promise.resolve('ok');}};
  const api=taskClient(raw,'session');const input={workspaceRoot:'fixture',relativePath:'versions/demo.md'};await api.readDocument(input);
  assert.equal(captured[0],input);assert.equal(captured[1].workspaceSession,'session');assert.match(captured[1].jobId,/^[0-9a-f-]{36}$/);
  let cancelled;const stopping={cancelTask:async input=>{cancelled=input;return true;}};
  assert.equal(await cancelTaskProgress(stopping,{jobId:'job',workspaceRoot:'new-workspace'},null,'session'),true);
  assert.equal(cancelled.workspaceRoot,'new-workspace');
});
test('Windows fallback preserves exact Unicode/quote arguments and owns descendants on timeout', {skip:process.platform!=='win32'},async t=>{
  const root=fixture(t),heartbeat=join(root,'heartbeat'),child=join(root,'child.mjs');
  writeFileSync(child,"import fs from 'node:fs';let n=0;setInterval(()=>fs.writeFileSync(process.argv[2],String(n++)),50);");
  const context={python:null,cwd:root,cancelPath:join(root,'cancel.flag'),signal:new SharedArrayBuffer(4),mode:'owned',cancelEvent:'Local\\ArchitectureManager-'+randomUUID()};
  const args=['中文 空格','ends\\','quote"value','literal$()'];
  const output=withProcessScope(context,()=>runScopedProcess(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))',...args],{encoding:'utf8',timeout:10000}));
  assert.deepEqual(JSON.parse(output),args);
  const independent=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{windowsHide:true});
  try {
    assert.throws(()=>withProcessScope(context,()=>runScopedProcess(process.execPath,['-e','require("node:child_process").spawn(process.execPath,[process.argv[1],process.argv[2]],{stdio:"ignore"});setTimeout(()=>{},20000)',child,heartbeat],{timeout:800})),error=>error.status===124);
    assert.ok(existsSync(heartbeat));const before=readFileSync(heartbeat,'utf8');await new Promise(resolve=>setTimeout(resolve,250));assert.equal(readFileSync(heartbeat,'utf8'),before);assert.doesNotThrow(()=>process.kill(independent.pid,0));
  } finally {independent.kill();}
});
test('a wrong job/session cannot cancel an unrelated task and immediate cancellation settles',async t=>{
  const root=fixture(t);mkdirSync(join(root,'versions'));writeFileSync(join(root,'versions/readme.md'),'# source');
  const jobId=randomUUID(),workspaceSession='session';let last;
  const task=runDomainTask({method:'readDocument',args:[root,'versions/readme.md'],workspaceRoot:root,jobId,workspaceSession,phase:'query',onProgress:row=>last=row});
  assert.equal(cancelDomainTask({jobId,workspaceRoot:root,workspaceSession:'wrong'}),false);
  const started=performance.now();assert.equal(cancelDomainTask({jobId,workspaceRoot:root,workspaceSession}),true);
  await assert.rejects(task,/TASK_CANCELLED/);assert.equal(last.state,'settled');assert.ok(performance.now()-started<10000);
});
