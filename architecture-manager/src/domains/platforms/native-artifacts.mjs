import fs from '../../core/physical-fs.mjs';
import {join} from 'node:path';

// Read public packaged metadata without executing the vendor application or depending on Electron ASAR fs.
export function readNativeArtifact(archive,name,maxBytes=32*1024*1024){
  const fd=fs.openSync(archive,'r');try{
    const size=Buffer.alloc(8);fs.readSync(fd,size,0,8,0);const length=size.readUInt32LE(4);if(length>16*1024*1024)throw Error('NATIVE_METADATA_INVALID');
    const header=Buffer.alloc(length);fs.readSync(fd,header,0,length,8);const value=JSON.parse(header.subarray(8,8+header.readUInt32LE(4)).toString('utf8'));
    let entry=value;for(const part of name.split(/[\\/]/)){if(!part||part==='..')throw Error('NATIVE_METADATA_INVALID');entry=entry.files?.[part];if(!entry)throw Error('NATIVE_METADATA_MISSING');}
    if(entry.size>maxBytes||entry.link)throw Error('NATIVE_METADATA_INVALID');
    if(entry.unpacked)return fs.readFileSync(join(archive+'.unpacked',name),'utf8');
    const bytes=Buffer.alloc(entry.size);fs.readSync(fd,bytes,0,bytes.length,8+length+Number(entry.offset));return bytes.toString('utf8');
  }finally{fs.closeSync(fd);}
}
