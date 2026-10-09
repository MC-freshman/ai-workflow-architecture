import {renameSync,existsSync} from 'node:fs';
import {relative} from 'node:path';
import {targetPath} from '../core/paths.mjs';
import {assertScopedActive} from './process-scope.mjs';
// Retry a briefly denied directory rename; never replace an existing target.
export function renameOwnedDirectory(root,source,target) {
  const from=targetPath(root,relative(root,source)),to=targetPath(root,relative(root,target)),signal=new Int32Array(new SharedArrayBuffer(4));
  for(let attempt=0;attempt<5;attempt++) {
    assertScopedActive();if(existsSync(to))throw Error('IMPORT_EXTERNAL_CHANGE');
    try{renameSync(from,to);return;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code) || attempt===4)throw error;Atomics.wait(signal,0,0,[25,50,100,200][attempt]);}
  }
}
