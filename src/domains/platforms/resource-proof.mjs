import {existsSync,readFileSync} from 'node:fs';
import {relative,resolve,isAbsolute,sep} from 'node:path';
import {platformPath} from '../../core/platform-path.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';

export function resourceProofBinding(root,id,env) {
  try {
    if(env.schema!=='ai-resource-environment/v1' || (env.platformId || env.platform)!==id || env.ownership!=='platform/runtime')return {valid:false,reason:'RESOURCE_ENVIRONMENT_IDENTITY_INVALID'};
    if(typeof env.restoreEvidence!=='string' || !/^[a-f0-9]{64}$/.test(env.restoreEvidenceSha256 || ''))return {valid:false,reason:'RESOURCE_ENVIRONMENT_RESTORE_REQUIRED'};
    let path;
    try{path=platformPath(root,id,env.restoreEvidence);}catch {
      const base=targetPath(root,`inbox/backup/${id}`),candidate=resolve(root,env.restoreEvidence),within=relative(base,candidate);
      if(!within || within==='..' || within.startsWith('..'+sep) || isAbsolute(within))throw Error('RESOURCE_ENVIRONMENT_PROOF_SCOPE_INVALID');
      path=targetPath(root,relative(resolve(root),candidate));
    }
    if(!existsSync(path))return {valid:false,reason:'RESOURCE_ENVIRONMENT_RESTORE_REQUIRED',path};
    const hash=sha256(readFileSync(path)),proof=readJson(path);
    const valid=hash===env.restoreEvidenceSha256 && proof.pass===true && Number.isSafeInteger(proof.filesCompared) && proof.filesCompared>0 && (!proof.differences || Array.isArray(proof.differences) && !proof.differences.length);
    return {valid,path,sha256:hash,reason:valid?null:'RESOURCE_ENVIRONMENT_RESTORE_INVALID'};
  }catch{return {valid:false,reason:'RESOURCE_ENVIRONMENT_RESTORE_INVALID'};}
}
