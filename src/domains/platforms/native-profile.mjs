import fs from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {sha256File} from '../../core/hash.mjs';

export function ownNativePath(root,id,path) {
  const base=targetPath(root,id),absolute=targetPath(root,relative(root,resolve(path))),own=relative(base,absolute);
  if(!own || own.startsWith('..') || /^[A-Za-z]:/.test(own))throw Error('NATIVE_CLIENT_PLATFORM_PATH_REQUIRED');
  // Reject junctions as well as a lexically safe path which resolves outside this platform.
  const existing=fs.existsSync(absolute)?absolute:dirname(absolute);
  if(fs.existsSync(existing)){const real=relative(fs.realpathSync(base),fs.realpathSync(existing));if(real.startsWith('..') || /^[A-Za-z]:/.test(real))throw Error('NATIVE_CLIENT_PLATFORM_PATH_REQUIRED');}
  return absolute;
}

export function discoverNativeBodies(root,id) {
  const bodies=[];let visited=0;
  function walk(directory,depth){
    if(depth>3 || ++visited>150)return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory() && !/^(runtime|userdata|node_modules|\.git|bridge|workspaces|resources)$/i.test(entry.name))walk(join(directory,entry.name),depth+1);
      else if(entry.isFile() && /^(Codex|ChatGPT|WorkBuddy|Doubao)\.exe$/i.test(entry.name))bodies.push(join(directory,entry.name));
    }
  }
  walk(targetPath(root,id),0);return bodies;
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
