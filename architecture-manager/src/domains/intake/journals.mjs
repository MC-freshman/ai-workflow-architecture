import {existsSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validPlatformId} from '../../core/platforms.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';

function directory(workspaceRoot,platformId,planId=null) {
  if(!validPlatformId(platformId) || planId!==null && !/^body-import-[0-9a-f-]{36}$/i.test(planId))throw Error('IMPORT_ID_INVALID');
  return targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-imports${planId?'/'+planId:''}`);
}
export function listIntakeJournals({workspaceRoot,platformId}) {
  const root=directory(workspaceRoot,platformId);if(!existsSync(root))return [];
  return readdirSync(root).filter(name=>/^body-import-[0-9a-f-]{36}$/i.test(name)).flatMap(planId=>{
    try{const row=readJson(join(directory(workspaceRoot,platformId,planId),'journal.json'));return [{planId,resourceId:row.plan.target.resourceId,type:row.plan.target.type,version:row.plan.target.version,status:row.status,createdAt:row.createdAt,error:row.error || null,released:row.released,bodyStaged:Boolean(row.placement)}];}catch{return [{planId,status:'unreadable',error:'IMPORT_JOURNAL_UNREADABLE'}];}
  }).sort((a,b)=>(b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function readIntakeJournal({workspaceRoot,platformId,planId}) {
  const journal=readJson(join(directory(workspaceRoot,platformId,planId),'journal.json'));
  if(realpathSync(journal.plan.workspaceRoot)!==realpathSync(workspaceRoot) || journal.plan.target.platformId!==platformId || journal.plan.planId!==planId)throw Error('IMPORT_ID_INVALID');
  if(sha256(stableJson(journal.plan))!==journal.planDigest)throw Error('IMPORT_JOURNAL_UNREADABLE');
  return journal;
}
export function buildIntakeRevertPlan(input) {
  const journal=readIntakeJournal(input);
  return {schema:'architecture-manager-plan/v1',kind:'body-import-revert',planId:'body-revert-'+randomUUID(),workspaceRoot:input.workspaceRoot,generatedAt:new Date().toISOString(),applyMode:'confirmation-required',writePerformed:false,target:{platformId:input.platformId,resourceId:journal.plan.target.resourceId,version:journal.plan.target.version,originalPlanId:input.planId},steps:[{operation:'restore-owned-registration',targets:journal.plan.payload.changes.map(row=>row.path)},{operation:'retain-frozen-version-and-body-backup',target:journal.plan.target.destination}],payload:{originalPlan:journal.plan},verification:['current bytes must still be this transaction output','old pointer and registry restored exactly','frozen releases, source, body and backup retained']};
}
