import fs from 'node:fs';
import {join,dirname,isAbsolute,resolve,relative,basename} from 'node:path';
import {parseJson,stableJson} from '../../core/json.mjs';
import {sha256File} from '../../core/hash.mjs';
import {readExternalText,assertIntakeUnchanged} from '../intake/sources.mjs';
import {hasSensitiveLiteral} from '../intake/policy.mjs';
import {runnerConfig} from './software-publish.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {allPlatformIds} from '../../core/platforms.mjs';
const secretName=/password|passwd|token|secret|api.?key|credential|authorization|cookie/i;
const reference=/^reference:[A-Za-z0-9._-]{1,128}$/;
export async function readMcpConfiguration({intake}) {
  await assertIntakeUnchanged(intake);const value=parseJson(await readExternalText(intake,intake.selectedEntry));
  if(hasSensitiveLiteral(stableJson(value)))throw Error('RAW_SECRET_NOT_ALLOWED');
  const servers=value.mcpServers || value.servers || (value.command || value.url || value.endpoint?{server:value}:null);
  if(!servers || Array.isArray(servers) || typeof servers!=='object' || !Object.keys(servers).length)throw Error('MCP_CONFIGURATION_REQUIRED');
  return {servers:Object.entries(servers).map(([name,server])=>({name,configuration:checkMcpServer(server)})),writePerformed:false};
}
export function checkMcpServer(server) {
  if(!server || typeof server!=='object')throw Error('MCP_CONFIGURATION_REQUIRED');
  const kind=server.kind || (server.type==='sse'?'sse':server.type==='http' || server.type==='streamable-http'?'streamable-http':server.url || server.endpoint?'streamable-http':'stdio');
  if(!['stdio','sse','streamable-http'].includes(kind))throw Error('MCP_TRANSPORT_UNSUPPORTED');
  const args=server.args || [];if(!Array.isArray(args) || args.some(value=>typeof value!=='string' || secretName.test(value)))throw Error('MCP_SPECIAL_CREDENTIAL_ADAPTER_REQUIRED');
  const env=server.env || {},headers=server.headers || {};for(const [section,values] of Object.entries({env,headers})) {
    if(!values || Array.isArray(values) || typeof values!=='object')throw Error('MCP_CONFIGURATION_REQUIRED');
    for(const [key,value] of Object.entries(values))if(typeof value!=='string' || /[\r\n]/.test(key) || (secretName.test(key) && !reference.test(value)) || value.startsWith('reference:') && !reference.test(value) || (section==='headers' && /[\r\n]/.test(value)))throw Error('RAW_SECRET_NOT_ALLOWED');
  }
  const result={kind,args,env,headers,protocolVersion:server.protocolVersion || (kind==='sse'?'2024-11-05':'2025-11-25')};
  if(kind==='stdio'){if(typeof server.command!=='string' || !server.command)throw Error('MCP_PROGRAM_REQUIRED');result.command=server.command;}
  else {let url;try{url=new URL(server.url || server.endpoint);}catch{throw Error('MCP_ENDPOINT_INVALID');}if(!['http:','https:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(key=>secretName.test(key)))throw Error('RAW_SECRET_NOT_ALLOWED');result.endpoint=url.href;}
  if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(result.protocolVersion))throw Error('MCP_PROTOCOL_UNSUPPORTED');return result;
}
export function resolveMcpServer({workspaceRoot,platformId,server,bodyRoot,runtimeExecutable=''}) {
  const normalized=checkMcpServer(server),gateway=runnerConfig(workspaceRoot,platformId),runtime=platformPython(workspaceRoot,platformId),result={...normalized,cwd:bodyRoot,timeoutSeconds:30};
  const assertOwner=value=>{if(isAbsolute(value)){const location=relative(workspaceRoot,value).replaceAll('\\','/');if(allPlatformIds(workspaceRoot).some(id=>id!==platformId && (location.startsWith(id+'/runtime/') || location.startsWith(id+'/workspaces/'))))throw Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');}};
  if(result.kind==='stdio') {
    const picked=runtimeExecutable || (isAbsolute(result.command)?result.command:result.command==='python' || result.command==='python.exe'?runtime.python:gateway.value.tools?.[result.command]);
    if(!picked || !isAbsolute(picked) || !fs.existsSync(picked))throw Error('MCP_PROGRAM_REQUIRED');if(/^(npx|npm|uvx)(\.cmd|\.exe)?$/i.test(basename(picked)))throw Error('MCP_RUNTIME_SETUP_REQUIRED');assertOwner(picked);
    result.command=fs.realpathSync(picked);result.args=result.args.map(arg=>{let path=arg;if(!arg.startsWith('-') && !isAbsolute(arg) && fs.existsSync(join(bodyRoot,arg)))path=resolve(bodyRoot,arg);assertOwner(path);return path;});
    result.programHashes=Object.fromEntries([result.command,...result.args.filter(path=>isAbsolute(path) && fs.existsSync(path) && fs.statSync(path).isFile())].map(path=>[path,sha256File(path)]));
  }
  const state=join(bodyRoot,'../native-state');result.env={...result.env,TEMP:join(state,'tmp'),TMP:join(state,'tmp'),XDG_CACHE_HOME:join(state,'cache'),NPM_CONFIG_CACHE:join(state,'npm-cache'),UV_CACHE_DIR:join(state,'uv-cache'),APPDATA:join(state,'appdata'),LOCALAPPDATA:join(state,'localappdata'),HOME:join(state,'home'),USERPROFILE:join(state,'home'),PYTHONDONTWRITEBYTECODE:'1'};
  for(const key of ['TEMP','TMP','XDG_CACHE_HOME','NPM_CONFIG_CACHE','UV_CACHE_DIR']) {assertOwner(result.env[key]);}
  return result;
}
export const mcpCredentialReferences=server=>[...new Set([...Object.values(server.env || {}),...Object.values(server.headers || {})].filter(value=>reference.test(value)))];
export const mcpSemanticTools=tools=>tools.map(tool=>({name:tool.name,inputSchema:tool.inputSchema,outputSchema:tool.outputSchema || null,annotations:tool.annotations || null})).sort((a,b)=>a.name.localeCompare(b.name));
