import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {runtimeFile} from '../core/runtime-path.mjs';
import {targetPath} from '../core/paths.mjs';
import {allPlatformIds} from '../core/platforms.mjs';
import {platformPython} from '../domains/platforms/runtime-binding.mjs';

const jobs=new Map();
export function cancelDomainTask({jobId,workspaceSession,workspaceRoot}) {
  const job=jobs.get(jobId);
  if(!job || job.workspaceSession!==workspaceSession || job.workspaceRoot!==resolve(workspaceRoot)) return false;
  if(job.mode==='provider-session') return false;
  Atomics.store(new Int32Array(job.signal),0,1);
  if(job.cancelPath) writeFileSync(job.cancelPath,'cancel');
  if(job.cancelEventActive && process.platform==='win32') {
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"for($n=0;$n -lt 40;$n++){try{$e=[Threading.EventWaitHandle]::OpenExisting($env:ARCHITECTURE_MANAGER_CANCEL_EVENT);$e.Set()|Out-Null;$e.Dispose();break}catch{Start-Sleep -Milliseconds 50}}"],{windowsHide:true,stdio:'ignore',env:{...process.env,ARCHITECTURE_MANAGER_CANCEL_EVENT:job.cancelEventActive}});
    job.signals.push(new Promise(resolveSignal=>{child.once('error',resolveSignal);child.once('close',resolveSignal);}));
  }
  job.worker.postMessage({kind:'cancel'});return true;
}
export function cancelAllDomainTasks() {for(const job of jobs.values()) cancelDomainTask(job);}
export function runDomainTask({method,args,workspaceRoot,platformId=null,jobId=randomUUID(),workspaceSession=null,mode='owned',phase='execute',onProgress=()=>{}}) {
  if(typeof jobId!=='string' || !/^[0-9a-f-]{36}$/i.test(jobId)) throw Error('INVALID_TASK_ID');
  if(jobs.has(jobId)) throw Error('TASK_ALREADY_RUNNING');
  const root=resolve(workspaceRoot);
  let binding=null,owner=null;
  if(platformId) {try {binding=platformPython(root,platformId);owner=platformId;} catch { /* No temporary directory before a platform is configured. */ }}
  if(!owner && !platformId) for(const id of allPlatformIds(root)) {try {binding=platformPython(root,id);owner=id;break;} catch { /* no automatic configuration */ }}
  // Read-only scans also work in a workspace without a configured platform.
  const cwd=owner?targetPath(root,`${owner}/runtime/tmp/manager-tasks/${jobId}`):null;
  if(cwd) mkdirSync(cwd,{recursive:true});
  const cancelPath=cwd?join(cwd,'cancel.flag'):null;
  const signal=new SharedArrayBuffer(4);
  let existingRoot=root;
  while(!existsSync(existingRoot) && dirname(existingRoot)!==existingRoot) existingRoot=dirname(existingRoot);
  const context={python:binding?.python || null,cwd:cwd || existingRoot,cancelPath,signal,mode,phase,cancelEvent:'Local\\ArchitectureManager-'+jobId};
  const worker=new Worker(runtimeFile('task_worker.mjs'),{workerData:{method,args,apiModule:new URL('../app/api.mjs',import.meta.url).href,scopeModule:new URL('./process-scope.mjs',import.meta.url).href,context}});
  const job={jobId,workspaceSession,workspaceRoot:root,platformId:owner,cancelPath,worker,mode,signal,signals:[],cancelEventActive:null};jobs.set(jobId,job);
  const emit=update=>{if(Object.hasOwn(update,'cancelEvent'))job.cancelEventActive=update.cancelEvent;onProgress({...update,jobId,workspaceSession,workspaceRoot:root,platformId:platformId || owner,cancellable:mode!=='provider-session'});};
  emit({phase:'任务开始',state:'running'});
  return new Promise((resolveTask,reject)=>{
    let settled=false;
    const finish=async(error,result)=>{
      if(settled) return;settled=true;
      await Promise.allSettled(job.signals);jobs.delete(jobId);
      emit({phase:error?'任务已停止或失败':'任务完成',state:'settled',error:error?.message || null});
      if(error) reject(error);else resolveTask(result);
    };
    worker.on('message',message=>{
      if(message.kind==='progress') emit(message.update);
      else if(message.kind==='result') finish(null,message.result && typeof message.result==='object' && !Array.isArray(message.result)?{...message.result,...(message.stoppedAfterCompletion?{stoppedAfterCompletion:true}:{})}:message.result);
      else if(message.kind==='error') finish(Object.assign(new Error(message.error.message),message.error));
    });
    worker.on('error',error=>finish(error));
    worker.on('exit',code=>{if(!settled) finish(new Error('TASK_WORKER_EXITED:'+code));});
  });
}
