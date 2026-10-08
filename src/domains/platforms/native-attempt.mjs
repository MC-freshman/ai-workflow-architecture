import fs from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath} from '../../core/paths.mjs';
import {atomicWrite} from '../../transactions/kernel.mjs';

export function recordNativeAttempt(workspaceRoot,platformId,status,error=null){
  const file=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-native/last-attempt.json`);
  fs.mkdirSync(dirname(file),{recursive:true});const value={status,error,checkedAt:new Date().toISOString()};atomicWrite(file,JSON.stringify(value,null,2)+'\n',randomUUID());return value;
}
export function nativeAttemptBlocksProof(attempt,proof){
  return Boolean(attempt&&['pending','failed'].includes(attempt.status)&&Date.parse(attempt.checkedAt)>=Date.parse(proof.checkedAt));
}
