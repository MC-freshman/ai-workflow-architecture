import { createHash } from 'node:crypto';
import {openSync,readSync,closeSync} from './physical-fs.mjs';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function sha256File(path,{onBlock=()=>{}}={}) {
  const hash=createHash('sha256'),file=openSync(path,'r'),chunk=Buffer.allocUnsafe(1024*1024);
  try{let size;while((size=readSync(file,chunk,0,chunk.length,null))){onBlock();hash.update(chunk.subarray(0,size));}return hash.digest('hex');}finally{closeSync(file);}
}

