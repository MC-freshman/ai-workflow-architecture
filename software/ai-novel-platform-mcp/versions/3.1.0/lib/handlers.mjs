import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
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
const WRITE=new Set(['novel_chapter_write','novel_backup_create','novel_knowledge_rebuild','novel_apply','novel_mindmap_create','novel_mindmap_add_nodes','novel_mindmap_update_node','novel_mindmap_delete_node','novel_mindmap_delete','novel_mindmap_import_xmind']);
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
INJECT_SPEC.whitelist = {"analysis-tools.cjs": ["analyzeConsistency", "analyzeStoryStateWithAI", "buildAiTimelineEvents", "buildExtractionMaterials", "buildLocalConsistencyIssues", "buildRelationshipGraph", "buildTimelineEvents", "extractTimeHints", "findSimilarWorldDoc", "getStoryOverviewForProject", "globalSearch", "loadAnalysisState", "loadIssueStatuses", "makeSearchSnippet", "normalizeComparableTitle", "normalizeConsistencyIssues", "normalizeExtractedWorldCards", "normalizeTimelinePayload", "queryTokens", "refreshLocalStoryState", "storyAnalysisSystemPrompt"], "app-update.cjs": ["checkForAppUpdate", "compareVersionNumbers", "downloadAndOpenAppUpdate"], "creative-agent.cjs": ["buildAgentRetrievalContext", "buildCreativeAgentExecutionContext", "collectCreativeAgentToolReport", "countExactOccurrences", "getCreativeWorkspaceView", "inferRevisionAction", "pacingReport", "queueCreativeAgentRun"], "creative-statistics.cjs": ["analyzeProjectStatistics", "buildArcAlerts", "chapterMetrics", "plainText"], "creative-workspace.cjs": ["generateArcs", "loadWorkspace", "qualityReport", "relevantMemories"], "docx-export.cjs": ["chapterContentToDocxChildren", "htmlInlineRuns", "htmlNodeToDocxBlocks", "htmlToDocxChildren", "imageRunFromHtmlNode", "normalizeHtmlText", "parseMarkdownTable", "reviewRunsForText", "stripMarkdown", "textRunsFromMarkdown"], "docx-fidelity.cjs": ["decodeXml", "extractComments", "extractImageLayouts", "extractTableLayouts", "extractTrackedChanges", "readDocxFidelity"], "ipc-contract.cjs": ["verifyIpcContract"], "ipc-security.cjs": ["assertTrustedSender", "validateIpcArguments"], "knowledge-freshness.cjs": ["cacheHealth", "getManifestPath", "inspectSources", "loadManifest"], "knowledge-index.cjs": ["buildIndexEntries", "buildKnowledgeSourceDescriptors", "chapterToKnowledgeItem", "chunkText", "compactSearchText", "compatibleVectorScore", "cosineSimilarity", "embeddingIdentity", "extractMetadata", "getEmbedding", "getKnowledgeSyncStatus", "getMaintenanceDiagnostics", "hashToken", "indexFreshnessItems", "indexSource", "indexSourcesUnlocked", "inspectKnowledgeFreshness", "lexicalRelevanceScore", "listKnowledgeItems", "loadKnowledgeSummaries", "loadMaterials", "loadVectorStore", "localEmbedding", "remoteEmbedding", "searchRelevantChunks", "selectUsefulChunks", "summarizeSourceText"], "mind-map-import.cjs": ["readXMindFile"], "logger.cjs": ["flushForTests", "getLogDir", "initLogger", "isLoggerActive", "log", "makeLogger", "pruneOldLogs"], "novel-agent.cjs": ["canUseTool", "initialToolStates", "normalizePermission", "normalizeScopeType", "permissionRank", "recommendScopeType", "resolveScope", "selectTools"], "novel-network-import.cjs": ["htmlToPlanningText", "parseNetworkJson", "readImportFiles"], "novel-network.cjs": ["makeId", "normalizeNetwork", "parseDocuments", "splitCells"], "operation-journal.cjs": ["beginOperation", "completeOperation", "endSession", "failOperation", "getRecoveryStatus", "listDrafts", "loadJournal", "loadWindowState"], "project-archives.cjs": ["buildBackupZip", "portableValue", "readExchangeArchive", "redactSecrets", "remapAssetValue", "validateExchangeZip"], "project-config.cjs": ["assertExpectedChapterRevision", "configForRenderer", "configFromRenderer", "getDefaultProjectPath", "inspectProjectHealth", "withJournalOperation"], "project-content.cjs": ["assertNoAccidentalChapterClone", "buildAppStateUnlocked", "calculateTotalWords", "compareChapterVersion", "convertDocumentToRichContent", "diffLines", "refreshChapterFromOriginalDocumentUnlocked"], "project-exchange-security.cjs": ["decryptBuffer", "encryptBuffer", "isEncrypted"], "project-exchange.cjs": ["buildProjectExchangeArchiveUnlocked", "previewProjectExchange", "readExchangeJson", "uniqueFileNameInDirectory"], "project-files.cjs": ["backupUnreadableConfig", "buildWorldDocFile", "cachedChapterRevision", "characterToMarkdown", "clampNumber", "contentRevision", "contentToPlainText", "countWords", "decodeBasicEntities", "defaultConfig", "escapeHtml", "extensionFromContentType", "extractOutline", "formatBytes", "getAnalysisDir", "getAnalysisStatePath", "getChapterPath", "getChapterVersionContentPath", "getChapterVersionDir", "getCharacterPath", "getConfigPath", "getIssueStatusPath", "getKnowledgeRole", "getKnowledgeSummariesPath", "getMaterialPath", "getMaterialsDir", "getOriginalDocumentPath", "getSharedChapterFileGroups", "getVectorsPath", "getWorldDocPath", "isHtmlContent", "knowledgeRoleLabel", "listChapterVersions", "loadChapterContent", "loadCharacters", "loadConfigUnlocked", "loadProjectSources", "loadWorldDocs", "makeId", "mapWithConcurrency", "normalizeCategory", "normalizeChapterFileName", "normalizeChapterVersionFileName", "normalizeDataId", "normalizeExportedDocxBuffer", "normalizeKnowledgeRole", "normalizeManagedFileName", "nowIso", "parseWorldDocFile", "promoteMarkdownHeadingsInHtml", "readJson", "readProjectConfig", "sanitizeDocxText", "sanitizeExportPathSegment", "sanitizeFileName", "snapshotChapterVersion", "stableHash", "stripWordBookmarkXml", "stripWorldDocFrontMatter", "todayKey", "uniqueChapterFileName", "uniqueContentFileName", "uniqueExportFileName", "uniqueFileName", "uniqueFileNameAllowingCurrent", "uniqueFileNameAvoiding"], "project-migrations.cjs": ["loadMigrationState", "migrateConfig", "migrateProject"], "project-ops.cjs": ["buildAppState", "buildProjectExchangeArchive", "indexSources", "loadConfig", "refreshChapterFromOriginalDocument"], "project-snapshots.cjs": ["compareSnapshot", "garbageCollectObjects", "listSnapshots"], "project-storage.cjs": ["readJson", "safeFileSegment", "sha256", "stableId", "withProjectTransaction", "withProjectWriteQueue"], "project-transactions.cjs": ["recoverFileTransactions"], "release-privacy.cjs": ["scanReleaseInputs"], "retrieval-pipeline.cjs": ["buildChatRetrievalPackage", "buildInventorySummary", "buildProjectMemorySummary", "buildProjectSourceCatalog", "buildSystemPrompt", "classifyRetrievalMode", "collectPromptMaterials", "compactChatHistory", "contextFromChunks", "describeFetchError", "extractOpenAiCompatibleAnswer", "fetchJsonWithDiagnostics", "fetchOpenAiCompatibleStream", "findMentionedChapters", "findMentionedSourceIds", "forceIncludeSourceChunks", "normalizeRetrievalMode", "normalizeTitleForMatch", "planHierarchicalRetrieval", "safeEndpointLabel", "summarizeRetrieval", "truncateForPrompt"], "retrieval-planner.cjs": ["auditEvidenceCoverage", "buildChapterAdjacency", "buildCoverageAudit", "buildEvidenceTargets", "buildSourceReasons", "buildStoryBoosts", "decomposeQuery", "extractQuerySignals", "inspectVolumeCache", "rankVolumeCache", "scoreCandidate", "selectionReasons"], "story-state.cjs": ["analyzeChapterLocally", "generateLocalBoard", "getAgentContext", "getBoard", "getStoryOverview", "listBoards", "normalizeAiChapterAnalysis"], "task-center.cjs": ["PersistentTaskCenter"], "task-runtime.cjs": ["buildAppearanceStats", "buildCreativeStatistics", "buildWorldMap", "getProjectTaskCenter", "queueKnowledgeRebuildAfterRestore", "scheduleIdleDeepAnalysis"], "vector-shards.cjs": ["indexVectorScore", "loadManifest", "loadStore", "loadVectorIndex", "migrateLegacyIfNeeded", "stats"], "word-import.cjs": ["convert", "convertToHtml", "convertToMarkdown", "embedStyleMap", "extractRawText", "readEmbeddedStyleMap", "styleMapping"]};
INJECT_SPEC.writeWhitelist = {"analysis-tools.cjs": ["addRelationEdge", "applyIssueStatuses", "prepareWorldCardCandidates", "saveAnalysisState", "saveIssueStatuses", "saveWorldCardCandidates"], "creative-agent.cjs": ["applySafeRevisionPartUnlocked", "applySafeRevisionUnlocked", "createSafeRevision", "executeCreativeAgentRun", "prepareCreativeAgentRun", "replaceUniqueSelection", "runCreativeAgentTool", "updateAgentStage"], "creative-workspace.cjs": ["deleteItem", "ensureWorkspace", "mergeImportedWorkspace", "rebuildCausality", "removeChapterReferences", "reorderScenes", "upsertItem"], "docx-export.cjs": ["createDocxReviewContext", "exportBookDocumentsToDirectory", "exportBookToDocx", "exportChapterToDocx", "exportContentToDocx", "markdownToDocxChildren"], "docx-fidelity.cjs": ["applyLayoutMetadata"], "knowledge-index.cjs": ["deleteMaterial", "ensureKnowledgeFreshnessForRetrieval", "rebuildIndex", "rebuildSummaryHierarchy", "removeSourceFromIndex", "removeSourceFromKnowledgeSummariesUnlocked", "repairKnowledgeSync", "repairMaintenance", "saveMaterial", "updateKnowledgeItemsUnlocked", "updateKnowledgeSummariesUnlocked", "updateVectorKnowledgeMetadata"], "logger.cjs": ["resetForTests"], "novel-network-import.cjs": ["mergeNetworks"], "operation-journal.cjs": ["clearDraft", "ensureJournal", "saveDraft", "saveWindowState", "startSession"], "project-archives.cjs": ["importExchangeAssets"], "project-config.cjs": ["activateProjectSession", "ensureCurrentProject", "ensureProjectStructureUnlocked", "finishProjectSessions", "repairProjectHealthUnlocked", "saveConfigUnlocked"], "project-content.cjs": ["enqueueChapterSave", "importDocumentIntoProjectUnlocked", "restoreChapterVersionUnlocked", "saveChapterContent"], "project-exchange.cjs": ["exportProjectExchange", "importProjectExchangeUnlocked", "importedCopyTitle"], "project-files.cjs": ["createUniqueDirectory", "ensureDir", "ensureExclusiveChapterFile", "exportCategorySegments", "exportTimestamp", "repairSharedChapterFiles", "writeJson", "writeWorldDoc"], "project-ops.cjs": ["applySafeRevision", "applySafeRevisionPart", "createBackup", "createBackupUnlocked", "ensureProjectStructure", "importDocumentIntoProject", "importProjectExchange", "removeSourceFromKnowledgeSummaries", "repairProjectHealth", "restoreChapterVersion", "saveConfig", "updateKnowledgeItems", "updateKnowledgeSummaries"], "project-snapshots.cjs": ["createBranch", "createSnapshot", "deleteBranch", "deleteSnapshot", "ensureSnapshotStore", "renameSnapshot", "restoreSnapshot", "switchBranch"], "project-storage.cjs": ["ensureDir", "removeProjectFile", "writeFileAtomic", "writeJsonAtomic", "writeProjectFiles"], "project-transactions.cjs": ["commitFileTransaction", "createFileTransaction", "recordBeforeWrite"], "retrieval-pipeline.cjs": ["appendCoverageChunks"], "retrieval-planner.cjs": ["addCoverageSecondPass", "ensureVolumeCache"], "runtime-state.cjs": ["sendRendererEvent"], "story-state.cjs": ["createManualFact", "createManualForeshadow", "deleteFact", "deleteForeshadow", "ensureStoryState", "removeChapterLedger", "saveBoard", "saveChapterLedger", "updateFact", "updateForeshadow"], "task-runtime.cjs": ["executeBackgroundTask"], "vector-shards.cjs": ["removeSource", "replaceSources", "reset", "saveAll", "updateSourcesMetadata", "upsertSources"]};
const REDLINE = {"ai-generate.cjs": ["buildCreativeAdvice", "buildLocalCreativeAdvice", "buildStructuringMaterials", "callChatApi", "callStructuredChatWithProgress", "collectKnowledgeSourceCorpus", "collectOutlineCorpus", "creativeAdviceTypeForMode", "estimateTokenCount", "extractJsonFromModelText", "generateCharactersFromOutline", "generateWorldDocsFromOutline", "makeIdSet", "normalizeCreativeAdviceMode", "normalizeCreativeAdvicePayload", "normalizeGeneratedCharacters", "normalizeGeneratedWorldDocs", "normalizeStringArray"], "chat-stream.cjs": ["consumeChatStream"], "credentials.cjs": ["decodeSecret", "encodeSecret", "loadCredentialSecrets", "runtimeSecret", "saveCredentialSecrets"], "windows-credentials.cjs": ["credentialTarget", "deleteSecret", "getSecret", "setSecret"]};
const WHITELIST=INJECT_SPEC.whitelist;
const WRITE_REG=INJECT_SPEC.writeWhitelist;
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
function injectedApply(name,module,fn,args=[]){
 if(!GUARD.available)throw err('CAPABILITY_UNAVAILABLE:'+name,'Set NOVEL_APP_ROOT.');
 const e=GUARD.writeCache.get(module);
 if(!e||!e.names.includes(fn))throw err('FUNCTION_NOT_WHITELISTED',`${module}#${fn}`);
 return e.mod[fn](...args);
}

const MM_CONF={planId:{type:'string',minLength:1},confirmToken:{type:'string',minLength:1}};
const MM_REF={id:{type:'string'},title:{type:'string'}};
const MM_GET={type:'object',additionalProperties:false,properties:MM_REF};
const MM_CREATE={type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:1},root:{type:'string'},outline:{},...MM_CONF},required:['title','planId','confirmToken']};
const MM_ADD={type:'object',additionalProperties:false,properties:{...MM_REF,parentId:{type:'string'},outline:{},...MM_CONF},required:['outline','planId','confirmToken']};
const MM_NODE={type:'object',additionalProperties:false,properties:{...MM_REF,nodeId:{type:'string',minLength:1},text:{type:'string'},note:{type:'string'},color:{type:'string'},side:{enum:['left','right']},collapsed:{type:'boolean'},...MM_CONF},required:['nodeId','planId','confirmToken']};
const MM_NODE_REF={type:'object',additionalProperties:false,properties:{...MM_REF,nodeId:{type:'string',minLength:1},...MM_CONF},required:['nodeId','planId','confirmToken']};
const MM_DELETE={type:'object',additionalProperties:false,properties:{...MM_REF,...MM_CONF},required:['planId','confirmToken']};
const MM_IMPORT={type:'object',additionalProperties:false,properties:{filePath:{type:'string',minLength:1},sheetIndex:{type:'integer',minimum:0},...MM_CONF},required:['filePath','planId','confirmToken']};
function injectedRead(name,module,fn,args=[]){
 if(!GUARD.available)throw err('CAPABILITY_UNAVAILABLE:'+name,'Set NOVEL_APP_ROOT to the AI Novel Writing Platform source root.');
 const e=GUARD.cache.get(module);
 if(!e||!e.names.includes(fn))throw err('FUNCTION_NOT_WHITELISTED',`${module}#${fn}`);
 return e.mod[fn](...args);
}
function parseOutline(value){
 if(value==null)return [];
 if(Array.isArray(value))return value.map(item=>{
  if(typeof item==='string')return {text:item,note:'',children:[]};
  return {text:String(item?.text||'').trim(),note:String(item?.note||''),children:parseOutline(item?.children||[])};
 }).filter(item=>item.text);
 const roots=[],stack=[{depth:-1,children:roots}];
 for(const line of String(value).split(/\r?\n/)){
  if(!line.trim())continue;
  const match=line.match(/^(\s*)(?:[-*+]\s+)?(.*)$/);
  const depth=Math.floor((match?match[1]:'').replace(/\t/g,'  ').length/2);
  const body=(match?match[2]:line).trim();
  const parts=body.split(/\s+::\s+/);
  const text=(parts.shift()||'').trim();
  const note=parts.join(' :: ').trim();
  if(!text)continue;
  while(stack.length>1&&stack[stack.length-1].depth>=depth)stack.pop();
  const node={text,note,children:[]};
  stack[stack.length-1].children.push(node);
  stack.push({depth,children:node.children});
 }
 return roots;
}
function makeNodes(tree,parentId,startOrder=0,forcedSide=null){
 const prefix=`mmn_${crypto.randomUUID()}`; let counter=0; const nodes=[];
 const visit=(items,pid,side)=>{(items||[]).forEach((item,index)=>{
  const id=`${prefix}_${counter++}`;
  nodes.push({id,parentId:pid,text:String(item.text).slice(0,500),note:String(item.note||'').slice(0,2000),color:'',collapsed:false,order:index,side});
  visit(item.children||[],id,side);
 });};
 (tree||[]).forEach((item,index)=>{
  const order=startOrder+index,side=forcedSide||(order%2===0?'left':'right');
  const id=`${prefix}_${counter++}`;
  nodes.push({id,parentId,text:String(item.text).slice(0,500),note:String(item.note||'').slice(0,2000),color:'',collapsed:false,order,side});
  visit(item.children||[],id,side);
 });
 return nodes;
}
function toTree(map){
 const byParent=new Map();
 for(const node of map.nodes||[])if(node.parentId)byParent.set(node.parentId,[...(byParent.get(node.parentId)||[]),node]);
 const build=node=>({id:node.id,text:node.text,note:node.note||'',side:node.side,collapsed:!!node.collapsed,children:(byParent.get(node.id)||[]).slice().sort((a,b)=>a.order-b.order).map(build)});
 const root=(map.nodes||[]).find(node=>node.id===map.rootId)||(map.nodes||[]).find(node=>!node.parentId);
 return root?build(root):null;
}
function findMap(state,ref={}){
 const maps=state?.mindMaps||[],id=String(ref.id||''),title=String(ref.title||'');
 const found=maps.find(item=>id&&item.id===id)||maps.find(item=>title&&item.title===title);
 if(!found)throw err('MINDMAP_NOT_FOUND',`找不到思维导图：${id||title||'(未指定)'}`);
 return found;
}
function findGrid(state,ref={}){
 const grids=state?.progressGrids||[],id=String(ref.id||''),title=String(ref.title||'');
 const found=grids.find(item=>id&&item.id===id)||grids.find(item=>title&&item.title===title);
 if(!found)throw err('GRID_NOT_FOUND',`找不到进度网格：${id||title||'(未指定)'}`);
 return found;
}
function descendantsOf(map,nodeId){
 const byParent=new Map();
 for(const node of map.nodes||[])if(node.parentId)byParent.set(node.parentId,[...(byParent.get(node.parentId)||[]),node.id]);
 const seen=new Set([nodeId]),stack=[...(byParent.get(nodeId)||[])];
 while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);stack.push(...(byParent.get(id)||[]));}
 return seen;
}
function xmindPath(value){
 const target=path.resolve(String(value||''));
 if(!/\.xmind$/i.test(target))throw err('MINDMAP_FILE_INVALID','Only .xmind files are accepted.');
 const allowed=process.env.NOVEL_XMIND_IMPORT_ROOT?path.resolve(process.env.NOVEL_XMIND_IMPORT_ROOT):null;
 if(allowed&&target!==allowed&&!target.startsWith(allowed+path.sep))throw err('NOVEL_PATH_ESCAPE','XMind path escapes NOVEL_XMIND_IMPORT_ROOT.');
 if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw err('MINDMAP_FILE_NOT_FOUND','XMind file not found.');
 return target;
}
const loadState=r=>injected('novel_mindmap_list','loadWorkspace',[r]);
const saveMap=(r,map)=>injectedWrite('novel_mindmap_create','upsertItem',[r,'mindMaps',map]);
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
 {name:'novel_knowledge_rebuild',description:'Rebuild knowledge index (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:CONF,required:['planId','confirmToken']}},
 {name:'novel_apply',description:'Call any whitelisted write function (requires plan+confirm).',inputSchema:{type:'object',additionalProperties:false,properties:{module:{type:'string'},fn:{type:'string'},args:{type:'array'},ack:{type:'string'},...CONF},required:['module','fn','planId','confirmToken']}}
,
 {name:'novel_mindmap_list',description:'List all saved mind maps with id, title, node count and update time.',inputSchema:EMPTY},
 {name:'novel_mindmap_get',description:'Read one mind map as a nested topic tree (find by id or title).',inputSchema:MM_GET},
 {name:'novel_grid_list',description:'List all saved progress grids.',inputSchema:EMPTY},
 {name:'novel_grid_get',description:'Read one progress grid with columns and rows (find by id or title).',inputSchema:MM_GET},
 {name:'novel_mindmap_create',description:'Build a complete mind map from title, root topic and an outline (nested array or indented text; " :: " separates a note). Requires novel_plan + confirmToken.',inputSchema:MM_CREATE},
 {name:'novel_mindmap_add_nodes',description:'Append an outline under a parent node of an existing mind map.',inputSchema:MM_ADD},
 {name:'novel_mindmap_update_node',description:'Edit one node: text, note, color, side or collapsed.',inputSchema:MM_NODE},
 {name:'novel_mindmap_delete_node',description:'Delete one node together with all its descendants.',inputSchema:MM_NODE_REF},
 {name:'novel_mindmap_delete',description:'Delete a whole mind map.',inputSchema:MM_DELETE},
 {name:'novel_mindmap_import_xmind',description:'Import a local .xmind file (content.json or XMind 8 content.xml) into one mind map per sheet.',inputSchema:MM_IMPORT},
];
export async function handle(name,args={}){
 if(name==='novel_plan'){if(!WRITE.has(args.tool))throw err('PLAN_TOOL_INVALID','plan only accepts write tools.');return makePlan(args.tool,args.arguments||{});}
 if(WRITE.has(name)){const v=consumePlan(name,args);audit({tool:name,decision:v.ok?'confirmed':'rejected',code:v.code||null});if(!v.ok)throw err(v.code,v.message);}
 const r=P();
 switch(name){
  case 'novel_project_info':return out('novel-project-info/v3',safeConfig(readJson(r,'novel.config.json')||{}));
  case 'novel_chapter_list':{const f=listing(r,'chapters')||[];return out('novel-chapter-list/v3',{count:f.length,chapters:f.map(n=>({fileName:n,bytes:fs.statSync(within(r,`chapters/${n}`)).size}))});}
  case 'novel_chapter_read':{const f=path.basename(String(args.fileName||''));if(f!==String(args.fileName||''))throw err('NOVEL_PATH_ESCAPE','basename only');const p=within(r,`chapters/${f}`);if(!fs.existsSync(p))throw err('NOVEL_FILE_NOT_FOUND',f);if(fs.statSync(p).size>2*1024*1024)throw err('NOVEL_FILE_TOO_LARGE','2MiB limit');return out('novel-chapter-read/v3',{fileName:f,text:fs.readFileSync(p,'utf-8')});}
  case 'novel_character_list':case 'novel_world_list':{const dirs=name==='novel_character_list'?['characters','character']:['world','worldDocs','worldbuilding'];for(const d of dirs){const f=listing(r,d);if(f)return out(name+'/v3',{directory:d,count:f.length,files:f});}return out(name+'/v3',{available:false,reason:'DIRECTORY_NOT_FOUND'});}
  case 'novel_knowledge_status':{const s=readJson(r,'vector_db/summaries.json')||readJson(r,'vector_db/vectors.json');return out('novel-knowledge-status/v3',{available:!!s,topLevelKeys:s?Object.keys(s):[]});}
  case 'novel_analysis_state':{const s=readJson(r,'analysis/snapshot.json');return out('novel-analysis-state/v3',{available:!!s,topLevelKeys:s?Object.keys(s):[]});}
  case 'novel_project_tree':{const rows=[];for(const e of fs.readdirSync(r,{withFileTypes:true}))rows.push({name:e.name,type:e.isDirectory()?'dir':'file',children:e.isDirectory()?fs.readdirSync(within(r,e.name)).slice(0,40):[]});return out('novel-project-tree/v3',{root:r,entries:rows});}
  case 'novel_config_keys':return out('novel-config-keys/v3',{keys:Object.keys(readJson(r,'novel.config.json')||{})});
  case 'novel_capabilities':return out('novel-capabilities/v3',{available:GUARD.available,reason:GUARD.reason||null,readonly:Object.fromEntries([...GUARD.cache].map(([k,v])=>[k,v.names])),writable:Object.fromEntries([...GUARD.writeCache].map(([k,v])=>[k,v.names])),redline:REDLINE,counts:{readonly:[...GUARD.cache.values()].reduce((a,x)=>a+x.names.length,0),writable:[...GUARD.writeCache.values()].reduce((a,x)=>a+x.names.length,0)},errors:GUARD.errors,stdoutNoiseDuringPreload:GUARD.noise||''});
  case 'novel_call':{const m=String(args.module||''),f=String(args.fn||'');if(!Object.prototype.hasOwnProperty.call(WHITELIST,m)||!WHITELIST[m].includes(f))throw err('FUNCTION_NOT_WHITELISTED',`${m}#${f}`);const extra=Array.isArray(args.args)?args.args:[];return out('novel-call/v3',{module:m,fn:f,result:await injected(name,f,[r,...extra])});}
  case 'novel_state':return out('novel-state/v3',{state:await injected(name,'buildAppState',[r])});
  case 'novel_knowledge_search':{const q=String(args.question||''),k=Number(args.topK||5);const v=await injected(name,'searchRelevantChunks',[r,q,k,{}]);return out('novel-knowledge-search/v3',{result:v,indexed:(v?.totalIndexedCount??0)>0});}
  case 'novel_analysis_timeline':return out('novel-analysis-timeline/v3',{timeline:await injected(name,'buildTimelineEvents',[r,{}])});
  case 'novel_analysis_consistency':return out('novel-analysis-consistency/v3',{analysis:await injected(name,'analyzeConsistency',[r,{}])});
  case 'novel_story_overview':return out('novel-story-overview/v3',{overview:await injected(name,'getStoryOverviewForProject',[r])});
  case 'novel_chapter_write':{const payload={chapterId:args.chapterId,content:args.content};for(const k of ['expectedRevision'])if(args[k]!==undefined)payload[k]=args[k];const v=await injectedWrite(name,'saveChapterContent',[r,payload]);return out('novel-chapter-write/v3',{chapter:v?.chapter??v});}
  case 'novel_backup_create':{const f=path.basename(String(args.fileName||`backup-${Date.now()}.zip`));const dir=within(r,'backups');fs.mkdirSync(dir,{recursive:true});const v=await injectedWrite(name,'createBackup',[r,path.join(dir,f)]);return out('novel-backup-create/v3',{backupPath:v});}
  case 'novel_knowledge_rebuild':return out('novel-knowledge-rebuild/v3',{result:await injectedWrite(name,'rebuildIndex',[r,{}])});
  case 'novel_apply':{const m=String(args.module||''),f=String(args.fn||'');if(!Object.prototype.hasOwnProperty.call(WRITE_REG,m)||!WRITE_REG[m].includes(f))throw err('FUNCTION_NOT_WHITELISTED',`${m}#${f}`);if(/^(delete|remove|clear|cleanup|purge)/i.test(f)&&args.ack!=='DELETE')throw err('DELETE_ACK_REQUIRED','Pass ack=DELETE for destructive functions.');const extra=Array.isArray(args.args)?args.args:[];const v=await injectedApply(name,m,f,[r,...extra]);return out('novel-apply/v3',{module:m,fn:f,result:v});}
  case 'novel_mindmap_list':{const s=await loadState(r);const maps=(s.mindMaps||[]).map(m=>({id:m.id,title:m.title,rootText:(m.nodes||[]).find(n=>n.id===m.rootId)?.text||'',nodeCount:(m.nodes||[]).length,updatedAt:m.updatedAt}));return out('novel-mindmap-list/v3.1',{count:maps.length,maps});}
  case 'novel_mindmap_get':{const s=await loadState(r);const m=findMap(s,args);return out('novel-mindmap-get/v3.1',{id:m.id,title:m.title,rootId:m.rootId,nodeCount:(m.nodes||[]).length,tree:toTree(m)});}
  case 'novel_grid_list':{const s=await loadState(r);const grids=(s.progressGrids||[]).map(g=>({id:g.id,title:g.title,rowCount:(g.rows||[]).length,columnCount:(g.columns||[]).length,updatedAt:g.updatedAt}));return out('novel-grid-list/v3.1',{count:grids.length,grids});}
  case 'novel_grid_get':{const s=await loadState(r);const g=findGrid(s,args);return out('novel-grid-get/v3.1',{id:g.id,title:g.title,description:g.description||'',columns:g.columns||[],rows:g.rows||[]});}
  case 'novel_mindmap_create':{
    const id=`mm_${crypto.randomUUID()}`,rootId=`${id}_root`,now=new Date().toISOString();
    const title=String(args.title||'AI 生成的思维导图').slice(0,160),rootText=String(args.root||title).slice(0,500);
    const nodes=[{id:rootId,parentId:'',text:rootText,note:'',color:'',collapsed:false,order:0,side:'right'},...makeNodes(parseOutline(args.outline),rootId)];
    const saved=await saveMap(r,{id,title,rootId,nodes,createdAt:now,updatedAt:now});
    return out('novel-mindmap-create/v3.1',{id:saved.id,title:saved.title,rootId:saved.rootId,nodeCount:(saved.nodes||[]).length,tree:toTree(saved),note:'软件若正打开规划页，请点「刷新规划数据」后从列表打开。'});
  }
  case 'novel_mindmap_add_nodes':{
    const s=await loadState(r),m=findMap(s,args),parentId=String(args.parentId||m.rootId);
    const parent=(m.nodes||[]).find(n=>n.id===parentId);
    if(!parent)throw err('MINDMAP_NODE_NOT_FOUND',parentId);
    const outline=parseOutline(args.outline);
    if(!outline.length)throw err('MINDMAP_OUTLINE_EMPTY','outline 为空。');
    const siblings=(m.nodes||[]).filter(n=>n.parentId===parentId);
    const added=makeNodes(outline,parentId,siblings.length,parent.parentId?parent.side:null);
    const saved=await saveMap(r,{...m,nodes:[...(m.nodes||[]),...added],updatedAt:new Date().toISOString()});
    return out('novel-mindmap-add-nodes/v3.1',{id:saved.id,added:added.length,nodeCount:(saved.nodes||[]).length,tree:toTree(saved)});
  }
  case 'novel_mindmap_update_node':{
    const s=await loadState(r),m=findMap(s,args),nodeId=String(args.nodeId||'');
    const node=(m.nodes||[]).find(n=>n.id===nodeId);
    if(!node)throw err('MINDMAP_NODE_NOT_FOUND',nodeId);
    const patch={};
    for(const key of ['text','note','color'])if(args[key]!==undefined)patch[key]=String(args[key]);
    if(args.side!==undefined)patch.side=args.side==='left'?'left':'right';
    if(args.collapsed!==undefined)patch.collapsed=!!args.collapsed;
    if(nodeId===m.rootId)delete patch.side;
    const saved=await saveMap(r,{...m,nodes:(m.nodes||[]).map(n=>n.id===nodeId?{...n,...patch}:n),updatedAt:new Date().toISOString()});
    return out('novel-mindmap-update-node/v3.1',{id:saved.id,nodeId,changed:Object.keys(patch),nodeCount:(saved.nodes||[]).length});
  }
  case 'novel_mindmap_delete_node':{
    const s=await loadState(r),m=findMap(s,args),nodeId=String(args.nodeId||'');
    if(nodeId===m.rootId)throw err('MINDMAP_ROOT_PROTECTED','不能删除中心主题；整张删除请用 novel_mindmap_delete。');
    if(!(m.nodes||[]).some(n=>n.id===nodeId))throw err('MINDMAP_NODE_NOT_FOUND',nodeId);
    const removed=descendantsOf(m,nodeId);
    const saved=await saveMap(r,{...m,nodes:(m.nodes||[]).filter(n=>!removed.has(n.id)),updatedAt:new Date().toISOString()});
    return out('novel-mindmap-delete-node/v3.1',{id:saved.id,removed:removed.size,nodeCount:(saved.nodes||[]).length});
  }
  case 'novel_mindmap_delete':{
    const s=await loadState(r),m=findMap(s,args);
    await injectedWrite(name,'deleteItem',[r,'mindMaps',m.id]);
    return out('novel-mindmap-delete/v3.1',{deletedId:m.id,title:m.title,nodeCount:(m.nodes||[]).length});
  }
  case 'novel_mindmap_import_xmind':{
    const target=xmindPath(args.filePath);
    const parsed=injectedRead(name,'mind-map-import.cjs','readXMindFile',[target]);
    const sheets=Array.isArray(parsed.sheets)?parsed.sheets:[];
    const picked=args.sheetIndex===undefined?sheets:[sheets[Number(args.sheetIndex)]].filter(Boolean);
    if(!picked.length)throw err('MINDMAP_SHEET_INVALID','sheetIndex 超出范围或文件没有可导入画布。');
    const imported=[];
    for(const sheet of picked){const v=await saveMap(r,sheet.map);imported.push({id:v.id,title:v.title,nodeCount:(v.nodes||[]).length,truncated:!!sheet.truncated});}
    return out('novel-mindmap-import-xmind/v3.1',{fileName:parsed.fileName,sheetCount:sheets.length,imported});
  }
  default:throw err('TOOL_UNKNOWN',name);
 }
}
