import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {parseJson,readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {validateRegistry} from '../resources/registry.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';

const sections={tool:['workflows','skills','packs'],agent:['agents'],software:['software']};
// This is a static release audit, not a claim that a native client or software body works.
// The existing publication validators own the contract and hash rules.
export function auditWorkspace({workspaceRoot}) {
  const root=resolve(workspaceRoot),results=[],inputs=[];
  const context={seen:new Set(),visiting:new Set(),resources:new Map()};
  const inspect=(target,check)=>{
    try {results.push({target,ok:true,...check()});}
    catch(error){results.push({target,ok:false,error:String(error.message)});context.visiting.clear();}
  };
  for(const [repository,groups] of Object.entries(sections)) {
    let registry;
    inspect(`${repository}/registry.json`,()=>{
      const bytes=readFileSync(targetPath(root,`${repository}/registry.json`));
      inputs.push({path:`${repository}/registry.json`,sha256:sha256(bytes)});
      registry=parseJson(bytes.toString('utf8'));
      validateRegistry(root,repository,bytes.toString('utf8'),{validateReleases:false});
      return {kind:'registry'};
    });
    for(const section of groups) for(const entry of Array.isArray(registry?.[section])?registry[section]:[]) {
      const label=`${repository}/${section}:${typeof entry?.id==='string'?entry.id:'invalid-entry'}`;
      inspect(label,()=>{
        const single={...registry,...Object.fromEntries(groups.map(group=>[group,group===section?[entry]:[]]))};
        validateRegistry(root,repository,JSON.stringify(single),{validateReleases:false});
        if(entry.kind==='skill-catalog')return {kind:'catalog',enabled:entry.enabled};
        const pointerPath=`${repository}/${entry.current}`,file=targetPath(root,pointerPath),bytes=readFileSync(file),pointer=readJson(file);
        inputs.push({path:pointerPath,sha256:sha256(bytes)});
        if(!entry.enabled)return {kind:'resource',enabled:false,version:pointer.version,releaseChecked:false};
        const prefix=['skills','packs'].includes(section)?section+'/':'';
        const verified=validateFrozenResource(root,repository,entry.id,pointer.version,context,prefix);
        return {kind:'resource',enabled:true,version:pointer.version,releaseChecked:true,sumsSha256:verified.sumsSha256};
      });
    }
  }
  // Detect pointer/registry edits during the read, rather than blessing a mixed snapshot.
  const uniqueInputs=[...new Map(inputs.map(row=>[row.path,row])).values()].sort((a,b)=>a.path.localeCompare(b.path));
  const changedInputs=uniqueInputs.filter(row=>{
    try{return sha256(readFileSync(targetPath(root,row.path)))!==row.sha256;}catch{return true;}
  }).map(row=>row.path);
  const releases=[...context.resources].map(([resource,value])=>({resource,sumsSha256:value.sumsSha256})).sort((a,b)=>a.resource.localeCompare(b.resource));
  const summary={passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,validatedReleases:releases.length,changedInputs:changedInputs.length};
  const report={schema:'architecture-manager-workspace-audit/v1',recordedAt:new Date().toISOString(),workspaceRoot:root,scope:'registered-current-and-exact-dependencies',readOnly:true,productionCalls:false,ok:summary.failed===0 && changedInputs.length===0,summary,results,inputs:uniqueInputs,releases,changedInputs};
  report.digest=sha256(JSON.stringify({summary,results,inputs:uniqueInputs,releases,changedInputs}));
  return report;
}
