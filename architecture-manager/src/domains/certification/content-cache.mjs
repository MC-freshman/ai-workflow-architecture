import {existsSync,readFileSync,statSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {targetPath} from '../../core/paths.mjs';
import {atomicWrite} from '../../transactions/kernel.mjs';
import {randomUUID} from 'node:crypto';
import {assertScopedActive} from '../../infrastructure/process-scope.mjs';

export function certificationHasher(root,id,{persist=false}={}) {
  const path=targetPath(root,`${id}/runtime/manager-check/content-cache.json`);
  let previous={};try {const cache=readJson(path);if(cache.schema==='architecture-manager-content-cache/v1') previous=cache.files || {};} catch { /* Broken cache never approves content. */ }
  const files={},counts={hashed:0,reused:0};
  const hashFile=path=>{
    assertScopedActive();
    const stat=statSync(path,{bigint:true});
    const metadata=[stat.size,stat.mtimeNs,stat.ctimeNs,stat.ino].map(String).join(':');
    const stored=files[path] || previous[path];
    const sha=stored?.metadata===metadata && /^[0-9a-f]{64}$/.test(stored.sha256)?(counts.reused++,stored.sha256):(counts.hashed++,sha256(readFileSync(path)));
    files[path]={metadata,sha256:sha};return sha;
  };
  const save=()=>{if(persist) {mkdirSync(dirname(path),{recursive:true});atomicWrite(path,JSON.stringify({schema:'architecture-manager-content-cache/v1',files},null,2)+'\n',randomUUID());}};
  return {hashFile,save,counts};
}
