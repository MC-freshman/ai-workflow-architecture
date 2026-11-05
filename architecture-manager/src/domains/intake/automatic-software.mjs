import fs from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {suggestBodyImport} from './automatic.mjs';
import {buildSoftwareBodyPlan,buildSoftwareBodyPlacementPlan} from './software-body.mjs';
import {buildExistingSoftwareBindingPlan,applyExistingSoftwareBinding} from './software-binding.mjs';
import {applyRuntimeBody,verifyRuntimeBody,listRuntimeBodies} from './runtime-body.mjs';
import {applyIntakePublication,verifyIntakePublication} from './publication.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {gatewayBinding,assertGatewaySelection} from '../software/gateway-binding.mjs';
import {platformConfig} from '../certification/binding.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {requirePlan,atomicWrite,writeAudit} from '../../transactions/kernel.mjs';
import {assertIntakeUnchanged} from './sources.mjs';
import {healthSoftware} from '../software/software.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const fileName=value=>basename(String(value || '').replaceAll('\\','/')).toLowerCase();
const generic=new Set(['java.exe','java','python.exe','python','node.exe','node','powershell.exe','cmd.exe','wscript.exe','cscript.exe']);
export function matchSoftwareRecipes(intake){
  const registry=readJson(targetPath(intake.workspaceRoot,'software/registry.json')),entry=fileName(intake.selectedEntry),matches=[];
  for(const row of registry.software || []){
    if(row.enabled===false||row.id.startsWith('_'))continue;
    try{
      const pointerPath=targetPath(intake.workspaceRoot,`software/${row.id}/current.json`),pointer=readJson(pointerPath),manifest=readJson(targetPath(intake.workspaceRoot,`software/${row.id}/versions/${pointer.version}/manifest.json`));
      const recipe=targetPath(intake.workspaceRoot,`software/${row.id}/versions/${pointer.version}/recipes/windows.json`),declaration=fs.existsSync(recipe)?readJson(recipe):{};
      const names=[manifest.transport?.command,declaration.launch?.entrypoint,...(manifest.capabilities || []).map(cap=>cap.invocation?.executable)].map(fileName).filter(value=>value&&!generic.has(value));
      const normalized=String(intake.sourcePath || '').toLowerCase().replace(/[^a-z0-9]/g,''),identity=row.id.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(names.includes(entry)||identity.length>=5&&normalized.includes(identity))matches.push({id:row.id,version:pointer.version,pointerSha256:sha256File(pointerPath),displayName:manifest.displayName || row.id});
    }catch{/* A malformed recipe is never silently selected. */}
  }
  return matches;
}
export async function buildAutomaticSoftwarePlan({intake,platformId,placementPlan:previousPlacement=null,now=new Date().toISOString()}){
  if(intake.type!=='software'||!intake.selectedEntry)throw Error('INTAKE_ENTRY_INVALID');await assertIntakeUnchanged(intake);
  const suggestion=await suggestBodyImport({intake}),matches=matchSoftwareRecipes(intake);
  if(matches.length>1)throw Error('AUTOMATIC_SOFTWARE_MATCH_AMBIGUOUS');
  if(!matches.length&&suggestion.mode!=='gui')throw Error('AUTOMATIC_SOFTWARE_DECLARATION_REQUIRED');
  const matched=matches[0] || null,id=matched?.id || suggestion.fields.resourceId;
  const reusable=listRuntimeBodies({workspaceRoot:intake.workspaceRoot,platformId}).findLast(row=>row.plan.target.resourceId===id&&row.plan.payload.intake.sourceFingerprint===intake.sourceFingerprint&&row.plan.payload.intake.selectedEntry===intake.selectedEntry);
  const placementPlan=previousPlacement || reusable?.plan || buildSoftwareBodyPlacementPlan({intake,platformId,softwareId:id});
  if(placementPlan.workspaceRoot!==intake.workspaceRoot||placementPlan.target.platformId!==platformId||placementPlan.target.resourceId!==id||placementPlan.payload.intake.sourceFingerprint!==intake.sourceFingerprint)throw Error('PLAN_PAYLOAD_MISMATCH');
  const binding=assertGatewaySelection(gatewayBinding(intake.workspaceRoot,platformId,platformConfig(intake.workspaceRoot,platformId)));
  if(matched)validateFrozenResource(intake.workspaceRoot,'software',id,matched.version);
  return {schema:'architecture-manager-plan/v1',kind:'automatic-software-intake',planId:'automatic-software-'+randomUUID(),workspaceRoot:intake.workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,softwareId:id,mode:matched?'existing-recipe':'gui-session',bodyPath:placementPlan.target.path,entry:placementPlan.target.entry,version:matched?.version || suggestion.fields.version},payload:{placementPlan,matched,suggestion:suggestion.fields,gatewayPath:binding.relativePath,gatewaySha256:fs.existsSync(binding.path)?sha256File(binding.path):null},steps:[...placementPlan.steps,{operation:matched?'自动绑定现行配方':'发布标准 GUI 会话配方并绑定',target:binding.relativePath}],verification:['original retained; real restoration before binding','body and credentials never enter shared repositories','existing recipe and pointer remain unchanged','binding is distinct from live compatibility and GUI functions']};
}
export async function applyAutomaticSoftware(plan,{auditRoot=defaultAuditRoot(),actor='local-user',onProgress=()=>{}}={}){
  requirePlan(plan);const {workspaceRoot,target,payload}=plan;
  const directory=targetPath(workspaceRoot,`${target.platformId}/runtime/maintenance/manager-automatic-software/${plan.planId}`);fs.mkdirSync(directory,{recursive:true});const journalPath=join(directory,'journal.json');
  let journal=fs.existsSync(journalPath)?readJson(journalPath):{planDigest:sha256(stableJson(plan)),status:'prepared',plan};
  if(journal.planDigest!==sha256(stableJson(plan)))throw Error('PLAN_PAYLOAD_MISMATCH');
  if(journal.status==='complete'){const proof=await verifyAutomaticSoftware(plan);if(!proof.ok)throw Error('IMPORT_EXTERNAL_CHANGE');return {...proof,status:'already-applied'};}
  const save=()=>atomicWrite(journalPath,json(journal),randomUUID());
  const expected=await buildAutomaticSoftwarePlan({intake:payload.placementPlan.payload.intake,platformId:target.platformId,placementPlan:payload.placementPlan,now:plan.generatedAt});
  if(stableJson(expected.target)!==stableJson(plan.target)||stableJson(expected.payload)!==stableJson(payload))throw Error('INTEGRATION_BASELINE_MISMATCH');
  save();try{
    journal.placement=await applyRuntimeBody({plan:payload.placementPlan},{auditRoot,actor,onProgress});journal.status='placed-pending-binding';save();
    if(payload.matched){const binding=buildExistingSoftwareBindingPlan({placementPlan:payload.placementPlan,now:plan.generatedAt});journal.bindingPlan=binding;save();journal.binding=applyExistingSoftwareBinding(binding,{auditRoot,actor});}
    else{const publication=buildSoftwareBodyPlan({placementPlan:payload.placementPlan,displayName:payload.suggestion.displayName,releaseVersion:target.version,mode:'gui',now:plan.generatedAt});journal.publicationPlan=publication;save();journal.publication=await applyIntakePublication(publication,{auditRoot,actor,onProgress});}
    try{journal.health=await healthSoftware(workspaceRoot,target.softwareId,target.platformId,{onProgress});}catch(error){journal.health={dispatchable:false,status:error.message,functionExecuted:false};}
    journal.status='complete';save();const proof=await verifyAutomaticSoftware(plan);if(!proof.ok)throw Error('VERIFY_FAILED');
    writeAudit({auditRoot,actor,plan,transactionId:plan.planId,action:plan.kind,status:'bound',target:payload.gatewayPath,writePerformed:true,now:new Date().toISOString()});
    return {...proof,status:journal.health.dispatchable?'bound-declared-conditions-ready':'bound-pending-live-verification',health:journal.health,bindingEstablished:true,callingConditionsVerified:journal.health.dispatchable===true,compatibilityVerified:false,guiFunctionsVerified:false,writePerformed:true};
  }catch(error){journal.status='pending';journal.error=error.message;save();throw Object.assign(error,{recovery:'body-and-backup-retained; re-preview to review a changed baseline',checkpointPath:journal.placement?.checkpointPath});}
}
export async function verifyAutomaticSoftware(plan){
  const journalPath=targetPath(plan.workspaceRoot,`${plan.target.platformId}/runtime/maintenance/manager-automatic-software/${plan.planId}/journal.json`),journal=fs.existsSync(journalPath)?readJson(journalPath):null;
  const placement=verifyRuntimeBody({plan:plan.payload.placementPlan}),binding=gatewayBinding(plan.workspaceRoot,plan.target.platformId,platformConfig(plan.workspaceRoot,plan.target.platformId));
  let publicationValid=true;if(journal?.publicationPlan)publicationValid=(await verifyIntakePublication({plan:journal.publicationPlan})).ok;
  const pointerPath=targetPath(plan.workspaceRoot,`software/${plan.target.softwareId}/current.json`),recipeUnchanged=!plan.payload.matched||fs.existsSync(pointerPath)&&sha256File(pointerPath)===plan.payload.matched.pointerSha256;
  return {ok:journal?.status==='complete'&&placement.ok&&binding.value.bodies?.[plan.target.softwareId]===placement.entry&&publicationValid&&recipeUnchanged,bodyPath:placement.entry,backup:placement.backup,recipeVersion:plan.target.version,bindingEstablished:binding.value.bodies?.[plan.target.softwareId]===placement.entry,functionExecuted:false,compatibilityVerified:false,writePerformed:false};
}
