import {sha256} from '../../core/hash.mjs';
import {parseJson} from '../../core/json.mjs';
import {safeRelative} from '../../core/paths.mjs';
import {gitRaw} from '../../infrastructure/git.mjs';
import {privateBindingHashes} from './binding.mjs';

function sharedBlobs(root,commit,paths) {
  if(!/^[0-9a-f]{40}$/i.test(commit || '')) return null;
  const names=[...new Set(paths)];
  if(names.some(path=>safeRelative(path)!==path || !/^(tool|agent|software)\//.test(path) || /[\r\n\0]/.test(path))) return null;
  try {
    const raw=gitRaw(root,['cat-file','--batch'],{encoding:null,stdio:['pipe','pipe','pipe'],input:names.map(path=>commit+':'+path).join('\n')+'\n'}),values=new Map();let offset=0;
    for(const name of names) {
      const end=raw.indexOf(10,offset);if(end<0) return null;
      const header=raw.subarray(offset,end).toString('utf8');offset=end+1;
      const match=/^[0-9a-f]+ blob (\d+)$/.exec(header);
      if(!match) {if(!header.endsWith(' missing')) return null;values.set(name,null);continue;}
      const size=Number(match[1]);values.set(name,raw.subarray(offset,offset+size));offset+=size+1;
    }
    return values;
  } catch {return null;}
}
// Registry labels/available-version caches change the old combined environment
// digest. Reconstruct its shared part from the recorded Git commit; compare the
// platform artifacts that exist NOW. An exact hash match proves those private
// artifacts did not change without reading another platform's runtime.
export function legacyBindingAtGit(root,id,previous,snapshot) {
  const commit=previous.git?.head;
  const registries=sharedBlobs(root,commit,['tool/registry.json','agent/registry.json','software/registry.json']);
  if(!registries || [...registries.values()].some(value=>!value)) return null;
  const privateHashes=privateBindingHashes(root,id),hashes={...privateHashes},pointers=[];
  const sections=[];
  for(const repo of ['tool','agent','software']) {
    const bytes=registries.get(repo+'/registry.json');hashes[repo]=sha256(bytes);const registry=parseJson(bytes.toString('utf8'));
    for(const entries of Object.values(registry)) if(Array.isArray(entries)) for(const entry of entries) if(entry.id) {const path=`${repo}/${entry.current || `${entry.id}/current.json`}`;pointers.push(path);sections.push({repo,entry,path});}
  }
  const closurePaths=Object.values(snapshot.cells).flatMap(cell=>cell.closure.map(({key})=>{const [path,version]=key.split('@');return `${path}/versions/${version}/SHA256SUMS`;}));
  const blobs=sharedBlobs(root,commit,[...pointers,...closurePaths]);if(!blobs) return null;
  // Rebuild the original insertion order, including each repository's pointers.
  const ordered={...privateHashes};
  for(const repo of ['tool','agent','software']) {ordered[repo]=hashes[repo];for(const row of sections.filter(row=>row.repo===repo)) if(blobs.get(row.path)) ordered[`${repo}:${row.entry.id}`]=sha256(blobs.get(row.path));}
  if(sha256(JSON.stringify(ordered))!==previous.environmentBindingSha256) return null;
  const unchanged=new Set();
  for(const [key,cell] of Object.entries(snapshot.cells)) if(cell.closure.every(entry=>{const [path,version]=entry.key.split('@'),blob=blobs.get(`${path}/versions/${version}/SHA256SUMS`);return blob && sha256(blob)===entry.sha256;})) unchanged.add(key);
  return {commit,unchanged,sharedMetadataReconstructed:true};
}
