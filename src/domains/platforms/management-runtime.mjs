import fs from 'node:fs';
import {basename,dirname,join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {targetPath} from '../../core/paths.mjs';
import {sha256File} from '../../core/hash.mjs';

export function managementRuntimePlan(root,platformId){
  const target=targetPath(root,`${platformId}/runtime/manager-node/node.exe`);
  const candidates=[process.execPath,...String(process.env.PATH || '').split(';').map(folder=>join(folder,'node.exe')),target];
  let source=null;
  for(const candidate of [...new Set(candidates)]){
    if(!fs.existsSync(candidate)||basename(candidate).toLowerCase()!=='node.exe')continue;
    const own=relative(root,fs.realpathSync(candidate)).replaceAll('\\','/');
    if(!own.startsWith('../')&&!/^[a-z]:/i.test(own)&&!own.startsWith(platformId+'/'))continue;
    const result=spawnSync(candidate,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true});
    if(result.status===0&&Number(result.stdout.match(/^v(\d+)/)?.[1])>=18){source=candidate;break;}
  }
  if(!source)throw Error('MANAGEMENT_NODE_REQUIRED');
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
