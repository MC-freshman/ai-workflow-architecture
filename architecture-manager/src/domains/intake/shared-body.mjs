import fs from 'node:fs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {validateFrozenResource,dependencyEntries} from '../resources/versions.mjs';
import {validateResourceContent} from '../resources/contracts.mjs';
import {scanExternalBody,readExternalText,assertIntakeUnchanged} from './sources.mjs';
import {buildIntakePublicationPlan} from './publication.mjs';
import {hasSensitiveLiteral} from './policy.mjs';
import {sha256} from '../../core/hash.mjs';

export const encode=value=>JSON.stringify(value,null,2)+'\n';
const sections={agent:['agent','agents',''],skill:['tool','skills','skills/'],tool:['tool','workflows',''],software:['software','software','']};
const ID=/^[a-z0-9][a-z0-9._-]*$/,SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function assertBodyIdentity(id,version) {if(!ID.test(id || ''))throw Error('RELEASE_RESOURCE_ID_INVALID');if(!SEMVER.test(version || ''))throw Error('RELEASE_SEMVER_INVALID');}
export function sharedRegistration(root,type,id,version,displayName) {
  const [repository,section,prefix]=sections[type],registryPath=`${repository}/registry.json`,registry=readJson(targetPath(root,registryPath));
  let catalogId=type==='skill'?'skills-'+id:id,catalogPath=`tool/_registry/${catalogId}.json`,catalog=null;
  if(type==='skill') {
    const owners=(registry.skills || []).filter(row=>row.kind==='skill-catalog').map(row=>({row,path:`tool/${row.path}`,catalog:readJson(targetPath(root,`tool/${row.path}`))})).filter(value=>value.catalog.skills?.some(skill=>skill.id===id));
    if(owners.length>1)throw Error('REGISTRY_ENTRY_INVALID');
    if(owners.length){catalogId=owners[0].row.id;catalogPath=owners[0].path;catalog=owners[0].catalog;}
    else if(fs.existsSync(targetPath(root,catalogPath))) {catalog=readJson(targetPath(root,catalogPath));if(catalog.skills?.some(row=>row.id!==id))throw Error('IMPORT_CATALOG_INVALID');}
  }
  const index=(registry[section] || []).findIndex(row=>row.id===catalogId),previous=index<0?{}:registry[section][index];
  const entry=type==='skill'?{...previous,id:catalogId,path:catalogPath.replace(/^tool\//,''),kind:'skill-catalog',enabled:true,invocable:false}:{...previous,id,displayName,version,current:`${prefix}${id}/current.json`,enabled:true};
  registry[section]=[...(registry[section] || [])];if(index<0)registry[section].push(entry);else registry[section][index]=entry;registry.version++;
  const changes=[{path:`${repository}/${prefix}${id}/current.json`,content:encode({schema:`ai-${type==='tool'?'workflow':type}-pointer/v1`,id,version,hashManifest:'SHA256SUMS'})}];
  if(type==='skill') {
    const next=catalog || {schema:'ai-skill-catalog/v1',sourceId:'user-import',skills:[]},old=next.skills.find(row=>row.id===id),skill={...old,id,version,...(old?{}:{sourceId:'user-import',sourcePath:`versions/${version}/SKILL.md`,category:'user-import'})};
    next.skills=old?next.skills.map(row=>row.id===id?skill:row):[...next.skills,skill];
    changes.push({path:catalogPath,content:encode(next)});
  }
  changes.push({path:registryPath,content:encode(registry)});return changes;
}
export function listBodyDependencies({workspaceRoot}) {
  const result={workflows:[],skills:[],packs:[],software:[]};
  for(const [repository,section,prefix] of [['tool','workflows',''],['tool','skills','skills/'],['tool','packs','packs/'],['software','software','']]) {
    const path=targetPath(workspaceRoot,`${repository}/registry.json`);if(!fs.existsSync(path))continue;
    for(const item of readJson(path)[section] || []) {
      if(item.enabled===false || item.deprecated)continue;
      const rows=item.kind==='skill-catalog'?(readJson(targetPath(workspaceRoot,`tool/${item.path}`)).skills || []):[item];
      for(const row of rows) {
        const pointer=targetPath(workspaceRoot,`${repository}/${prefix}${row.id}/current.json`);if(!fs.existsSync(pointer))continue;
        const current=readJson(pointer);if(ID.test(row.id) && SEMVER.test(current.version || ''))result[section].push({id:row.id,version:current.version,displayName:row.displayName || row.id});
      }
    }
    result[section]=[...new Map(result[section].map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  return {...result,writePerformed:false};
}
export function assertExactBodyDependencies(root,deps={}) {
  for(const [section,repository,prefix] of [['workflows','tool',''],['skills','tool','skills/'],['packs','tool','packs/'],['software','software','']])for(const [id,version] of dependencyEntries(deps[section]))validateFrozenResource(root,repository,id,version,undefined,prefix);
}
export async function readBodyEditor({workspaceRoot,platformId,type,resourceId,version=null,intake=null}) {
  if(intake) {await assertIntakeUnchanged(intake);return {intake,content:await readExternalText(intake,intake.selectedEntry),fields:{},writePerformed:false};}
  if(!['agent','skill'].includes(type))throw Error('INTAKE_TYPE_INVALID');
  const [repository,,prefix]=sections[type],pointer=readJson(targetPath(workspaceRoot,`${repository}/${prefix}${resourceId}/current.json`));version ||=pointer.version;assertBodyIdentity(resourceId,version);
  const checked=validateFrozenResource(workspaceRoot,repository,resourceId,version,undefined,prefix),manifest=checked.manifest,release=targetPath(workspaceRoot,`${repository}/${prefix}${resourceId}/versions/${version}`);
  const source=await scanExternalBody({workspaceRoot,platformId,type,sourcePath:release,entryPath:type==='agent'?(manifest.bodyPrompt || manifest.prompt):manifest.entry});
  const dependencies=type==='agent'?readJson(targetPath(release,manifest.toolLock)):manifest.dependencies || {};
  const latest=fs.readdirSync(targetPath(workspaceRoot,`${repository}/${prefix}${resourceId}/versions`)).filter(pin=>SEMVER.test(pin)).map(pin=>pin.split('.').map(Number)).sort((a,b)=>b[0]-a[0] || b[1]-a[1] || b[2]-a[2])[0];
  return {intake:source,content:await readExternalText(source,source.selectedEntry),fields:{resourceId,displayName:manifest.displayName || resourceId,version:[latest[0],latest[1],latest[2]+1].join('.'),role:manifest.role || '',runnerWorkflow:manifest.runnerWorkflow || '',dependencies,requires:manifest.requires || [],policies:manifest.policies || [],updating:true,manifest},writePerformed:false};
}
export async function buildAgentSkillBodyPlan({intake,platformId,resourceId,version,displayName,role='',runnerWorkflow='',dependencies={},requires=[],content=null,existingManifest=null}) {
  assertBodyIdentity(resourceId,version);if(!['agent','skill'].includes(intake.type))throw Error('INTAKE_TYPE_INVALID');
  await assertIntakeUnchanged(intake);content ??=await readExternalText(intake,intake.selectedEntry);
  if(typeof content!=='string' || !content.trim())throw Error('BODY_TEXT_REQUIRED');if(hasSensitiveLiteral(content))throw Error('RAW_SECRET_NOT_ALLOWED');
  assertExactBodyDependencies(intake.workspaceRoot,dependencies);
  const workflows=Object.fromEntries(dependencyEntries(dependencies.workflows)),skills=Object.fromEntries(dependencyEntries(dependencies.skills)),packs=Object.fromEntries(dependencyEntries(dependencies.packs)),software=Object.fromEntries(dependencyEntries(dependencies.software));
  const manifest={...(existingManifest || {}),schema:intake.type==='agent'?'ai-agent/v2':'ai-skill/v1',id:resourceId,version,displayName:displayName || resourceId,integrity:{sha256Manifest:'SHA256SUMS'},environmentOwnership:'platform-runtime'};
  const files={},sourceFiles=intake.files.filter(row=>row.included && row.text && !['SOURCE.json','SHA256SUMS'].includes(row.path)).map(row=>({sourcePath:row.path,path:'original/'+row.path}));
  if(intake.type==='agent') {
    if(Object.keys(software).length)throw Error('AGENT_SOFTWARE_DEPENDENCY_REQUIRES_WORKFLOW');
    if(!Object.keys(workflows).length || !workflows[runnerWorkflow])throw Error('AGENT_MAIN_WORKFLOW_REQUIRED');
    Object.assign(manifest,{role:role || '按所提供的专家正文处理任务',prompt:'prompt.md',bodyPrompt:'body.md',toolLock:'tool-lock.json',workflows:Object.keys(workflows),runnerWorkflow,permissions:existingManifest?.permissions || {filesystem:'project-scoped',network:'deny',process:'allowlisted-only'},policies:existingManifest?.policies || ['project-scoped','no-credentials']});
    // An edit also retains referenced policy files at their original relative paths.
    for(const policy of manifest.policies.filter(path=>path.includes('/'))) {const row=intake.files.find(row=>row.path===policy && row.included);if(!row)throw Error('RESOURCE_ENTRY_MISSING:'+policy);sourceFiles.push({sourcePath:row.path,path:row.path});}
    const context=[];manifest.bodyContexts=[];
    for(const [id,pin] of Object.entries(skills)) {
      const checked=validateFrozenResource(intake.workspaceRoot,'tool',id,pin,undefined,'skills/'),path=targetPath(intake.workspaceRoot,`tool/skills/${id}/versions/${pin}/${checked.manifest.entry}`),text=fs.readFileSync(path,'utf8').replace(/^\uFEFF/,'');
      if(hasSensitiveLiteral(text))throw Error('RAW_SECRET_NOT_ALLOWED');
      files[`contexts/${id}.md`]=text;manifest.bodyContexts.push({id,version:pin,sha256Manifest:checked.sumsSha256,textSha256:sha256(text),entry:`contexts/${id}.md`});
      context.push(`<!-- 精确技能上下文 ${id}@${pin}; SHA256SUMS ${checked.sumsSha256} -->\n${text}`);
    }
    files['body.md']=content;files['prompt.md']=[content,...context].join('\n\n');files['tool-lock.json']=encode({schema:'ai-tool-lock/v2',workflows,skills,packs,profiles:dependencies.profiles || {}});
  } else {
    if(!Array.isArray(requires) || requires.some(value=>typeof value!=='string' || !value.trim()))throw Error('SKILL_REQUIREMENTS_INVALID');
    Object.assign(manifest,{kind:'atomic',category:existingManifest?.category || 'user-import',entry:'SKILL.md',input:{type:'text',contract:'task plus project context'},output:{type:'text',contract:'advice, edits, or named artifacts'},permissions:existingManifest?.permissions || ['read-project'],requires,conflicts:existingManifest?.conflicts || [],dependencies:{workflows,skills,packs,software}});
    files['SKILL.md']=content;
  }
  files['manifest.json']=encode(manifest);
  validateResourceContent({repository:intake.type==='agent'?'agent':'tool',resourceId,version,read:name=>files[name],has:name=>Object.hasOwn(files,name) || sourceFiles.some(row=>row.path===name)});
  const changes=sharedRegistration(intake.workspaceRoot,intake.type,resourceId,version,manifest.displayName),skillCatalogPath=intake.type==='skill'?changes.find(row=>row.path.startsWith('tool/_registry/')).path:null;
  return buildIntakePublicationPlan({intake,platformId,repository:intake.type==='agent'?'agent':'tool',resourceId,version,prefix:intake.type==='skill'?'skills/':'',files,sourceFiles,changes,settings:{workflow:runnerWorkflow || null,exactDependencies:dependencies,skillCatalogPath,businessExecuted:false}});
}
