import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {gatewayBinding,gatewayDifferences} from './gateway-binding.mjs';
import {platformPath} from '../../core/platform-path.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {readOnboardingConfig,assertConfigurationReferences} from '../../onboarding-config.mjs';
import {plannedFiles,applyGeneratedFiles,verifyFiles} from '../../transactions/onboarding-files.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
export function buildGatewayMigrationPlan({workspaceRoot,platformId,sourcePath,conflictChoice,now=new Date().toISOString()}) {
  if(!['active','source'].includes(conflictChoice))throw Error('SOFTWARE_BINDING_SELECTION_REQUIRED');
  const snapshot=readOnboardingConfig({workspaceRoot,platformId});
  if(!snapshot.exists)throw Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const binding=gatewayBinding(workspaceRoot,platformId,snapshot.config);
  const source=platformPath(workspaceRoot,platformId,sourcePath);
  if(!binding.alternatives.some(row=>targetPath(workspaceRoot,row.path)===source))throw Error('SOFTWARE_BINDING_SOURCE_INVALID');
  const other=readJson(source),value=structuredClone(binding.value),differences=gatewayDifferences(value,other);
  for(const [key,item] of Object.entries(other)) {
    const active=value[key];
    if(!Object.hasOwn(value,key)){value[key]=item;continue;}
    if(active && item && typeof active==='object' && typeof item==='object' && !Array.isArray(active) && !Array.isArray(item)) {
      for(const [id,entry] of Object.entries(item))if(!Object.hasOwn(active,id) || conflictChoice==='source')active[id]=entry;
    }else if(conflictChoice==='source')value[key]=item;
  }
  assertConfigurationReferences(value);
  const config={...snapshot.config,softwareGatewayConfig:binding.path};
  const files=plannedFiles(workspaceRoot,[{path:snapshot.configPath,content:json(config)},{path:binding.relativePath,content:json(value)}]);
  return {schema:'architecture-manager-plan/v1',kind:'software-binding-migration',planId:'gateway-migration-'+randomUUID(),workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{platformId,sourcePath,conflictChoice,activePath:binding.relativePath},payload:{files,sourceSha256:sha256(fs.readFileSync(source))},migration:{...differences,sourcePath,activePath:binding.relativePath,conflictChoice},steps:files.map(file=>({operation:'migrate-software-bindings',target:file.path,oldSha256:file.beforeSha256,newSha256:file.newSha256})),verification:['explicit source and conflict choice','original source preserved','baseline hashes, checkpoint, atomic rollback','configuration changes are not callable proof']};
}
export function applyGatewayMigration(plan,options){return applyGeneratedFiles(plan,()=>buildGatewayMigrationPlan({workspaceRoot:plan.workspaceRoot,...plan.target,now:plan.generatedAt}),options);}
export const verifyGatewayMigration=verifyFiles;
