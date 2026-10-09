import fs from '../../core/physical-fs.mjs';
import {join,dirname,relative} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {validPlatformId} from '../../core/platforms.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {entryChunks,assertIntakeUnchanged} from './sources.mjs';
import {sourceRelative} from './paths.mjs';
import {assertScopedActive} from '../../infrastructure/process-scope.mjs';
import {renameOwnedDirectory} from '../../infrastructure/filesystem.mjs';
import {requirePlan,saveCheckpoint,atomicWrite,writeAudit} from '../../transactions/kernel.mjs';
import {gitText} from '../../infrastructure/git.mjs';
const encode=value=>JSON.stringify(value,null,2)+'\n';
export function buildRuntimeBodyPlan({intake,platformId,resourceId,now=new Date().toISOString(),installationId=randomUUID()}) {
  if(!['software','platform'].includes(intake.type) || !validPlatformId(platformId) || !/^[a-z0-9][a-z0-9._-]*$/.test(resourceId || '') || !/^[a-f0-9-]{36}$/.test(installationId))throw Error('IMPORT_TARGET_INVALID');
  const rows=intake.files.filter(row=>row.included).map(({path,sha256,bytes})=>({path,sha256,bytes}));if(!rows.length || !rows.some(row=>row.path===intake.selectedEntry))throw Error('INTAKE_ENTRY_INVALID');
  const root=intake.workspaceRoot,path=targetPath(root,`${platformId}/runtime/software/${resourceId}/${installationId}/body`),backup=targetPath(root,`inbox/backup/${platformId}/manager-bodies/${installationId}`),journal=targetPath(root,`${platformId}/runtime/maintenance/manager-bodies/${installationId}/journal.json`);
  return {schema:'architecture-manager-plan/v1',kind:'software-import',planId:'runtime-body-'+installationId,workspaceRoot:root,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,softwareId:resourceId,resourceId,path,backup,journal,source:intake.sourcePath,intakeKind:'selected-source',installationId,entry:intake.selectedEntry,sourceKind:intake.sourceKind},rows,payload:{intake},steps:[{operation:'verify-original-source',sha256:intake.sourceFingerprint},{operation:'copy-body-backup',target:backup},{operation:'real-restore-and-place',target:path}],estimatedAdditionalBytes:rows.reduce((sum,row)=>sum+row.bytes*2,0),verification:['original source retained','selected runtime dependencies retained','actual restore supplies final body','only own installed tree can resume; no program executed']};
}
function assertBodyPlan(plan) {
  requirePlan(plan);const expected=buildRuntimeBodyPlan({intake:plan.payload.intake,platformId:plan.target.platformId,resourceId:plan.target.resourceId,installationId:plan.target.installationId,now:plan.generatedAt});
  if(stableJson(expected)!==stableJson(plan))throw Error('PLAN_PAYLOAD_MISMATCH');
  for(const row of plan.rows)sourceRelative(row.path);
}
function sums(plan){return plan.rows.map(row=>row.sha256+'  '+row.path).sort().join('\n')+'\n';}
function fileDigest(path) {const hash=createHash('sha256'),file=fs.openSync(path,'r'),chunk=Buffer.allocUnsafe(1024*1024);try{let size;while((size=fs.readSync(file,chunk,0,chunk.length,null))){assertScopedActive();hash.update(chunk.subarray(0,size));}return hash.digest('hex');}finally{fs.closeSync(file);}}
function bodyFiles(directory,prefix='') {return fs.readdirSync(directory,{withFileTypes:true}).flatMap(row=>{if(row.isSymbolicLink())throw Error('INTAKE_LINK_NOT_ALLOWED');return row.isDirectory()?bodyFiles(join(directory,row.name),prefix+row.name+'/'):[{path:prefix+row.name,bytes:fs.statSync(join(directory,row.name)).size}];});}
function verifiedBody(directory,plan) {
  try {
    const rows=bodyFiles(directory).map(row=>({path:row.path,sha256:fileDigest(join(directory,row.path))})).sort((a,b)=>a.path.localeCompare(b.path)),expected=plan.rows.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path));return stableJson(rows)===stableJson(expected);
  }catch(error){if(error.message==='TASK_CANCELLED')throw error;return false;}
}
export function verifyRuntimeBody({plan}) {
  assertBodyPlan(plan);let manifest=null;try{manifest=readJson(join(plan.target.backup,'MANIFEST.json'));}catch{/* Missing backup is not success. */}
  const seal=fs.existsSync(join(plan.target.backup,'SHA256SUMS'))?fs.readFileSync(join(plan.target.backup,'SHA256SUMS'),'utf8'):null;
  return {ok:manifest?.planDigest===sha256(stableJson(plan)) && manifest.restoreDrill?.performed===true && seal===sums(plan) && verifiedBody(plan.target.path,plan) && verifiedBody(join(plan.target.backup,'payload'),plan),target:plan.target.path,backup:plan.target.backup,entry:join(plan.target.path,plan.target.entry),functionExecuted:false,writePerformed:false};
}
async function copySource(intake,rows,destination,onProgress,phase) {
  fs.mkdirSync(destination,{recursive:true});let bytesDone=0;const bytesTotal=rows.reduce((sum,row)=>sum+row.bytes,0);
  if(bodyFiles(destination).some(file=>!rows.some(row=>row.path===file.path && file.bytes<=row.bytes)))throw Error('IMPORT_EXTERNAL_CHANGE');
  for(const [index,row] of rows.entries()) {
    const path=targetPath(destination,row.path);fs.mkdirSync(dirname(path),{recursive:true});
    const exists=fs.existsSync(path),existing=exists?fs.statSync(path).size:0;if(existing>row.bytes)throw Error('IMPORT_EXTERNAL_CHANGE');
    let fd=null;if(existing)fd=fs.openSync(path,'r');
    async function* chunks(){let size=0;for await(const chunk of entryChunks(intake,row)){assertScopedActive();const skipped=Math.max(0,Math.min(chunk.length,existing-size));if(skipped){const previous=Buffer.allocUnsafe(skipped);if(fs.readSync(fd,previous,0,skipped,size)!==skipped || !previous.equals(chunk.subarray(0,skipped)))throw Error('IMPORT_EXTERNAL_CHANGE');}size+=chunk.length;if(size>row.bytes)throw Error('INTAKE_SOURCE_CHANGED');bytesDone+=chunk.length;onProgress({phase,path:row.path,bytesDone,bytesTotal,filesDone:index,filesTotal:rows.length,reusedBytes:Math.min(size,existing)});if(skipped<chunk.length)yield chunk.subarray(skipped);}}
    try{await pipeline(Readable.from(chunks()),fs.createWriteStream(path,{flags:exists?'a':'wx'}));}finally{if(fd!==null)fs.closeSync(fd);}
    if(fileDigest(path)!==row.sha256 || fs.statSync(path).size!==row.bytes)throw Error('INTAKE_SOURCE_CHANGED');onProgress({phase,path:row.path,bytesDone,bytesTotal,filesDone:index+1,filesTotal:rows.length});
  }
}
export async function applyRuntimeBody({plan},{auditRoot=defaultAuditRoot(),actor='local-user',onProgress=()=>{}}={}) {
  assertBodyPlan(plan);
  const bridge=targetPath(plan.workspaceRoot,`${plan.target.platformId}/bridge.json`);if(!fs.existsSync(bridge) || readJson(bridge).platform!==plan.target.platformId || readJson(bridge).shared?.readOnly!==true)throw Error('IMPORT_PLATFORM_REQUIRED');
  let rollbackHead;try{rollbackHead=gitText(plan.workspaceRoot,['rev-parse','HEAD']);}catch{throw Error('IMPORT_GIT_BASELINE_REQUIRED');}
  const directory=dirname(plan.target.journal),digest=sha256(stableJson(plan));fs.mkdirSync(directory,{recursive:true});
  let journal=fs.existsSync(plan.target.journal)?readJson(plan.target.journal):{schema:'architecture-manager-body-placement/v1',planId:plan.planId,planDigest:digest,plan,rollbackHead,status:'prepared'};
  if(journal.planDigest!==digest)throw Error('PLAN_PAYLOAD_MISMATCH');
  if(journal.status==='complete'){const verification=verifyRuntimeBody({plan});if(!verification.ok)throw Error('IMPORT_EXTERNAL_CHANGE');return {status:'already-applied',verification,bodyPath:plan.target.path,entry:verification.entry,backup:plan.target.backup,writePerformed:false};}
  const lock=join(directory,'active.lock');
  if(fs.existsSync(lock)){const owner=readJson(lock);let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw Error('IMPORT_BUSY');fs.renameSync(lock,lock+'-'+randomUUID()+'.expired');}
  let fd;try{fd=fs.openSync(lock,'wx');}catch{throw Error('IMPORT_BUSY');}fs.writeFileSync(fd,encode({pid:process.pid}));fs.closeSync(fd);
  const save=()=>atomicWrite(plan.target.journal,encode(journal),plan.planId),stage=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/tmp/manager-bodies/${plan.target.installationId}`);
  try {
    await assertIntakeUnchanged(plan.payload.intake,{onProgress});
    const installedBytes=directory=>fs.existsSync(directory)?bodyFiles(directory).reduce((total,row)=>total+row.bytes,0):0;
    const existing=installedBytes(join(plan.target.backup,'payload'))+installedBytes(join(stage,'backup/payload'))+installedBytes(join(stage,'restored'));
    const free=fs.statfsSync(plan.workspaceRoot),remaining=Math.max(0,plan.estimatedAdditionalBytes-existing);if(Number(free.bavail)*Number(free.bsize)<remaining)throw Error('INTAKE_DISK_SPACE_REQUIRED');
    if(!journal.checkpoint)journal.checkpoint=saveCheckpoint(auditRoot,plan.planId,encode({schema:'architecture-manager-runtime-body-checkpoint/v1',workspaceRoot:plan.workspaceRoot,plan,targetExisted:false,backupRetained:true}));save();
    if(fs.existsSync(plan.target.path)) {
      if(!journal.placing || !verifyRuntimeBody({plan}).ok)throw Error('IMPORT_EXTERNAL_CHANGE');journal.status='complete';save();return {status:'already-applied',verification:verifyRuntimeBody({plan}),bodyPath:plan.target.path,entry:join(plan.target.path,plan.target.entry),backup:plan.target.backup,writePerformed:false};
    }
    if(!fs.existsSync(plan.target.backup)) {
      const backupStage=join(stage,'backup');
      await copySource(plan.payload.intake,plan.rows,join(backupStage,'payload'),onProgress,'备份本体');
      fs.writeFileSync(join(backupStage,'SHA256SUMS'),sums(plan));
      fs.writeFileSync(join(backupStage,'MANIFEST.json'),encode({schema:'architecture-manager-software-backup/v1',planDigest:digest,platformId:plan.target.platformId,softwareId:plan.target.resourceId,files:plan.rows,target:plan.target.path,restoreDrill:{performed:false},containsCredentials:false}));
      fs.mkdirSync(dirname(plan.target.backup),{recursive:true});renameOwnedDirectory(plan.workspaceRoot,backupStage,plan.target.backup);journal.status='backed-up';save();
    }
    const backupManifest=readJson(join(plan.target.backup,'MANIFEST.json'));if(backupManifest.planDigest!==digest || !verifiedBody(join(plan.target.backup,'payload'),plan))throw Error('IMPORT_EXTERNAL_CHANGE');
    const restored=join(stage,'restored');
    await copySource({sourcePath:join(plan.target.backup,'payload'),sourceKind:'directory'},plan.rows,restored,onProgress,'真实恢复本体');if(!verifiedBody(restored,plan))throw Error('VERIFY_FAILED');
    await assertIntakeUnchanged(plan.payload.intake,{onProgress});assertScopedActive();
    backupManifest.restoreDrill={performed:true,verifiedFiles:plan.rows.length,at:new Date().toISOString()};atomicWrite(join(plan.target.backup,'MANIFEST.json'),encode(backupManifest),plan.planId);journal.status='restore-passed';journal.placing=true;save();
    fs.mkdirSync(dirname(plan.target.path),{recursive:true});if(fs.existsSync(plan.target.path))throw Error('IMPORT_EXTERNAL_CHANGE');renameOwnedDirectory(plan.workspaceRoot,restored,plan.target.path);
    journal.status='complete';save();const verification=verifyRuntimeBody({plan});if(!verification.ok)throw Error('VERIFY_FAILED');
    writeAudit({auditRoot,actor,plan,transactionId:plan.planId,action:'software-import',status:'applied',target:plan.target.path,checkpointPath:journal.checkpoint.path,checkpointSha256:journal.checkpoint.sha256,newSha256:sha256(sums(plan)),writePerformed:true});return {status:'staged-awaiting-recipe',bodyPath:plan.target.path,entry:verification.entry,backup:plan.target.backup,verification,restored:true,writePerformed:true};
  }catch(error){journal.status='interrupted';journal.error=error.message;save();writeAudit({auditRoot,actor,plan,transactionId:plan.planId,action:'software-import',status:'interrupted',target:plan.target.path,checkpointPath:journal.checkpoint?.path || null,error:error.message});throw error;}finally{fs.unlinkSync(lock);}
}
export function listRuntimeBodies({workspaceRoot,platformId}) {
  const parent=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-bodies`);if(!fs.existsSync(parent))return [];
  return fs.readdirSync(parent,{withFileTypes:true}).filter(row=>row.isDirectory()).flatMap(row=>{try{const journal=readJson(targetPath(parent,row.name+'/journal.json'));if(journal.plan && sha256(stableJson(journal.plan))===journal.planDigest && journal.plan.target.platformId===platformId && journal.plan.workspaceRoot===workspaceRoot)return [{status:journal.status,plan:journal.plan,bodyPath:journal.plan.target.path}];}catch{/* An invalid history is not a resumable plan. */}return [];});
}
