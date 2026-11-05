import {existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {sha256} from '../core/hash.mjs';
import {targetPath} from '../core/paths.mjs';
import {atomicWrite} from './kernel.mjs';
import {restoreOwnedFiles} from './recovery.mjs';

const terminal = new Set(['applied','recovered']);
const digest = journal => {const {journalSha256: _ignored,...content}=journal;return sha256(JSON.stringify(content));};
function save(path,journal) {
  journal.journalSha256=digest(journal);
  atomicWrite(path,JSON.stringify(journal,null,2)+'\n',journal.transactionId);
}
function load(auditRoot,path) {
  const directory=targetPath(auditRoot,'recoveries');
  const safePath=targetPath(directory,relative(directory,resolve(path)));
  const journal=JSON.parse(readFileSync(safePath,'utf8'));
  if(journal.schema!=='architecture-manager-recovery/v1' || journal.journalSha256!==digest(journal) || !/^[A-Za-z0-9._-]{1,280}$/.test(journal.transactionId) || !['prepared','recovering','conflict',...terminal].includes(journal.status) || !Array.isArray(journal.entries) || !journal.entries.length) throw Error('RECOVERY_JOURNAL_INVALID');
  const seen=new Set();
  const entries=journal.entries.map(entry=>{
    const target=targetPath(journal.workspaceRoot,entry.target);
    if(seen.has(target) || !/^[a-f0-9]{64}$/.test(entry.afterSha256))throw Error('RECOVERY_JOURNAL_INVALID');
    seen.add(target);
    let before=null;
    if(entry.beforeSha256!==null) {
      if(!/^[a-f0-9]{64}$/.test(entry.beforeSha256) || entry.checkpoint!==`${journal.transactionId}-${entry.index}.before`)throw Error('RECOVERY_JOURNAL_INVALID');
      before=readFileSync(targetPath(directory,entry.checkpoint));
      if(sha256(before)!==entry.beforeSha256)throw Error('RECOVERY_CHECKPOINT_CHANGED');
    } else if(entry.checkpoint!==null)throw Error('RECOVERY_JOURNAL_INVALID');
    return {target,before,afterSha256:entry.afterSha256};
  });
  return {path:safePath,journal,entries};
}

// Written before any owned target changes. The journal stores hashes/paths only;
// original bytes stay in the same private audit area as existing checkpoints.
export function prepareRecovery({auditRoot,workspaceRoot,transactionId,entries}) {
  if(!/^[A-Za-z0-9._-]{1,280}$/.test(transactionId) || !entries.length)throw Error('RECOVERY_JOURNAL_INVALID');
  mkdirSync(auditRoot,{recursive:true});
  const directory=targetPath(auditRoot,'recoveries');mkdirSync(directory,{recursive:true});
  const path=targetPath(directory,transactionId+'.json');
  if(existsSync(path))throw Error('RECOVERY_JOURNAL_EXISTS');
  const records=entries.map((entry,index)=>{
    const target=relative(resolve(workspaceRoot),entry.target).replaceAll('\\','/');
    targetPath(workspaceRoot,target);
    if(!/^[a-f0-9]{64}$/.test(entry.afterSha256))throw Error('RECOVERY_JOURNAL_INVALID');
    const checkpoint=entry.before===null?null:`${transactionId}-${index}.before`;
    if(checkpoint)atomicWrite(targetPath(directory,checkpoint),entry.before,transactionId);
    return {index,target,beforeSha256:entry.before===null?null:sha256(entry.before),afterSha256:entry.afterSha256,checkpoint};
  });
  const journal={schema:'architecture-manager-recovery/v1',transactionId,workspaceRoot:resolve(workspaceRoot),status:'prepared',entries:records,restored:[]};
  save(path,journal);return path;
}

export function completeRecovery(auditRoot,path) {
  const loaded=load(auditRoot,path);
  if(loaded.journal.status!=='prepared')throw Error('RECOVERY_JOURNAL_INVALID');
  loaded.journal.status='applied';save(loaded.path,loaded.journal);
}

export function resumeRecovery(auditRoot,path,{onProgress=()=>{}}={}) {
  const {path:safePath,journal,entries}=load(auditRoot,path);
  if(terminal.has(journal.status))return {ok:true,status:journal.status,restored:[],journalPath:safePath};
  // Preflight every file before restoring any: an external edit blocks the batch.
  const conflicts=entries.filter(entry=>{
    const current=existsSync(entry.target)?sha256(readFileSync(entry.target)):null;
    return current!==(entry.before===null?null:sha256(entry.before)) && current!==entry.afterSha256;
  }).map(entry=>entry.target);
  if(conflicts.length){journal.status='conflict';save(safePath,journal);return {ok:false,conflicts,restored:[],journalPath:safePath};}
  journal.status='recovering';save(safePath,journal);
  const restored=[];
  for(const entry of entries.slice().reverse()) {
    // Revalidate boundaries at each write, including a replaced parent junction.
    targetPath(journal.workspaceRoot,relative(journal.workspaceRoot,entry.target));
    const result=restoreOwnedFiles([entry],journal.transactionId);
    if(!result.ok){journal.status='conflict';save(safePath,journal);return {...result,restored,journalPath:safePath};}
    restored.push(...result.restored);
    for(const target of result.restored)if(!journal.restored.includes(target))journal.restored.push(target);
    save(safePath,journal);
    onProgress({target:entry.target,restored:result.restored.length,journalPath:safePath});
  }
  journal.status='recovered';save(safePath,journal);
  return {ok:true,status:'recovered',restored,journalPath:safePath};
}

export function resumePendingRecoveries({auditRoot,workspaceRoot,targets}) {
  if(!existsSync(auditRoot) || !existsSync(join(auditRoot,'recoveries')))return [];
  const directory=targetPath(auditRoot,'recoveries'),results=[];
  for(const name of readdirSync(directory).filter(name=>name.endsWith('.json'))) {
    const path=targetPath(directory,name),raw=JSON.parse(readFileSync(path,'utf8'));
    if(resolve(raw.workspaceRoot || '').toLowerCase()!==resolve(workspaceRoot).toLowerCase() || terminal.has(raw.status))continue;
    if(!raw.entries?.some(entry=>targets.includes(targetPath(workspaceRoot,entry.target))))continue;
    const result=resumeRecovery(auditRoot,path);results.push(result);
    if(!result.ok)throw Object.assign(Error('RECOVERY_EXTERNAL_CHANGE'),{recovery:result});
  }
  return results;
}
