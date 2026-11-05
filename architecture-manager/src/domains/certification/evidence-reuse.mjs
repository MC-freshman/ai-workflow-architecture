import {readFileSync,statSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {sha256} from '../../core/hash.mjs';

export function bindingMatches(previous,binding,environmentHash) {
  return ['configSha256','versionsSha256','adapterSha256'].every(key=>typeof binding[key]==='string' && binding[key].length>0 && previous[key]===binding[key])
    && typeof environmentHash==='string' && environmentHash.length>0 && previous.environmentBindingSha256===environmentHash;
}

export function evidenceIntact(root,id,path,expectedSha256,relativeDirectory=`${id}/runtime`) {
  if(typeof path!=='string' || !/^[a-f0-9]{64}$/.test(expectedSha256 || ''))return false;
  try {
    const target=targetPath(root,relative(root,resolve(path)));
    const directory=targetPath(root,relativeDirectory);
    const local=relative(directory,target);
    if(!local || local.startsWith('..') || resolve(directory,local)!==target)return false;
    return statSync(target).isFile() && sha256(readFileSync(target))===expectedSha256;
  } catch {return false;}
}

export function reusableEvidence({root,id,previous,binding,environmentHash,path,expectedSha256,relativeDirectory}) {
  return bindingMatches(previous,binding,environmentHash) && evidenceIntact(root,id,path,expectedSha256,relativeDirectory);
}
