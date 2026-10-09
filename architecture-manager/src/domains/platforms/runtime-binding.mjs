import {existsSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';

export function platformPython(workspaceRoot,platformId) {
  if(typeof platformId!=='string' || !/^[a-z][a-z0-9-]{1,30}$/.test(platformId)) throw Error('PLATFORM_CONFIGURATION_REQUIRED');
  const bridgeFile=targetPath(workspaceRoot,`${platformId}/bridge.json`);
  const bridge=existsSync(bridgeFile)?readJson(bridgeFile):{};
  for(const relative of [`${platformId}/bridge/runner-config.json`,`${platformId}/bridge/${platformId}-config.json`]) {
    const file=targetPath(workspaceRoot,relative);
    if(!existsSync(file)) continue;
    const config=readJson(file);
    if(config.platform!==platformId) throw Error('PLATFORM_CONFIG_ID_MISMATCH');
    const python=bridge.runner?.python || config.interpreters?.['.py'];
    if(typeof python==='string' && isAbsolute(python) && existsSync(python)) return {python,configPath:file,config};
  }
  throw Error('RUNTIME_PYTHON_REQUIRED');
}
