import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {verifyRuntimeBody} from './runtime-body.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {gatewayBinding,assertGatewaySelection} from '../software/gateway-binding.mjs';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {assertConfigurationReferences} from '../onboarding/onboarding-config.mjs';
import {platformConfig} from '../certification/binding.mjs';
import {plannedFiles,applyGeneratedFiles,verifyFiles} from '../../transactions/onboarding-files.mjs';

export function buildExistingSoftwareBindingPlan({placementPlan,now=new Date().toISOString()}) {
  const restored=verifyRuntimeBody({plan:placementPlan});
  if(!restored.ok)throw Error('IMPORT_PLACEMENT_INVALID');
  const intake=placementPlan.payload.intake,selected=intake.files.find(row=>row.path===intake.selectedEntry);
  if(intake.type!=='software' || !selected?.runnable || selected.installer)throw Error('INSTALLER_NOT_INSTALLED');
  const root=placementPlan.workspaceRoot,{platformId,resourceId:softwareId}=placementPlan.target;
  const pointerPath=targetPath(root,`software/${softwareId}/current.json`),current=readJson(pointerPath);
  const {manifest}=validateFrozenResource(root,'software',softwareId,current.version);
  if(!manifest.capabilities?.length)throw Error('SOFTWARE_CAPABILITY_UNAVAILABLE');
  const config=platformConfig(root,platformId),binding=assertGatewaySelection(gatewayBinding(root,platformId,config));
  const gateway={...binding.value,bodies:{...binding.value.bodies,[softwareId]:restored.entry}};
  assertConfigurationReferences(gateway);
  const files=plannedFiles(root,[{path:binding.relativePath,content:JSON.stringify(gateway,null,2)+'\n'}]);
  return {schema:'architecture-manager-plan/v1',kind:'software-binding',planId:'software-binding-'+randomUUID(),workspaceRoot:root,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,softwareId,version:current.version,bodyPath:restored.entry},payload:{files,placementPlan,pointerBytes:fs.readFileSync(pointerPath,'utf8')},steps:files.map(file=>({operation:'bind-restored-body-to-current-recipe',target:file.path,oldSha256:file.beforeSha256,newSha256:file.newSha256})),verification:['restored body verified; source retained','current recipe and pointer unchanged','only platform binding changes; live compatibility and MCP remain separately pending']};
}
export function applyExistingSoftwareBinding(plan,options) {return applyGeneratedFiles(plan,()=>buildExistingSoftwareBindingPlan({placementPlan:plan.payload.placementPlan,now:plan.generatedAt}),options);}
export function verifyExistingSoftwareBinding(plan) {
  const result=verifyFiles(plan),pointer=targetPath(plan.workspaceRoot,`software/${plan.target.softwareId}/current.json`);
  return {...result,ok:result.ok && fs.existsSync(pointer) && fs.readFileSync(pointer,'utf8')===plan.payload.pointerBytes,functionExecuted:false};
}
