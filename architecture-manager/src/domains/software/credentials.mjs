import fs from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {runnerConfig} from '../../software-publish.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {plannedFiles,applyGeneratedFiles,verifyFiles} from '../../transactions/onboarding-files.mjs';
import {atomicWrite,requirePlan,saveCheckpoint,writeAudit} from '../../transactions/kernel.mjs';
import {runScopedProcess,withScopedCleanup} from '../../infrastructure/process-scope.mjs';
const encode=value=>JSON.stringify(value,null,2)+'\n';
export function nativeCredentialBinding(workspaceRoot,platformId) {
  const runtime=platformPython(workspaceRoot,platformId),root=targetPath(workspaceRoot,`${platformId}/runtime/software/native-credentials`),backupRoot=targetPath(workspaceRoot,`inbox/backup/${platformId}/manager-native-credentials`),provider=targetPath(workspaceRoot,`${platformId}/bridge/manager-providers/credential_store.py`);
  return {root,backupRoot,provider,python:runtime.python,command:[runtime.python,'-B',provider,'read',root]};
}
export function buildNativeCredentialProviderPlan({workspaceRoot,platformId,now=new Date().toISOString()}) {
  const binding=nativeCredentialBinding(workspaceRoot,platformId),connector=runnerConfig(workspaceRoot,platformId),gateway={...connector.value,nativeCredentialProvider:binding.command,nativeCredentialWorkspace:binding.root};
  const files=plannedFiles(workspaceRoot,[{path:relative(workspaceRoot,binding.provider).replaceAll('\\','/'),content:fs.readFileSync(runtimeFile('credential_store.py'),'utf8')},{path:relative(workspaceRoot,connector.path).replaceAll('\\','/'),content:encode(gateway)}]);
  return {schema:'architecture-manager-plan/v1',kind:'mcp-credential-provider',planId:'mcp-credential-provider-'+randomUUID(),workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId},payload:{files},steps:files.map(file=>({operation:'register-private-native-credential-provider',target:file.path})),verification:['reference values stay out of plans and evidence','per-platform vault namespace','encrypted platform backup and real restore; current Windows user only']};
}
export function applyNativeCredentialProvider(plan,options) {if(verifyFiles(plan).ok)return {status:'already-applied',writePerformed:false};return applyGeneratedFiles(plan,()=>buildNativeCredentialProviderPlan({workspaceRoot:plan.workspaceRoot,...plan.target,now:plan.generatedAt}),options);}
export const verifyNativeCredentialProvider=verifyFiles;
export function buildNativeCredentialPlan({workspaceRoot,platformId,reference,operation='set',now=new Date().toISOString(),planId='mcp-credential-'+randomUUID()}) {
  if(!/^reference:[A-Za-z0-9._-]{1,128}$/.test(reference || '') || !['set','delete','restore','status'].includes(operation) || !/^mcp-credential-[a-f0-9-]{36}$/.test(planId))throw Error('CREDENTIAL_REFERENCE_INVALID');
  const binding=nativeCredentialBinding(workspaceRoot,platformId);if(!fs.existsSync(binding.provider) || sha256File(binding.provider)!==sha256File(runtimeFile('credential_store.py')))throw Error('MCP_CREDENTIAL_PROVIDER_REQUIRED');
  const record=join(binding.root,sha256(reference.slice(10))+'.json');
  return {schema:'architecture-manager-plan/v1',kind:'mcp-credential',planId,workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,reference,operation},payload:{binding,record,beforeSha256:fs.existsSync(record)?sha256File(record):null,providerSha256:sha256File(binding.provider)},steps:[{operation:'private-credential-'+operation,target:reference}],verification:['value passed only through memory/stdin','plan/checkpoint/audit contain reference only','encrypted backup marked containsCredentials with real restore']};
}
export function applyNativeCredential(plan,{value=null,auditRoot=defaultAuditRoot(),actor='local-user'}={}) {
  requirePlan(plan);const receiptPath=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-native-credentials/${plan.planId}.json`);if(fs.existsSync(receiptPath)){const verified=verifyNativeCredential(plan);if(!verified.ok)throw Error('IMPORT_EXTERNAL_CHANGE');return {status:'already-applied',...verified.result,containsCredentialValues:false};}const expected=buildNativeCredentialPlan({workspaceRoot:plan.workspaceRoot,...plan.target,now:plan.generatedAt,planId:plan.planId});if(stableJson(expected)!==stableJson(plan))throw Error('PLAN_PAYLOAD_MISMATCH');
  if(plan.target.operation==='set' && (typeof value!=='string' || !value))throw Error('CREDENTIAL_VALUE_INVALID');
  const checkpoint=saveCheckpoint(auditRoot,plan.planId,encode({plan,containsCredentialValues:false})),request={name:plan.target.reference.slice(10),...(plan.target.operation==='set'?{value,backupRoot:plan.payload.binding.backupRoot}:{})};
  const result=withScopedCleanup(()=>JSON.parse(runScopedProcess(plan.payload.binding.python,['-B',plan.payload.binding.provider,plan.target.operation,plan.payload.binding.root],{input:encode(request),encoding:'utf8',windowsHide:true,shell:false,timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}})));
  const path=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-native-credentials/${plan.planId}.json`);fs.mkdirSync(join(path,'..'),{recursive:true});atomicWrite(path,encode({planSha256:sha256(stableJson(plan)),result,afterSha256:fs.existsSync(plan.payload.record)?sha256File(plan.payload.record):null}),plan.planId);
  writeAudit({auditRoot,actor,plan,transactionId:plan.planId,action:'mcp-credential',status:result.ok?'applied':'failed',target:plan.target.reference,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,writePerformed:plan.target.operation!=='status'});return {status:result.ok?'applied':'failed',...result,containsCredentialValues:false};
}
export function verifyNativeCredential(plan) {
  try{const receipt=readJson(targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-native-credentials/${plan.planId}.json`)),current=fs.existsSync(plan.payload.record)?sha256File(plan.payload.record):null;return {ok:receipt.planSha256===sha256(stableJson(plan)) && receipt.result.ok && current===receipt.afterSha256,result:receipt.result,containsCredentialValues:false};}catch{return {ok:false,containsCredentialValues:false};}
}
