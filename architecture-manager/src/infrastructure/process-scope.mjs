import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {runtimeFile} from '../core/runtime-path.mjs';

const scope=new AsyncLocalStorage();
export function withProcessScope(context,operation) {return scope.run(context,operation);}
export function withScopedCleanup(operation) {const context=scope.getStore();return context?scope.run({...context,deferCancellation:true},operation):operation();}
export function processScopeCancelled(context) {return (context.signal && Atomics.load(new Int32Array(context.signal),0)===1) || (context.cancelPath && existsSync(context.cancelPath));}
export function assertScopedActive() {const context=scope.getStore();if(context && !context.deferCancellation && context.mode!=='provider-session' && processScopeCancelled(context)) throw Error('TASK_CANCELLED');}
export function runScopedProcess(executable,args,options={}) {
  const context=scope.getStore();
  // Only commands with no index/ref writes can bypass the child controller.
  const readonlyGit=executable==='git' && ['status','rev-parse','diff','ls-files','cat-file','ls-tree','for-each-ref','rev-list','show'].some(command=>args.includes(command));
  if(context && processScopeCancelled(context) && !context.deferCancellation && context.mode!=='provider-session') throw Error('TASK_CANCELLED');
  if(!context || context.mode==='provider-session' || (!context.python && readonlyGit)) return execFileSync(executable,args,{windowsHide:true,shell:false,...options});
  if(!context.python && process.platform!=='win32') throw Error('RUNTIME_PYTHON_REQUIRED');
  // Git's index/ref writes finish atomically before honoring a stop request.
  const atomicGit=context.deferCancellation || executable==='git' && args.some(argument=>['add','commit','revert','branch','tag'].includes(argument));
  const cancelPath=atomicGit?join(context.cwd,'atomic-'+randomUUID()+'.flag'):context.cancelPath;
  context.onProgress?.({phase:'正在运行 '+executable.split(/[\\/]/).at(-1),atomicStep:atomicGit,cancelEvent:!context.python && !atomicGit?context.cancelEvent:null});
  const input=Buffer.isBuffer(options.input)?options.input.toString('utf8'):options.input ?? null;
  const specification={argv:[executable,...args],input,cwd:options.cwd || context.cwd,scopeRoot:context.cwd,cancelPath,deferCancellation:atomicGit,cancelEvent:context.cancelEvent,timeoutSeconds:(options.timeout || 120000)/1000};
  const controller=context.python || 'powershell.exe';
  const controllerArgs=context.python?['-B',runtimeFile('job_controller.py')]:['-NoProfile','-NonInteractive','-Command',"& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:ARCHITECTURE_MANAGER_JOB_SCRIPT)))"];
  return execFileSync(controller,controllerArgs,{
    ...options,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,cwd:options.cwd || context.cwd,
    env:{...process.env,...options.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',ARCHITECTURE_MANAGER_JOB_SCRIPT:runtimeFile('windows_job.ps1')},
    input:JSON.stringify(specification)+'\n',
    timeout:(options.timeout || 120000)+10000
  });
}
