import fs from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {selectNativeProfile} from './native-profile.mjs';
import {validateNativeAiEvents} from './native-ai-probe.mjs';
import {readOnboardingConfig} from '../onboarding/onboarding-config.mjs';
import {clientBinding} from '../onboarding/onboarding-client.mjs';
import {targetPath} from '../../core/paths.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {parseJsonc} from '../../core/jsonc.mjs';
import {atomicWrite} from '../../transactions/kernel.mjs';
import {recordNativeAttempt} from './native-attempt.mjs';

const read=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const json=value=>JSON.stringify(value,null,2)+'\n';
const statePath=(root,id)=>targetPath(root,`${id}/bridge/native-client.json`);
const TOOL='mcp__architecture__architecture_verify';

export function sessionTranscriptEvents(text,sessionId) {
  return text.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}})
    .filter(event=>event&&typeof event==='object'&&(!sessionId||event.sessionId===sessionId)&&['assistant','user'].includes(event.type));
}

function openAttempt({workspaceRoot,platformId,attemptId}) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(attemptId))throw Error('INVALID_ATTEMPT_ID');
  const record=read(statePath(workspaceRoot,platformId));
  if(!record.registered||record.profile?.kind!=='workspace-mcp'||record.profile?.vendor!=='Qoder')throw Error('NATIVE_CLIENT_SESSION_PROOF_UNSUPPORTED');
  const profile=selectNativeProfile(workspaceRoot,platformId,record.profile.bodyPath);
  if(json(profile)!==json(record.profile)||sha256File(profile.configPath)!==record.nativeConfigSha256)throw Error('NATIVE_CLIENT_BINDING_CHANGED');
  const service=read(targetPath(workspaceRoot,`${platformId}/bridge/client-adapter.json`)).server;
  if(!service||service.executable!==record.entry.command||json(service.args)!==json(record.entry.args))throw Error('NATIVE_CLIENT_BINDING_CHANGED');
  const cwd=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/session-${attemptId}`);
  return {record,profile,service,cwd,serviceSha256:sha256File(service.args.find(path=>String(path).endsWith('mcp_service.py')))};
}

function frozenReleasePins(workspaceRoot) {
  const releases={};
  for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']]){
    const row=read(targetPath(workspaceRoot,repo+'/registry.json'))[key]?.find(item=>item.enabled!==false&&/^[a-z0-9][a-z0-9._-]*$/.test(item.id));
    if(!row)throw Error('NATIVE_CLIENT_FROZEN_RELEASE_REQUIRED');
    const pointer=read(targetPath(workspaceRoot,`${repo}/${row.id}/current.json`));
    releases[repo]={id:row.id,version:pointer.version,hashManifestSha256:sha256File(targetPath(workspaceRoot,`${repo}/${row.id}/versions/${pointer.version}/SHA256SUMS`))};
  }
  return releases;
}

// The client only reads MCP servers from its user-level settings, so the verification channel is registered there for the duration of one challenge.
export function writeSessionProbeConfig({configPath,service,probeFile,attemptId,allowReplace=false}) {
  const before=fs.existsSync(configPath)?fs.readFileSync(configPath,'utf8'):null;
  const document=before===null?{}:parseJsonc(before);
  document.mcpServers ||= {};
  if(document.mcpServers.architecture&&!allowReplace)throw Error('NATIVE_SERVER_NAME_CONFLICT');
  document.mcpServers.architecture={command:service.executable,args:[...service.args,'--native-probe-file',probeFile],type:'stdio',disabled:false};
  atomicWrite(configPath,json(document),attemptId);
  return {before,beforeSha256:before===null?null:sha256(before),afterSha256:sha256File(configPath)};
}

export function restoreSessionProbeConfig({configPath,before,beforeSha256,attemptId}) {
  if(before===null){const document=parseJsonc(fs.readFileSync(configPath,'utf8'));delete document.mcpServers.architecture;atomicWrite(configPath,json(document),attemptId);}
  else fs.writeFileSync(configPath,before,'utf8');
  const after=sha256File(configPath);
  if(beforeSha256!==null&&after!==beforeSha256)throw Error('NATIVE_CLIENT_SESSION_CONFIG_RESTORE_FAILED');
  return after;
}

export function prepareNativeClientSessionProof({workspaceRoot,platformId,attemptId=randomUUID(),configDir=join(homedir(),'.qoder')}) {
  const {profile,service,cwd,serviceSha256}=openAttempt({workspaceRoot,platformId,attemptId});
  fs.mkdirSync(cwd,{recursive:true});
  if(fs.existsSync(join(cwd,'attempt.json')))throw Error('NATIVE_CLIENT_SESSION_ATTEMPT_ALREADY_USED');
  readOnboardingConfig({workspaceRoot,platformId});
  const expected={...clientBinding(workspaceRoot,platformId),challenge:randomBytes(24).toString('hex'),releases:frozenReleasePins(workspaceRoot)};
  const probeFile=join(cwd,'challenge.json');
  fs.writeFileSync(probeFile,json(expected));
  const configPath=join(configDir,'mcp.json');
  const channel=writeSessionProbeConfig({configPath,service,probeFile,attemptId});
  fs.writeFileSync(join(cwd,'attempt.json'),json({attemptId,platformId,consent:true,stage:'awaiting-client-session',configPath,...channel,startedAt:new Date().toISOString()}),{flag:'wx'});
  recordNativeAttempt(workspaceRoot,platformId,'pending');
  return {schema:'architecture-manager-native-session/v1',attemptId,platformId,challenge:expected.challenge,expected,probeFile,cwd,tool:TOOL,...channel,serviceSha256,profile,
    instruction:`Call ${TOOL} exactly once with ${json({challenge:expected.challenge,platformId}).trim()}. Do not call any other tool, do not answer from memory, and do not repeat the call.`};
}

export function restoreNativeClientSessionConfig({workspaceRoot,platformId,attemptId}) {
  const {cwd}=openAttempt({workspaceRoot,platformId,attemptId});
  const marker=read(join(cwd,'attempt.json'));
  const restored=restoreSessionProbeConfig(marker);
  fs.writeFileSync(join(cwd,'attempt.json'),json({...marker,stage:'cancelled',restoredAt:new Date().toISOString(),restoredSha256:restored}));
  recordNativeAttempt(workspaceRoot,platformId,'failed','NATIVE_CLIENT_SESSION_ATTEMPT_CANCELLED');
  return {ok:true,attemptId,configPath:marker.configPath,restoredSha256:restored};
}

export function finalizeNativeClientSessionProof({workspaceRoot,platformId,attemptId,transcriptPath,sessionId,aiConsent=false}) {
  const {record,profile,cwd,serviceSha256}=openAttempt({workspaceRoot,platformId,attemptId});
  if(aiConsent!==true)throw Error('NATIVE_AI_CONSENT_REQUIRED');
  const marker=read(join(cwd,'attempt.json'));
  const expected=read(join(cwd,'challenge.json'));
  try {
    if(marker.stage!=='awaiting-client-session')throw Error('NATIVE_CLIENT_SESSION_ATTEMPT_NOT_AWAITING');
    // The facade refuses a second call and marks the challenge file; that claim is what proves a live call happened.
    if(!fs.existsSync(`${join(cwd,'challenge.json')}.called`))throw Error('NATIVE_CLIENT_SESSION_CALL_UNCLAIMED');
    if(sha256File(marker.configPath)!==marker.afterSha256)throw Error('NATIVE_CLIENT_BINDING_CHANGED');
    if(!fs.existsSync(transcriptPath))throw Error('NATIVE_CLIENT_TRANSCRIPT_MISSING');
    const entries=sessionTranscriptEvents(fs.readFileSync(transcriptPath,'utf8'),sessionId);
    const proof=validateNativeAiEvents(entries,expected);
    const binding=clientBinding(workspaceRoot,platformId);
    if(['configSha256','versionsSha256','adapterSha256'].some(key=>binding[key]!==expected[key]))throw Error('NATIVE_CLIENT_BINDING_CHANGED');
    const tracePath=join(cwd,'native-trace.private.jsonl');
    fs.writeFileSync(tracePath,entries.map(event=>JSON.stringify(event)).join('\n')+'\n');
    const value={schema:'architecture-manager-native-proof/v1',platformId,status:'native-read-verified',...binding,profile,nativeConfigSha256:record.nativeConfigSha256,serviceSha256,...proof,challenge:expected.challenge,
      nativeVendorClientVerified:true,proofScope:'native-three-repository-frozen-release-read',softwareBusinessExecuted:false,businessRunExecuted:false,modelTurnStarted:true,
      transport:'vendor-client-session-tool-trace',sessionChannelConfigPath:marker.configPath,sessionChannelBeforeSha256:marker.beforeSha256,sessionChannelAfterSha256:marker.afterSha256,sessionId,attemptId,
      tracePath,traceSha256:sha256File(tracePath),checkedAt:new Date().toISOString()};
    const evidencePath=join(cwd,'proof.json');
    atomicWrite(evidencePath,json(value),randomUUID());
    atomicWrite(targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/latest.json`),json({...value,evidencePath,evidenceSha256:sha256File(evidencePath)}),randomUUID());
    restoreSessionProbeConfig(marker);
    fs.writeFileSync(join(cwd,'attempt.json'),json({...marker,stage:'passed',sessionId,transcriptPath,finishedAt:new Date().toISOString()}));
    recordNativeAttempt(workspaceRoot,platformId,'passed');
    return {...value,registered:true,writePerformed:true};
  } catch(error) {
    try{restoreSessionProbeConfig(marker);}catch{error.message=`${error.message}; NATIVE_CLIENT_SESSION_CONFIG_UNRESTORED`;}
    fs.writeFileSync(join(cwd,'failed.json'),json({status:'native-ai-verification-failed',error:error.message,attemptId,sessionId,transcriptPath,checkedAt:new Date().toISOString()}));
    recordNativeAttempt(workspaceRoot,platformId,'failed',error.message);
    throw error;
  }
}
