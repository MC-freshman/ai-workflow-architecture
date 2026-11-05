import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {selectNativeProfile} from './native-profile.mjs';
import {readOnboardingConfig} from '../onboarding/onboarding-config.mjs';
import {clientBinding} from '../onboarding/onboarding-client.mjs';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {childEnv} from '../../core/child-env.mjs';
import {sha256File} from '../../core/hash.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {runOwnedProcess} from '../../core/owned-process.mjs';
import {parseJsonc} from '../../core/jsonc.mjs';
import {requirePlan,atomicWrite,saveCheckpoint,writeAudit,makeId} from '../../transactions/kernel.mjs';
import {recordNativeAttempt,nativeAttemptBlocksProof} from './native-attempt.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=path=>fs.existsSync(path)?sha256File(path):null;
const read=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const statePath=(root,id)=>targetPath(root,`${id}/bridge/native-client.json`);

export function buildNativeClientPlan({workspaceRoot,platformId,bodyPath='',now=new Date().toISOString()}) {
  const snapshot=readOnboardingConfig({workspaceRoot,platformId});
  const profile=selectNativeProfile(workspaceRoot,platformId,bodyPath);
  const descriptor=read(targetPath(workspaceRoot,`${platformId}/bridge/client-adapter.json`));
  if(profile.supportsRegistration && !descriptor.server?.executable)throw Error('NATIVE_SERVICE_REQUIRED');
  const entry=profile.kind==='workbuddy-cli'?{type:'stdio',command:descriptor.server.executable,args:descriptor.server.args}:profile.kind==='workspace-mcp'&&profile.vendor==='Qoder'?{command:descriptor.server.executable,args:descriptor.server.args,type:'stdio',disabled:false}:{command:descriptor.server?.executable,args:descriptor.server?.args,enabled:true};
  const existing=fs.existsSync(statePath(workspaceRoot,platformId))?read(statePath(workspaceRoot,platformId)):null;
  return {schema:'architecture-manager-plan/v1',kind:'platform-native-client',planId:'native-'+randomUUID(),workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,bodyPath:profile.bodyPath},payload:{profile,entry,python:snapshot.fields.pythonExecutable,nativeConfigBefore:profile.configPath?hash(profile.configPath):null,bindingBefore:hash(statePath(workspaceRoot,platformId)),configSha256:hash(targetPath(workspaceRoot,snapshot.configPath)),managed:Boolean(existing?.registered && existing.profile.bodyPath===profile.bodyPath && existing.nativeConfigSha256===hash(profile.configPath)),helperSha256:hash(runtimeFile('native_client.py'))},steps:[{operation:'识别原生本体',target:profile.bodyPath},{operation:profile.supportsRegistration?'通过厂商接口注册 MCP':'登记待补外部接口',target:profile.configPath || profile.bodyPath},{operation:'独立原生三仓只读调用验证',target:profile.label}],verification:['preserve all unrelated native settings','encrypted private backup and real restored-file comparison','native tool calls are distinct from facade loopback','no model turn; unsupported direct calls remain pending']};
}

async function helper(plan,spec,options={}) {
  const {workspaceRoot,target:{platformId},payload:{python}}=plan;
  const cwd=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/${plan.planId}`);
  const result=await runOwnedProcess({python,args:['-B',runtimeFile('native_client.py')],input:json(spec),cwd,timeout:180000,registerCancel:options.registerCancel});
  if(result.cancelled)throw Error('ONBOARDING_CANCELLED');
  let response;try{response=JSON.parse(result.stdout.trim());}catch{throw Error('NATIVE_CLIENT_CONNECTION_FAILED');}
  if(result.exitCode!==0 || !response.ok)throw Error(response.error || 'NATIVE_CLIENT_CONNECTION_FAILED');
  return response;
}

export async function applyNativeClient(plan,{auditRoot=defaultAuditRoot(),actor='local-user',registerCancel=()=>{}}={}) {
  requirePlan(plan);
  const expected=buildNativeClientPlan({...plan.target,workspaceRoot:plan.workspaceRoot,now:plan.generatedAt});
  if(json(expected.payload)!==json(plan.payload))throw Error('INTEGRATION_BASELINE_MISMATCH');
  const {workspaceRoot,target:{platformId},payload:{profile,entry}}=plan;
  const cwd=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/${plan.planId}`);
  fs.mkdirSync(cwd,{recursive:true});
  const transactionId=makeId(plan,new Date().toISOString());
  const checkpoint=saveCheckpoint(auditRoot,transactionId,json({kind:plan.kind,platformId,bindingBefore:fs.existsSync(statePath(workspaceRoot,platformId))?read(statePath(workspaceRoot,platformId)):null,nativeConfigSha256:plan.payload.nativeConfigBefore}));
  const backupPath=targetPath(workspaceRoot,`inbox/backup/${platformId}/manager-native/${plan.planId}/config.before.dpapi.json`);
  const options={registerCancel};let registered=false,workspaceWrittenSha256=null;
  try {
    if(profile.kind==='codex-app-server') {
      fs.mkdirSync(profile.home,{recursive:true});
      await helper(plan,{operation:'configure',profile,cwd,entry,beforeSha256:plan.payload.nativeConfigBefore,managed:plan.payload.managed,backupPath},options);registered=true;
    } else if(profile.kind==='workbuddy-cli') {
      fs.mkdirSync(profile.project,{recursive:true});
      const previous=fs.existsSync(profile.configPath)?parseJsonc(fs.readFileSync(profile.configPath,'utf8')).mcpServers?.architecture:null;
      const same=previous && Object.entries(entry).every(([key,value])=>json(previous[key])===json(value));
      if(previous && !same && (!plan.payload.managed || Object.keys(previous).some(key=>!['type','command','args','enabled'].includes(key))))throw Error('NATIVE_SERVER_NAME_CONFLICT');
      // Native CLI owns the JSONC writer. No generic parser rewrites user settings.
      await helper(plan,{operation:'backup',configPath:profile.configPath,backupPath},options);
      const result=same?{exitCode:0}:await runOwnedProcess({python:plan.payload.python,executable:process.execPath,args:[profile.cli,'mcp','add-json','architecture',JSON.stringify(entry),'--scope','project'],cwd:profile.project,timeout:60000,registerCancel,env:childEnv(process.env,{ELECTRON_RUN_AS_NODE:'1',ACC_PRODUCT_CONFIG_PATH:profile.productPath,CODEBUDDY_FORCE_LITE_WB_BUNDLE:'1',CODEBUDDY_DISABLE_COMPILE_CACHE:'1',CODEBUDDY_CONFIG_DIR:targetPath(workspaceRoot,`${platformId}/runtime/native-client-home`)})});
      if(result.cancelled)throw Error('ONBOARDING_CANCELLED');
      if(result.exitCode!==0 || !fs.existsSync(profile.configPath))throw Error('NATIVE_REGISTRATION_FAILED');
      const native=parseJsonc(fs.readFileSync(profile.configPath,'utf8')).mcpServers?.architecture;
      if(!native || !['command','args'].every(key=>json(native[key])===json(entry[key])))throw Error('NATIVE_CONFIGURATION_READBACK_FAILED');
      registered=true;
    }
    else if(profile.kind==='workspace-mcp'){
      const document=fs.existsSync(profile.configPath)?parseJsonc(fs.readFileSync(profile.configPath,'utf8')):{};
      let table=document;for(const key of profile.configKeys){if(table[key]!=null&&(typeof table[key]!=='object'||Array.isArray(table[key])))throw Error('NATIVE_SERVER_NAME_CONFLICT');table[key] ||= {};table=table[key];}
      const previous=table.architecture;
      if(previous&&json(previous)!==json(entry)&&!plan.payload.managed)throw Error('NATIVE_SERVER_NAME_CONFLICT');
      await helper(plan,{operation:'backup',configPath:profile.configPath,backupPath},options);
      if(hash(profile.configPath)!==plan.payload.nativeConfigBefore)throw Error('INTEGRATION_BASELINE_MISMATCH');
      table.architecture=entry;fs.mkdirSync(dirname(profile.configPath),{recursive:true});atomicWrite(profile.configPath,json(document),transactionId);workspaceWrittenSha256=hash(profile.configPath);
      let returned=read(profile.configPath);for(const key of profile.configKeys)returned=returned[key];if(json(returned.architecture)!==json(entry))throw Error('NATIVE_CONFIGURATION_READBACK_FAILED');registered=true;
    }
    const record={schema:'architecture-manager-native-client/v1',platformId,profile,entry,registered,nativeConfigSha256:profile.configPath?hash(profile.configPath):null,nativeVendorClientVerified:false,status:registered?'registered-pending-native-call':'interface-required',reason:profile.reason || (profile.supportsDirectProbe?'原生工具调用尚未执行':'厂商配置已注册；尚无已验证的无模型工具调用接口，不能标记完整接入。'),backupPath:registered?backupPath:null,registeredAt:new Date().toISOString()};
    fs.mkdirSync(dirname(statePath(workspaceRoot,platformId)),{recursive:true});atomicWrite(statePath(workspaceRoot,platformId),json(record),transactionId);
    if(registered) {
      fs.writeFileSync(join(dirname(backupPath),'RESTORE.md'),`# 原生配置私有备份\n\n可能含凭据，采用当前 Windows 用户 DPAPI 加密，不入库。恢复演练：解密到独立文件后逐字节比较成功，临时件已删除。\n\n恢复：向管理台 native_client.py 传入 JSON {"operation":"restore","backupPath":${JSON.stringify(backupPath)}}；使用本平台登记的 Python。目标 ${profile.configPath}，恢复前核对当前配置，避免覆盖随后更改。\n`);
    }
    writeAudit({auditRoot,actor,transactionId,plan,action:plan.kind,status:'applied',target:platformId,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,oldSha256:plan.payload.bindingBefore,newSha256:hash(statePath(workspaceRoot,platformId)),now:record.registeredAt,writePerformed:true});
    if(profile.supportsDirectProbe)return {...await probeNativeClient({workspaceRoot,platformId},{registerCancel}),registered:true,writePerformed:true};
    return {...record,architectureComplete:false,writePerformed:true};
  }catch(error){
    if(profile.kind==='workspace-mcp'&&!registered&&workspaceWrittenSha256&&hash(profile.configPath)===workspaceWrittenSha256)await helper(plan,{operation:'restore',backupPath},options).catch(()=>{});
    // A failed tool probe does not undo valid registration. A failed registration restores it.
    // Codex's writer restores its own failed write. Never replace a concurrently edited file here.
    // WorkBuddy uses its atomic native writer; a failed registration keeps the encrypted checkpoint.
    writeAudit({auditRoot,actor,transactionId,plan,action:plan.kind,status:registered?'registered-probe-failed':'failed-preserved-checkpoint',target:platformId,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,error:error.message,now:new Date().toISOString()});
    throw error;
  }
}

function toolObject(result) {
  if(result?.isError)throw Error('NATIVE_CLIENT_TOOL_FAILED');
  try{return result.structuredContent || JSON.parse(result.content.find(value=>value.type==='text').text);}catch{throw Error('NATIVE_CLIENT_RECEIPT_MISMATCH');}
}
export function validateNativeReceipt(response,expected) {
  const receipt=toolObject(response.receipt),resources=toolObject(response.resources);
  if(response.modelTurnStarted!==false || response.transport!=='vendor-app-server' || receipt.schema!=='architecture-client-receipt/v1' || !['challenge','platformId','configSha256','versionsSha256'].every(key=>receipt[key]===expected[key]) || receipt.businessRunExecuted!==false)throw Error('NATIVE_CLIENT_RECEIPT_MISMATCH');
  if(!['tool','agent','software'].every(name=>resources[name] && Number.isInteger(receipt.registriesRead?.[name])))throw Error('NATIVE_CLIENT_THREE_REPOS_REQUIRED');
  const releases={};
  for(const repo of ['tool','agent','software']){
    const release=toolObject(response.releases?.[repo]),pin=expected.releases?.[repo];
    if(!pin || !['id','version','hashManifestSha256'].every(key=>release[key]===pin[key]) || release.repository!==repo || release.readOnly!==true || release.businessRunExecuted!==false || !release.files?.['manifest.json'])throw Error('NATIVE_CLIENT_FROZEN_RELEASE_REQUIRED');
    releases[repo]={repository:repo,id:release.id,version:release.version,hashManifestSha256:release.hashManifestSha256,filesRead:Object.keys(release.files).length};
  }
  return {receipt,registriesRead:receipt.registriesRead,releases};
}

export async function probeNativeClient(input,options={}){
  const record=read(statePath(input.workspaceRoot,input.platformId));
  if(!record.profile.supportsDirectProbe)return performNativeProbe(input,options);
  recordNativeAttempt(input.workspaceRoot,input.platformId,'pending');
  try{const result=await performNativeProbe(input,options);recordNativeAttempt(input.workspaceRoot,input.platformId,'passed');return result;}
  catch(error){recordNativeAttempt(input.workspaceRoot,input.platformId,'failed',error.message);throw error;}
}
async function performNativeProbe({workspaceRoot,platformId},{registerCancel=()=>{}}={}) {
  const record=read(statePath(workspaceRoot,platformId));
  if(!record.profile.supportsDirectProbe){const current=nativeClientStatus(workspaceRoot,platformId);if(current.nativeVendorClientVerified)return {...current,writePerformed:false};}
  if(!record.registered || !record.profile.supportsDirectProbe)return {...record,nativeVendorClientVerified:false,architectureComplete:false,writePerformed:false};
  const profile=selectNativeProfile(workspaceRoot,platformId,record.profile.bodyPath);
  assertNativeClientBinding(record,profile);
  const snapshot=readOnboardingConfig({workspaceRoot,platformId}),binding=clientBinding(workspaceRoot,platformId);
  const service=read(targetPath(workspaceRoot,`${platformId}/bridge/client-adapter.json`)).server;
  if(!service || service.executable!==record.entry.command || json(service.args)!==json(record.entry.args))throw Error('NATIVE_CLIENT_BINDING_CHANGED');
  const releases={};
  for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']]){
    const registry=read(targetPath(workspaceRoot,repo+'/registry.json')),row=registry[key]?.find(value=>value.enabled!==false && /^[a-z0-9][a-z0-9._-]*$/.test(value.id));
    if(!row)throw Error('NATIVE_CLIENT_FROZEN_RELEASE_REQUIRED');
    const pointer=read(targetPath(workspaceRoot,`${repo}/${row.id}/current.json`));releases[repo]={id:row.id,version:pointer.version,hashManifestSha256:hash(targetPath(workspaceRoot,`${repo}/${row.id}/versions/${pointer.version}/SHA256SUMS`))};
  }
  const expected={...binding,challenge:randomBytes(24).toString('hex'),releases};
  const plan={workspaceRoot,target:{platformId},planId:'probe-'+randomUUID(),payload:{python:snapshot.fields.pythonExecutable}};
  const response=await helper(plan,{operation:'probe',profile,cwd:targetPath(workspaceRoot,platformId),entry:record.entry,challenge:expected,releases},{registerCancel});
  const proof=validateNativeReceipt(response,expected);
  if(response.configSha256!==record.nativeConfigSha256 || json(clientBinding(workspaceRoot,platformId))!==json(binding))throw Error('NATIVE_CLIENT_BINDING_CHANGED');
  const result={schema:'architecture-manager-native-proof/v1',platformId,status:'native-read-verified',...binding,nativeConfigSha256:record.nativeConfigSha256,profile,serviceSha256:hash(service.args.find(path=>path.endsWith('mcp_service.py'))),...proof,challenge:expected.challenge,nativeVendorClientVerified:true,proofScope:'native-three-repository-frozen-release-read',softwareBusinessExecuted:false,businessRunExecuted:false,modelTurnStarted:false,checkedAt:new Date().toISOString()};
  const evidencePath=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/${plan.planId}/proof.json`);fs.mkdirSync(dirname(evidencePath),{recursive:true});atomicWrite(evidencePath,json(result),randomUUID());
  const latest=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/latest.json`);atomicWrite(latest,json({...result,evidencePath,evidenceSha256:hash(evidencePath)}),randomUUID());
  return {...result,registered:true,evidencePath,writePerformed:true};
}

export function nativeClientStatus(workspaceRoot,platformId) {
  try{
    const record=read(statePath(workspaceRoot,platformId));
    const latest=read(targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/latest.json`));
    const attemptPath=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/last-attempt.json`),attempt=fs.existsSync(attemptPath)?read(attemptPath):null;
    if(nativeAttemptBlocksProof(attempt,latest))return {registered:record.registered,nativeVendorClientVerified:false,status:attempt.status==='pending'?'native-probe-pending':'native-probe-failed',reason:attempt.error,lastSuccessfulProofAt:latest.checkedAt,profile:record.profile};
    const binding=clientBinding(workspaceRoot,platformId),service=read(targetPath(workspaceRoot,`${platformId}/bridge/client-adapter.json`)).server;
    const traceCurrent=latest.modelTurnStarted===false || (['vendor-cli-model-tool-trace','vendor-client-session-tool-trace'].includes(latest.transport) && hash(latest.tracePath)===latest.traceSha256);
    const current=record.registered && traceCurrent && latest.proofScope==='native-three-repository-frozen-release-read' && json(selectNativeProfile(workspaceRoot,platformId,record.profile.bodyPath))===json(latest.profile) && hash(record.profile.configPath)===latest.nativeConfigSha256 && hash(latest.evidencePath)===latest.evidenceSha256 && ['configSha256','versionsSha256','adapterSha256'].every(key=>binding[key]===latest[key]) && hash(service.args.find(path=>path.endsWith('mcp_service.py')))===latest.serviceSha256;
    return {registered:record.registered,nativeVendorClientVerified:Boolean(current && latest.nativeVendorClientVerified),status:current?latest.status:'native-proof-stale',profile:record.profile,proofScope:latest.proofScope,modelTurnStarted:latest.modelTurnStarted};
  }catch{
    try{const record=read(statePath(workspaceRoot,platformId));return {registered:record.registered,nativeVendorClientVerified:false,status:record.status,reason:record.reason,profile:record.profile};}catch{return {registered:false,nativeVendorClientVerified:false,status:'native-body-required',reason:'请选择平台本体，注册并验证原生客户端。'};}
  }
}
export function verifyNativeClient(plan){const state=nativeClientStatus(plan.workspaceRoot,plan.target.platformId);return {ok:state.registered || state.status==='interface-required',...state,architectureComplete:false,writePerformed:false};}
// Single source of truth for the native binding (D-147): the fresh profile must
// equal the registered one byte-for-byte (vendor body/cli hashes included) and
// the registered config hash must still match the file on disk. Both the direct
// probe and the AI probe assert through here so their criteria cannot drift.
export function assertNativeClientBinding(record,profile){
  if(!record?.registered || json(profile)!==json(record.profile) || hash(profile.configPath)!==record.nativeConfigSha256)throw Error('NATIVE_CLIENT_BINDING_CHANGED');
}
