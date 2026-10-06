import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';
import {randomUUID} from 'node:crypto';

export const ONBOARDING_STEPS=['configuration','backend','environment','providers','capabilities','client','certification','governance','git'];
export function inputInvalidations(journal,inputs,versions) {
  const previous=journal.inputs || {},oldFields=previous.fields || {},newFields=inputs.fields || {},changed=[];
  const versionKeys={runnerVersion:'runner',contractsVersion:'contracts',scannerVersion:'scanner'};
  const normalize=(fields,key,pins)=>versionKeys[key]?(fields[key] || pins?.[versionKeys[key]]?.version):key==='clientArgs'?(fields[key] || []):key==='probeArguments'?(fields[key] || {}):(fields[key] || null);
  for(const key of new Set([...Object.keys(oldFields),...Object.keys(newFields)])) {
    if(['gitAuthorName','gitAuthorEmail'].includes(key))continue;
    if(stableJson(normalize(oldFields,key,journal.versions))!==stableJson(normalize(newFields,key,versions)))changed.push(key);
  }
  const clientFields=['clientKind','clientExecutable','clientArgs','probeTool','probeArguments'],providerFields=['peerDispatcherModule','peerContentRoot','softwareGateway','softwareEnvironment'];
  const result=new Set(['certification','governance','git']);
  if(changed.some(key=>![...clientFields,...providerFields,'displayName','matrixVersion'].includes(key)) || stableJson(previous.backendFields || {})!==stableJson(inputs.backendFields || {}))return [...ONBOARDING_STEPS];
  if(changed.length)for(const step of ['configuration','client'])result.add(step);
  if(changed.some(key=>providerFields.includes(key)) || stableJson(previous.bodies || {})!==stableJson(inputs.bodies || {}) || stableJson(previous.interpreterAliases || {})!==stableJson(inputs.interpreterAliases || {}))for(const step of ['providers','capabilities','client'])result.add(step);
  return ONBOARDING_STEPS.filter(step=>result.has(step));
}
const optional=['environment','software','client','certification','git'];
export function onboardingDeferrals(requested=[]) {
  if(!Array.isArray(requested) || requested.some(name=>!optional.includes(name)))throw Error('ONBOARDING_DEFERRAL_INVALID');
  const reasons={};for(const name of [...new Set(requested)]){
    const dependents=name==='environment'?['backend','environment','providers','capabilities','client','certification']:name==='software'?['software','certification']:name==='client'?['client','certification']:[name];
    const labels={environment:'运行环境',software:'软件绑定',client:'客户端验证',certification:'接入认证',git:'Git 提交'};
    for(const dependent of dependents)reasons[dependent] ||= dependent===name?'用户本次选择暂缓':'依赖暂缓的 '+labels[name]+'，未执行';
  }return reasons;
}
export function automaticJournalPath(root,id){return targetPath(root,`${id}/runtime/maintenance/manager-onboarding/automatic.json`);}
function affected(path,id) {
  if(['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md','.gitignore'].includes(path))return ['governance','git'];
  if(path===`${id}/bridge/client-adapter.json` || path.startsWith(`${id}/bridge/manager-client/`))return ['client','certification','governance','git'];
  if(path===`${id}/bridge/capabilities.json`)return ['capabilities','certification','governance','git'];
  if(path.includes('software-gateway-config.json') || path.includes('software-environment.json') || path.includes('/manager-providers/'))return ['providers','capabilities','certification','governance','git'];
  return [...ONBOARDING_STEPS];
}
function validTarget(path,id) {return path.startsWith(`${id}/bridge/`) || path===`${id}/bridge.json` || path===`${id}/runtime/software/software-environment.json` || ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md','.gitignore'].includes(path);}
export function onboardingResumePreview(root,id,mode='strict',versions=null) {
  if(!['strict','reconcile','restart'].includes(mode))throw Error('ONBOARDING_RESUME_MODE_INVALID');
  const file=automaticJournalPath(root,id);if(!fs.existsSync(file))return {mode,journalSha256:null,sourcePlanId:null,changes:[],invalidatedSteps:[],versionsChanged:false};
  const journal=readJson(file),changes=[];if(journal.platformId && journal.platformId!==id)throw Error('ONBOARDING_JOURNAL_INVALID');
  for(const [path,oldSha256] of Object.entries(journal.finalTargets || {})) {
    if(!validTarget(path,id) || !/^[a-f0-9]{64}$/.test(oldSha256))throw Error('ONBOARDING_JOURNAL_INVALID');
    const resolved=targetPath(root,path),newSha256=fs.existsSync(resolved)?sha256(fs.readFileSync(resolved)):null;
    if(oldSha256!==newSha256)changes.push({path,oldSha256,newSha256,affectedSteps:affected(path,id)});
  }
  const versionsChanged=Boolean(versions && [['runner','runnerVersion'],['contracts','contractsVersion'],['scanner','scannerVersion']].some(([name,key])=>{
    const prior=journal.versions?.[name]?.version || journal.inputs?.fields?.[key];
    return prior && prior!==versions[name].version;
  }));
  return {mode,journalSha256:sha256(fs.readFileSync(file)),sourcePlanId:journal.planId || null,changes,invalidatedSteps:ONBOARDING_STEPS.filter(step=>changes.some(row=>row.affectedSteps.includes(step))),versionsChanged};
}
export function assertResumePreview(root,id,preview,versions) {
  if(stableJson(onboardingResumePreview(root,id,preview.mode,versions))!==stableJson(preview))throw Error('ONBOARDING_RESUME_PREVIEW_CHANGED');
  if(preview.mode==='strict' && preview.changes.length)throw Error('ONBOARDING_RESUME_DRIFT');
  if(preview.mode==='reconcile' && preview.versionsChanged)throw Error('ONBOARDING_RESUME_VERSION_CHANGED');
}
export function archiveAutomaticJournal(file) {
  if(!fs.existsSync(file))return null;const bytes=fs.readFileSync(file),digest=sha256(bytes),directory=join(dirname(file),'history');fs.mkdirSync(directory,{recursive:true});
  const name='automatic-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+digest.slice(0,12)+'-'+randomUUID()+'.json',snapshot=join(directory,name);
  fs.writeFileSync(snapshot,bytes,{flag:'wx'});fs.writeFileSync(snapshot+'.SHA256SUMS',digest+'  '+name+'\n',{flag:'wx'});return {path:snapshot,sha256:digest};
}
export function reconcileAutomaticJournal(journal,preview) {
  const removed=journal.steps.filter(row=>preview.invalidatedSteps.includes(row.step));
  journal.steps=journal.steps.filter(row=>!preview.invalidatedSteps.includes(row.step));
  for(const row of preview.changes)if(row.newSha256)journal.finalTargets[row.path]=row.newSha256;else delete journal.finalTargets[row.path];
  (journal.reconciliations ||= []).push({at:new Date().toISOString(),approvedChanges:preview.changes,invalidatedSteps:preview.invalidatedSteps,removedResults:removed});
  return journal;
}
