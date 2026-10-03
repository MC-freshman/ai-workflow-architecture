import fs from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import {sha256,sha256File} from '../../core/hash.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {runScopedProcess} from '../../infrastructure/process-scope.mjs';
import {verifyRuntimeBody} from '../intake/runtime-body.mjs';
import {nativeCredentialBinding} from './credentials.mjs';
import {checkMcpServer,resolveMcpServer,mcpSemanticTools} from './mcp-config.mjs';
import {hasSensitiveLiteral} from '../intake/policy.mjs';
export function validateMcpSchemas(tools) {
  if(!Array.isArray(tools) || !tools.length || tools.length>10000)throw Error('MCP_EMPTY_TOOLS');
  const names=new Set();const checkRefs=value=>{if(!value || typeof value!=='object')return;if(value.$ref && !value.$ref.startsWith('#'))throw Error('MCP_SCHEMA_UNSUPPORTED');for(const child of Object.values(value))checkRefs(child);};
  for(const tool of tools) {
    if(!tool || typeof tool.name!=='string' || !tool.name.trim() || names.has(tool.name) || !tool.inputSchema || tool.inputSchema.type!=='object')throw Error('MCP_TOOL_INVALID');names.add(tool.name);
    for(const schema of [tool.inputSchema,tool.outputSchema].filter(Boolean)) {checkRefs(schema);try{const Validator=String(schema.$schema || '').includes('draft-07')?Ajv:Ajv2020;new Validator({strict:false,validateFormats:false}).compile(schema);}catch{throw Error('MCP_SCHEMA_UNSUPPORTED');}}
  }
  if(hasSensitiveLiteral(stableJson(tools)))throw Error('RAW_SECRET_NOT_ALLOWED');return tools;
}
export function discoverNativeMcp({workspaceRoot,platformId,placementPlan,server,runtimeExecutable='',confirmed=false}) {
  if(confirmed!==true)throw Error('MCP_CONNECTION_CONFIRMATION_REQUIRED');
  if(placementPlan.workspaceRoot!==workspaceRoot || placementPlan.target.platformId!==platformId || placementPlan.payload.intake.type!=='software')throw Error('IMPORT_PLACEMENT_INVALID');
  if(!verifyRuntimeBody({plan:placementPlan}).ok)throw Error('SOFTWARE_BACKUP_NOT_RESTORED');
  const configuration=resolveMcpServer({workspaceRoot,platformId,server:checkMcpServer(server),bodyRoot:placementPlan.target.path,runtimeExecutable}),runtime=platformPython(workspaceRoot,platformId),credential=nativeCredentialBinding(workspaceRoot,platformId),directory=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-mcp/${randomUUID()}`);fs.mkdirSync(directory,{recursive:true});
  for(const path of [configuration.env.TEMP,configuration.env.TMP,configuration.env.XDG_CACHE_HOME,configuration.env.NPM_CONFIG_CACHE,configuration.env.UV_CACHE_DIR,configuration.env.APPDATA,configuration.env.LOCALAPPDATA,configuration.env.HOME])fs.mkdirSync(path,{recursive:true});
  let response;try{response=JSON.parse(runScopedProcess(runtime.python,['-B',runtimeFile('mcp_probe.py')],{input:JSON.stringify({server:configuration,credentialProvider:fs.existsSync(credential.provider)?credential.command:null}),cwd:directory,encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024,windowsHide:true,shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}}));}catch(error){if(error.message==='TASK_CANCELLED')throw error;let code='MCP_CONNECTION_FAILED';try{code=JSON.parse(String(error.stdout)).error || code;}catch{/* Native stderr and values never become a UI error. */}throw Error(code);}
  if(!response.ok)throw Error(response.error || 'MCP_CONNECTION_FAILED');validateMcpSchemas(response.result.tools);
  const evidence={schema:'architecture-manager-mcp-discovery/v1',discoveryId:directory.split(/[\\/]/).at(-1),workspaceRoot,platformId,softwareId:placementPlan.target.resourceId,placementPlanId:placementPlan.planId,sourceFingerprint:placementPlan.payload.intake.sourceFingerprint,bodyPath:join(placementPlan.target.path,placementPlan.target.entry),configuration,serverInfo:response.serverInfo,protocolVersion:response.protocolVersion,tools:response.result.tools,toolsSha256:sha256(stableJson(mcpSemanticTools(response.result.tools))),helperSha256:sha256File(runtimeFile('native_mcp.py')),discoveredAt:new Date().toISOString(),functionsExecuted:false,nativeDiscoveryPerformed:true};
  if(hasSensitiveLiteral(stableJson(evidence)))throw Error('RAW_SECRET_NOT_ALLOWED');fs.writeFileSync(join(directory,'discovery.json'),JSON.stringify(evidence,null,2)+'\n');
  return {...evidence,evidencePath:join(directory,'discovery.json'),evidenceSha256:sha256File(join(directory,'discovery.json')),status:'discovered-awaiting-permissions'};
}
export function readNativeMcpDiscovery({workspaceRoot,platformId,discoveryId,evidenceSha256}) {
  if(!/^[a-f0-9-]{36}$/.test(discoveryId || ''))throw Error('INVALID_TASK_ID');const path=targetPath(workspaceRoot,`${platformId}/runtime/maintenance/manager-mcp/${discoveryId}/discovery.json`);
  if(sha256File(path)!==evidenceSha256)throw Error('MCP_DISCOVERY_CHANGED');const value=readJson(path);if(value.workspaceRoot!==workspaceRoot || value.platformId!==platformId || value.discoveryId!==discoveryId || value.helperSha256!==sha256File(runtimeFile('native_mcp.py')) || value.toolsSha256!==sha256(stableJson(mcpSemanticTools(value.tools))))throw Error('MCP_DISCOVERY_CHANGED');validateMcpSchemas(value.tools);return value;
}
