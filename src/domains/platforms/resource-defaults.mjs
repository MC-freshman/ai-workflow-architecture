import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {declaredVersion} from '../certification/declared.mjs';
import {atomicWrite,makeId,output,requirePlan,saveCheckpoint,writeAudit} from '../../transactions/kernel.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const ID=/^[a-z0-9][a-z0-9._-]*$/i;
const tableKey=repository=>repository==='tool'?'workflowVersions':'agentVersions';
function context(workspaceRoot,platformId){
  if(!ID.test(platformId || ''))throw Error('INVALID_PLATFORM_ID');
  const relative=`${platformId}/bridge.json`,file=targetPath(workspaceRoot,relative),bytes=fs.readFileSync(file),bridge=readJson(file);
  if(bridge.platform!==platformId)throw Error('PLATFORM_SCOPE_MISMATCH');
  return {relative,file,bytes,bridge};
}
function registered(root,repository,id){
  if(!['tool','agent'].includes(repository)||!ID.test(id || ''))throw Error('INVALID_RESOURCE_ID');
  const registry=readJson(targetPath(root,`${repository}/registry.json`));
  if(!registry[repository==='tool'?'workflows':'agents']?.some(row=>row.id===id&&row.enabled!==false))throw Error('RESOURCE_NOT_REGISTERED');
  const pointerPath=targetPath(root,`${repository}/${id}/current.json`),pointer=readJson(pointerPath);
  return {pointer,pointerSha256:sha256File(pointerPath)};
}
function pairedVersion(root,platformId,resourceId){
  for(const relative of [`${platformId}/bridge/runner-config.json`,`${platformId}/bridge/${platformId}-config.json`]){
    const file=targetPath(root,relative);if(!fs.existsSync(file))continue;const config=readJson(file);
    for(const key of ['runner','scannerRelease','invocationMatrixRelease']){
      const value=config[key];if(typeof value!=='string')continue;
      const parts=value.replaceAll('\\','/').split('/'),at=parts.lastIndexOf('versions');
      if(at>0&&parts[at-1]===resourceId)return declaredVersion(value);
    }
  }
  return null;
}
export function readPlatformResourceVersions({workspaceRoot,platformId}){
  const {bridge,bytes}=context(workspaceRoot,platformId),rows=[];
  for(const [repository,section] of [['tool','workflows'],['agent','agents']]){
    const registry=readJson(targetPath(workspaceRoot,`${repository}/registry.json`));
    for(const row of registry[section] || []){
      if(row.enabled===false||!ID.test(row.id))continue;
      const {pointer}=registered(workspaceRoot,repository,row.id),override=declaredVersion(bridge.defaults?.[tableKey(repository)]?.[row.id]);
      rows.push({repository,resourceId:row.id,sharedVersion:pointer.version,platformVersion:override,effectiveVersion:override || pointer.version,resolvedFrom:override?'platform-local':'shared-current',pairedVersion:repository==='tool'?pairedVersion(workspaceRoot,platformId,row.id):null});
    }
  }
  return {platformId,bridgeSha256:sha256(bytes),scope:'platform-local',rows};
}
export function buildPlatformResourceDefaultPlan({workspaceRoot,platformId,repository,resourceId,targetVersion=null,now=new Date().toISOString()}){
  const {bridge,bytes,relative}=context(workspaceRoot,platformId),{pointer,pointerSha256}=registered(workspaceRoot,repository,resourceId);
  if(targetVersion!==null&&typeof targetVersion!=='string')throw Error('INVALID_RESOURCE_VERSION');
  const key=tableKey(repository),previous=bridge.defaults?.[key]?.[resourceId] ?? null,effectiveVersion=targetVersion || pointer.version;
  const pairing=repository==='tool'?pairedVersion(workspaceRoot,platformId,resourceId):null;
  if(pairing&&pairing!==effectiveVersion)throw Error('PLATFORM_VERSION_PAIRING_REQUIRED');
  const validated={seen:new Set(),visiting:new Set()};validateFrozenResource(workspaceRoot,repository,resourceId,effectiveVersion,validated);
  if(previous===targetVersion)throw Error('NO_CHANGE');
  const after=structuredClone(bridge);after.defaults={...(after.defaults || {}),[key]:{...(after.defaults?.[key] || {})}};
  if(targetVersion===null)delete after.defaults[key][resourceId];else after.defaults[key][resourceId]=targetVersion;
  const bindings=[...validated.resources].map(([id,value])=>({id,sumsSha256:value.sumsSha256})).sort((a,b)=>a.id.localeCompare(b.id));
  return {schema:'architecture-manager-plan/v1',kind:'platform-resource-default',planId:'platform-default-'+randomUUID(),workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,repository,resourceId,targetVersion,previousVersion:declaredVersion(previous),effectiveVersion,scope:'platform-local'},payload:{relativePath:relative,beforeSha256:sha256(bytes),afterText:json(after),afterSha256:sha256(json(after)),sharedPointerSha256:pointerSha256,resourceBindings:bindings},steps:[{operation:targetVersion===null?'恢复跟随共享默认':'设置本平台默认版本',target:relative,oldValue:previous,newValue:targetVersion,oldSha256:sha256(bytes),checkpoint:true}],verification:['only the selected platform bridge default changes','shared current and frozen releases remain unchanged','exact agent dependency locks remain authoritative','future runs only; existing run locks remain unchanged']};
}
export function applyPlatformResourceDefault(plan,{auditRoot=defaultAuditRoot(),actor='local-user',now=new Date().toISOString(),failAfterCheckpoint=false}={}){
  requirePlan(plan);if(plan.kind!=='platform-resource-default')throw Error('INVALID_TRANSACTION_PLAN');
  const {workspaceRoot,target,payload}=plan,{file,bytes}=context(workspaceRoot,target.platformId),transactionId=makeId(plan,now);
  const common={auditRoot,actor,now,transactionId,plan,action:plan.kind,target:payload.relativePath};
  if(sha256(bytes)===payload.afterSha256){
    const checked=verifyPlatformResourceDefault(plan);if(!checked.ok)throw Error('INTEGRATION_BASELINE_MISMATCH');
    return {...output(writeAudit({...common,status:'already-applied'})),...checked};
  }
  const expected=buildPlatformResourceDefaultPlan({...target,workspaceRoot,now:plan.generatedAt});
  if(json(expected.payload)!==json(payload))throw Error('INTEGRATION_BASELINE_MISMATCH');
  const lock=targetPath(workspaceRoot,`${target.platformId}/runtime/maintenance/manager-defaults/bridge.lock`);fs.mkdirSync(dirname(lock),{recursive:true});
  if(fs.existsSync(lock)){
    let owner;try{owner=readJson(lock);}catch{throw Error('RESOURCE_BUSY');}
    if(owner.schema!=='architecture-manager-default-lock/v1'||!Number.isInteger(owner.pid))throw Error('RESOURCE_BUSY');
    let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
    if(alive)throw Error('RESOURCE_BUSY');
    fs.renameSync(lock,lock+'.'+randomUUID()+'.expired');
  }
  let handle;try{handle=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')throw Error('RESOURCE_BUSY');throw error;}
  fs.writeFileSync(handle,json({schema:'architecture-manager-default-lock/v1',pid:process.pid,transactionId,createdAt:now}));
  let written=false,checkpoint=null;
  try{
    if(sha256File(file)!==payload.beforeSha256)throw Error('EXTERNAL_CHANGE_DETECTED');
    checkpoint=saveCheckpoint(auditRoot,transactionId,bytes.toString('utf8'));
    if(failAfterCheckpoint)throw Object.assign(Error('SIMULATED_INTERRUPT'),{checkpointPath:checkpoint.path});
    atomicWrite(file,payload.afterText,transactionId);written=true;
    const verified=verifyPlatformResourceDefault(plan);if(!verified.ok){atomicWrite(file,bytes.toString('utf8'),transactionId+'-restore');throw Error('PLATFORM_DEFAULT_READBACK_FAILED');}
    const event=writeAudit({...common,status:'applied',oldSha256:payload.beforeSha256,newSha256:payload.afterSha256,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,writePerformed:true});
    const result={...output(event,checkpoint.path),...verified,writePerformed:true,previousVersion:target.previousVersion};
    const receiptPath=targetPath(workspaceRoot,`${target.platformId}/runtime/maintenance/manager-defaults/${transactionId}.json`);atomicWrite(receiptPath,json(result),transactionId);return {...result,receiptPath};
  }catch(error){
    let restored=!written;
    if(written&&sha256File(file)===payload.afterSha256){atomicWrite(file,bytes.toString('utf8'),transactionId+'-restore');restored=true;}
    try{writeAudit({...common,status:restored?'failed-restored':'failed-external-change',error:error.message,checkpointPath:checkpoint?.path,checkpointSha256:checkpoint?.sha256,writePerformed:false});}catch{/* Preserve the original error and checkpoint if the audit device is unavailable. */}
    throw Object.assign(error,{checkpointPath:checkpoint?.path,recovery:restored?'restored':'external-change-preserved'});
  }
  finally{fs.closeSync(handle);fs.rmSync(lock,{force:true});}
}
export function verifyPlatformResourceDefault(plan){
  const {workspaceRoot,target,payload}=plan,{bridge,bytes}=context(workspaceRoot,target.platformId),{pointer,pointerSha256}=registered(workspaceRoot,target.repository,target.resourceId);
  const override=declaredVersion(bridge.defaults?.[tableKey(target.repository)]?.[target.resourceId]);
  validateFrozenResource(workspaceRoot,target.repository,target.resourceId,override || pointer.version);
  return {ok:sha256(bytes)===payload.afterSha256&&override===target.targetVersion&&pointerSha256===payload.sharedPointerSha256,platformId:target.platformId,repository:target.repository,resourceId:target.resourceId,platformVersion:override,sharedVersion:pointer.version,effectiveVersion:override || pointer.version,resolvedFrom:override?'platform-local':'shared-current',scope:'platform-local',effectiveFor:'future-runs-only',sharedCurrentChanged:false,writePerformed:false};
}
