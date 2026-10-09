import fs from 'node:fs';
import {join,extname,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {buildRuntimeBodyPlan,applyRuntimeBody,verifyRuntimeBody} from './runtime-body.mjs';
import {assertIntakeUnchanged} from './sources.mjs';
import {buildOnboardingConfigPlan,applyOnboardingConfig} from '../../onboarding-config.mjs';
import {buildOnboardingClientPlan,applyOnboardingClient} from '../../onboarding-client.mjs';
import {buildOnboardingGovernancePlan,applyOnboardingGovernance} from '../../onboarding-governance.mjs';
import {plannedFiles,applyGeneratedFiles,verifyFiles} from '../../transactions/onboarding-files.mjs';
import {atomicWrite,requirePlan} from '../../transactions/kernel.mjs';
import {gitText,gitRaw} from '../../infrastructure/git.mjs';
const encode=value=>JSON.stringify(value,null,2)+'\n';
function nativeDescriptor(configuration,placement,intake,clientMode,clientArgs,clientIdentity) {
  const entry=intake.files.find(row=>row.path===intake.selectedEntry && row.included),platformId=placement.target.platformId,body=join(placement.target.path,intake.selectedEntry),configFile=configuration.payload.files.find(file=>file.path.endsWith('-config.json') || file.path.endsWith('/runner-config.json'));
  const interpreter=configFile?JSON.parse(configFile.content).interpreters?.['.py']:null,extension=extname(body).toLowerCase(),executable=extension==='.py'?interpreter:extension==='.exe'?body:configuration.target.inputs.clientRuntimeExecutable || body,adapter=targetPath(intake.workspaceRoot,`${platformId}/bridge/client-adapter.json`),registration=targetPath(intake.workspaceRoot,`${platformId}/bridge/manager-client/mcp-client-registration.json`);
  const replacements={'{client-body}':body,'{client-descriptor}':adapter,'{mcp-registration}':registration,'{runner-config}':targetPath(intake.workspaceRoot,configuration.payload.files.find(file=>file.path===configuration.target.platformId+'/bridge/runner-config.json' || file.path.endsWith('-config.json')).path)},args=[...(extension==='.py'?['-B',body]:[]),...clientArgs.map(arg=>replacements[arg] || arg)];
  return {schema:'architecture-manager-client/v1',platformId,kind:clientMode==='json-cli'?'cli':'manual-native',executable,args,clientIdentity,sourceBody:{planId:placement.planId,path:body,entrySha256:entry.sha256,sourceFingerprint:intake.sourceFingerprint,mode:clientMode},nativeVerified:false,installedClient:false,interfaceRequired:clientMode==='manual-native',notes:clientMode==='json-cli'?'User provided JSON-stdin client; receipt challenge must pass independently.':'GUI program body installed; native MCP/CLI interface or login still pending.'};
}
export async function buildPlatformBodyPlan({intake,platformId,displayName='',fields={},confirmed=false,clientMode='manual-native',clientArgs=[],clientIdentity='architecture-json-cli-client',now=new Date().toISOString()}) {
  if(intake.type!=='platform' || !['manual-native','json-cli'].includes(clientMode))throw Error('INTAKE_TYPE_INVALID');
  await assertIntakeUnchanged(intake);const entry=intake.files.find(row=>row.path===intake.selectedEntry && row.included);if(!entry || !entry.runnable || entry.installer)throw Error('PLATFORM_INSTALLATION_REQUIRED');
  if(!Array.isArray(clientArgs) || clientArgs.some(arg=>typeof arg!=='string'))throw Error('CLIENT_ARGUMENTS_INVALID');
  const configuration=buildOnboardingConfigPlan({workspaceRoot:intake.workspaceRoot,platformId,confirmed,fields:{...fields,displayName}}),placement=buildRuntimeBodyPlan({intake,platformId,resourceId:'platform-client'});
  const native=nativeDescriptor(configuration,placement,intake,clientMode,clientArgs,clientIdentity),adapterPath=`${platformId}/bridge/client-adapter.json`;
  const configFile=configuration.payload.files.find(file=>file.path.endsWith('-config.json') || file.path.endsWith('/runner-config.json')),governance=buildOnboardingGovernancePlan({workspaceRoot:intake.workspaceRoot,platformId,stagedConfig:JSON.parse(configFile.content),now});
  return {schema:'architecture-manager-plan/v1',kind:'platform-body',planId:'platform-body-'+randomUUID(),workspaceRoot:intake.workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,creating:configuration.target.creating,nativeBodyPath:native.sourceBody.path,clientMode,clientArgs,clientIdentity,userAuthorized:configuration.target.userAuthorized},payload:{configuration,placement,native,adapterPath,governance},steps:[{operation:'save-platform-configuration',targets:configuration.payload.files.map(row=>row.path)},{operation:'register-platform-as-pending',targets:governance.payload.files.map(row=>row.path)},{operation:'backup-restore-and-place-client',target:placement.target.path},{operation:'install-architecture-service-and-native-descriptor',target:adapterPath}],verification:['real body backup restored','source unchanged','native body distinct from facade','real client challenge required; floor and first matrix still required']};
}
function rollbackAnchor(root,configuration) {
  const head=gitText(root,['rev-parse','HEAD']);
  for(const file of configuration.payload.files.filter(row=>row.beforeSha256))if(sha256(gitRaw(root,['show',head+':'+file.path],{encoding:null}))!==file.beforeSha256)throw Error('IMPORT_GIT_BASELINE_REQUIRED');return head;
}
export async function applyPlatformBody(plan,{auditRoot=defaultAuditRoot(),actor='local-user',onProgress=()=>{}}={}) {
  requirePlan(plan);if(plan.kind!=='platform-body' || plan.payload.configuration.target.platformId!==plan.target.platformId || plan.payload.placement.target.platformId!==plan.target.platformId || plan.payload.native.platformId!==plan.target.platformId)throw Error('PLAN_PAYLOAD_MISMATCH');
  const configFile=plan.payload.configuration.payload.files.find(file=>file.path.endsWith('-config.json') || file.path.endsWith('/runner-config.json'));
  if([plan.payload.configuration,plan.payload.placement,plan.payload.governance].some(part=>part.workspaceRoot!==plan.workspaceRoot) || !configFile || stableJson(JSON.parse(configFile.content))!==stableJson(plan.payload.governance.target.stagedConfig))throw Error('PLAN_PAYLOAD_MISMATCH');
  const expected=nativeDescriptor(plan.payload.configuration,plan.payload.placement,plan.payload.placement.payload.intake,plan.target.clientMode,plan.target.clientArgs,plan.target.clientIdentity);
  if(stableJson(expected)!==stableJson(plan.payload.native) || plan.target.nativeBodyPath!==expected.sourceBody.path || plan.payload.adapterPath!==`${plan.target.platformId}/bridge/client-adapter.json`)throw Error('PLAN_PAYLOAD_MISMATCH');
  const journalPath=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-onboarding/body-${plan.planId}.json`),digest=sha256(stableJson(plan));let journal=fs.existsSync(journalPath)?readJson(journalPath):{schema:'architecture-manager-platform-body/v1',planDigest:digest,status:'prepared',steps:[]};
  if(journal.planDigest!==digest)throw Error('PLAN_PAYLOAD_MISMATCH');if(journal.status==='complete'){const verification=verifyPlatformBody(plan);if(!verification.ok)throw Error('IMPORT_EXTERNAL_CHANGE');return {status:'already-applied',verification};}
  const save=()=>{fs.mkdirSync(dirname(journalPath),{recursive:true});atomicWrite(journalPath,encode(journal),plan.planId);};
  const assertBindings=()=>{for(const [path,digest] of Object.entries(journal.bindings || {})){const absolute=targetPath(plan.workspaceRoot,path);if(!fs.existsSync(absolute) || sha256(fs.readFileSync(absolute))!==digest)throw Error('IMPORT_EXTERNAL_CHANGE');}};
  const settled=(step,files=[])=>{journal.bindings ||= {};for(const file of files)journal.bindings[file.path]=sha256(fs.readFileSync(targetPath(plan.workspaceRoot,file.path)));journal.steps.push(step);save();onProgress({phase:'平台本体接入安全点',step,completed:journal.steps.length,total:5});};
  try {
    assertBindings();
    if(!journal.steps.includes('configuration')) {journal.rollbackHead=rollbackAnchor(plan.workspaceRoot,{payload:{files:[...plan.payload.configuration.payload.files,...plan.payload.governance.payload.files]}});applyOnboardingConfig(plan.payload.configuration,{auditRoot,actor});settled('configuration',plan.payload.configuration.payload.files);}
    if(!journal.steps.includes('governance')) {assertBindings();applyOnboardingGovernance(plan.payload.governance,{auditRoot,actor});settled('governance',plan.payload.governance.payload.files);}
    if(!journal.steps.includes('body')) {assertBindings();await applyRuntimeBody({plan:plan.payload.placement},{auditRoot,actor,onProgress});settled('body');}
    if(!journal.steps.includes('service')) {assertBindings();const service=buildOnboardingClientPlan({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId});applyOnboardingClient(service,{auditRoot,actor});settled('service',service.payload.files);}
    const adapterPath=targetPath(plan.workspaceRoot,plan.payload.adapterPath),standard=readJson(adapterPath),native={...plan.payload.native,server:standard.server || {executable:standard.executable,args:standard.args}};
    const files=plannedFiles(plan.workspaceRoot,[{path:plan.payload.adapterPath,content:encode(native)}]),binding={schema:'architecture-manager-plan/v1',kind:'platform-native-bind',planId:plan.planId+'-binding',workspaceRoot:plan.workspaceRoot,applyMode:'confirmation-required',writePerformed:false,target:{platformId:plan.target.platformId},payload:{files},steps:[]};
    if(!journal.steps.includes('native')) {assertBindings();applyGeneratedFiles(binding,()=>binding,{auditRoot,actor});journal.nativeSha256=sha256(encode(native));settled('native',files);}
    if(!verifyRuntimeBody({plan:plan.payload.placement}).ok || sha256(fs.readFileSync(adapterPath))!==journal.nativeSha256)throw Error('IMPORT_EXTERNAL_CHANGE');
    journal.status='complete';journal.nativeStatus=plan.target.clientMode==='manual-native'?'interface-required':'challenge-required';save();return {status:'body-installed-native-pending',bodyPath:plan.target.nativeBodyPath,entrySha256:plan.payload.native.sourceBody.entrySha256,nativeStatus:journal.nativeStatus,architectureComplete:false,verification:verifyPlatformBody(plan),journalPath};
  }catch(error){journal.status='interrupted';journal.error=error.message;save();throw error;}
}
export function verifyPlatformBody(plan) {
  const placement=verifyRuntimeBody({plan:plan.payload.placement}),adapter=targetPath(plan.workspaceRoot,plan.payload.adapterPath);let native=false;try{const value=readJson(adapter);native=value.platformId===plan.target.platformId && stableJson(value.sourceBody)===stableJson(plan.payload.native.sourceBody) && sha256File(plan.target.nativeBodyPath)===value.sourceBody.entrySha256;}catch{/* Missing descriptor/body is not a pass. */}
  return {ok:placement.ok && native,bodyInstalled:placement.ok,nativeDescriptorBound:native,nativeClientVerified:false,architectureComplete:false,writePerformed:false};
}
