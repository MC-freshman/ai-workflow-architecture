import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { redact, safeConfig } from './redact.mjs';
import { makePlan, consumePlan, strip, audit } from './confirm.mjs';
const require=createRequire(import.meta.url);
const EMPTY={type:'object',additionalProperties:false,properties:{}};
const FILE={type:'object',additionalProperties:false,properties:{fileName:{type:'string',minLength:1}},required:['fileName']};
const CALL={type:'object',additionalProperties:false,properties:{module:{type:'string'},fn:{type:'string'},args:{type:'array'}},required:['module','fn']};
const PLAN={type:'object',additionalProperties:false,properties:{tool:{type:'string'},arguments:{type:'object'}},required:['tool','arguments']};
const CONF={planId:{type:'string',minLength:1},confirmToken:{type:'string',minLength:1}};
const SEARCH={type:'object',additionalProperties:false,properties:{question:{type:'string',minLength:1},topK:{type:'integer',minimum:1,maximum:20}},required:['question']};
const WRITE=new Set(['novel_chapter_write','novel_backup_create','novel_knowledge_rebuild']);
const err=(c,m)=>Object.assign(new Error(m),{code:c});
const P=()=>{const r=process.env.NOVEL_PROJECT_ROOT||'';if(!r)throw err('NOVEL_PROJECT_ROOT_REQUIRED','Set NOVEL_PROJECT_ROOT.');const p=path.resolve(r);if(!fs.existsSync(path.join(p,'novel.config.json')))throw err('NOVEL_PROJECT_INVALID','novel.config.json missing.');return p;};
const within=(r,rel)=>{const p=path.resolve(r,rel);if(p!==r&&!p.startsWith(r+path.sep))throw err('NOVEL_PATH_ESCAPE','Path escapes root.');return p;};
const readJson=(r,rel)=>{const p=within(r,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf-8')):null;};
const listing=(r,rel)=>{const p=within(r,rel);return fs.existsSync(p)&&fs.statSync(p).isDirectory()?fs.readdirSync(p,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name):null;};
const out=(s,d)=>redact({schema:s,...d});
let GUARD={cache:new Map(),writeCache:new Map(),available:false,errors:[],reason:'NOVEL_APP_ROOT_REQUIRED'};
export const configure=g=>{GUARD=g;};
export const INJECT_SPEC={
 root:process.env.NOVEL_APP_ROOT?path.join(process.env.NOVEL_APP_ROOT,'electron','services'):'',
 reason:'NOVEL_APP_ROOT_REQUIRED',kind:'cjs',
 whitelist:{
  'project-ops.cjs':['loadConfig','buildAppState','loadConfigUnlocked'],
  'project-files.cjs':['loadProjectSources','loadCharacters','loadWorldDocs','loadChapterContent','loadConfigUnlocked'],
  'knowledge-index.cjs':['loadKnowledgeSummaries','searchRelevantChunks','loadVectorStore'],
  'analysis-tools.cjs':['buildTimelineEvents','analyzeConsistency','getStoryOverviewForProject','loadAnalysisState','buildRelationshipGraph'],
  'story-state.cjs':['loadStoryState','buildStoryOverview'],
  'creative-workspace.cjs':['getCreativeWorkspaceView']
 },
 writeWhitelist:{
  'project-ops.cjs':['createBackup'],
  'project-content.cjs':['saveChapterContent'],
  'knowledge-index.cjs':['rebuildIndex','indexSource']
 }
};
const WHITELIST=INJECT_SPEC.whitelist;
function injected(name,fn,args=[]){
 if(!GUARD.available)throw err('CAPABILITY_UNAVAILABLE:'+name,'Set NOVEL_APP_ROOT to the AI Novel Writing Platform source root. Preload errors: '+JSON.stringify(GUARD.errors).slice(0,180));
 const entry=[...GUARD.cache.values()].find(e=>e.names.includes(fn));
 if(!entry)throw err('CAPABILITY_UNAVAILABLE:'+name,'Function '+fn+' is not in the preloaded read-only whitelist.');
 return entry.mod[fn](...args);
}
function injectedWrite(name,fn,args=[]){
 if(!GUARD.available)throw err('CAPABILITY_UNAVAILABLE:'+name,'Set NOVEL_APP_ROOT to the AI Novel Writing Platform source root.');
 const entry=[...GUARD.writeCache.values()].find(e=>e.names.includes(fn));
 if(!entry)throw err('CAPABILITY_UNAVAILABLE:'+name,'Write function '+fn+' is not in the preloaded write whitelist.');
 return entry.mod[fn](...args);
}
export const TOOLS=[
 {name:'novel_project_info',description:'Safe project metadata.',inputSchema:EMPTY},
 {name:'novel_chapter_list',description:'Chapter files.',inputSchema:EMPTY},
 {name:'novel_chapter_read',description:'Read one chapter file.',inputSchema:FILE},
 {name:'novel_character_list',description:'Character files.',inputSchema:EMPTY},
 {name:'novel_world_list',description:'Worldbuilding files.',inputSchema:EMPTY},
 {name:'novel_knowledge_status',description:'Knowledge index summaries.',inputSchema:EMPTY},
 {name:'novel_analysis_state',description:'Analysis snapshot.',inputSchema:EMPTY},
 {name:'novel_project_tree',description:'Project directory tree (2 levels).',inputSchema:EMPTY},
 {name:'novel_config_keys',description:'Config key names only, no values.',inputSchema:EMPTY},
 {name:'novel_capabilities',description:'Injected whitelist and preload state.',inputSchema:EMPTY},
 {name:'novel_call',description:'Call one whitelisted read-only service function.',inputSchema:CALL},
 {name:'novel_state',description:'Full project app state (injected, redacted).',inputSchema:EMPTY},
 {name:'novel_knowledge_search',description:'Local knowledge retrieval (injected).',inputSchema:SEARCH},
 {name:'novel_analysis_timeline',description:'Timeline events (injected).',inputSchema:EMPTY},
 {name:'novel_analysis_consistency',description:'Consistency issues (injected).',inputSchema:EMPTY},
 {name:'novel_story_overview',description:'Story overview (injected).',inputSchema:EMPTY},
 {name:'novel_plan',description:'Issue a zero-write plan for a write tool.',inputSchema:PLAN},
 {name:'novel_chapter_write',description:'Save chapter content (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:{chapterId:{type:'string'},content:{type:'string'},expectedRevision:{type:'string'},...CONF},required:['chapterId','content','planId','confirmToken']}},
 {name:'novel_backup_create',description:'Create project backup (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:{fileName:{type:'string'},...CONF},required:['planId','confirmToken']}},
 {name:'novel_knowledge_rebuild',description:'Rebuild knowledge index (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:CONF,required:['planId','confirmToken']}}
];
export async function handle(name,args={}){
 if(name==='novel_plan'){if(!WRITE.has(args.tool))throw err('PLAN_TOOL_INVALID','plan only accepts write tools.');return makePlan(args.tool,args.arguments||{});}
 if(WRITE.has(name)){const v=consumePlan(name,args);audit({tool:name,decision:v.ok?'confirmed':'rejected',code:v.code||null});if(!v.ok)throw err(v.code,v.message);}
 const r=P();
 switch(name){
  case 'novel_project_info':return out('novel-project-info/v2',safeConfig(readJson(r,'novel.config.json')||{}));
  case 'novel_chapter_list':{const f=listing(r,'chapters')||[];return out('novel-chapter-list/v2',{count:f.length,chapters:f.map(n=>({fileName:n,bytes:fs.statSync(within(r,`chapters/${n}`)).size}))});}
  case 'novel_chapter_read':{const f=path.basename(String(args.fileName||''));if(f!==String(args.fileName||''))throw err('NOVEL_PATH_ESCAPE','basename only');const p=within(r,`chapters/${f}`);if(!fs.existsSync(p))throw err('NOVEL_FILE_NOT_FOUND',f);if(fs.statSync(p).size>2*1024*1024)throw err('NOVEL_FILE_TOO_LARGE','2MiB limit');return out('novel-chapter-read/v2',{fileName:f,text:fs.readFileSync(p,'utf-8')});}
  case 'novel_character_list':case 'novel_world_list':{const dirs=name==='novel_character_list'?['characters','character']:['world','worldDocs','worldbuilding'];for(const d of dirs){const f=listing(r,d);if(f)return out(name+'/v2',{directory:d,count:f.length,files:f});}return out(name+'/v2',{available:false,reason:'DIRECTORY_NOT_FOUND'});}
  case 'novel_knowledge_status':{const s=readJson(r,'vector_db/summaries.json')||readJson(r,'vector_db/vectors.json');return out('novel-knowledge-status/v2',{available:!!s,topLevelKeys:s?Object.keys(s):[]});}
  case 'novel_analysis_state':{const s=readJson(r,'analysis/snapshot.json');return out('novel-analysis-state/v2',{available:!!s,topLevelKeys:s?Object.keys(s):[]});}
  case 'novel_project_tree':{const rows=[];for(const e of fs.readdirSync(r,{withFileTypes:true}))rows.push({name:e.name,type:e.isDirectory()?'dir':'file',children:e.isDirectory()?fs.readdirSync(within(r,e.name)).slice(0,40):[]});return out('novel-project-tree/v2',{root:r,entries:rows});}
  case 'novel_config_keys':return out('novel-config-keys/v2',{keys:Object.keys(readJson(r,'novel.config.json')||{})});
  case 'novel_capabilities':return out('novel-capabilities/v2',{available:GUARD.available,reason:GUARD.reason||null,modules:[...GUARD.cache.entries()].map(([k,v])=>({module:k,functions:v.names})),errors:GUARD.errors,stdoutNoiseDuringPreload:GUARD.noise||''});
  case 'novel_call':{const m=String(args.module||''),f=String(args.fn||'');if(!Object.prototype.hasOwnProperty.call(WHITELIST,m)||!WHITELIST[m].includes(f))throw err('FUNCTION_NOT_WHITELISTED',`${m}#${f}`);const extra=Array.isArray(args.args)?args.args:[];return out('novel-call/v2',{module:m,fn:f,result:await injected(name,f,[r,...extra])});}
  case 'novel_state':return out('novel-state/v2',{state:await injected(name,'buildAppState',[r])});
  case 'novel_knowledge_search':{const q=String(args.question||''),k=Number(args.topK||5);const v=await injected(name,'searchRelevantChunks',[r,q,k,{}]);return out('novel-knowledge-search/v2',{result:v,indexed:(v?.totalIndexedCount??0)>0});}
  case 'novel_analysis_timeline':return out('novel-analysis-timeline/v2',{timeline:await injected(name,'buildTimelineEvents',[r,{}])});
  case 'novel_analysis_consistency':return out('novel-analysis-consistency/v2',{analysis:await injected(name,'analyzeConsistency',[r,{}])});
  case 'novel_story_overview':return out('novel-story-overview/v2',{overview:await injected(name,'getStoryOverviewForProject',[r])});
  case 'novel_chapter_write':{const payload={chapterId:args.chapterId,content:args.content};for(const k of ['expectedRevision'])if(args[k]!==undefined)payload[k]=args[k];const v=await injectedWrite(name,'saveChapterContent',[r,payload]);return out('novel-chapter-write/v2',{chapter:v?.chapter??v});}
  case 'novel_backup_create':{const f=path.basename(String(args.fileName||`backup-${Date.now()}.zip`));const dir=within(r,'backups');fs.mkdirSync(dir,{recursive:true});const v=await injectedWrite(name,'createBackup',[r,path.join(dir,f)]);return out('novel-backup-create/v2',{backupPath:v});}
  case 'novel_knowledge_rebuild':return out('novel-knowledge-rebuild/v2',{result:await injectedWrite(name,'rebuildIndex',[r,{}])});
  default:throw err('TOOL_UNKNOWN',name);
 }
}
