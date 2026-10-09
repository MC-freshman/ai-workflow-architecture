import {openSync,closeSync,readSync,statSync,createReadStream} from '../../core/physical-fs.mjs';
import {Readable} from 'node:stream';
import {TextDecoder} from 'node:util';
import {createInflateRaw,crc32} from 'node:zlib';
import {sourceRelative,assertUniqueSourcePaths} from './paths.mjs';

function readAt(file,position,size) {
  const data=Buffer.alloc(size);let done=0;
  while(done<size) {const count=readSync(file,data,done,size-done,position+done);if(!count)throw Error('INTAKE_ZIP_TRUNCATED');done+=count;}
  return data;
}
function name(bytes,flags) {
  if(!(flags & 0x800) && bytes.some(byte=>byte>127)) throw Error('INTAKE_ZIP_FILENAME_ENCODING');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INTAKE_ZIP_FILENAME_ENCODING');}
}
export function zipDirectory(source) {
  const file=openSync(source,'r');
  try {
    const size=statSync(source).size,tailSize=Math.min(size,65557),tail=readAt(file,size-tailSize,tailSize);
    let eocd=-1;
    for(let offset=tail.length-22;offset>=0;offset--) if(tail.readUInt32LE(offset)===0x06054b50 && offset+22+tail.readUInt16LE(offset+20)===tail.length){eocd=offset;break;}
    if(eocd<0) throw Error('INTAKE_ZIP_INVALID');
    if(tail.readUInt16LE(eocd+4) || tail.readUInt16LE(eocd+6) || tail.readUInt16LE(eocd+8)!==tail.readUInt16LE(eocd+10)) throw Error('INTAKE_ZIP_MULTIDISK');
    const count=tail.readUInt16LE(eocd+10),length=tail.readUInt32LE(eocd+12),start=tail.readUInt32LE(eocd+16);
    if(count===65535 || length===0xffffffff || start===0xffffffff) throw Error('INTAKE_ZIP64_REQUIRED');
    if(start+length>size-tailSize+eocd) throw Error('INTAKE_ZIP_INVALID');
    const central=readAt(file,start,length),entries=[];let offset=0;
    for(let index=0;index<count;index++) {
      if(offset+46>central.length || central.readUInt32LE(offset)!==0x02014b50) throw Error('INTAKE_ZIP_INVALID');
      const flags=central.readUInt16LE(offset+8),method=central.readUInt16LE(offset+10),crc=central.readUInt32LE(offset+16),compressedSize=central.readUInt32LE(offset+20),bytes=central.readUInt32LE(offset+24),nameLength=central.readUInt16LE(offset+28),extraLength=central.readUInt16LE(offset+30),commentLength=central.readUInt16LE(offset+32),external=central.readUInt32LE(offset+38),local=central.readUInt32LE(offset+42);
      if(flags & 1) throw Error('INTAKE_ZIP_ENCRYPTED');
      if(![0,8].includes(method)) throw Error('INTAKE_ZIP_COMPRESSION');
      if([compressedSize,bytes,local].includes(0xffffffff)) throw Error('INTAKE_ZIP64_REQUIRED');
      if((external>>>16 & 0xf000)===0xa000) throw Error('INTAKE_LINK_NOT_ALLOWED');
      const end=offset+46+nameLength+extraLength+commentLength;if(end>central.length)throw Error('INTAKE_ZIP_TRUNCATED');
      const rawName=central.subarray(offset+46,offset+46+nameLength),decoded=name(rawName,flags),directory=decoded.endsWith('/') || (external>>>16 & 0xf000)===0x4000;
      const relative=sourceRelative(decoded),header=readAt(file,local,30);
      if(header.readUInt32LE(0)!==0x04034b50 || header.readUInt16LE(6)!==flags || header.readUInt16LE(8)!==method) throw Error('INTAKE_ZIP_HEADER_MISMATCH');
      const localNameSize=header.readUInt16LE(26),dataOffset=local+30+localNameSize+header.readUInt16LE(28);
      if(!rawName.equals(readAt(file,local+30,localNameSize))) throw Error('INTAKE_ZIP_HEADER_MISMATCH');
      if(dataOffset+compressedSize>start || directory && bytes) throw Error('INTAKE_ZIP_INVALID');
      entries.push({path:relative,directory,bytes,compressedSize,dataOffset,method,crc});offset=end;
    }
    if(offset!==central.length) throw Error('INTAKE_ZIP_INVALID');
    assertUniqueSourcePaths(entries);return entries;
  } finally {closeSync(file);}
}
export async function* zipChunks(source,entry) {
  const raw=entry.compressedSize?createReadStream(source,{start:entry.dataOffset,end:entry.dataOffset+entry.compressedSize-1,highWaterMark:1024*1024}):Readable.from([]);
  const stream=entry.method===8?raw.pipe(createInflateRaw()):raw;let bytes=0,crc=0;
  raw.on('error',error=>stream.destroy(error));
  try {
    for await(const chunk of stream) {bytes+=chunk.length;if(bytes>entry.bytes)throw Error('INTAKE_ZIP_SIZE_MISMATCH');crc=crc32(chunk,crc);yield chunk;}
    if(bytes!==entry.bytes || crc!==entry.crc) throw Error('INTAKE_ZIP_CONTENT_MISMATCH');
  } finally {stream.destroy();if(stream!==raw)raw.destroy();}
}
