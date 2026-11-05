import fs from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {sha256File} from '../../core/hash.mjs';
import {readNativeArtifact} from './native-artifacts.mjs';

export function ownNativePath(root,id,path) {
  const base=targetPath(root,id),absolute=targetPath(root,relative(root,resolve(path))),own=relative(base,absolute);
  if(own.startsWith('..') || /^[A-Za-z]:/.test(own)){
    // D-163: a body that sits inside the workspace but under another platform is a placement
    // decision, not a broken path. Name the directory that owns it and give both ways out;
    // borrowing another platform's program stays refused either way.
    const inside=relative(fs.realpathSync(root),absolute).replaceAll('\\','/');
    if(!inside.startsWith('../')&&!/^[A-Za-z]:/.test(inside))throw Error(`NATIVE_BODY_OUTSIDE_PLATFORM:path=${inside};owner=${inside.split('/')[0]};要么把本体迁入 ${id} 平台目录，要么就"外部本体例外"单独治理裁定后登记（当前未开放）`);
    throw Error('NATIVE_CLIENT_PLATFORM_PATH_REQUIRED');
  }
  if(!own)throw Error('NATIVE_CLIENT_PLATFORM_PATH_REQUIRED');
  // Reject junctions as well as a lexically safe path which resolves outside this platform.
  const existing=fs.existsSync(absolute)?absolute:dirname(absolute);
  if(fs.existsSync(existing)){const real=relative(fs.realpathSync(base),fs.realpathSync(existing));if(real.startsWith('..') || /^[A-Za-z]:/.test(real))throw Error('NATIVE_CLIENT_PLATFORM_PATH_REQUIRED');}
  return absolute;
}

export function discoverNativeBodies(root,id) {
  const bodies=[],queue=[{directory:targetPath(root,id),depth:0}];let visited=0;
  // Breadth first: source trees must not exhaust the limit before a nearby installed body is seen.
  while(queue.length&&visited++<150){const {directory,depth}=queue.shift();
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()&&depth<3&&!/^(runtime|userdata|node_modules|\.git|bridge|workspaces|resources)$/i.test(entry.name))queue.push({directory:join(directory,entry.name),depth:depth+1});
      else if(entry.isFile()&&/^(Codex|ChatGPT|WorkBuddy|Doubao|Qoder(?:[ _-]?CN)?|ZCode|DeepSeek[ _-]?Harness)\.exe$/i.test(entry.name))bodies.push(join(directory,entry.name));
    }
  }return bodies;
}

// D-163: the CN edition of the vendor ships a different package name ("qoder-cn", verified on
// disk: E:\ai\qoder\qoder-cn\Qoder CN\resources\app.asar, version 0.4.8) and an executable with a
// space in it. The vendor stays "Qoder" so registration, session proof and config keys behave
// exactly as for the international edition; only the label names the edition.
export const WORKSPACE_MCP_EDITIONS = Object.freeze({
  'qoder': { vendor: 'Qoder', edition: null },
  'qoder-cn': { vendor: 'Qoder', edition: 'CN' },
  '@zcode/desktop': { vendor: 'ZCode', edition: null }
});
export function workspaceMcpEdition(name) {
  const known = WORKSPACE_MCP_EDITIONS[String(name)];
  return known ? { ...known, label: known.edition ? `${known.vendor} ${known.edition} 原生工作区 MCP 配置` : `${known.vendor} 原生工作区 MCP 配置` } : null;
}
export function nativeProfile(root,id,bodyPath) {
  const body=ownNativePath(root,id,bodyPath);
  if(!fs.existsSync(body) || !fs.statSync(body).isFile())throw Error('NATIVE_CLIENT_BODY_REQUIRED');
  const base=dirname(body),resources=join(base,'resources');
  const executable=join(resources,'codex.exe');
  if(fs.existsSync(executable)){
    const home=ownNativePath(root,id,join(base,'..','userdata','codex-home'));
    return {kind:'codex-app-server',label:'Codex 原生 app-server',bodyPath:body,bodySha256:sha256File(body),executable,executableSha256:sha256File(executable),home,configPath:join(home,'config.toml'),supportsRegistration:true,supportsDirectProbe:true};
  }
  const cli=join(resources,'app.asar.unpacked','cli'),productPath=join(cli,'product.json');
  if(fs.existsSync(productPath)){
    const product=JSON.parse(fs.readFileSync(productPath,'utf8'));
    if(product.productName==='WorkBuddy' || product.name==='WorkBuddy'){
      const entry=join(cli,'bin','codebuddy'),project=targetPath(root,`${id}/workspaces/architecture-native`);
      if(fs.existsSync(entry))return {kind:'workbuddy-cli',label:'WorkBuddy 原生 CLI',bodyPath:body,bodySha256:sha256File(body),executable:body,executableSha256:sha256File(body),cli:entry,cliSha256:sha256File(entry),productPath,project,configPath:join(project,'.mcp.json'),supportsRegistration:true,supportsDirectProbe:false};
    }
  }
  const archive=join(resources,'app.asar');
  if(fs.existsSync(archive)){
    try{
      const metadata=JSON.parse(readNativeArtifact(archive,'package.json'));
      const edition=workspaceMcpEdition(metadata.name);
      if(edition){
        const {vendor}=edition,project=targetPath(root,`${id}/workspaces/architecture-native`);
        const configPath=vendor==='Qoder'?join(project,'mcp.json'):join(project,'.zcode','config.json');
        // `edition` is only present for the CN build: the international profile keeps its exact
        // previous key set, so an existing registration never becomes unbound by this change.
        return {kind:'workspace-mcp',vendor,...(edition.edition?{edition:edition.edition}:{}),label:edition.label,bodyPath:body,bodySha256:sha256File(body),archive,archiveSha256:sha256File(archive),version:metadata.version,project,configPath,configKeys:vendor==='Qoder'?['mcpServers']:['mcp','servers'],supportsRegistration:true,supportsDirectProbe:false,reason:'原生工作区配置可自动登记；客户端须加载该项目，真实工具回执仍须独立验证。'};
      }
    }catch{/* Missing metadata is an interface gap, never proof of native capability. */}
  }
  return {kind:'interface-required',label:'尚未确认外部工具接口',bodyPath:body,bodySha256:sha256File(body),supportsRegistration:false,supportsDirectProbe:false,reason:'此本体未提供已适配的外部 MCP 注册与直接调用接口。需要厂商开放接口或可验证的适配器；不会以管理台 CLI 回环替代。'};
}

export function selectNativeProfile(root,id,bodyPath='') {
  if(bodyPath)return nativeProfile(root,id,bodyPath);
  const binding=targetPath(root,`${id}/bridge/native-client.json`);
  if(fs.existsSync(binding)){const previous=nativeProfile(root,id,JSON.parse(fs.readFileSync(binding,'utf8')).profile.bodyPath);if(previous.supportsRegistration)return previous;}
  const profiles=discoverNativeBodies(root,id).map(path=>nativeProfile(root,id,path));
  const supported=profiles.filter(value=>value.supportsRegistration);
  const unique=[...new Map((supported.length?supported:profiles).map(value=>[value.executable || value.bodyPath,value])).values()];
  if(unique.length!==1)throw Error(unique.length?'NATIVE_CLIENT_SELECTION_REQUIRED':'NATIVE_CLIENT_BODY_REQUIRED');
  return unique[0];
}
