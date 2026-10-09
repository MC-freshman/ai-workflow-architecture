import fs from 'node:fs';
import {extname} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {parseJson,readJson} from '../../core/json.mjs';
import {parseDefinition,validateResourceContent,promptBlock} from '../resources/contracts.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {assertBodyIdentity,assertExactBodyDependencies,sharedRegistration,encode} from './shared-body.mjs';
import {readExternalText,assertIntakeUnchanged,scanExternalBody,draftTextSource} from './sources.mjs';
import {buildIntakePublicationPlan} from './publication.mjs';
import {hasSensitiveLiteral} from './policy.mjs';

const permissions={filesystem:'project-scoped',network:'deny',process:'allowlisted-only'};
const inputSchema={type:'object',required:['request'],properties:{request:{type:'string',minLength:1}},additionalProperties:false},outputSchema={type:'object',required:['answer'],properties:{answer:{type:'string'}},additionalProperties:false};
export function workflowTextFiles({resourceId,version,displayName,content,stages=null,dependencies={workflows:{},skills:{},packs:{}},definition=null,manifest=null,extraFiles={}}) {
  assertBodyIdentity(resourceId,version);
  const body=content?.trim() || '阅读输入的 request，按用户目标完成任务并返回 answer；缺少必要输入时明确说明。';
  const flow=definition?{...definition,id:resourceId,version,stages:stages || definition.stages}:{schema:'ai-workflow-definition/v2',id:resourceId,version,mode:'pipeline',maxParallel:1,roles:['expert'],outputWorker:'expert',stages:(stages || [{id:'INTAKE',action:'prompt',worker:'expert',dependsOn:[],promptRef:'prompt.md#stage:INTAKE'}]).map(stage=>({...stage,outputs:stage.outputs || 'schemas/output.json'}))};
  const data=manifest?{...manifest,id:resourceId,version,displayName:displayName || manifest.displayName || resourceId}:{schema:'ai-workflow/v2.1',id:resourceId,version,displayName:displayName || resourceId,mode:flow.mode,entry:'workflow.yaml',inputSchema:'schemas/input.json',outputSchema:'schemas/output.json',permissions,dependencies,integrity:{sha256Manifest:'SHA256SUMS'}};
  const files={...extraFiles,'manifest.json':encode(data),[data.entry]:encode(flow)};
  if(!manifest){files['schemas/input.json']=encode(inputSchema);files['schemas/output.json']=encode(outputSchema);}
  if(!definition || content!==undefined)files['prompt.md']=flow.stages.filter(stage=>stage.action==='prompt').map(stage=>`<!-- stage:${stage.id} -->\n${stage.body || body}\n<!-- /stage:${stage.id} -->\n`).join('\n');
  for(const stage of flow.stages)delete stage.body;
  files[data.entry]=encode(flow);
  validateResourceContent({repository:'tool',resourceId,version,read:name=>files[name],has:name=>Object.hasOwn(files,name)});return files;
}
export async function readToolBodyEditor({workspaceRoot,platformId,resourceId=null,version=null,intake=null}) {
  let manifest=null,definition=null,content='',source=intake;
  if(resourceId) {
    version ||=readJson(targetPath(workspaceRoot,`tool/${resourceId}/current.json`)).version;
    manifest=validateFrozenResource(workspaceRoot,'tool',resourceId,version).manifest;
    if(!['ai-workflow/v2.1','ai-workflow/v2','ai-workflow/v1'].includes(manifest.schema))throw Error('TOOL_DEFINITION_KIND_REQUIRED');
    source=await scanExternalBody({workspaceRoot,platformId,type:'tool',sourcePath:targetPath(workspaceRoot,`tool/${resourceId}/versions/${version}`),entryPath:manifest.entry});
  }
  if(source) {
    await assertIntakeUnchanged(source);content=await readExternalText(source,source.selectedEntry);
    if(/\.(json|yaml|yml)$/i.test(source.selectedEntry)) {
      definition=parseDefinition(content);if(!definition?.stages?.length)throw Error('WORKFLOW_STAGES_REQUIRED');
      const localManifest=source.files.find(row=>row.path==='manifest.json' && row.included);if(!manifest && localManifest)manifest=parseJson(await readExternalText(source,localManifest.path));
      content=source.files.some(row=>row.path==='prompt.md' && row.included)?await readExternalText(source,'prompt.md'):'';
    }
  }
  const versions=resourceId?fs.readdirSync(targetPath(workspaceRoot,`tool/${resourceId}/versions`)).filter(pin=>/^\d+\.\d+\.\d+$/.test(pin)).map(pin=>pin.split('.').map(Number)).sort((a,b)=>b[0]-a[0] || b[1]-a[1] || b[2]-a[2]):[];
  const stageBodies={};
  if(source && definition)for(const stage of definition.stages)if(stage.promptRef) {
    const path=stage.promptRef.replace(/^workflow:/,'').split('#')[0];
    if(source.files.some(row=>row.included && row.path===path)) {
      const text=await readExternalText(source,path);stageBodies[stage.id]=promptBlock(text,stage.id);
    }
  }
  return {intake:source,content,manifest,definition,stageBodies,fields:{resourceId:resourceId || manifest?.id || '',version:resourceId?[versions[0][0],versions[0][1],versions[0][2]+1].join('.'):'1.0.0',displayName:manifest?.displayName || '',dependencies:manifest?.dependencies || {workflows:{},skills:{},packs:{}},updating:Boolean(resourceId)},writePerformed:false};
}
export async function buildToolBodyPlan({workspaceRoot,platformId,intake=null,resourceId,version,displayName,content=undefined,stages=null,dependencies={},definition=null,manifest=null,adopt=true}) {
  assertBodyIdentity(resourceId,version);if(intake && intake.type!=='tool')throw Error('INTAKE_TYPE_INVALID');
  const root=intake?.workspaceRoot || workspaceRoot;assertExactBodyDependencies(root,dependencies);
  const original={};
  if(intake) {await assertIntakeUnchanged(intake);for(const row of intake.files.filter(row=>row.included && row.text && !['SHA256SUMS','SOURCE.json'].includes(row.path)))original[row.path]=await readExternalText(intake,row.path);}
  if(intake && !definition && /\.(json|yaml|yml)$/i.test(intake.selectedEntry))definition=parseDefinition(original[intake.selectedEntry]);
  if(intake && content===undefined && !definition)content=original[intake.selectedEntry];
  let selected=stages;
  if(!definition && !stages && intake && /\.(py|js|mjs|ps1|sh)$/i.test(intake.selectedEntry))selected=[{id:'RUN',action:'script',worker:'expert',dependsOn:[],script:'original/'+intake.selectedEntry,arguments:{argv:[],timeoutSeconds:30}}];
  if(selected) {
    if(!selected.length)throw Error('WORKFLOW_STAGES_REQUIRED');
    selected=selected.map((stage,index)=>({...stage,worker:stage.worker || 'expert',dependsOn:stage.dependsOn || (index?[selected[index-1].id]:[]),...(stage.action==='prompt'?{promptRef:`prompt.md#stage:${stage.id}`}:{})}));
  }
  const supporting={...original};delete supporting['manifest.json'];if(definition && manifest)delete supporting[manifest.entry];
  for(const [path,text] of Object.entries(original))supporting['original/'+path]=text;
  const nextManifest=manifest?{...manifest,dependencies}:null;
  const files=workflowTextFiles({resourceId,version,displayName,content,stages:selected,dependencies,definition,manifest:nextManifest,extraFiles:supporting});
  for(const content of Object.values(files))if(hasSensitiveLiteral(content))throw Error('RAW_SECRET_NOT_ALLOWED');
  const source=intake || draftTextSource({workspaceRoot:root,platformId,type:'tool',files:{'instructions.md':content || '按输入的 request 处理任务，返回 answer。'},entryPath:'instructions.md'});
  const current=targetPath(root,`tool/${resourceId}/current.json`),changes=adopt || !fs.existsSync(current)?sharedRegistration(root,'tool',resourceId,version,displayName || resourceId):[];
  return buildIntakePublicationPlan({intake:source,platformId,repository:'tool',resourceId,version,files,changes,settings:{adopt:changes.length>0,sourceVersion:manifest?.version || null,scriptExecutionConfirmed:false,programBodiesBelongTo:'software',scriptExtensions:selected?.filter(stage=>stage.action==='script').map(stage=>extname(stage.script)) || []}});
}
