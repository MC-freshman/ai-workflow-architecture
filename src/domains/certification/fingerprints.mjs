import {existsSync,readFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {sha256} from '../../core/hash.mjs';
import {readJson,inside,stableJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {verifyFrozenDirectory} from '../resources/integrity.mjs';
import {parseDefinition} from '../resources/contracts.mjs';
import {certificationHasher} from './content-cache.mjs';
import {platformConfigPath} from './binding.mjs';
import {declaredDefaults,resolvedCellVersion} from './declared.mjs';

export {stableJson} from '../../core/json.mjs';
const digest=value=>sha256(stableJson(value));
export const resourceKey=row=>`${row.kind}:${row.id}`;
const repositories={workflow:'tool',agent:'agent',software:'software'};
const excludedConfig=new Set(['runner','contracts','scannerRelease','capabilities','softwareGatewayConfig','executionBackend','environmentManifest','scriptEnvironment','scriptEnvironmentRungs','softwareGateway','softwareEnvironment','softwareRuntimeRoot','peerDispatcherModule','peerContentRoot','interpreters','runsRoot','bridge']);
// A cell's version follows the same precedence the engine uses: the platform's declared default wins
// over the shared pointer. The judge is told the same version, so the snapshot and the reported rows
// describe the same release; keeping them apart made the merge reject a matrix that had actually
// passed for exactly this reason.
export function certificationInventory(root,platformId=null) {
  const rows=[],defaults=platformId?declaredDefaults({workspaceRoot:root,platformId}):null;
  for(const [repo,section,kind] of [['tool','workflows','workflow'],['agent','agents','agent'],['software','software','software']]) {
    const registry=readJson(targetPath(root,`${repo}/registry.json`));
    for(const entry of registry[section] || []) if(entry.enabled===true && (repo==='software' || entry.invocable!==false)) {
      const pointer=readJson(targetPath(root,`${repo}/${entry.current || `${entry.id}/current.json`}`));
      const version=resolvedCellVersion({workspaceRoot:root,platformId,kind,id:entry.id,pointerVersion:pointer.version,defaults});
      rows.push({kind,id:entry.id,version:String(version)});
    }
  }
  if(new Set(rows.map(resourceKey)).size!==rows.length) throw Error('CERTIFICATION_DUPLICATE_RESOURCE');
  return rows;
}
export function certificationSnapshot(root,id,config,{persistCache=false,inventory=certificationInventory(root,id)}={}) {
  excludedConfig.add('resourceEnvironmentManifest');excludedConfig.add('contextWindowTokens');excludedConfig.add('contextWindowSource');
  const hasher=certificationHasher(root,id,{persist:persistCache}),verified=new Map(),contentCache=new Map(),definitionCache=new Map();
  const verifyDirectory=directory=>{
    if(!verified.has(directory)) verified.set(directory,verifyFrozenDirectory(directory,{hashFile:hasher.hashFile}));
    return verified.get(directory);
  };
  const ownArtifact=path=>{
    if(!path) return null;
    const checked=targetPath(root,relative(root,path));
    if(!inside(targetPath(root,id),checked)) throw Error('CERTIFICATION_PLATFORM_PATH_MISMATCH');
    return existsSync(checked) && statSync(checked).isFile()?hasher.hashFile(checked):{missing:true,path:checked};
  };
  const readOwn=path=>{if(!path) return {};ownArtifact(path);return existsSync(path)?readJson(path):{};};
  const capability=readOwn(config.capabilities),gateway=readOwn(config.softwareGatewayConfig);
  const softwareEnvironment=readOwn(config.softwareEnvironment);
  const program=path=>{
    if(typeof path!=='string' || !existsSync(path)) return {path:path || null,exists:false};
    const stat=statSync(path,{bigint:true});return stat.isFile()?{path,size:String(stat.size),mtime:String(stat.mtimeNs),ctime:String(stat.ctimeNs)}:{path,exists:true,directory:true};
  };
  const pins={};
  for(const key of ['runner','contracts','scannerRelease']) {
    const directory=config[key];
    if(!directory || !inside(targetPath(root,'tool'),directory)) throw Error('CERTIFICATION_RELEASE_PATH_MISMATCH');
    const verified=verifyDirectory(directory),manifest=readJson(join(directory,'manifest.json'));
    pins[key]={version:manifest.version,sha256:verified.sumsSha256};
  }
  const rules={selector:1,contracts:pins.contracts.sha256};
  for(const resource of ['platform-conformance','architecture-ops']) {
    const pointer=readJson(targetPath(root,`tool/${resource}/current.json`));
    const pinned=resource==='architecture-ops'?config.invocationMatrixRelease:null;
    const directory=pinned?targetPath(root,relative(root,pinned)):targetPath(root,`tool/${resource}/versions/${pointer.version}`);
    if(!inside(targetPath(root,`tool/${resource}/versions`),directory)) throw Error('CERTIFICATION_RELEASE_PATH_MISMATCH');
    rules[resource]=verifyDirectory(directory).sumsSha256;
  }
  const globalConfig=Object.fromEntries(Object.entries(config).filter(([key])=>!excludedConfig.has(key)));
  const base={configuration:globalConfig,checks:Object.fromEntries(['runner-protocol-prepare','terminal-stop-with-evidence'].map(key=>[key,capability.checks?.[key] ?? null])),permissions:capability.permissions || {},permissionAdapters:capability.permissionAdapters || []};
  const rulesSha256=digest(rules);
  const cells={};
  for(const row of inventory) {
    const context={seen:new Set(),visiting:new Set(),resources:new Map(),verifyDirectory,contentCache};
    validateFrozenResource(root,repositories[row.kind],row.id,row.version,context);
    const profiles=new Set(),actions=new Set(),closure=[];
    for(const [key,value] of context.resources) {
      const manifest=value.manifest;closure.push({key,sha256:value.sumsSha256});
      if(manifest['x-runtimeRequirements']?.profile)profiles.add(manifest['x-runtimeRequirements'].profile);
      for(const profile of manifest.requiredProfiles || []) profiles.add(String(profile));
      if(manifest.toolLock) {const lock=readJson(join(value.directory,manifest.toolLock));for(const key of Object.keys(lock.profiles || {})) profiles.add(key);}
      if(manifest.schema?.startsWith('ai-workflow/')) {
        if(!definitionCache.has(value.directory)) definitionCache.set(value.directory,parseDefinition(readFileSync(join(value.directory,manifest.entry),'utf8')));
        const definition=definitionCache.get(value.directory);
        for(const profile of definition.requiredProfiles || []) profiles.add(String(profile));
        for(const stage of definition.stages || []) if(stage.action) actions.add(stage.action);
      }
    }
    const settings={base,profiles:Object.fromEntries([...profiles].sort().map(key=>[key,{profile:capability.profiles?.[key] ?? null,descriptor:capability.descriptor?.profiles?.[key] ?? null}])),actions:Object.fromEntries([...actions].sort().map(key=>[key,capability.descriptor?.actions?.[key] ?? capability.checks?.[key] ?? null]))};
    if(actions.has('prompt') || row.kind==='agent')settings.contextBudget={window:config.contextWindowTokens ?? null,source:config.contextWindowSource ?? null};
    if([...context.resources.values()].some(value=>Object.keys(value.manifest['x-runtimeRequirements']?.packages || {}).length))settings.resourceEnvironment=ownArtifact(config.resourceEnvironmentManifest);
    if(actions.has('script') || [...profiles].some(profile=>/python|sealed|sandbox/i.test(profile))) settings.script={backend:ownArtifact(config.executionBackend),manifest:ownArtifact(config.environmentManifest),environment:config.scriptEnvironment,rungs:config.scriptEnvironmentRungs,interpreters:Object.fromEntries(Object.entries(config.interpreters || {}).map(([key,path])=>[key,program(path)]))};
    if(actions.has('delegate')) settings.peer={module:ownArtifact(config.peerDispatcherModule),root:config.peerContentRoot};
    const programs=value=>Array.isArray(value)?value.map(program):value;
    const softwareIds=row.kind==='software'?[row.id]:[...context.resources.values()].filter(value=>value.manifest.schema==='ai-software/v1').map(value=>value.manifest.id);
    const selectedMap=values=>Object.fromEntries(softwareIds.map(key=>[key,values?.[key] ?? null]));
    if(row.kind==='software' || actions.has('software-call')) settings.software={body:row.kind==='software'?program(gateway.bodies?.[row.id] || gateway.software?.[row.id]?.body):Object.fromEntries(Object.entries(selectedMap(gateway.bodies)).map(([key,path])=>[key,program(path)])),aliases:Object.fromEntries(Object.entries(gateway.interpreterAliases || {}).map(([key,path])=>[key,program(path)])),interpreters:Object.fromEntries(Object.entries(gateway.interpreters || {}).map(([key,path])=>[key,program(path)])),providers:Object.fromEntries(Object.entries(gateway).filter(([key])=>/provider|endpoint/i.test(key)).map(([key,value])=>[key,programs(value)])),gateway:program(config.softwareGateway),environment:{bodies:selectedMap(softwareEnvironment.bodies),software:selectedMap(softwareEnvironment.software),interpreter:softwareEnvironment.interpreter,policy:softwareEnvironment.policy}};
    const runtimePrograms=[];
    const gather=value=>{if(value && typeof value==='object') {if(value.path && value.mtime) runtimePrograms.push(value);else for(const child of Object.values(value)) gather(child);}};gather(settings);
    const resourceSha256=digest(closure.sort((a,b)=>a.key.localeCompare(b.key))),configurationSha256=digest(settings);
    cells[resourceKey(row)]={...row,resourceSha256,configurationSha256,rulesSha256,profiles:[...profiles].sort(),actions:[...actions].sort(),closure,runtimePrograms};
  }
  const value={schema:'architecture-manager-certification-snapshot/v1',platformId:id,configSha256:sha256(readFileSync(platformConfigPath(root,id))),pins,rulesSha256,cells};
  value.digest=digest(value);hasher.save();value.cache={...hasher.counts};return value;
}
