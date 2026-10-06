import {runScopedProcess as execFileSync} from '../../infrastructure/process-scope.mjs';
import {parseJson as parseJsonText} from '../../core/json.mjs';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,rmSync,copyFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {sha256} from '../../core/hash.mjs';
import {targetPath} from '../../core/paths.mjs';
import {inside} from '../../core/json.mjs';
import {gitRaw,gitText} from '../../infrastructure/git.mjs';
import {parseGitStatus} from './state.mjs';
import {archiveTool} from '../../infrastructure/archive-tool.mjs';

function tree(root) {
  return gitRaw(root,['ls-tree','-rz','--full-tree','HEAD']).split('\0').filter(Boolean).map(record=>{
    const tab=record.indexOf('\t'),[mode,type,id]=record.slice(0,tab).split(' '),name=record.slice(tab+1);
    if(type!=='blob' || mode==='120000') throw Error('GIT_BACKUP_UNSUPPORTED_ENTRY');
    return {path:name,sha256:sha256(gitRaw(root,['cat-file','blob',id],{encoding:null}))};
  });
}
function files(root,prefix='') {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
    const name=prefix+entry.name;
    if(entry.isSymbolicLink()) throw Error('GIT_BACKUP_UNSUPPORTED_ENTRY');
    return entry.isDirectory()?files(join(root,entry.name),name+'/'):[name];
  });
}
export function createGitBackup(root,plan) {
  const mode=plan.target.backupMode || 'snapshot';
  const base=mode==='history'?`inbox/backup/${plan.target.platformId}`:'inbox/archive';
  if(!['snapshot','history'].includes(mode) || !plan.target.destination.startsWith(base+'/')) throw Error('GIT_BACKUP_DESTINATION_INVALID');
  const destination=targetPath(root,plan.target.destination);
  if(existsSync(destination)) throw Error('GIT_BACKUP_ALREADY_EXISTS');
  const expectedTree=tree(root);
  const changes=mode==='history'?parseGitStatus(gitRaw(root,['status','--porcelain=v1','-z','--untracked-files=all'])):[];
  const stagedPatch=mode==='history'?gitRaw(root,['diff','--cached','--binary'],{encoding:null}):Buffer.alloc(0);
  mkdirSync(destination,{recursive:true});
  const restore=join(destination,'.restore-proof');
  const report={schema:'architecture-manager-git-backup/v1',backupMode:mode,head:gitText(root,['rev-parse','HEAD']),containsUncommitted:mode==='history',mayContainCredentials:mode==='history',privateNotForPublication:mode==='history',restoreVerified:false,tracked:expectedTree,changes:[]};
  if(mode==='snapshot') {
    gitRaw(root,['-c','core.autocrlf=false','archive','--format=zip','-o',join(destination,'repo.zip'),'HEAD']);
    mkdirSync(restore);
    execFileSync(archiveTool(),['-xf',join(destination,'repo.zip'),'-C',restore],{windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']});
  } else {
    gitRaw(root,['bundle','create',join(destination,'source.bundle'),'--all']);
    writeFileSync(join(destination,'index.patch'),stagedPatch);
    for(const change of changes) {
      const source=targetPath(root,change.path);
      if(existsSync(source)) {
        if(!lstatSync(source).isFile()) throw Error('GIT_BACKUP_UNSUPPORTED_ENTRY');
        const payload=join(destination,'working-tree',change.path);
        mkdirSync(dirname(payload),{recursive:true});copyFileSync(source,payload);
        const digest=sha256(readFileSync(payload));
        if(sha256(readFileSync(source))!==digest) throw Error('EXTERNAL_CHANGE_DETECTED');
        report.changes.push({...change,sha256:digest});
      } else report.changes.push({...change,deleted:true});
    }
    gitRaw(root,['bundle','verify',join(destination,'source.bundle')]);
    execFileSync('git',['clone','--no-checkout',join(destination,'source.bundle'),restore],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000});
    gitRaw(restore,['config','core.autocrlf','false']);
    gitRaw(restore,['checkout','--detach',report.head]);
  }
  for(const entry of expectedTree) if(sha256(readFileSync(targetPath(restore,entry.path)))!==entry.sha256) throw Error('GIT_BACKUP_RESTORE_MISMATCH');
  if(mode==='history') {
    if(stagedPatch.length) gitRaw(restore,['apply','--cached',join(destination,'index.patch')]);
    if(!gitRaw(restore,['diff','--cached','--binary'],{encoding:null}).equals(stagedPatch)) throw Error('GIT_BACKUP_INDEX_RESTORE_MISMATCH');
    for(const change of report.changes) {
      const target=targetPath(restore,change.path);
      if(change.deleted) {if(existsSync(target)) rmSync(target);}
      else {mkdirSync(dirname(target),{recursive:true});copyFileSync(join(destination,'working-tree',change.path),target);if(sha256(readFileSync(target))!==change.sha256) throw Error('GIT_BACKUP_RESTORE_MISMATCH');}
    }
  }
  report.restoreVerified=true;report.restoredAt=new Date().toISOString();
  // Only remove the owned, newly created restore fixture, never the source tree.
  if(!inside(destination,restore) || lstatSync(restore).isSymbolicLink()) throw Error('GIT_BACKUP_DESTINATION_INVALID');
  rmSync(restore,{recursive:true});
  writeFileSync(join(destination,'MANIFEST.json'),JSON.stringify(report,null,2)+'\n');
  const sums=files(destination).filter(name=>name!=='SHA256SUMS').sort().map(name=>`${sha256(readFileSync(join(destination,name)))}  ${name}`).join('\n')+'\n';
  writeFileSync(join(destination,'SHA256SUMS'),sums);
  return {sha256:sha256(sums),backupMode:mode,restoreVerified:true};
}
export function verifyGitBackup(root,plan) {
  try {
    const directory=targetPath(root,plan.target.destination),sums=readFileSync(join(directory,'SHA256SUMS'),'utf8');
    const listed=new Set();
    for(const line of sums.split(/\r?\n/).filter(Boolean)) {
      const match=/^([0-9a-f]{64})  (.+)$/.exec(line);
      if(!match || listed.has(match[2])) throw Error('GIT_BACKUP_HASH_INVALID');
      listed.add(match[2]);
      if(sha256(readFileSync(targetPath(directory,match[2])))!==match[1]) throw Error('GIT_BACKUP_HASH_MISMATCH');
    }
    const actual=files(directory).filter(name=>name!=='SHA256SUMS').sort();
    if(JSON.stringify([...listed].sort())!==JSON.stringify(actual)) throw Error('GIT_BACKUP_FILE_SET_MISMATCH');
    const manifest=parseJsonText(readFileSync(join(directory,'MANIFEST.json'),'utf8'));
    return {ok:manifest.restoreVerified===true && manifest.head===plan.target.headBefore,backupMode:manifest.backupMode,restoreVerified:manifest.restoreVerified,sumsPath:join(directory,'SHA256SUMS')};
  } catch(error) {return {ok:false,error:error.message};}
}
