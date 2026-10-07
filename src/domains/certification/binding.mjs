import {platformPath} from '../../core/platform-path.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';

// Compatibility binding for previously stored onboarding evidence. No import of
// the onboarding state machine or platform checker is allowed in this module.
export function platformConfigPath(root,id) {
  const relative=[`${id}/bridge/runner-config.json`,`${id}/bridge/${id}-config.json`].find(path=>existsSync(targetPath(root,path)));
  if(!relative) throw Error('ONBOARDING_CONFIGURATION_REQUIRED');
  return targetPath(root,relative);
}
export function platformConfig(root,id) {return readJson(platformConfigPath(root,id));}
export function privateBindingHashes(root,id,config=platformConfig(root,id)) {
  const hashes={};
  for(const [name,path] of Object.entries({capabilities:config.capabilities,gateway:config.softwareGatewayConfig,backend:config.executionBackend,manifest:config.environmentManifest}))hashes[name]=path && existsSync(platformPath(root,id,path))?sha256(readFileSync(platformPath(root,id,path))):null;
  for(const [name,path] of Object.entries({hostManifest:config.hostEnvironmentManifest,peerProvider:config.peerDispatcherModule,platformProvider:targetPath(root,`${id}/bridge/manager-providers/platform_provider.py`)}))if(path && existsSync(platformPath(root,id,path)))hashes[name]=sha256(readFileSync(platformPath(root,id,path)));
  return hashes;
}
export function environmentBinding(root,id) {
  const hashes=privateBindingHashes(root,id);
  for(const repo of ['tool','agent','software']) {
    const registryPath=targetPath(root,`${repo}/registry.json`);
    if(!existsSync(registryPath)) {hashes[repo]=null;continue;}
    hashes[repo]=sha256(readFileSync(registryPath));
    const registry=readJson(registryPath);
    for(const entries of Object.values(registry)) if(Array.isArray(entries)) for(const entry of entries) if(entry.id) {
      const pointer=targetPath(root,`${repo}/${entry.current || `${entry.id}/current.json`}`);
      if(existsSync(pointer)) hashes[`${repo}:${entry.id}`]=sha256(readFileSync(pointer));
    }
  }
  return sha256(JSON.stringify(hashes));
}
