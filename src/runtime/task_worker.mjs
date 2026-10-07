import {parentPort,workerData} from 'node:worker_threads';
import {existsSync} from 'node:fs';

const {method,args,apiModule,scopeModule,context}=workerData;
const cancellations=new Set();
let cancelLegacy=()=>{};
parentPort.on('message',message=>{if(message?.kind==='cancel') {for(const cancel of cancellations) cancel();cancelLegacy();}});
const progress=update=>parentPort.postMessage({kind:'progress',update});
const registerCancel=cancel=>{if(cancel) {cancellations.add(cancel);if(existsSync(context.cancelPath)) cancel();}};
try {
  const api=await import(apiModule),{withProcessScope,processScopeCancelled}=await import(scopeModule);
  if(!Object.hasOwn(api,method) || typeof api[method]!=='function') throw Error('IPC_OPERATION_UNDECLARED');
  const parameters=[...args];
  const input=parameters[0];
  const target=input?.platformId || input?.plan?.target?.platformId;
  if(target) cancelLegacy=()=>api.cancelOnboarding({workspaceRoot:input.workspaceRoot || input.plan.workspaceRoot,platformId:target});
  if(method==='applyPlan') parameters[0]={...parameters[0],onProgress:update=>{
    if(context.mode!=='provider-session' && processScopeCancelled(context)) throw Error('TASK_CANCELLED');
    progress(update);
  }};
  if(method==='runPlatformCheck') parameters[0]={...parameters[0],onProgress:progress,registerCancel};
  if(['executeOnboardingChecks','executePostAlignmentChecks','probeOnboardingCapabilities','probeOnboardingClient','probeNativeClient','probeNativeClientWithAi'].includes(method)) parameters.push({onProgress:progress,registerCancel});
  if(method==='buildSoftwareRecipePlan') parameters.push({});
  if(method==='healthSoftware') parameters.push({onProgress:progress,registerCancel});
  if(method==='scanExternalBody') parameters.push({onProgress:progress});
  const deferCancellation=method==='applyPlan' && ['git-commit','git-branch','git-tag','git-rollback'].includes(input?.plan?.kind);
  const result=await withProcessScope({...context,deferCancellation,onProgress:progress},()=>api[method](...parameters));
  if(processScopeCancelled(context) && context.phase==='query') throw Error('TASK_CANCELLED');
  parentPort.postMessage({kind:'result',result,stoppedAfterCompletion:processScopeCancelled(context)});
} catch(error) {
  parentPort.postMessage({kind:'error',error:{message:error.message,checkpointPath:error.checkpointPath || null,recovery:error.recovery || null,issues:error.issues || null}});
} finally {parentPort.close();}
