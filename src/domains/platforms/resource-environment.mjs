import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath} from '../../core/paths.mjs';
import {platformPath} from '../../core/platform-path.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {runOwnedProcess} from '../../core/owned-process.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';

const normal=name=>name.toLowerCase().replace(/[-_.]+/g,'-');
const version=/^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const encode=value=>JSON.stringify(value,null,2)+'\n';
function add(table,name,pin) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || typeof pin!=='string' || !version.test(pin))throw Error('RUNTIME_REQUIREMENT_NOT_PINNED');
  const key=normal(name);
  if(table[key] && table[key]!==pin)throw Error('RUNTIME_DEPENDENCY_CONFLICT:'+key);
  table[key]=pin;
}
export function collectResourceRequirements(root,resources) {
  const context={seen:new Set(),visiting:new Set(),resources:new Map()},packages={},legacyPackages={},profiles=new Set(),sources=[];
  for(const row of resources)validateFrozenResource(root,row.repository,row.id,row.version,context);
  for(const [key,item] of context.resources) {
    const manifest=item.manifest,requirements=manifest['x-runtimeRequirements'];
    if(requirements && Object.keys(requirements).length) {
      if(requirements.ownership!=='platform/runtime')throw Error('RUNTIME_OWNERSHIP_NOT_PLATFORM:'+key);
      if(requirements.profile)profiles.add(requirements.profile);
      for(const [name,pin] of Object.entries(requirements.packages || {}))add(packages,name,pin);
    }
    const lock=manifest.runtime?.environmentLock;
    if(lock) {
      const file=targetPath(item.directory,lock);
      for(const line of readFileSync(file,'utf8').split(/\r?\n/)) {
        const text=line.split('#')[0].trim();if(!text)continue;
        const match=/^([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9.+-]+)$/.exec(text);
        if(!match)throw Error('RUNTIME_REQUIREMENT_NOT_PINNED');add(legacyPackages,match[1],match[2]);
      }
    }
    sources.push({key,sumsSha256:item.sumsSha256});
  }
  const ordered=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
  const result={packages:ordered(packages),legacyPackages:ordered(legacyPackages),profiles:[...profiles].sort(),sources:sources.sort((a,b)=>a.key.localeCompare(b.key))};
  return {...result,digest:sha256(encode(result))};
}
export function resourceEnvironmentMatches(root,id,path,requirements) {
  if(!Object.keys(requirements.packages).length)return true;
  if(!path || !existsSync(platformPath(root,id,path)))return false;
  const env=readJson(platformPath(root,id,path));
  const packages=Object.fromEntries(Object.entries(env.packages || {}).map(([name,pin])=>[normal(name),pin]));
  if(!Object.entries(requirements.packages).every(([name,pin])=>packages[name]===pin))return false;
  return Boolean(env.python && existsSync(platformPath(root,id,env.python)));
}
export async function prepareResourceEnvironment({workspaceRoot,platformId,python,requirements,installationId=randomUUID(),wheelhouse=null},options={}) {
  if(!Object.keys(requirements.packages).length)return {status:'not-required',manifest:null};
  if(!python || !existsSync(python))throw Error('RUNTIME_COMPATIBLE_PYTHON_REQUIRED');
  const directory=targetPath(workspaceRoot,`${platformId}/runtime/manager-resources/${installationId}`);
  const backup=targetPath(workspaceRoot,`inbox/backup/${platformId}/manager-resources/${installationId}`);
  mkdirSync(directory,{recursive:true});
  const specPath=join(directory,'spec.json'),resultPath=join(directory,'resource-environment.json');
  const spec={schema:'manager-resource-environment-spec/v1',platformId,directory,backup,packages:requirements.packages,profiles:requirements.profiles,requirementsDigest:requirements.digest,python,...(wheelhouse?{wheelhouse:platformPath(workspaceRoot,platformId,wheelhouse)}:{})};
  const content=encode(spec);
  if(existsSync(specPath) && readFileSync(specPath,'utf8')!==content)throw Error('ONBOARDING_RESUME_DRIFT');
  const {atomicWrite}=await import('../../transactions/kernel.mjs');
  if(!existsSync(specPath))atomicWrite(specPath,content,installationId);
  const result=await runOwnedProcess({python,args:['-B',runtimeFile('resource_env.py'),specPath],cwd:directory,scopeRoot:directory,timeout:1800000,registerCancel:options.registerCancel,onOutput:chunk=>{try{options.onProgress?.({...JSON.parse(String(chunk).trim()),platformId});}catch{/* progress is data */}},env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PIP_CACHE_DIR:join(directory,'pip-cache'),TEMP:directory,TMP:directory}});
  if(result.cancelled)throw Error('ONBOARDING_CANCELLED');
  if(result.exitCode!==0 || !existsSync(resultPath))throw Error('RESOURCE_ENVIRONMENT_PREPARATION_FAILED');
  const env=readJson(resultPath),proof=readJson(platformPath(workspaceRoot,platformId,env.restoreEvidence));
  if(env.requirementsDigest!==requirements.digest || !proof.pass || sha256(readFileSync(env.restoreEvidence))!==env.restoreEvidenceSha256)throw Error('RESOURCE_ENVIRONMENT_RESTORE_FAILED');
  return {status:'prepared',manifest:resultPath,sha256:sha256(readFileSync(resultPath)),result:env};
}
