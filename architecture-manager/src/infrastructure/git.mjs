import {runScopedProcess} from './process-scope.mjs';

export function gitRaw(root,args,options={}) {
  return runScopedProcess('git',['-C',root,...args],{encoding:'utf8',shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,timeout:120000,...options});
}
export function gitText(root,args,options={}) { return gitRaw(root,args,options).trim(); }
export function nulPaths(output) { return output.split('\0').filter(Boolean); }
