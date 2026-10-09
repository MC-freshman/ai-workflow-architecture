import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {sourceRelative,assertUniqueSourcePaths} from './paths.mjs';
import {assertIntakeUnchanged,entryChunks} from './sources.mjs';
import {hasSensitiveLiteral} from './policy.mjs';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {validPlatformId} from '../../core/platforms.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {verifyFrozenDirectory} from '../resources/integrity.mjs';
import {validateRegistry} from '../resources/registry.mjs';
import {requirePlan,atomicWrite,saveCheckpoint,writeAudit} from '../../transactions/kernel.mjs';
import {restoreOwnedFiles} from '../../transactions/recovery.mjs';
import {assertScopedActive} from '../../infrastructure/process-scope.mjs';
import {gitRaw,gitText} from '../../infrastructure/git.mjs';

const encode=value=>JSON.stringify(value,null,2)+'\n';
const hash=file=>fs.existsSync(file)?sha256(fs.readFileSync(file)):null;
const sameRoot=(left,right)=>fs.realpathSync(left)===fs.realpathSync(right);
const ID=/^[a-z0-9][a-z0-9._-]*$/i,VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
function location(root,platformId,planId) {
  if(!validPlatformId(platformId) || !/^body-import-[0-9a-f-]{36}$/i.test(planId))throw Error('IMPORT_ID_INVALID');
  const bridge=[`${platformId}/bridge.json`,`${platformId}/bridge/bridge.json`].map(path=>targetPath(root,path)).find(path=>fs.existsSync(path));
  if(!bridge)throw Error('IMPORT_PLATFORM_REQUIRED');
  const binding=readJson(bridge);
  if(!['ai-platform-bridge/v1','ai-platform-bridge/v1.1'].includes(binding.schema) || binding.platform!==platformId || binding.shared?.readOnly!==true)throw Error('IMPORT_PLATFORM_REQUIRED');
  return targetPath(root,`${platformId}/runtime/maintenance/manager-imports/${planId}`);
}
function assertChange(plan,change) {
  if(sourceRelative(change.path)!==change.path)throw Error('IMPORT_MUTATION_NOT_ALLOWED');
  const {repository,resourceId,prefix,version,platformId}=plan.target;
  const pointer=`${repository}/${prefix}${resourceId}/current.json`,catalog=plan.target.settings?.skillCatalogPath || `tool/_registry/skills-${resourceId}.json`;
  if(![pointer,`${repository}/registry.json`,...(plan.target.type==='skill'?[catalog]:[])].includes(change.path) && !change.path.startsWith(`${platformId}/bridge/`))throw Error('IMPORT_MUTATION_NOT_ALLOWED');
  targetPath(plan.workspaceRoot,change.path);
  const next=change.path.endsWith('.json')?JSON.parse(change.content):null;
  if(change.path===pointer && (next.id!==resourceId || next.version!==version || next.hashManifest!=='SHA256SUMS'))throw Error('IMPORT_POINTER_INVALID');
  if(change.path.endsWith('/registry.json')) {
    const previous=JSON.parse(change.before),section=plan.target.type==='agent'?'agents':plan.target.type==='skill'?'skills':plan.target.type==='software'?'software':'workflows',ids=new Set(plan.target.type==='skill'?[resourceId,'skills-'+resourceId]:[resourceId]);
    const strip=value=>({...value,version:0,[section]:(value[section] || []).filter(entry=>!ids.has(entry.id))});
    if(stableJson(strip(previous))!==stableJson(strip(next)) || next.version!==previous.version+1)throw Error('IMPORT_FOREIGN_REGISTRY_CHANGE');
  }
  if(change.path===catalog) {
    if(!/^tool\/_registry\/skills-[a-z0-9._-]+\.json$/i.test(catalog) || !Array.isArray(next.skills) || next.skills.filter(row=>row.id===resourceId).length!==1 || next.skills.find(row=>row.id===resourceId).version!==version)throw Error('IMPORT_CATALOG_INVALID');
    const previous=change.before===null?null:JSON.parse(change.before),strip=value=>({...value,skills:value.skills.filter(row=>row.id!==resourceId)});
    if(previous && stableJson(strip(previous))!==stableJson(strip(next)))throw Error('IMPORT_FOREIGN_CATALOG_CHANGE');
    if(catalog!==`tool/_registry/skills-${resourceId}.json`) {
      const registry=readJson(targetPath(plan.workspaceRoot,'tool/registry.json'));
      if(!registry.skills?.some(row=>row.kind==='skill-catalog' && `tool/${row.path}`===catalog) || !previous?.skills.some(row=>row.id===resourceId))throw Error('IMPORT_CATALOG_INVALID');
    } else if(!previous && next.skills.some(row=>row.id!==resourceId))throw Error('IMPORT_CATALOG_INVALID');
  }
  if(hasSensitiveLiteral(change.content) || change.before!==null && hasSensitiveLiteral(change.before))throw Error('RAW_SECRET_NOT_ALLOWED');
  if(sha256(change.content)!==change.afterSha256 || (change.before===null?null:sha256(change.before))!==change.beforeSha256)throw Error('PLAN_PAYLOAD_MISMATCH');
}
function assertPublication(plan) {
  requirePlan(plan);const target=plan.target;
  if(plan.kind!=='body-import' || !['tool','agent','software'].includes(target.repository) || !ID.test(target.resourceId) || !VERSION.test(target.version) || !['','skills/'].includes(target.prefix))throw Error('IMPORT_TARGET_INVALID');
  if(target.prefix && (target.repository!=='tool' || target.type!=='skill'))throw Error('IMPORT_TARGET_INVALID');
  if(({agent:'agent',skill:'tool',tool:'tool',software:'software'})[target.type]!==target.repository)throw Error('IMPORT_TARGET_INVALID');
  if(target.destination!==`${target.repository}/${target.prefix}${target.resourceId}/versions/${target.version}`)throw Error('IMPORT_TARGET_INVALID');
  location(plan.workspaceRoot,target.platformId,plan.planId);
  assertUniqueSourcePaths(plan.payload.files.map(row=>({path:sourceRelative(row.path),directory:false})));
  for(const row of plan.payload.files) {
    if(row.content!==undefined) {if(typeof row.content!=='string' || row.content.includes('\0') || /\.(exe|dll|so|dylib|zip|7z|jar|png|jpg|pdf|ico)$/i.test(row.path) || sha256(row.content)!==row.sha256 || hasSensitiveLiteral(row.content))throw Error('PLAN_PAYLOAD_MISMATCH');}
    else {
      if(target.repository==='software')throw Error('IMPORT_NON_TEXT_SHARED_FILE');
      const source=plan.payload.intake.files.find(source=>source.path===row.sourcePath && source.included);
      if(!source || source.sha256!==row.sha256 || !source.text)throw Error('IMPORT_NON_TEXT_SHARED_FILE');
    }
  }
  const sums=plan.payload.files.map(row=>row.sha256+'  '+row.path).sort().join('\n')+'\n';
  if(sums!==plan.payload.sums)throw Error('PLAN_PAYLOAD_MISMATCH');
  for(const change of plan.payload.changes)assertChange(plan,change);
  const current=`${target.repository}/${target.prefix}${target.resourceId}/current.json`;
  if(!fs.existsSync(targetPath(plan.workspaceRoot,current)) && (!plan.payload.changes.some(row=>row.path===current) || !plan.payload.changes.some(row=>row.path===`${target.repository}/registry.json`)))throw Error('IMPORT_REGISTRATION_REQUIRED');
  const placement=plan.payload.placementPlan;
  if(placement) {
    if(target.type!=='software' || placement.kind!=='software-import' || !sameRoot(placement.workspaceRoot,plan.workspaceRoot) || placement.target.platformId!==target.platformId || placement.target.softwareId!==target.resourceId || placement.target.source!==plan.payload.intake.sourcePath)throw Error('IMPORT_PLACEMENT_INVALID');
    if(stableJson(placement.rows.map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path)))!==stableJson(plan.payload.intake.files.filter(row=>row.included).map(({path,sha256,bytes})=>({path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path))))throw Error('IMPORT_PLACEMENT_INVALID');
  }
}
export function buildIntakePublicationPlan({intake,platformId,repository,resourceId,version,prefix='',files={},sourceFiles=[],changes=[],settings={},placementPlan=null,now=new Date().toISOString()}) {
  const root=intake.workspaceRoot,planId='body-import-'+randomUUID(),destination=`${repository}/${prefix}${resourceId}/versions/${version}`;
  location(root,platformId,planId);
  if(fs.existsSync(targetPath(root,destination)))throw Error('RELEASE_VERSION_EXISTS');
  const source={schema:'ai-release-source/v1',releaseStatus:'published',id:resourceId,version,sourcePlanId:planId,sourceFingerprint:intake.sourceFingerprint,sourceFiles:intake.files.filter(row=>row.included).map(({path,sha256})=>({path,sha256})),environmentOwnership:'platform-runtime',generatedBy:'architecture-manager body import',generatedAt:now};
  const rows=Object.entries({...files,'SOURCE.json':encode(source)}).map(([path,content])=>({path:sourceRelative(path),content,sha256:sha256(content)}));
  for(const mapping of sourceFiles){const row=intake.files.find(row=>row.path===mapping.sourcePath && row.included);if(!row)throw Error('INTAKE_ENTRY_INVALID');rows.push({path:sourceRelative(mapping.path),sourcePath:row.path,sha256:row.sha256,bytes:row.bytes});}
  const mutations=changes.map(change=>{const target=targetPath(root,change.path),before=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;return {...change,before,beforeSha256:before===null?null:sha256(before),afterSha256:sha256(change.content)};});
  const sums=rows.map(row=>row.sha256+'  '+row.path).sort().join('\n')+'\n';
  const plan={schema:'architecture-manager-plan/v1',kind:'body-import',planId,workspaceRoot:root,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{repository,resourceId,version,prefix,type:intake.type,platformId,destination,sourceRetained:true,settings},steps:[{operation:'verify-original-source',sha256:intake.sourceFingerprint},...(placementPlan?[{operation:'place-backup-and-really-restore-body',target:placementPlan.target.path}]:[]),{operation:'stage-and-validate-release',target:destination,files:rows.length+1},{operation:'publish-frozen-version',target:destination},{operation:'register-and-bind',targets:mutations.map(row=>row.path)}],payload:{intake,files:rows,sums,changes:mutations,placementPlan},verification:['original bytes retained','complete sealed dependency closure','compare-and-swap registration','journal recovery; published bytes retained']};
  assertPublication(plan);return plan;
}
const planDigest=plan=>sha256(stableJson(plan));
function journalWrite(directory,journal){fs.mkdirSync(directory,{recursive:true});atomicWrite(join(directory,'journal.json'),encode(journal),journal.plan.planId);}
function acquireImportLock(directory) {
  fs.mkdirSync(directory,{recursive:true});const lock=join(directory,'active.lock');
  if(fs.existsSync(lock)) {
    let owner;try{owner=readJson(lock);}catch{throw Error('IMPORT_BUSY');}
    let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
    if(alive)throw Error('IMPORT_BUSY');
    fs.renameSync(lock,join(directory,'expired-lock-'+randomUUID()+'.json'));
  }
  let file;try{file=fs.openSync(lock,'wx');}catch{throw Error('IMPORT_BUSY');}
  fs.writeFileSync(file,encode({pid:process.pid,acquiredAt:new Date().toISOString()}));fs.closeSync(file);
  return ()=>fs.unlinkSync(lock);
}
function requireRollbackCommit(plan,pinnedHead=null) {
  let top,head;try{top=gitText(plan.workspaceRoot,['rev-parse','--show-toplevel']);head=pinnedHead || gitText(plan.workspaceRoot,['rev-parse','HEAD']);}catch(error){if(error.message==='TASK_CANCELLED')throw error;throw Error('IMPORT_GIT_BASELINE_REQUIRED');}
  if(!/^[a-f0-9]{40,64}$/i.test(head))throw Error('IMPORT_GIT_BASELINE_REQUIRED');
  if(fs.realpathSync(top)!==fs.realpathSync(plan.workspaceRoot))throw Error('IMPORT_GIT_BASELINE_REQUIRED');
  for(const change of plan.payload.changes.filter(row=>row.before!==null)) {
    let original;try{original=gitRaw(plan.workspaceRoot,['show',`${head}:${change.path}`],{encoding:null});}catch(error){if(error.message==='TASK_CANCELLED')throw error;throw Error('IMPORT_GIT_BASELINE_REQUIRED');}
    if(sha256(original)!==change.beforeSha256)throw Error('IMPORT_GIT_BASELINE_REQUIRED');
  }
  return head;
}
function releaseMatches(plan) {
  try{const directory=targetPath(plan.workspaceRoot,plan.target.destination),source=readJson(join(directory,'SOURCE.json'));return source.sourcePlanId===plan.planId && fs.readFileSync(join(directory,'SHA256SUMS'),'utf8')===plan.payload.sums && verifyFrozenDirectory(directory).sumsSha256===sha256(plan.payload.sums);}catch{return false;}
}
export async function verifyIntakePublication({plan}) {
  assertPublication(plan);const release=releaseMatches(plan),changes=plan.payload.changes.map(row=>({path:row.path,ok:hash(targetPath(plan.workspaceRoot,row.path))===row.afterSha256}));
  if(release)validateFrozenResource(plan.workspaceRoot,plan.target.repository,plan.target.resourceId,plan.target.version,undefined,plan.target.prefix);
  const placement=plan.payload.placementPlan?(await import('../../software-intake.mjs')).verifySoftwareImport({plan:plan.payload.placementPlan}):null;
  return {schema:'architecture-manager-verification/v1',ok:release && changes.every(row=>row.ok) && (!placement || placement.ok),release,changes,placement,sourceRetained:true,functionExecuted:false};
}
export async function applyIntakePublication(plan,{actor='local-user',auditRoot=defaultAuditRoot(),now=new Date().toISOString(),onProgress=()=>{},failAfterStep=null}={}) {
  assertPublication(plan);const directory=location(plan.workspaceRoot,plan.target.platformId,plan.planId),file=join(directory,'journal.json'),digest=planDigest(plan);
  let journal=fs.existsSync(file)?readJson(file):{schema:'architecture-manager-import-journal/v1',plan,planDigest:digest,status:'prepared',createdAt:now,released:false,checkpoint:null};
  if(journal.planDigest!==digest)throw Error('PLAN_PAYLOAD_MISMATCH');
  if(journal.status==='reverted')throw Error('IMPORT_ALREADY_REVERTED');
  if(journal.status==='complete') {const verification=await verifyIntakePublication({plan});if(!verification.ok)throw Error('IMPORT_EXTERNAL_CHANGE');return {status:'already-applied',verification,journalPath:file,writePerformed:false};}
  const releaseLock=acquireImportLock(directory);
  const stage=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/tmp/manager-imports/${plan.planId}/staging`);
  try {
    const source=await assertIntakeUnchanged(plan.payload.intake,{onProgress});
    journal.rollbackHead=requireRollbackCommit(plan,journal.rollbackHead);
    journalWrite(directory,journal);
    const destination=targetPath(plan.workspaceRoot,plan.target.destination);
    if(fs.existsSync(destination) && !releaseMatches(plan))throw Error('RELEASE_VERSION_EXISTS');
    for(const change of plan.payload.changes) {
      const current=hash(targetPath(plan.workspaceRoot,change.path));
      if(current!==change.beforeSha256 && current!==change.afterSha256)throw Error('IMPORT_EXTERNAL_CHANGE');
    }
    if(!journal.checkpoint) {
      journal.checkpoint=saveCheckpoint(auditRoot,plan.planId,encode({schema:'architecture-manager-import-checkpoint/v1',workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId,files:plan.payload.changes,releaseRetainedOnUndo:true}));journalWrite(directory,journal);
    }
    if(plan.payload.placementPlan) {
      const body=await import('../../software-intake.mjs'),placement=plan.payload.placementPlan;
      if(!journal.placement) {
        if(fs.existsSync(placement.target.path)) {
          if(!body.verifySoftwareImport({plan:placement}).ok)throw Error('IMPORT_EXTERNAL_CHANGE');
          if(placement.payload?.intake)journal.placement=await body.applySoftwareImport({plan:placement},{actor,auditRoot,now,onProgress});
          else {const {listSoftwareRecoveries}=await import('../../software-recovery.mjs');const previous=listSoftwareRecoveries({workspaceRoot:plan.workspaceRoot,auditRoot}).find(row=>row.action==='software-import' && row.target===placement.target.path);if(!previous)throw Error('IMPORT_EXTERNAL_CHANGE');journal.placement={status:'already-staged',checkpointPath:previous.checkpointPath};}
        } else journal.placement=await body.applySoftwareImport({plan:placement},{actor,auditRoot,now,onProgress});
        journal.status='body-staged';journalWrite(directory,journal);
      }
      if(!body.verifySoftwareImport({plan:placement}).ok)throw Error('IMPORT_EXTERNAL_CHANGE');
      if(failAfterStep==='placement')throw Error('SIMULATED_INTERRUPT');
    }
    if(!releaseMatches(plan)) {
      if(fs.existsSync(stage)) {const quarantined=stage+'-'+randomUUID()+'.partial';fs.renameSync(stage,quarantined);journal.partialStage=quarantined;}
      fs.mkdirSync(stage,{recursive:true});let completed=0;
      for(const row of plan.payload.files) {
        assertScopedActive();const target=targetPath(stage,row.path);fs.mkdirSync(dirname(target),{recursive:true});
        if(row.content!==undefined)fs.writeFileSync(target,row.content,'utf8');
        else {
          const original=source.files.find(entry=>entry.path===row.sourcePath);
          async function* chunks(){let bytesDone=0;for await(const chunk of entryChunks(source,original)){assertScopedActive();bytesDone+=chunk.length;onProgress({phase:'复制原文',path:row.path,bytesDone,bytesTotal:original.bytes});yield chunk;}}
          await pipeline(Readable.from(chunks()),fs.createWriteStream(target,{flags:'wx'}));
        }
        if(hash(target)!==row.sha256)throw Error('INTAKE_SOURCE_CHANGED');
        onProgress({phase:'准备冻结版本',path:row.path,completed:++completed,total:plan.payload.files.length});
      }
      fs.writeFileSync(join(stage,'SHA256SUMS'),plan.payload.sums,'utf8');
      const targetKey=`${plan.target.repository}/${plan.target.prefix}${plan.target.resourceId}@${plan.target.version}`;
      validateFrozenResource(plan.workspaceRoot,plan.target.repository,plan.target.resourceId,plan.target.version,{seen:new Set(),visiting:new Set(),directoryForResource:(key,canonical)=>key===targetKey?stage:canonical},plan.target.prefix);
      await assertIntakeUnchanged(plan.payload.intake,{onProgress});assertScopedActive();
      journal.status='validated';journalWrite(directory,journal);
      fs.mkdirSync(dirname(destination),{recursive:true});if(fs.existsSync(destination))throw Error('RELEASE_VERSION_EXISTS');fs.renameSync(stage,destination);
    }
    journal.released=true;journal.status='released-awaiting-registration';journalWrite(directory,journal);
    if(failAfterStep==='release')throw Error('SIMULATED_INTERRUPT');
    for(const [index,change] of plan.payload.changes.entries()) {
      assertScopedActive();const target=targetPath(plan.workspaceRoot,change.path),current=hash(target);
      if(current===change.afterSha256)continue;if(current!==change.beforeSha256)throw Error('IMPORT_EXTERNAL_CHANGE');
      fs.mkdirSync(dirname(target),{recursive:true});atomicWrite(target,change.content,plan.planId);
      onProgress({phase:'登记与绑定',path:change.path,completed:index+1,total:plan.payload.changes.length});
      if(failAfterStep===index+1)throw Error('SIMULATED_INTERRUPT');
    }
    if(plan.payload.changes.some(row=>row.path===`${plan.target.repository}/registry.json`))validateRegistry(plan.workspaceRoot,plan.target.repository,fs.readFileSync(targetPath(plan.workspaceRoot,`${plan.target.repository}/registry.json`),'utf8'),{onlyIds:new Set([plan.target.resourceId])});
    const verification=await verifyIntakePublication({plan});if(!verification.ok)throw Error('VERIFY_FAILED');
    journal.status='complete';journal.completedAt=new Date().toISOString();journalWrite(directory,journal);
    writeAudit({actor,auditRoot,now,plan,transactionId:plan.planId,action:plan.kind,status:'applied',target:plan.target.destination,checkpointPath:journal.checkpoint.path,checkpointSha256:journal.checkpoint.sha256,newSha256:sha256(plan.payload.sums),writePerformed:true});
    return {status:'applied',verification,journalPath:file,checkpointPath:journal.checkpoint.path,publishedVersionRetained:true,writePerformed:true};
  } catch(error) {
    journal.status='interrupted';journal.error=error.message;journal.released=releaseMatches(plan);journalWrite(directory,journal);
    writeAudit({actor,auditRoot,now,plan,transactionId:plan.planId,action:plan.kind,status:journal.released?'released-awaiting-registration':'interrupted-before-publication',target:plan.target.destination,checkpointPath:journal.checkpoint?.path || null,error:error.message,writePerformed:journal.released});
    throw Object.assign(error,{journalPath:file,checkpointPath:journal.checkpoint?.path || null,released:journal.released});
  } finally {releaseLock();}
}
export function revertIntakePublication(plan,{auditRoot=defaultAuditRoot(),actor='local-user',now=new Date().toISOString()}={}) {
  assertPublication(plan);const directory=location(plan.workspaceRoot,plan.target.platformId,plan.planId),file=join(directory,'journal.json'),journal=readJson(file);
  if(journal.planDigest!==planDigest(plan))throw Error('PLAN_PAYLOAD_MISMATCH');
  const releaseLock=acquireImportLock(directory);
  try {
    const restored=restoreOwnedFiles(plan.payload.changes.map(row=>({target:targetPath(plan.workspaceRoot,row.path),before:row.before,afterSha256:row.afterSha256})),plan.planId);
    if(!restored.ok)throw Object.assign(Error('RECOVERY_EXTERNAL_CHANGE'),{recovery:restored});
    if(plan.payload.changes.some(row=>hash(targetPath(plan.workspaceRoot,row.path))!==row.beforeSha256))throw Error('VERIFY_FAILED');
    journal.status='reverted';journal.released=releaseMatches(plan);journalWrite(directory,journal);
    writeAudit({actor,auditRoot,now,plan,transactionId:plan.planId,action:'body-import-revert',status:'applied',target:plan.target.destination,checkpointPath:journal.checkpoint?.path || null,writePerformed:true});
    return {status:'reverted',restored,publishedVersionRetained:journal.released,bodyAndBackupRetained:Boolean(plan.payload.placementPlan),sourceRetained:true};
  } finally {releaseLock();}
}
export function assertIntakeRevertPlan(plan) {
  requirePlan(plan);const original=plan.payload?.originalPlan;assertPublication(original);
  if(plan.kind!=='body-import-revert' || !sameRoot(plan.workspaceRoot,original.workspaceRoot) || plan.target.platformId!==original.target.platformId || plan.target.resourceId!==original.target.resourceId || plan.target.version!==original.target.version || plan.target.originalPlanId!==original.planId)throw Error('PLAN_PAYLOAD_MISMATCH');
  const expected=[{operation:'restore-owned-registration',targets:original.payload.changes.map(row=>row.path)},{operation:'retain-frozen-version-and-body-backup',target:original.target.destination}];
  if(stableJson(plan.steps)!==stableJson(expected))throw Error('PLAN_PAYLOAD_MISMATCH');return original;
}
export function verifyIntakeRevert(plan) {
  const original=assertIntakeRevertPlan(plan),directory=location(plan.workspaceRoot,plan.target.platformId,original.planId),journal=readJson(join(directory,'journal.json'));
  const restored=original.payload.changes.every(row=>hash(targetPath(original.workspaceRoot,row.path))===row.beforeSha256);
  const retained=journal.released?releaseMatches(original):true;
  return {ok:journal.planDigest===planDigest(original) && journal.status==='reverted' && restored && retained,registrationRestored:restored,publishedVersionRetained:journal.released && retained,bodyAndBackupRetained:Boolean(original.payload.placementPlan),functionExecuted:false};
}
