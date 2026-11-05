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
import {resourceProofBinding} from './resource-proof.mjs';
import {runScopedProcess} from '../../infrastructure/process-scope.mjs';

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
  try {
    if(!path || !existsSync(platformPath(root,id,path)))return false;
    const env=readJson(platformPath(root,id,path));
    if(!resourceProofBinding(root,id,env).valid)return false;
    const packages=Object.fromEntries(Object.entries(env.packages || {}).map(([name,pin])=>[normal(name),pin]));
    if(!Object.entries(requirements.packages).every(([name,pin])=>packages[name]===pin))return false;
    const python=platformPath(root,id,env.python);if(!existsSync(python))return false;
    const actual=JSON.parse(runScopedProcess(python,['-B','-c',"import importlib.metadata as m,json;print(json.dumps({d.metadata['Name']:d.version for d in m.distributions()}))"],{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
    const installed=Object.fromEntries(Object.entries(actual).map(([name,pin])=>[normal(name),pin]));
    return Object.entries(requirements.packages).every(([name,pin])=>installed[name]===pin);
  }catch(error){if(error.message==='TASK_CANCELLED')throw error;return false;}
}
// D-171: every knob that changes *where* packages come from or *how patient*
// the download is. They are the only spec fields allowed to change between two
// attempts: switching mirror after a failed download must not be refused as a
// drift, it must reuse the install directory and continue.
export const RESOURCE_DOWNLOAD_SPEC_KEYS=['wheelhouse','indexUrl','trustedHost','socketTimeoutSeconds','retries','idleTimeoutSeconds','maxSeconds'];
function downloadSpec(source) {
  const spec={};
  if(source.wheelhouse)spec.wheelhouse=platformPath(source.workspaceRoot,source.platformId,source.wheelhouse);
  for(const key of ['indexUrl','trustedHost'])if(source[key])spec[key]=String(source[key]).trim();
  for(const key of ['socketTimeoutSeconds','retries','idleTimeoutSeconds','maxSeconds']) {
    const value=Number(source[key]);if(Number.isFinite(value) && value>0)spec[key]=Math.floor(value);
  }
  return spec;
}
// Export the pure pieces so the retry rule is testable without a real download.
export function resourceEnvironmentSpec({workspaceRoot,platformId,directory,backup,packages,profiles,requirementsDigest,python,wheelhouse=null,download=null}) {
  const source={...(wheelhouse?{wheelhouse}:{}),...download};
  return {schema:'manager-resource-environment-spec/v1',platformId,directory,backup,packages,profiles,requirementsDigest,python,...downloadSpec({...source,workspaceRoot,platformId})};
}
export function specDiffersOnlyInDownloadSource(previous,next) {
  const keys=new Set([...Object.keys(previous),...Object.keys(next)]);
  for(const key of keys) {
    if(RESOURCE_DOWNLOAD_SPEC_KEYS.includes(key))continue;
    if(JSON.stringify(previous[key])!==JSON.stringify(next[key]))return false;
  }
  return true;
}
export async function prepareResourceEnvironment({workspaceRoot,platformId,python,requirements,installationId=randomUUID(),wheelhouse=null,download=null},options={}) {
  if(!Object.keys(requirements.packages).length)return {status:'not-required',manifest:null};
  if(!python || !existsSync(python))throw Error('RUNTIME_COMPATIBLE_PYTHON_REQUIRED');
  const directory=targetPath(workspaceRoot,`${platformId}/runtime/manager-resources/${installationId}`);
  const backup=targetPath(workspaceRoot,`inbox/backup/${platformId}/manager-resources/${installationId}`);
  mkdirSync(directory,{recursive:true});
  const specPath=join(directory,'spec.json'),resultPath=join(directory,'resource-environment.json');
  const spec=resourceEnvironmentSpec({workspaceRoot,platformId,directory,backup,packages:requirements.packages,profiles:requirements.profiles,requirementsDigest:requirements.digest,python,wheelhouse,download});
  const content=encode(spec);
  const {atomicWrite}=await import('../../transactions/kernel.mjs');
  if(existsSync(specPath)) {
    const existing=readFileSync(specPath,'utf8');
    // D-171: a failed download followed by a corrected mirror/wheelhouse is a
    // normal retry, not a drift. Nothing has been produced yet, so rewriting the
    // spec keeps the same install directory (venv + cache + wheels) alive.
    if(existing!==content) {
      if(!existsSync(resultPath) && specDiffersOnlyInDownloadSource(JSON.parse(existing),spec))atomicWrite(specPath,content,installationId);
      else throw Error('ONBOARDING_RESUME_DRIFT');
    }
  } else atomicWrite(specPath,content,installationId);
  // D-172: the outer watchdog must not be the binding constraint. The python
  // side now ends a run on real inactivity (idleTimeoutSeconds) or its own hard
  // cap, both reported as progress; this is only a backstop against a hang.
  const result=await runOwnedProcess({python,args:['-B',runtimeFile('resource_env.py'),specPath],cwd:directory,scopeRoot:directory,timeout:Number(download?.maxSeconds||0)*1000+7200000,registerCancel:options.registerCancel,onOutput:chunk=>{try{options.onProgress?.({...JSON.parse(String(chunk).trim()),platformId});}catch{/* progress is data */}},env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PIP_CACHE_DIR:join(directory,'pip-cache'),TEMP:directory,TMP:directory}});
  if(result.cancelled)throw Error('ONBOARDING_CANCELLED');
  // D-172: hand the python side's own reason to the caller, so "the download
  // stalled" is distinguishable from "a package refused to install". The generic
  // code stays as the fallback when nothing more specific was reported.
  const reason=/RESOURCE_ENVIRONMENT_(?:IDLE_TIMEOUT|TIME_LIMIT|COMMAND_FAILED|PACKAGE_MISMATCH|RESTORE_HASH_MISMATCH|PATH_MISMATCH)[^\r\n]*/.exec(`${result.stdout}\n${result.stderr}`);
  if(result.exitCode!==0 || !existsSync(resultPath))throw Error(reason?reason[0]:'RESOURCE_ENVIRONMENT_PREPARATION_FAILED');
  const env=readJson(resultPath),proof=readJson(platformPath(workspaceRoot,platformId,env.restoreEvidence));
  if(env.requirementsDigest!==requirements.digest || !proof.pass || sha256(readFileSync(env.restoreEvidence))!==env.restoreEvidenceSha256)throw Error('RESOURCE_ENVIRONMENT_RESTORE_FAILED');
  return {status:'prepared',manifest:resultPath,sha256:sha256(readFileSync(resultPath)),result:env};
}
