import fs from 'node:fs';
import {basename,dirname,join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {targetPath} from '../../core/paths.mjs';
import {sha256File} from '../../core/hash.mjs';

const NODE_BASENAME='node.exe';
const NODE_MAJOR_MINIMUM=18;
const OUTCOME_OK='ok';
const OUTCOME_MISSING='missing';
const OUTCOME_NOT_NODE='not-node';
const OUTCOME_SCOPE='out-of-scope';
const OUTCOME_LAUNCH='launch-failed';
const OUTCOME_VERSION='version-unsupported';

// D-164: the old loop treated "cannot launch" exactly like "not installed" — a spawn
// failure only skipped the candidate, so the run ended in MANAGEMENT_NODE_REQUIRED with an
// "install Node" hint even though Node was on PATH. Launch failures are no longer swallowed:
// they are reported as NODE_SPAWN_FAILED carrying the failing candidate and the reason, while
// a genuinely absent Node keeps its own NODE_NOT_FOUND code.
function clean(value){return String(value ?? '').trim().replace(/^"+|"+$/g,'');}
function oneLine(value,limit=160){const text=String(value ?? '').replace(/\s+/g,' ').trim();return text.length>limit?`...${text.slice(-limit)}`:text;}
function installedNodeFolders(env){
  const folders=[];
  for(const base of [env.ProgramFiles,env['ProgramFiles(x86)'],env.LOCALAPPDATA,env.APPDATA]){
    if(!base)continue;
    for(const tail of ['nodejs',join('Programs','nodejs')])folders.push(join(clean(base),tail));
  }
  return folders;
}
function spawnNodeVersion(candidate){
  return spawnSync(candidate,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true});
}
function whereNode(){
  if(process.platform!=='win32')return [];
  const finder=join(clean(process.env.SystemRoot) || 'C:\\Windows','System32','where.exe');
  const result=spawnSync(finder,[NODE_BASENAME],{encoding:'utf8',timeout:5000,windowsHide:true});
  if(result.error||result.status!==0||!result.stdout)return [];
  return String(result.stdout).split(/\r?\n/).map(clean).filter(Boolean);
}
function nodeDiscoveryError(attempts){
  const searched=`searched=${attempts.length}`;
  const launch=attempts.find(attempt=>attempt.outcome===OUTCOME_LAUNCH);
  if(launch)return `NODE_SPAWN_FAILED:candidate=${launch.candidate};errorCode=${launch.errorCode || 'none'};exitCode=${launch.exitCode===null?'none':launch.exitCode};stderr=${launch.stderr || 'none'};${searched}`;
  const unsupported=attempts.find(attempt=>attempt.outcome===OUTCOME_VERSION);
  if(unsupported)return `NODE_VERSION_UNSUPPORTED:candidate=${unsupported.candidate};version=${unsupported.version || 'unknown'};minimum=v${NODE_MAJOR_MINIMUM};${searched}`;
  const summary=attempts.reduce((totals,attempt)=>({...totals,[attempt.outcome]:(totals[attempt.outcome] || 0)+1}),{});
  const outcomes=Object.entries(summary).map(([outcome,count])=>`${outcome}=${count}`).join(',');
  return `NODE_NOT_FOUND:${searched};outcomes=${outcomes || 'none'}`;
}
export function managementNodeCandidates({env=process.env,execPath=process.execPath,resolver=whereNode,target=null}={}){
  const ordered=[];
  // Only a real node executable may stand in for process.execPath: the packaged Electron
  // binary is a node host but its basename never is node.exe.
  if(basename(execPath).toLowerCase()===NODE_BASENAME)ordered.push(execPath);
  for(const folder of String(env.PATH ?? '').split(';').map(clean).filter(Boolean))ordered.push(join(folder,NODE_BASENAME));
  for(const folder of installedNodeFolders(env))ordered.push(join(folder,NODE_BASENAME));
  for(const found of resolver ? resolver() : [])ordered.push(found);
  if(target)ordered.push(target);
  return [...new Map(ordered.map(candidate=>[candidate.toLowerCase(),candidate])).values()];
}
export function discoverManagementNode({root,platformId,env=process.env,execPath=process.execPath,resolver=whereNode,probe=spawnNodeVersion}={}){
  const target=targetPath(root,`${platformId}/runtime/manager-node/node.exe`);
  const attempts=[];let source=null;
  for(const candidate of managementNodeCandidates({env,execPath,resolver,target})){
    if(!fs.existsSync(candidate)){attempts.push({candidate,outcome:OUTCOME_MISSING});continue;}
    if(basename(candidate).toLowerCase()!==NODE_BASENAME){attempts.push({candidate,outcome:OUTCOME_NOT_NODE});continue;}
    let own=null;
    try{own=relative(root,fs.realpathSync(candidate)).replaceAll('\\','/');}catch{own=null;}
    if(own===null||(!own.startsWith('../')&&!/^[a-z]:/i.test(own)&&!own.startsWith(`${platformId}/`))){attempts.push({candidate,outcome:OUTCOME_SCOPE,detail:own});continue;}
    const result=probe(candidate) || {};
    const exitCode=typeof result.status==='number'?result.status:null;
    if(result.error||exitCode!==0){attempts.push({candidate,outcome:OUTCOME_LAUNCH,exitCode,errorCode:result.error?.code || null,stderr:oneLine(result.stderr || result.error?.message)});continue;}
    const version=String(result.stdout ?? '').trim().split(/\s+/)[0] || null;
    const major=Number(version?.match(/^v(\d+)/)?.[1]);
    if(!Number.isFinite(major)||major<NODE_MAJOR_MINIMUM){attempts.push({candidate,outcome:OUTCOME_VERSION,version});continue;}
    attempts.push({candidate,outcome:OUTCOME_OK,version});source=candidate;break;
  }
  if(!source)throw Error(nodeDiscoveryError(attempts));
  return {source,target,attempts};
}
export function managementRuntimePlan(root,platformId,options={}){
  const {source,target}=discoverManagementNode({root,platformId,...options});
  return {source,target,sha256:sha256File(source),beforeSha256:fs.existsSync(target)?sha256File(target):null,bytes:fs.statSync(source).size};
}
export function installManagementRuntime(plan){
  const {workspaceRoot,target:{platformId},payload:{managementRuntime:runtime}}=plan;
  if(sha256File(runtime.source)!==runtime.sha256||runtime.target!==targetPath(workspaceRoot,`${platformId}/runtime/manager-node/node.exe`))throw Error('MANAGEMENT_RUNTIME_DRIFT');
  if(fs.existsSync(runtime.target)&&sha256File(runtime.target)===runtime.sha256)return {installed:true,reused:true};
  if((fs.existsSync(runtime.target)?sha256File(runtime.target):null)!==runtime.beforeSha256)throw Error('MANAGEMENT_RUNTIME_DRIFT');
  const directory=targetPath(workspaceRoot,`inbox/backup/${platformId}/manager-node/${runtime.sha256}`);fs.mkdirSync(directory,{recursive:true});
  const payload=join(directory,'node.exe');
  if(!fs.existsSync(payload))fs.copyFileSync(runtime.source,payload,fs.constants.COPYFILE_EXCL);
  if(sha256File(payload)!==runtime.sha256)throw Error('MANAGEMENT_RUNTIME_BACKUP_FAILED');
  const drill=targetPath(workspaceRoot,`${platformId}/runtime/tmp/manager-node-restore-${randomUUID()}.exe`);fs.mkdirSync(dirname(drill),{recursive:true});
  try{fs.copyFileSync(payload,drill);if(sha256File(drill)!==runtime.sha256)throw Error('MANAGEMENT_RUNTIME_BACKUP_FAILED');}finally{if(fs.existsSync(drill))fs.rmSync(drill);}
  fs.writeFileSync(join(directory,'MANIFEST.json'),JSON.stringify({schema:'architecture-manager-runtime-backup/v1',platformId,kind:'node-runtime',containsCredentials:false,sha256:runtime.sha256,bytes:runtime.bytes,target:runtime.target,restoreVerified:true,rebuildCommand:`Copy-Item -LiteralPath '${payload.replaceAll("'","''")}' -Destination '${runtime.target.replaceAll("'","''")}'`,recordedAt:new Date().toISOString()},null,2)+'\n');
  fs.mkdirSync(dirname(runtime.target),{recursive:true});
  const temporary=runtime.target+'.'+randomUUID()+'.tmp';try{fs.copyFileSync(payload,temporary);if(sha256File(temporary)!==runtime.sha256)throw Error('MANAGEMENT_RUNTIME_DRIFT');fs.renameSync(temporary,runtime.target);}finally{if(fs.existsSync(temporary))fs.rmSync(temporary);}
  return {installed:true,backup:directory,restoreVerified:true};
}
