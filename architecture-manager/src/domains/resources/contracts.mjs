import fs from 'node:fs';
import {parseDocument} from 'yaml';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import {parseJson} from '../../core/json.mjs';

const cache=new Map();
function assertSchema(name,value) {
  if(!cache.has(name)) {
    const schema=parseJson(fs.readFileSync(new URL('./contracts/'+name+'.schema.json',import.meta.url),'utf8'));
    const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false});
    cache.set(name,ajv.compile(schema));
  }
  const validate=cache.get(name);
  if(!validate(value)) throw Object.assign(Error('RESOURCE_SCHEMA_INVALID:'+name),{issues:validate.errors});
}
export function parseDefinition(text) {
  const document=parseDocument(text.replace(/^\uFEFF/,''),{uniqueKeys:true,strict:true});
  if(document.errors.length) throw Error('WORKFLOW_DEFINITION_INVALID');
  return document.toJS({maxAliasCount:0});
}
export function promptBlock(text,anchor) {
  if(typeof text!=='string')throw Error('RESOURCE_PROMPT_ANCHOR_INVALID');
  const tokens=[...text.matchAll(/<!--\s*(\/?)stage:([A-Za-z0-9_-]+)\s*-->/g)],opened=new Set();let active=null,start=0,result=null;
  for(const token of tokens) {
    if(!token[1]) {if(active || opened.has(token[2]))throw Error('RESOURCE_PROMPT_ANCHOR_INVALID');opened.add(token[2]);active=token[2];start=token.index+token[0].length;}
    else {if(active!==token[2])throw Error('RESOURCE_PROMPT_ANCHOR_INVALID');if(active===anchor)result=text.slice(start,token.index).trim();active=null;}
  }
  if(active || result===null || !result.trim())throw Error('RESOURCE_PROMPT_ANCHOR_INVALID');return result;
}
export function validateResourceContent({repository,resourceId,version,read,has}) {
  const manifest=parseJson(read('manifest.json'));
  if(manifest.id!==resourceId || manifest.version!==version) throw Error('RESOURCE_IDENTITY_MISMATCH');
  const exists=name=>typeof name==='string' && has(name);
  const schemas=[];
  if(repository==='tool' && ['ai-workflow/v2.1','ai-workflow/v2','ai-workflow/v1'].includes(manifest.schema)) {
    if(manifest.schema==='ai-workflow/v2.1') assertSchema('manifest-v2.1',manifest);
    if(!exists(manifest.entry)) throw Error('RESOURCE_ENTRY_MISSING');
    const definition=parseDefinition(read(manifest.entry));
    if(definition.id!==resourceId || String(definition.version)!==version) throw Error('WORKFLOW_IDENTITY_MISMATCH');
    if(['ai-workflow-definition/v2','ai-workflow-definition/v3'].includes(definition.schema)) assertSchema(definition.schema.endsWith('/v3')?'workflow-definition-v3':'workflow-definition-v2',definition);
    if(!definition.stages?.length) throw Error('WORKFLOW_STAGES_REQUIRED');
    const ids=new Set(definition.stages.map(stage=>stage.id));
    if(ids.size!==definition.stages.length) throw Error('WORKFLOW_STAGE_DUPLICATE');
    for(const stage of definition.stages) {
      for(const dependency of stage.dependsOn || []) if(!ids.has(dependency)) throw Error('WORKFLOW_STAGE_DEPENDENCY_MISSING');
      for(const field of ['promptRef','repairPromptRef','script','repairScript']) if(stage[field]) {
        const name=stage[field].replace(/^workflow:/,'').split('#')[0];
        if(!exists(name)) throw Error('RESOURCE_ENTRY_MISSING:'+name);
        if(['promptRef','repairPromptRef'].includes(field))promptBlock(read(name),stage[field].split('#stage:')[1]);
      }
    }
    const visited=new Set(),visiting=new Set();
    const visit=id=>{if(visiting.has(id))throw Error('WORKFLOW_STAGE_CYCLE');if(visited.has(id))return;visiting.add(id);for(const parent of definition.stages.find(stage=>stage.id===id).dependsOn || [])visit(parent);visiting.delete(id);visited.add(id);};
    for(const id of ids)visit(id);
    if(definition.schema==='ai-workflow-definition/v3') {
      if(!definition.scenarios?.[definition.defaultScenario]) throw Error('WORKFLOW_SCENARIO_MISSING');
      if(!Array.isArray(definition.requiredStages) || definition.requiredStages.some(id=>!ids.has(id))) throw Error('WORKFLOW_REQUIRED_STAGE_MISSING');
    }
    if(manifest.schema==='ai-workflow/v2.1') schemas.push(manifest.inputSchema,manifest.outputSchema);
  } else if(repository==='agent') {
    if(!['ai-agent/v1','ai-agent/v2'].includes(manifest.schema) || !exists(manifest.prompt) || !exists(manifest.toolLock) || !Array.isArray(manifest.workflows)) throw Error('RESOURCE_SCHEMA_INVALID:agent');
    const lock=parseJson(read(manifest.toolLock));
    if(!['ai-tool-lock/v1','ai-tool-lock/v2'].includes(lock.schema)) throw Error('RESOURCE_SCHEMA_INVALID:tool-lock');
    if(manifest.workflows.some(id=>!lock.workflows?.[id])) throw Error('RESOURCE_WORKFLOW_NOT_LOCKED');
    for(const policy of manifest.policies || []) if(policy.includes('/') && !exists(policy)) throw Error('RESOURCE_ENTRY_MISSING:'+policy);
  } else if(repository==='software') {
    if(manifest.schema==='ai-software/v1') assertSchema('software-manifest-v1',manifest);
    else if(['ai-software-gateway/v1','ai-software-connector-component/v1'].includes(manifest.schema)) assertSchema('software-component-v1',manifest);
    else throw Error('RESOURCE_SCHEMA_INVALID:software');
  } else if(repository==='tool' && ['ai-governance-tool/v1','ai-contract-package/v1','ai-runtime-contracts/v1','ai-skill/v1','ai-pack/v1'].includes(manifest.schema)) {
    if(manifest.entry && !exists(manifest.entry)) throw Error('RESOURCE_ENTRY_MISSING');
  } else throw Error('RESOURCE_SCHEMA_INVALID:'+repository);
  for(const name of schemas) {
    if(!exists(name)) throw Error('RESOURCE_SCHEMA_FILE_MISSING:'+name);
    const schema=parseJson(read(name));
    if(!schema || !Object.keys(schema).length) throw Error('RESOURCE_SCHEMA_PLACEHOLDER');
    const Validator=String(schema.$schema || '').includes('draft-07')?Ajv:Ajv2020;
    const validator=new Validator({strict:false,validateFormats:false});
    if(!validator.validateSchema(schema)) throw Error('RESOURCE_SCHEMA_FILE_INVALID:'+name);
  }
  return manifest;
}
