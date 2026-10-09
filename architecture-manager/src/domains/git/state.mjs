import {gitRaw,nulPaths} from '../../infrastructure/git.mjs';

export function parseGitStatus(output) {
  const records=nulPaths(output),rows=[];
  for(let index=0;index<records.length;index++) {
    const record=records[index];
    const row={code:record.slice(0,2),path:record.slice(3)};
    if(/[RC]/.test(row.code)) row.originalPath=records[++index];
    rows.push(row);
  }
  return rows;
}
export function selectedPath(name,paths) { return paths.some(path=>name===path || name.startsWith(path+'/')); }
export function assertSelectedIndex(root,paths) {
  const staged=nulPaths(gitRaw(root,['diff','--cached','--name-only','-z']));
  const unrelated=staged.filter(name=>!selectedPath(name,paths));
  if(unrelated.length) throw Object.assign(new Error('GIT_UNRELATED_STAGED_FILES'),{paths:unrelated});
}
export function assertConfiguredRemote(root,remote) {
  if(typeof remote!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) || !gitRaw(root,['remote']).split(/\r?\n/).includes(remote)) throw new Error('INVALID_REMOTE');
  return remote;
}
