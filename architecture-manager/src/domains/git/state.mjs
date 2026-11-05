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
// `extraAllowed` carries the departed source of a rename the caller already judged legitimate:
// once the destination is staged, git reports the pair as an add plus a delete, so the source
// shows up in the index without ever being addable itself. An unrelated rename still fails closed.
export function assertSelectedIndex(root,paths,extraAllowed=[]) {
  const staged=nulPaths(gitRaw(root,['diff','--cached','--name-only','-z']));
  const allowed=[...paths,...extraAllowed];
  const unrelated=staged.filter(name=>!selectedPath(name,allowed));
  if(unrelated.length) throw Object.assign(new Error('GIT_UNRELATED_STAGED_FILES'),{paths:unrelated});
}
export function assertConfiguredRemote(root,remote) {
  if(typeof remote!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) || !gitRaw(root,['remote']).split(/\r?\n/).includes(remote)) throw new Error('INVALID_REMOTE');
  return remote;
}
