import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {existsSync, rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {runtimeFile} from '../core/runtime-path.mjs';

const scope=new AsyncLocalStorage();
export function withProcessScope(context,operation) {return scope.run(context,operation);}
export function withScopedCleanup(operation) {const context=scope.getStore();return context?scope.run({...context,deferCancellation:true},operation):operation();}
export function processScopeCancelled(context) {return (context.signal && Atomics.load(new Int32Array(context.signal),0)===1) || (context.cancelPath && existsSync(context.cancelPath));}
export function assertScopedActive() {const context=scope.getStore();if(context && !context.deferCancellation && context.mode!=='provider-session' && processScopeCancelled(context)) throw Error('TASK_CANCELLED');}
// AUD-D-010: decide readonly-ness by the git subcommand position, never by a bare flag match -
// `git merge --log` used to slip past this as "readonly" because args.includes('log').
const READONLY_GIT_COMMANDS=new Set(['status','rev-parse','diff','ls-files','cat-file','ls-tree','for-each-ref','rev-list','show','log','blame','describe','shortlog','grep','count-objects','diff-tree','merge-base','fsck']);
const GIT_GLOBAL_VALUE_FLAGS=new Set(['-C','-c','--exec-path','--git-dir','--work-tree','--namespace','--super-prefix']);
function gitSubcommand(args) {
  let expectsValue=false;
  for(const argument of args) {
    if(expectsValue) {expectsValue=false;continue;}
    if(argument.startsWith('-')) {if(GIT_GLOBAL_VALUE_FLAGS.has(argument)) expectsValue=true;continue;}
    return argument;
  }
  return null;
}
export function runScopedProcess(executable,args,options={}) {
  const context=scope.getStore();
  const readonlyGit=executable==='git' && READONLY_GIT_COMMANDS.has(gitSubcommand(args));
  if(context && processScopeCancelled(context) && !context.deferCancellation && context.mode!=='provider-session') throw Error('TASK_CANCELLED');
  if(!context || context.mode==='provider-session' || (!context.python && readonlyGit)) return execFileSync(executable,args,{windowsHide:true,shell:false,...options});
  if(!context.python && process.platform!=='win32') throw Error('RUNTIME_PYTHON_REQUIRED');
  // Git's index/ref writes finish atomically before honoring a stop request.
  const atomicGit=context.deferCancellation || executable==='git' && ['add','commit','revert','branch','tag'].some(argument=>args.includes(argument));
  const cancelPath=atomicGit?join(context.cwd,'atomic-'+randomUUID()+'.flag'):context.cancelPath;
  context.onProgress?.({phase:'正在运行 '+executable.split(/[\\/]/).at(-1),atomicStep:atomicGit,cancelEvent:!context.python && !atomicGit?context.cancelEvent:null});
  const input=Buffer.isBuffer(options.input)?options.input.toString('utf8'):options.input ?? null;
  const specification={argv:[executable,...args],input,cwd:options.cwd || context.cwd,scopeRoot:context.cwd,cancelPath,deferCancellation:atomicGit,cancelEvent:context.cancelEvent,timeoutSeconds:(options.timeout || 120000)/1000};
  const controller=context.python || 'powershell.exe';
  const controllerArgs=context.python?['-B',runtimeFile('job_controller.py')]:['-NoProfile','-NonInteractive','-Command',"& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:ARCHITECTURE_MANAGER_JOB_SCRIPT)))"];
  const run=()=>execFileSync(controller,controllerArgs,{
    ...options,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,cwd:options.cwd || context.cwd,
    env:{...process.env,...options.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',ARCHITECTURE_MANAGER_JOB_SCRIPT:runtimeFile('windows_job.ps1')},
    input:JSON.stringify(specification)+'\n',
    timeout:(options.timeout || 120000)+10000
  });
  if(!atomicGit) return run();
  // AUD-D-003: the atomic-step cancel marker is transient state; never leave it in the workspace.
  try { return run(); } finally { rmSync(cancelPath,{force:true}); }
}
