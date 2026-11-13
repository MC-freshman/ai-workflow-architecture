import fs from 'node:fs'; import path from 'node:path';
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
import { redact, safeConfig } from './redact.mjs';
import { makePlan, consumePlan, strip, audit } from './confirm.mjs';
const run = promisify(execFile);
const EMPTY={type:'object',additionalProperties:false,properties:{}};
const ID={type:'object',additionalProperties:false,properties:{id:{type:'string',pattern:'^[a-z0-9][a-z0-9._-]*$'}},required:['id']};
const CALL={type:'object',additionalProperties:false,properties:{module:{type:'string'},fn:{type:'string'},args:{type:'array'}},required:['module','fn']};
const PLAN={type:'object',additionalProperties:false,properties:{tool:{type:'string'},arguments:{type:'object'}},required:['tool','arguments']};
const CONF={planId:{type:'string',minLength:1},confirmToken:{type:'string',minLength:1}};
const WRITE=new Set(['arch_relayout_apply','arch_release_gate_draft','arch_defects_status_plan']);
const err=(c,m)=>Object.assign(new Error(m),{code:c});
const ROOT=()=>{const r=process.env.ARCH_WORKSPACE_ROOT||'';if(!r)throw err('ARCH_WORKSPACE_ROOT_REQUIRED','Set ARCH_WORKSPACE_ROOT.');const p=path.resolve(r);if(!fs.existsSync(p))throw err('ARCH_WORKSPACE_ROOT_INVALID','Root missing.');return p;};
const within=rel=>{const r=ROOT(),p=path.resolve(r,rel);if(p!==r&&!p.startsWith(r+path.sep))throw err('ARCH_PATH_ESCAPE','Path escapes root.');return p;};
const readJson=rel=>{const p=within(rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf-8')):null;};
const readText=rel=>{const p=within(rel);return fs.existsSync(p)?fs.readFileSync(p,'utf-8'):'';};
const out=(s,d)=>redact({schema:s,...d});
let GUARD={cache:new Map(),available:false,errors:[],reason:'ARCH_MANAGER_ROOT_REQUIRED'};
export const configure=g=>{GUARD=g;};
export const INJECT_SPEC={
 root:path.join(process.env.ARCH_MANAGER_ROOT||'', 'src','domains') || '',
 reason:'ARCH_MANAGER_ROOT_REQUIRED',
 kind:'esm',
 whitelist:{
  'resources/inventory.mjs':['scanWorkspace','inspectPlatformDirectory'],
  'platforms/adoption-completion.mjs':['readAdoptionCompletion'],
  'onboarding/onboarding-auto.mjs':['verifyAutomaticOnboarding','buildAutomaticOnboardingPlan'],
  'onboarding/onboarding-state.mjs':['readOnboardingState','readOnboardingThreeLayer'],
  'audit/defects.mjs':['readDefectBook','verifyDefectBook'],
  'docs/documents.mjs':['readDocument'],
  'git/state.mjs':['parseGitStatus'],
  'certification/anchor.mjs':['readAnchorState','anchorAlignment']
 }
};
INJECT_SPEC.root = process.env.ARCH_MANAGER_ROOT ? path.join(process.env.ARCH_MANAGER_ROOT,'src','domains') : '';
const WHITELIST=INJECT_SPEC.whitelist;
function injected(name,fn,args=[]){
 if(!GUARD.available)throw err('CAPABILITY_UNAVAILABLE:'+name,'Injected capability unavailable. Set ARCH_MANAGER_ROOT to the architecture-manager source root. Preload errors: '+JSON.stringify(GUARD.errors).slice(0,180));
 const entry=[...GUARD.cache.values()].find(e=>e.names.includes(fn));
 if(!entry)throw err('CAPABILITY_UNAVAILABLE:'+name,'Function '+fn+' is not in the preloaded read-only whitelist.');
 return entry.mod[fn](...args);
}
export const TOOLS=[
 {name:'arch_software_list',description:'Shared software registry entries.',inputSchema:EMPTY},
 {name:'arch_software_read',description:'One software pointer and manifest summary.',inputSchema:ID},
 {name:'arch_versions_current',description:'Pinned shared component versions.',inputSchema:EMPTY},
 {name:'arch_defects_list',description:'Defect book counts and non-closed ids.',inputSchema:EMPTY},
 {name:'arch_conform_status',description:'Last conform evidence.',inputSchema:EMPTY},
 {name:'arch_governance_status',description:'Named baseline from three authoritative lists.',inputSchema:EMPTY},
 {name:'arch_platform_pins',description:'runtimeComponentVersion per platform.',inputSchema:EMPTY},
 {name:'arch_baseline_read',description:'Current named baseline document head.',inputSchema:EMPTY},
 {name:'arch_updates_read',description:'Tail of the update log.',inputSchema:EMPTY},
 {name:'arch_registry_all',description:'Entry counts across the three shared registries.',inputSchema:EMPTY},
 {name:'arch_capabilities',description:'Injected whitelist, preload state and gaps.',inputSchema:EMPTY},
 {name:'arch_call',description:'Call one whitelisted read-only domain function.',inputSchema:CALL},
 {name:'arch_inventory',description:'Full workspace inventory (injected).',inputSchema:EMPTY},
 {name:'arch_adoption_read',description:'11-step adoption completion verdict (injected).',inputSchema:EMPTY},
 {name:'arch_three_layer',description:'Three-layer onboarding readback (injected).',inputSchema:EMPTY},
 {name:'arch_anchor_state',description:'Anchor alignment state (injected).',inputSchema:EMPTY},
 {name:'arch_plan',description:'Issue a zero-write plan for a write tool.',inputSchema:PLAN},
 {name:'arch_relayout_apply',description:'Apply runtime component re-layout (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:CONF,required:['planId','confirmToken']}},
 {name:'arch_release_gate_draft',description:'Read the release gate draft (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:CONF,required:['planId','confirmToken']}},
 {name:'arch_defects_status_plan',description:'Draft a defect status change plan, zero writes.',inputSchema:{type:'object',additionalProperties:false,properties:CONF,required:['planId','confirmToken']}}
];
export async function handle(name,args={}){
 if(name==='arch_plan'){if(!WRITE.has(args.tool))throw err('PLAN_TOOL_INVALID','plan only accepts write tools.');return makePlan(args.tool,args.arguments||{});}
 if(WRITE.has(name)){const v=consumePlan(name,args);audit({tool:name,decision:v.ok?'confirmed':'rejected',code:v.code||null});if(!v.ok)throw err(v.code,v.message);}
 const R=ROOT();
 switch(name){
  case 'arch_software_list':{const d=readJson('software/registry.json');return out('arch-software-list/v2',{ids:(d?.software||[]).map(e=>e.id),entries:d?.software||[]});}
  case 'arch_software_read':{const id=String(args.id||'');if(!/^[a-z0-9][a-z0-9._-]*$/.test(id))throw err('ARCH_ID_INVALID','bad id');const c=readJson(`software/${id}/current.json`);if(!c)throw err('ARCH_FILE_NOT_FOUND',id);const m=readJson(`software/${id}/versions/${c.version}/manifest.json`);return out('arch-software-read/v2',{id,version:c.version,available:c.available,kind:m?.kind||null,capabilities:m?.capabilities?.length||0});}
  case 'arch_versions_current':{const a=readJson('versions/anchor.json');return out('arch-versions-current/v2',{engine:a?.engine,checker:a?.checker,judge:a?.judge,contracts:a?.contracts,conformance:a?.conformance});}
  case 'arch_defects_list':{const d=readJson('versions/缺陷状态簿.json');const rows=d?.defects||[];const counts={};for(const r of rows)counts[r.status]=(counts[r.status]||0)+1;return out('arch-defects-list/v2',{total:rows.length,counts,nonClosed:rows.filter(r=>!['closed','ruled','absorbed'].includes(r.status)).map(r=>r.id)});}
  case 'arch_conform_status':{const d=readJson('architecture-manager/conform.json');return d?out('arch-conform-status/v2',{available:true,ok:d.ok,digest:d.digest,recordedAt:d.recordedAt}):out('arch-conform-status/v2',{available:false,reason:'EVIDENCE_NOT_FOUND'});}
  case 'arch_governance_status':{const b={};for(const f of ['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md']){const m=readText(f).match(/当前命名基线[^\r\n]{0,180}/);b[f]=m?(m[0].match(/\d+\.\d+\.\d+/)||[null])[0]:null;}return out('arch-governance-status/v2',{baselines:b});}
  case 'arch_platform_pins':{const pins={};for(const e of fs.readdirSync(R,{withFileTypes:true})){if(!e.isDirectory()||!fs.existsSync(path.join(R,e.name,'bridge.json')))continue;pins[e.name]=JSON.parse(fs.readFileSync(path.join(R,e.name,'bridge.json'),'utf-8')).runtimeComponentVersion||null;}return out('arch-platform-pins/v2',{pins});}
  case 'arch_baseline_read':{const v=(readText('AGENTS.md').match(/当前命名基线[^\r\n]*?(\d+\.\d+\.\d+)/)||[])[1]||'3.7.0';const t=readText(`versions/架构${v}.md`);return out('arch-baseline-read/v2',{baseline:v,lines:t.split(/\r?\n/).slice(0,80)});}
  case 'arch_updates_read':{const t=readText('versions/更新日志.md');return out('arch-updates-read/v2',{tail:t.split(/\r?\n/).slice(-60)});}
  case 'arch_registry_all':{const c={};for(const r of ['tool','agent','software']){const d=readJson(`${r}/registry.json`);c[r]=d?((d.workflows||d.agents||d.software||[]).length):null;}return out('arch-registry-all/v2',{counts:c});}
  case 'arch_capabilities':return out('arch-capabilities/v2',{available:GUARD.available,reason:GUARD.reason||null,modules:[...GUARD.cache.entries()].map(([k,v])=>({module:k,functions:v.names})),errors:GUARD.errors,stdoutNoiseDuringPreload:GUARD.noise||''});
  case 'arch_call':{const m=String(args.module||''),f=String(args.fn||'');if(!Object.prototype.hasOwnProperty.call(WHITELIST,m)||!WHITELIST[m].includes(f))throw err('FUNCTION_NOT_WHITELISTED',`${m}#${f}`);const v=await injected(name,f,Array.isArray(args.args)?args.args:[]);return out('arch-call/v2',{module:m,fn:f,result:v});}
  case 'arch_inventory':return out('arch-inventory/v2',{inventory:await injected(name,'scanWorkspace',[R])});
  case 'arch_adoption_read':return out('arch-adoption-read/v2',{adoption:await injected(name,'readAdoptionCompletion',[R])});
  case 'arch_three_layer':return out('arch-three-layer/v2',{state:await injected(name,'readOnboardingState',[R])});
  case 'arch_anchor_state':return out('arch-anchor-state/v2',{anchor:await injected(name,'readAnchorState',[R])});
  case 'arch_relayout_apply':{const mgr=process.env.ARCH_MANAGER_ROOT;if(!mgr)throw err('CAPABILITY_UNAVAILABLE:arch_relayout_apply','Set ARCH_MANAGER_ROOT.');const cli=path.join(mgr,'src','cli.mjs');const {stdout}=await run(process.execPath,[cli,'relayout','--root',R],{timeout:120000,maxBuffer:8*1024*1024});let rep;try{rep=JSON.parse(stdout);}catch{rep={raw:stdout.slice(0,400)};}return out('arch-relayout-apply/v2',{applied:true,report:rep});}
  case 'arch_release_gate_draft':{const p=within('architecture-manager/release-gate.json');return out('arch-release-gate-draft/v2',{available:fs.existsSync(p),content:fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf-8')):null});}
  case 'arch_defects_status_plan':{const d=readJson('versions/缺陷状态簿.json');return out('arch-defects-status-plan/v2',{draftOnly:true,total:(d?.defects||[]).length,open:(d?.defects||[]).filter(r=>!['closed','ruled','absorbed'].includes(r.status)).length,note:'Zero writes. Use the management UI for real status changes.'});}
  default:throw err('TOOL_UNKNOWN',name);
 }
}
