import {existsSync,readFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {platformPath} from '../../core/platform-path.mjs';
import {readJson} from '../../core/json.mjs';

export function normaliseRunner(value) {
  if(value==null || typeof value==='string')return {};
  if(typeof value!=='object' || Array.isArray(value))throw Error('PLATFORM_RUNNER_SHAPE_INVALID');
  const result={...value},keys=Object.keys(result).filter(key=>/^\d+$/.test(key)).sort((a,b)=>Number(a)-Number(b));
  if(keys.length && keys.every((key,index)=>key===String(index) && typeof result[key]==='string' && result[key].length===1)) {
    const text=keys.map(key=>result[key]).join('');
    if(/^(?:wf-runner|architecture-runner|ai-workflow-runner|\d+\.\d+\.\d+)(?:[\w./\\-]*)$/.test(text) || /^(?:[A-Za-z]:\/|\/).*\/tool\/wf-runner(?:\/versions\/\d+\.\d+\.\d+)?$/.test(text.replaceAll('\\','/')))for(const key of keys)delete result[key];
  }
  return result;
}

export function bridgeCompatibility(root,id,config={}) {
  const canonical=`${id}/bridge.json`,legacy=`${id}/bridge/bridge.json`;
  const paths=[canonical,legacy].filter(path=>existsSync(targetPath(root,path)));
  const conflicted=paths.length===2 && !readFileSync(targetPath(root,canonical)).equals(readFileSync(targetPath(root,legacy)));
  let authority;
  if(config.bridge) {
    const selected=platformPath(root,id,config.bridge);
    authority=paths.find(path=>resolve(targetPath(root,path))===resolve(selected));
    if(!authority)throw Error('PLATFORM_BRIDGE_REFERENCE_UNKNOWN');
  } else if(paths.length===1 || !conflicted)authority=paths.includes(canonical)?canonical:paths[0];
  else throw Error('PLATFORM_BRIDGE_AUTHORITY_REQUIRED');
  const value=authority?readJson(targetPath(root,authority)):{};
  if(value.platform && value.platform!==id)throw Error('PLATFORM_ID_MISMATCH');
  return {authority:authority || canonical,canonical,legacy,paths,conflicted,value,
    mirrors:paths.filter(path=>path!==canonical),source:authority?relative(resolve(root),targetPath(root,authority)).replaceAll('\\','/'):'new-configuration'};
}

export function bridgeFiles(root,id,bridge,config={}) {
  const binding=bridgeCompatibility(root,id,config),content=JSON.stringify(bridge,null,2)+'\n';
  return [...new Set([binding.canonical,...binding.mirrors])].map(path=>({path,content}));
}
