import fs from 'node:fs';
import {resolve,relative} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {platformPath} from '../../core/platform-path.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';

const names=['software-gateway-config.json','software-gateway.json'];
const label=(root,path)=>relative(root,path).replaceAll('\\','/');
export function gatewayDifferences(current,other) {
  const missing=[],conflicts=[];
  for(const [key,value] of Object.entries(other)) {
    if(!Object.hasOwn(current,key)){missing.push(key);continue;}
    const active=current[key];
    if(active && value && typeof active==='object' && typeof value==='object' && !Array.isArray(active) && !Array.isArray(value)) {
      for(const [id,item] of Object.entries(value)) {
        if(!Object.hasOwn(active,id))missing.push(`${key}:${id}`);
        else if(stableJson(active[id])!==stableJson(item))conflicts.push(`${key}:${id}`);
      }
    }else if(stableJson(active)!==stableJson(value))conflicts.push(key);
  }
  return {missing,conflicts};
}
// An explicit pointer is authoritative. Discovery never imports historical state.
export function gatewayBinding(root,id,config={}) {
  root=resolve(root);
  const candidates=names.map(name=>targetPath(root,`${id}/bridge/${name}`)),declared=config.softwareGatewayConfig;
  const path=declared?platformPath(root,id,declared):candidates.find(file=>fs.existsSync(file)) || candidates[0];
  const value=fs.existsSync(path)?readJson(path):{},alternatives=[];
  for(const file of candidates.filter(file=>file!==path && fs.existsSync(file))) {
    try{alternatives.push({path:label(root,file),sha256:sha256(fs.readFileSync(file)),...gatewayDifferences(value,readJson(file))});}
    catch(error){alternatives.push({path:label(root,file),error:error.message,missing:[],conflicts:[]});}
  }
  const selectionRequired=(!declared || !fs.existsSync(path)) && alternatives.some(row=>row.conflicts.length || row.error || !fs.existsSync(path));
  return {path,relativePath:label(root,path),value,recovered:[],sources:[path,...alternatives.map(row=>targetPath(root,row.path))],alternatives,selectionRequired};
}
export function assertGatewaySelection(binding){if(binding.selectionRequired)throw Error('SOFTWARE_BINDING_SELECTION_REQUIRED');return binding;}
