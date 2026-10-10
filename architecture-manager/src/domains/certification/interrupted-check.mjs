import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readJson} from '../../core/json.mjs';

// Older workers could die before saving an aborted report. Clean their owned
// probes first, then expose only the existing hashed partial rows for reuse.
export async function recoverInterruptedCheck({base,platformId,configSha256,scope,cleanup,save}) {
  if(!existsSync(base))return null;
  const directories=readdirSync(base,{withFileTypes:true}).filter(row=>row.isDirectory() && !row.isSymbolicLink()).map(row=>row.name).sort().reverse();
  for(const name of directories) {
    const out=join(base,name),snapshotPath=join(out,'scope-snapshot.json'),partialPath=join(out,'matrix.partial.json');
    if(existsSync(join(out,'check.json')) || !existsSync(snapshotPath) || !existsSync(partialPath))continue;
    let prior,partial;
    try {prior=readJson(snapshotPath);partial=readJson(partialPath);}catch{continue;}
    if(prior.snapshot?.platformId!==platformId || prior.snapshot.configSha256!==configSha256 || (prior.snapshot.scope || 'full')!==scope || !partial.rows?.length)continue;
    const result=await cleanup(out);
    if(!result.ok)throw Error('INTERRUPTED_CHECK_CLEANUP_REQUIRED');
    return save(out,{schema:'architecture-manager-platform-check/v1',platformId,scope,stage:'check-cancelled',status:'aborted',reason:'recovered-interrupted-worker',partialPath,matrixPath:null,
      conformPath:join(out,'conform.json'),cleanupPath:join(out,'cancel-cleanup.json'),counts:{pass:0,fail:0},issues:['旧检查已安全停止；只复用内容仍一致的实际通过行。'],checkedAt:new Date().toISOString(),evidenceFresh:true});
  }
  return null;
}
