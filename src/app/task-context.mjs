import {resolve} from 'node:path';
export function taskContext(input) {
  const roots=[typeof input==='string'?input:null,input?.workspaceRoot,input?.plan?.workspaceRoot,input?.intake?.workspaceRoot,input?.placementPlan?.workspaceRoot].filter(value=>value!=null);
  if(!roots.length || roots.some(value=>typeof value!=='string' || !value))throw Error('WORKSPACE_REQUIRED');
  const workspaceRoot=resolve(roots[0]);if(roots.some(value=>resolve(value)!==workspaceRoot))throw Error('IMPORT_TARGET_INVALID');
  return {workspaceRoot,platformId:input?.platformId || input?.plan?.target?.platformId || input?.placementPlan?.target?.platformId || null};
}
