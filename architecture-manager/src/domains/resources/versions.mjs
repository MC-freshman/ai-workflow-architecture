import {existsSync,readFileSync} from 'node:fs';
import {targetPath,safeRelative} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {verifyFrozenDirectory} from './integrity.mjs';
import {validateResourceContent} from './contracts.mjs';

const ID=/^(?:_[a-z][a-z0-9-]*|[a-z0-9][a-z0-9._-]*)$/i,VERSION=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const kinds={workflows:['tool',''],agents:['agent',''],skills:['tool','skills/'],packs:['tool','packs/'],software:['software','']};
export function dependencyEntries(value) {
  if(value==null) return [];
  const entries=Array.isArray(value)?value.map(item=>typeof item==='string'?item.split('@'):[item.id,item.version]):Object.entries(value);
  if(entries.some(([id,version])=>!ID.test(id) || typeof version!=='string' || !VERSION.test(version))) throw Error('RESOURCE_DEPENDENCY_NOT_PINNED');
  return entries;
}
export function validateFrozenResource(workspaceRoot,repository,resourceId,version,context={seen:new Set(),visiting:new Set()},subdirectory='') {
  context.resources ||=new Map();
  if(!['tool','agent','software'].includes(repository) || !ID.test(resourceId) || !VERSION.test(version)) throw Error('INVALID_RESOURCE_VERSION');
  const key=`${repository}/${subdirectory}${resourceId}@${version}`;
  if(context.visiting.has(key)) throw Error('RESOURCE_DEPENDENCY_CYCLE');
  if(context.seen.has(key)) return context.resources.get(key);
  context.visiting.add(key);
  const canonical=targetPath(workspaceRoot,`${repository}/${subdirectory}${resourceId}/versions/${version}`);
  const directory=context.directoryForResource?.(key,canonical) || canonical;
  const integrity=(context.verifyDirectory || verifyFrozenDirectory)(directory);
  const get=name=>readFileSync(targetPath(directory,safeRelative(name)),'utf8');
  if(existsSync(targetPath(directory,'SOURCE.json'))) {
    const source=readJson(targetPath(directory,'SOURCE.json'));
    // Older frozen releases can retain a staging label beside a publication stamp.
    // A current resource remains readable; this guard rejects genuinely unissued candidates.
    if(['candidate','draft','unpublished'].includes(source.releaseStatus) && !source.publishedAt && !source.releasedAt) throw Error('RESOURCE_VERSION_CANDIDATE');
  }
  const manifest=context.contentCache?.get(directory) || validateResourceContent({repository,resourceId,version,read:get,has:name=>existsSync(targetPath(directory,safeRelative(name)))});
  context.contentCache?.set(directory,manifest);
  const declarations=[manifest.dependencies,manifest.depends];
  if(repository==='agent') declarations.push(readJson(targetPath(directory,manifest.toolLock)));
  if(manifest.members) declarations.push({skills:manifest.members});
  for(const declaration of declarations) for(const [section,[repo,prefix]] of Object.entries(kinds)) {
    for(const [id,pin] of dependencyEntries(declaration?.[section])) validateFrozenResource(workspaceRoot,repo,id,pin,context,prefix);
  }
  if(repository==='agent' && manifest.bodyContexts) {
    const lock=readJson(targetPath(directory,manifest.toolLock));
    if(!Array.isArray(manifest.bodyContexts))throw Error('RESOURCE_CONTEXT_INVALID');
    for(const item of manifest.bodyContexts) {
      const skill=context.resources.get(`tool/skills/${item.id}@${item.version}`);
      if(lock.skills?.[item.id]!==item.version || !skill || skill.sumsSha256!==item.sha256Manifest || !item.entry || !existsSync(targetPath(directory,safeRelative(item.entry))))throw Error('RESOURCE_CONTEXT_CHANGED');
      // Compare the copied instruction file to its preview binding, independently of the release seal.
      if(sha256(get(item.entry))!==item.textSha256)throw Error('RESOURCE_CONTEXT_CHANGED');
    }
  }
  context.resources?.set(key,{manifest,...integrity});
  context.visiting.delete(key);context.seen.add(key);
  return {manifest,...integrity};
}
