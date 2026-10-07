import {relative,resolve,isAbsolute,sep} from 'node:path';
import {targetPath} from './paths.mjs';

// Private paths are resolved against the chosen workspace, never process.cwd().
export function platformPath(root,id,value) {
  if(typeof value!=='string' || !value.trim())throw Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');
  const directory=targetPath(root,id),absolute=resolve(root,value),own=relative(directory,absolute);
  if(!own || own==='..' || own.startsWith('..'+sep) || isAbsolute(own))throw Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');
  return targetPath(root,relative(resolve(root),absolute));
}
