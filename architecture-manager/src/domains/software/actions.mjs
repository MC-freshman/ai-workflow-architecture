import fs from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {runnerConfig} from './software-publish.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {runScopedProcess} from '../../infrastructure/process-scope.mjs';
import {atomicWrite,requirePlan,writeAudit,saveCheckpoint} from '../../transactions/kernel.mjs';
import {hasSensitiveLiteral} from '../intake/policy.mjs';
const encode=value=>JSON.stringify(value,null,2)+'\n';
export function buildSoftwareCommandPlan({workspaceRoot,platformId,softwareId,operation='call',capability='version',arguments:values={},credentialReferences=[],profile=null,now=new Date().toISOString(),planId='software-command-'+randomUUID()}) {
  if(!/^software-command-[a-f0-9-]{36}$/.test(planId))throw Error('INVALID_TASK_ID');
  const pointer=readJson(targetPath(workspaceRoot,`software/${softwareId}/current.json`)),resource=validateFrozenResource(workspaceRoot,'software',softwareId,pointer.version),connector=runnerConfig(workspaceRoot,platformId),runtime=platformPython(workspaceRoot,platformId),bodyPath=connector.value.bodies[softwareId];
  if(!bodyPath || !fs.existsSync(bodyPath))throw Error('SOFTWARE_NOT_INSTALLED');
  const recipe=readJson(join(resource.directory,'recipes/windows.json')),bodyRow=recipe.verify?.files?.find(row=>row.path.split('/').at(-1).toLowerCase()===bodyPath.split(/[\\/]/).at(-1).toLowerCase());
  if(!bodyRow || sha256File(bodyPath)!==bodyRow.sha256)throw Error('SOFTWARE_BODY_CHANGED');
  if(!['call','open','status','close'].includes(operation))throw Error('INVALID_SOFTWARE_MODE');
  if(hasSensitiveLiteral(encode({values,credentialReferences})))throw Error('RAW_SECRET_NOT_ALLOWED');
  if(!Array.isArray(credentialReferences) || credentialReferences.some(ref=>!/^reference:[A-Za-z0-9._-]+$/.test(ref)))throw Error('RAW_SECRET_NOT_ALLOWED');
  let request;
  if(operation==='call') {
    const cap=resource.manifest.capabilities.find(row=>row.name===capability);if(!cap)throw Error('CAPABILITY_UNAVAILABLE');
    const inputSchema=readJson(join(resource.directory,cap.inputSchemaRef)),Validator=String(inputSchema.$schema || '').includes('draft-07')?Ajv:Ajv2020,validate=new Validator({strict:false,validateFormats:false}).compile(inputSchema);if(!validate(values))throw Error('SOFTWARE_ARGUMENT_INVALID');
    request={schema:'ai-software-call/v1',kind:'request',softwareId,softwareVersion:pointer.version,capability,arguments:values,credentialReferences,idempotencyKey:sha256(planId),timeoutSeconds:cap.invocation.timeout || 30,profile:profile || (connector.value.softwareProfiles?.['manager-'+softwareId]?'manager-'+softwareId:'readonly-version'),consented:true,holder:'manager-ui'};
  }else request={schema:'ai-software-session/v1',kind:'request',operation,softwareId,softwareVersion:pointer.version,sessionKey:'manager-software',holder:'manager-ui',profile:profile || (connector.value.softwareProfiles?.['manager-'+softwareId]?'manager-'+softwareId:'administrator'),timeoutSeconds:60,consented:true};
  return {schema:'architecture-manager-plan/v1',kind:'software-command',planId,workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,softwareId,operation,capability,arguments:values,credentialReferences,profile:request.profile,version:pointer.version,bodyPath},payload:{request,python:runtime.python,connectorPath:connector.gatewayPath,configPath:connector.path,connectorSha256:sha256File(connector.gatewayPath),configSha256:sha256(connector.text),releaseSha256:resource.sumsSha256,bodySha256:bodyRow.sha256},steps:[{operation:operation==='call'?'confirmed-declared-action':'confirmed-session-'+operation,dispatch:'registered-connector-provider-only',request}],verification:['same frozen release and platform binding','source/body hash before dispatch','version, function and session liveness are separate','repeated confirmation does not start another process']};
}
export function applySoftwareCommand(plan,{auditRoot=defaultAuditRoot(),actor='local-user'}={}) {
  requirePlan(plan);const expected=buildSoftwareCommandPlan({workspaceRoot:plan.workspaceRoot,...plan.target,now:plan.generatedAt,planId:plan.planId});if(stableJson(expected)!==stableJson(plan))throw Error('PLAN_PAYLOAD_MISMATCH');
  const directory=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-software-commands/${plan.planId}`),responsePath=join(directory,'response.json');
  if(fs.existsSync(responsePath)){if(!verifySoftwareCommand(plan).receiptValid)throw Error('IMPORT_EXTERNAL_CHANGE');const reply=readJson(responsePath);return {status:'already-applied',reply,evidencePath:responsePath,writePerformed:false};}
  const intentPath=join(directory,'intent.json');if(plan.target.operation==='open' && fs.existsSync(intentPath))throw Error('SOFTWARE_EXECUTION_UNKNOWN');
  fs.mkdirSync(directory,{recursive:true});const checkpoint=saveCheckpoint(auditRoot,plan.planId,encode({plan,configurationUnchanged:true})),configPath=join(directory,'request-config.json');
  const gateway=readJson(plan.payload.configPath);atomicWrite(configPath,encode({...gateway,allowGuiLaunch:plan.target.operation==='open'}),plan.planId);
  atomicWrite(intentPath,encode({planSha256:sha256(stableJson(plan)),operation:plan.target.operation}),plan.planId);
  const ask=request=>JSON.parse(runScopedProcess(plan.payload.python,['-B',plan.payload.connectorPath,'--config',configPath],{input:encode(request),encoding:'utf8',cwd:directory,timeout:120000,maxBuffer:4*1024*1024,windowsHide:true,shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}}));
  const recordPath=join(gateway.lockRoot,'sessions',sha256(plan.target.softwareId+'/manager-software')+'.json'),readRecord=()=>{try{return readJson(recordPath);}catch{return null;}};
  let reply;try{if(plan.target.operation==='open'){const current=ask({...plan.payload.request,operation:'status'});if(current.ok && current.state==='SESSION_READY' && readRecord()?.pid)reply=current;}reply ||=ask(plan.payload.request);if(plan.target.operation==='open' && reply.ok && reply.state==='SESSION_READY')reply=ask({...plan.payload.request,operation:'status'});}finally{fs.unlinkSync(configPath);}
  if(reply?.kind!=='response' || typeof reply.ok!=='boolean')throw Error('SOFTWARE_CONNECTOR_INVALID');
  atomicWrite(responsePath,encode(reply),plan.planId);atomicWrite(join(directory,'receipt.json'),encode({planSha256:sha256(stableJson(plan)),responseSha256:sha256(encode(reply))}),plan.planId);writeAudit({auditRoot,actor,plan,transactionId:plan.planId,action:'software-command',status:reply.ok?'applied':'blocked',target:plan.target.bodyPath,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,newSha256:sha256(encode(reply)),writePerformed:true});
  return {status:reply.ok?'relayed':'blocked',reply,evidencePath:responsePath,sessionState:reply.state || null,sessionPid:reply.state==='SESSION_READY'?readRecord()?.pid || null:null,functionExecuted:plan.target.operation==='call' && reply.ok===true,writePerformed:true};
}
export function verifySoftwareCommand(plan) {
  const file=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-software-commands/${plan.planId}/response.json`);if(!fs.existsSync(file))return {ok:false,receiptValid:false};const reply=readJson(file);let receiptValid=false;try{const receipt=readJson(join(file,'../receipt.json'));receiptValid=receipt.planSha256===sha256(stableJson(plan)) && receipt.responseSha256===sha256File(file);}catch{/* A response without its binding is not verified. */}return {ok:receiptValid && reply.ok===true,receiptValid,sessionState:reply.state || null,reply,writePerformed:false};
}
