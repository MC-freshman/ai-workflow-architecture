import fs from 'node:fs';
import {relative,resolve,isAbsolute} from 'node:path';
import {runScopedProcess} from '../../infrastructure/process-scope.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {sha256} from '../../core/hash.mjs';

export function reconcileHostManifest(root,id,config,python) {
  if(!config.hostEnvironmentManifest)return {files:[]};
  const original=resolve(config.hostEnvironmentManifest),own=relative(targetPath(root,id),original);
  if(!own || own.startsWith('..') || isAbsolute(own))throw Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');
  let valid=false;
  try {const old=readJson(original);valid=resolve(old.executable)===resolve(python) && old.files?.length>0 && old.files.every(row=>fs.existsSync(row.path) && sha256(fs.readFileSync(row.path))===row.sha256);}catch{/* A stale manifest is explicitly replaced in the preview, never erased. */}
  if(valid)return {files:[],path:original};
  if(!python || !fs.existsSync(python))throw Error('RUNTIME_PYTHON_REQUIRED');
  const snapshot=JSON.parse(runScopedProcess(python,['-B',runtimeFile('host_snapshot.py')],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true,shell:false}));
  if(resolve(snapshot.executable)!==resolve(python) || !snapshot.files?.length || !snapshot.files.every(row=>fs.existsSync(row.path) && sha256(fs.readFileSync(row.path))===row.sha256))throw Error('HOST_ENVIRONMENT_SNAPSHOT_FAILED');
  const content=JSON.stringify(snapshot,null,2)+'\n',path=`${id}/runtime/manager-host/${sha256(content)}/manifest.json`;
  return {path:targetPath(root,path),previousPath:original,files:[{path,content}],scope:snapshot.scope};
}
