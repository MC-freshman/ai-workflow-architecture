import fs from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {readJson,stableJson} from '../../core/json.mjs';

// One resolver for discovery, provider installation and software binding.
// Recover unique legacy values; never choose between conflicting registrations.
export function gatewayBinding(root,id,config={}) {
  const directory=targetPath(root,id),declared=config.softwareGatewayConfig;
  const path=declared?resolve(root,declared):targetPath(root,`${id}/bridge/software-gateway-config.json`);
  const own=relative(directory,path);
  if(!own || own.startsWith('..') || isAbsolute(own))throw Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');
  const candidates=[path,...['software-gateway.json','software-gateway-config.json'].map(name=>targetPath(root,`${id}/bridge/${name}`))];
  const files=[...new Set(candidates)].filter(file=>fs.existsSync(file));
  const value=fs.existsSync(path)?readJson(path):{},recovered=[];
  const maps=['bodies','interpreterAliases','interpreters','recipeVariables','nativeMcpServers','mcpServers','softwareProfiles','sessionLaunchArguments'];
  for(const file of files.filter(file=>file!==path)) {
    const other=readJson(file);
    for(const key of ['allowedEndpoints','credentialReferences'])if(Object.hasOwn(value,key) && Object.hasOwn(other,key) && stableJson(value[key])!==stableJson(other[key]))throw Error(`SOFTWARE_BINDING_CONFLICT:${key}`);
    for(const [key,item] of Object.entries(other))if(!maps.includes(key) && !Object.hasOwn(value,key))value[key]=item;
    for(const key of maps)for(const [name,item] of Object.entries(other[key] || {})) {
      if(Object.hasOwn(value[key] || {},name) && stableJson(value[key][name])!==stableJson(item))throw Error(`SOFTWARE_BINDING_CONFLICT:${key}:${name}`);
      if(!Object.hasOwn(value[key] || {},name)){(value[key] ||= {})[name]=item;recovered.push({source:relative(root,file).replaceAll('\\','/'),field:key,id:name});}
    }
  }
  return {path,relativePath:relative(root,path).replaceAll('\\','/'),value,recovered,sources:files};
}
