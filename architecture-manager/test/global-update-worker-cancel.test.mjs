import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('real worker forwards a global stop and permits its cleanup progress',async t=>{
  const root=mkdtempSync(join(tmpdir(),'global-worker-cancel-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file=join(root,'api.mjs');
  writeFileSync(file,"let cancelled=false;export function cancelGlobalUpdate(){cancelled=true;}export async function applyPlan({onProgress}){while(!cancelled){onProgress({phase:'wait-for-global-stop'});await new Promise(r=>setTimeout(r,20));}onProgress({phase:'cleanup-after-global-stop'});return {status:'stopped',legacyCancellationDelivered:true};}");
  const signal=new SharedArrayBuffer(4);
  const worker=new Worker(new URL('../src/runtime/task_worker.mjs',import.meta.url),{workerData:{method:'applyPlan',args:[{plan:{kind:'platform-global-update',workspaceRoot:root}}],apiModule:pathToFileURL(file).href,scopeModule:new URL('../src/infrastructure/process-scope.mjs',import.meta.url).href,context:{cwd:root,cancelPath:join(root,'cancel.flag'),signal,mode:'transaction',phase:'mutation'}}});
  t.after(()=>worker.terminate());
  const result=await new Promise((resolve,reject)=>{let sent=false;worker.on('error',reject);worker.on('message',message=>{if(message.kind==='progress'&&!sent){sent=true;Atomics.store(new Int32Array(signal),0,1);worker.postMessage({kind:'cancel'});}if(message.kind==='error')reject(Error(message.error.message));if(message.kind==='result')resolve(message.result);});});
  assert.equal(result.status,'stopped');assert.equal(result.legacyCancellationDelivered,true);
});
