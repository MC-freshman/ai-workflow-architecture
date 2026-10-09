import {crc32,deflateRawSync} from 'node:zlib';
export function zipFixture(rows) {
  const local=[],central=[];let offset=0;
  for(const row of rows) {
    const name=Buffer.from(row.path),data=Buffer.from(row.content || ''),compressed=row.deflate?deflateRawSync(data):data,method=row.deflate?8:0,flags=0x800,crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(flags,6);header.writeUInt16LE(method,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,compressed);
    const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(0x314,4);item.writeUInt16LE(20,6);item.writeUInt16LE(flags,8);item.writeUInt16LE(method,10);item.writeUInt32LE(crc,16);item.writeUInt32LE(compressed.length,20);item.writeUInt32LE(data.length,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(((row.symlink?0xa000:0x8000)<<16)>>>0,38);item.writeUInt32LE(offset,42);central.push(item,name);offset+=header.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
