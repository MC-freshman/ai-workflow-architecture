import {lstatSync,existsSync} from '../../core/physical-fs.mjs';
import {dirname,resolve} from 'node:path';

export function externalSourcePath(value) {
  if(typeof value!=='string' || !value.trim()) throw Error('INTAKE_SOURCE_REQUIRED');
  const source=resolve(value);let next=source;
  while(true) {
    if(existsSync(next) && lstatSync(next).isSymbolicLink()) throw Error('INTAKE_LINK_NOT_ALLOWED');
    const parent=dirname(next);if(parent===next)break;next=parent;
  }
  if(!existsSync(source)) throw Error('INTAKE_SOURCE_MISSING');
  return source;
}
export function sourceRelative(value) {
  if(typeof value!=='string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error('INTAKE_UNSAFE_PATH');
  const name=value.replaceAll('\\','/');
  if(name.startsWith('/') || name.includes(':')) throw Error('INTAKE_UNSAFE_PATH');
  const parts=name.replace(/\/$/,'').split('/');
  if(parts.some(part=>!part || part==='.' || part==='..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error('INTAKE_UNSAFE_PATH');
  return parts.join('/');
}
export function assertUniqueSourcePaths(entries) {
  const names=new Map();
  for(const entry of entries) {
    const key=entry.path.normalize('NFC').toLowerCase();
    if(names.has(key)) throw Error('INTAKE_DUPLICATE_PATH');names.set(key,entry.directory);
  }
  for(const name of names.keys()) {
    const parts=name.split('/');parts.pop();
    while(parts.length) {if(names.get(parts.join('/'))===false) throw Error('INTAKE_FILE_DIRECTORY_COLLISION');parts.pop();}
  }
}
