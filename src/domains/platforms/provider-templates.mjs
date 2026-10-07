import {platformPath} from '../../core/platform-path.mjs';
import fs from 'node:fs';
import {targetPath} from '../../core/paths.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {sha256} from '../../core/hash.mjs';
import {readJson} from '../../core/json.mjs';

export function providerTemplateStatus(root,id) {
  const configPath=[`${id}/bridge/runner-config.json`,`${id}/bridge/${id}-config.json`].map(path=>targetPath(root,path)).find(path=>fs.existsSync(path));
  const config=configPath?readJson(configPath):{};
  const files=['platform_provider.py','peer_dispatcher.py'].map(name=>{
    const path=`${id}/bridge/manager-providers/${name}`,file=targetPath(root,path),expectedSha256=sha256(fs.readFileSync(runtimeFile(name)));
    const installedSha256=fs.existsSync(file)?sha256(fs.readFileSync(file)):null;
    return {path,expectedSha256,installedSha256,current:expectedSha256===installedSha256};
  });
  const activePeerPath=config.peerDispatcherModule?platformPath(root,id,config.peerDispatcherModule):null,activePeerSha256=activePeerPath && fs.existsSync(activePeerPath)?sha256(fs.readFileSync(activePeerPath)):null;
  return {current:files.every(row=>row.current) && activePeerSha256===files[1].expectedSha256,activePeerPath,activePeerSha256,files};
}
