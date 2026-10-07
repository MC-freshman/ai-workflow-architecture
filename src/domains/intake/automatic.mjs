import fs from 'node:fs';
import {basename} from 'node:path';
import YAML from 'yaml';
import {readExternalText,assertIntakeUnchanged,entryChunks} from './sources.mjs';
import {buildAgentSkillBodyPlan,listBodyDependencies} from './shared-body.mjs';
import {buildToolBodyPlan,readToolBodyEditor} from './tool-body.mjs';
import {targetPath} from '../../core/paths.mjs';

const ID=/^[a-z0-9][a-z0-9._-]*$/,VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function nextImportVersion(root,type,id,preferred='1.0.0') {
  const repository=type==='agent'?'agent':type==='software'?'software':'tool',prefix=type==='skill'?'skills/':'';
  const directory=targetPath(root,`${repository}/${prefix}${id}/versions`);
  if(!fs.existsSync(directory))return VERSION.test(preferred)?preferred:'1.0.0';
  const versions=fs.readdirSync(directory).filter(value=>VERSION.test(value)).map(value=>value.split('.').map(Number)).sort((a,b)=>b[0]-a[0] || b[1]-a[1] || b[2]-a[2]);
  return versions.length?[versions[0][0],versions[0][1],versions[0][2]+1].join('.'):'1.0.0';
}

export async function suggestBodyImport({intake}) {
  if(!intake?.selectedEntry)throw Error('INTAKE_ENTRY_INVALID');
  let manifest=null;
  if(intake.files.some(row=>row.path==='manifest.json' && row.included && row.text)){
    try{manifest=JSON.parse(await readExternalText(intake,'manifest.json'));}catch{throw Error('RESOURCE_SCHEMA_INVALID');}
  }
  const selected=intake.files.find(row=>row.path===intake.selectedEntry);
  const text=selected?.text?await readExternalText(intake,intake.selectedEntry):'';
  let front={};
  if(text.startsWith('---\n') || text.startsWith('---\r\n')){const block=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(block){try{front=YAML.parse(block[1],{maxAliasCount:30}) || {};}catch{/* Invalid metadata is content, never instructions. */}}}
  const heading=text.match(/^#\s+(.+)$/m)?.[1]?.trim(),sourceName=basename(intake.sourcePath || intake.selectedEntry).replace(/\.(zip|md|txt|exe|py|js|mjs|ps1|sh)$/i,'');
  const stem=sourceName.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
  const candidate=manifest?.id || front.id || front.name || stem;
  const resourceId=typeof candidate==='string' && ID.test(candidate)?candidate:`${intake.type}-${intake.sourceFingerprint.slice(0,10)}`;
  const version=nextImportVersion(intake.workspaceRoot,intake.type,resourceId,manifest?.version);
  const fields={resourceId,version,displayName:manifest?.displayName || front.name || heading || sourceName,role:manifest?.role || heading || '按提供的正文处理任务',runnerWorkflow:manifest?.runnerWorkflow || '',dependencies:manifest?.dependencies || {workflows:{},skills:{},packs:{},profiles:{}},requires:manifest?.requires || []};
  if(intake.type==='tool' && !manifest?.dependencies)fields.dependencies={workflows:{},skills:{},packs:{}};
  if(intake.type==='agent'){
    const options=listBodyDependencies({workspaceRoot:intake.workspaceRoot});
    if(manifest?.toolLock && intake.files.some(row=>row.path===manifest.toolLock && row.included))fields.dependencies=JSON.parse(await readExternalText(intake,manifest.toolLock));
    if(!fields.runnerWorkflow){const workflow=options.workflows.find(row=>row.id==='expert-task') || options.workflows[0];if(!workflow)throw Error('AGENT_MAIN_WORKFLOW_REQUIRED');fields.runnerWorkflow=workflow.id;fields.dependencies={...fields.dependencies,workflows:{...fields.dependencies.workflows,[workflow.id]:workflow.version}};}
  }
  let mode=null;
  if(intake.type==='software'){
    if(selected?.text && /\.(py|js|mjs|ps1|sh)$/i.test(intake.selectedEntry))mode='cli';
    else if(/\.exe$/i.test(intake.selectedEntry) && !selected.installer){
      let header=Buffer.alloc(0);for await(const chunk of entryChunks(intake,selected)){header=Buffer.concat([header,chunk.subarray(0,Math.max(0,4096-header.length))]);if(header.length>=4096)break;}
      if(header.length>=64 && header.readUInt16LE(0)===0x5a4d){const offset=header.readUInt32LE(60);if(offset+94<=header.length && header.readUInt32LE(offset)===0x4550){const subsystem=header.readUInt16LE(offset+24+68);mode=subsystem===2?'gui':subsystem===3?'cli':null;}}
    }
  }
  return {fields,manifest,content:text,mode,versionAutoIncremented:version!==manifest?.version,instructionsExecuted:false,writePerformed:false};
}

export async function buildAutomaticTextBodyPlan({intake,platformId}) {
  if(!['agent','skill','tool'].includes(intake?.type))throw Error('AUTOMATIC_INTAKE_CONFIGURATION_REQUIRED');
  await assertIntakeUnchanged(intake);
  const suggestion=await suggestBodyImport({intake});let plan;
  if(intake.type==='tool'){
    const editor=await readToolBodyEditor({workspaceRoot:intake.workspaceRoot,platformId,intake});
    const script=/\.(py|js|mjs|ps1|sh)$/i.test(intake.selectedEntry);
    const stages=editor.definition?null:script?[{id:'RUN',action:'script',worker:'expert',script:'original/'+intake.selectedEntry,arguments:{argv:[],timeoutSeconds:30}}]:null;
    plan=await buildToolBodyPlan({workspaceRoot:intake.workspaceRoot,platformId,intake,...suggestion.fields,manifest:editor.manifest,definition:editor.definition,content:editor.definition?undefined:editor.content,stages,adopt:true});
  } else plan=await buildAgentSkillBodyPlan({intake,platformId,...suggestion.fields,content:suggestion.content,existingManifest:suggestion.manifest});
  plan.automatic={identity:suggestion.fields.resourceId,version:suggestion.fields.version,source:'manifest/frontmatter/file name',standardWorkflow:suggestion.fields.runnerWorkflow || null,permissions:'retained from manifest, otherwise bounded standard template',bodyExecuted:false};
  return plan;
}
