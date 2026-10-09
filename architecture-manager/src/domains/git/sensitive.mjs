import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {gitRaw,nulPaths} from '../../infrastructure/git.mjs';

const SECRET=/(password|passwd|api[_-]?key|access[_-]?token|secret|private[_-]?key)\s*[:=]/i;
const BODY=/\.(exe|dll|msi|msix|com|pyd|so|dylib|zip|7z|rar|iso|bundle)$/i;
export function inspectBytes(name,buffer) {
  const findings=[],size=buffer.length;
  if(size>10*1024*1024) findings.push({path:name,kind:'large-file',bytes:size});
  if(BODY.test(name) || buffer.includes(0)) findings.push({path:name,kind:'software-body-or-binary',bytes:size});
  if(/(^|\/)\.env(?:\.|$)|(^|\/)(?:credentials?|id_rsa|id_ed25519)(?:\.|$)/i.test(name) || SECRET.test(buffer.toString('utf8')) || /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(buffer.toString('utf8'))) findings.push({path:name,kind:'possible-secret',bytes:size});
  return findings;
}
export function scanPaths(root,paths) {
  const findings=[],visited=new Set();
  const visit=name=>{
    if(visited.has(name)) return;visited.add(name);
    const file=targetPath(root,name);
    if(!existsSync(file)) return;
    const meta=lstatSync(file);
    if(meta.isSymbolicLink()) {findings.push({path:name,kind:'symbolic-link'});return;}
    if(meta.isDirectory()) for(const child of readdirSync(file)) visit(join(name,child).replaceAll('\\','/'));
    else if(meta.isFile()) {
      if(meta.size>10*1024*1024) findings.push({path:name,kind:'large-file',bytes:meta.size});
      else findings.push(...inspectBytes(name,readFileSync(file)));
    }
  };
  for(const name of paths) visit(name);
  return {clean:findings.length===0,findings};
}
export function scanIndex(root,paths) {
  const files=nulPaths(gitRaw(root,['ls-files','--cached','-z','--',...paths]));
  const findings=files.flatMap(name=>{
    const size=Number(gitRaw(root,['cat-file','-s',':'+name]).trim());
    return size>10*1024*1024?[{path:name,kind:'large-file',bytes:size}]:inspectBytes(name,gitRaw(root,['show',':'+name],{encoding:null}));
  });
  return {clean:findings.length===0,findings};
}
export function scanOutgoing(root,remote) {
  const remoteRefs=gitRaw(root,['for-each-ref','--format=%(refname)',`refs/remotes/${remote}/`]).trim().split(/\r?\n/).filter(Boolean);
  const objects=gitRaw(root,['rev-list','--objects','HEAD',...(remoteRefs.length?['--not',...remoteRefs]:[])]).split(/\r?\n/).filter(Boolean);
  const findings=[];
  for(const entry of objects) {
    const split=entry.indexOf(' ');if(split<0) continue;
    const id=entry.slice(0,split),name=entry.slice(split+1);
    if(gitRaw(root,['cat-file','-t',id]).trim()!=='blob') continue;
    const size=Number(gitRaw(root,['cat-file','-s',id]).trim());
    if(size>10*1024*1024) findings.push({path:name,kind:'large-file',bytes:size});
    else findings.push(...inspectBytes(name,gitRaw(root,['cat-file','blob',id],{encoding:null})));
  }
  return {clean:findings.length===0,findings};
}
