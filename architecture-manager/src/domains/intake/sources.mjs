import {selectDeclaredEntry} from './entry-selection.mjs';
import {createReadStream,readdirSync,lstatSync,statSync,statfsSync} from '../../core/physical-fs.mjs';
import {basename,join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {externalSourcePath,sourceRelative,assertUniqueSourcePaths} from './paths.mjs';
import {zipDirectory,zipChunks} from './zip.mjs';
import {exclusionReason,classifyEntry,decodeSourceText,hasSensitiveLiteral} from './policy.mjs';
import {interpretation} from './interpret.mjs';
import {sha256} from '../../core/hash.mjs';
import {stableJson} from '../../core/json.mjs';
import {assertScopedActive} from '../../infrastructure/process-scope.mjs';

const types=new Set(['agent','skill','tool','platform','software']);
function inventory(source,kind,policy) {
  if(kind==='zip')return zipDirectory(source);
  if(kind==='file')return [{path:sourceRelative(basename(source)),bytes:statSync(source).size,directory:false}];
  const entries=[];
  const walk=(directory,prefix='')=>{
    assertScopedActive();
    for(const item of readdirSync(directory,{withFileTypes:true})) {
      const name=sourceRelative(prefix+item.name),file=join(directory,item.name),metadata=lstatSync(file);
      if(metadata.isSymbolicLink())throw Error('INTAKE_LINK_NOT_ALLOWED');
      if(!metadata.isDirectory() && !metadata.isFile())throw Error('INTAKE_FILE_TYPE');
      entries.push({path:name,bytes:metadata.isFile()?metadata.size:0,directory:metadata.isDirectory()});
      if(metadata.isDirectory() && !exclusionReason(name,[],policy))walk(file,name+'/');
    }
  };
  walk(source);assertUniqueSourcePaths(entries);return entries;
}
export function entryChunks(intake,row) {
  if(intake.sourceKind==='draft') {const original=intake.draftFiles?.[row.path];if(typeof original!=='string' || sha256(original)!==row.sha256)throw Error('INTAKE_SOURCE_CHANGED');return [Buffer.from(original,'utf8')];}
  const source=externalSourcePath(intake.sourcePath);
  if(intake.sourceKind==='zip') {
    const entry=zipDirectory(source).find(entry=>entry.path===row.path && !entry.directory);
    if(!entry)throw Error('INTAKE_SOURCE_CHANGED');return zipChunks(source,entry);
  }
  const name=sourceRelative(row.path),file=intake.sourceKind==='file'?source:join(source,name);
  externalSourcePath(file);return createReadStream(file,{highWaterMark:1024*1024});
}
export async function scanExternalBody({workspaceRoot,platformId=null,sourcePath,type='agent',excludes=[],entryPath=null},{onProgress=()=>{}}={}) {
  if(!types.has(type))throw Error('INTAKE_TYPE_INVALID');
  const source=externalSourcePath(sourcePath),metadata=lstatSync(source),sourceKind=metadata.isDirectory()?'directory':extname(source).toLowerCase()==='.zip'?'zip':'file';
  excludes=[...new Set(excludes.map(sourceRelative))].sort();
  const policy={runtimeBody:['platform','software'].includes(type)},entries=inventory(source,sourceKind,policy),files=[],excluded=[],totalBytes=entries.filter(row=>!row.directory && !exclusionReason(row.path,excludes,policy)).reduce((sum,row)=>sum+row.bytes,0);
  const intake={sourcePath:source,sourceKind};let bytesDone=0,previewBudget=128*1024;
  for(const [index,row] of entries.entries()) {
    assertScopedActive();const excludedReason=exclusionReason(row.path,excludes,policy);
    if(excludedReason){excluded.push({path:row.path,reason:excludedReason,directory:row.directory});continue;}
    if(row.directory)continue;
    const hash=createHash('sha256'),chunks=[];let bytes=0,head=Buffer.alloc(0),crcTextError=false,decoder=new TextDecoder('utf-8',{fatal:true}),secretTail='',sensitive=false,previewBytes=0;
    let classification=null;
    for await(const chunk of entryChunks(intake,row)) {
      assertScopedActive();hash.update(chunk);bytes+=chunk.length;bytesDone+=chunk.length;
      if(head.length<4096)head=Buffer.concat([head,chunk.subarray(0,4096-head.length)]);
      classification ||= classifyEntry(row.path,head,type);
      if(classification.text) {
        try {const decoded=decoder.decode(chunk,{stream:true});sensitive ||=hasSensitiveLiteral(secretTail+decoded);secretTail=decoded.slice(-256);}catch{crcTextError=true;}
        const limit=row.path===entryPath?32768:Math.min(32768,previewBudget);
        if(previewBytes<limit){const preview=chunk.subarray(0,limit-previewBytes);chunks.push(preview);previewBytes+=preview.length;}
      }
      onProgress({phase:'读取本体来源',path:row.path,filesDone:index+1,filesTotal:entries.length,bytesDone,bytesTotal:totalBytes});
    }
    assertScopedActive();
    classification ||=classifyEntry(row.path,head,type);
    if(classification.text){try{decoder.decode();}catch{crcTextError=true;}}
    if(bytes!==row.bytes)throw Error('INTAKE_SOURCE_CHANGED');
    const reason=sensitive?'正文包含凭据字面值':crcTextError?'需要转换为 UTF-8 文本':!classification.sharedText && ['agent','skill','tool'].includes(type)?'二进制/本体不进入共享文本仓':null;
    const included=!reason;
    let preview='';if(classification.text && !sensitive && !crcTextError){const prefix=Buffer.concat(chunks).subarray(0,32768);preview=new TextDecoder().decode(prefix,{stream:true});}
    previewBudget=Math.max(0,previewBudget-previewBytes);
    files.push({path:row.path,bytes,sha256:hash.digest('hex'),...classification,included,reason,preview,previewTruncated:bytes>previewBytes});
  }
  if(!files.length)throw Error('INTAKE_SOURCE_EMPTY');
  if(entryPath && !files.some(row=>row.path===sourceRelative(entryPath) && row.included))throw Error('INTAKE_ENTRY_INVALID');
  let freeBytes=null;try{const disk=statfsSync(workspaceRoot);freeBytes=Number(disk.bavail)*Number(disk.bsize);}catch{ /* Read-only preview can still describe a source before target exists. */ }
  const candidates=files.filter(row=>row.included && (['agent','skill','tool'].includes(type)?row.sharedText:row.runnable || row.installer || /\.json$/i.test(row.path)));
  const choices=type==='skill'?candidates.filter(row=>/(^|\/)SKILL\.md$/i.test(row.path)):type==='agent'?candidates.filter(row=>/\.(md|txt)$/i.test(row.path)):type==='tool'?candidates.filter(row=>/workflow\.(yaml|yml|json)$|\.(md|py|js|mjs|ps1|sh)$/i.test(row.path)):candidates;
  let declaredManifest=null;const manifestRow=files.find(row=>row.path==='manifest.json'&&row.included&&row.text&&!row.previewTruncated);if(manifestRow){try{declaredManifest=JSON.parse(manifestRow.preview);}catch{/* Invalid manifests are handled by the publication validator. */}}
  const selectedEntry=entryPath || selectDeclaredEntry(type,choices,declaredManifest),shared=['agent','skill','tool'].includes(type),bodyBytes=files.filter(row=>row.included).reduce((sum,row)=>sum+row.bytes,0);
  let archiveSha256=null;
  if(sourceKind==='zip'){const hash=createHash('sha256');for await(const chunk of createReadStream(source)){assertScopedActive();hash.update(chunk);}archiveSha256=hash.digest('hex');}
  assertScopedActive();
  const fingerprint=sha256(stableJson({sourcePath:source,sourceKind,type,excludes,archiveSha256,entries:files.map(({path,bytes,sha256,included,reason})=>({path,bytes,sha256,included,reason})).sort((a,b)=>a.path.localeCompare(b.path)),excluded:excluded.sort((a,b)=>a.path.localeCompare(b.path))}));
  return {schema:'architecture-manager-intake/v1',workspaceRoot,platformId,type,sourcePath:source,sourceKind,sourceFingerprint:fingerprint,archiveSha256,excludes,files,excluded,choices:choices.map(({path,bytes,text,executable,installer,runnable})=>({path,bytes,text,executable,installer,runnable})),selectedEntry,selectionRequired:!selectedEntry,conversion:interpretation(type,files,selectedEntry),sourceRetained:true,bodyBytes,space:{steadyBytes:shared?bodyBytes:bodyBytes*2,peakBytes:bodyBytes*2,freeBytes,sufficient:freeBytes===null?null:freeBytes>=bodyBytes*2},writePerformed:false,instructionsExecuted:false,environmentOwnership:'platform-runtime'};
}
export async function assertIntakeUnchanged(intake,options={}) {
  if(intake.sourceKind==='draft') {
    const fresh=draftTextSource({workspaceRoot:intake.workspaceRoot,platformId:intake.platformId,type:intake.type,files:intake.draftFiles,entryPath:intake.selectedEntry});
    if(fresh.sourceFingerprint!==intake.sourceFingerprint)throw Error('INTAKE_SOURCE_CHANGED');return fresh;
  }
  const fresh=await scanExternalBody({workspaceRoot:intake.workspaceRoot,platformId:intake.platformId,sourcePath:intake.sourcePath,type:intake.type,excludes:intake.excludes,entryPath:intake.selectedEntry},options);
  if(fresh.sourceFingerprint!==intake.sourceFingerprint)throw Error('INTAKE_SOURCE_CHANGED');return fresh;
}
export async function readExternalText(intake,name) {
  const row=intake.files.find(row=>row.path===name && row.included && row.text);if(!row)throw Error('INTAKE_ENTRY_INVALID');
  const bytes=[];for await(const chunk of entryChunks(intake,row)){assertScopedActive();bytes.push(chunk);}
  const content=Buffer.concat(bytes);if(sha256(content)!==row.sha256)throw Error('INTAKE_SOURCE_CHANGED');return decodeSourceText(content);
}
export function draftTextSource({workspaceRoot,platformId,type,files,entryPath}) {
  if(!['agent','skill','tool'].includes(type) || !files || !Object.keys(files).length)throw Error('INTAKE_TYPE_INVALID');
  const rows=Object.entries(files).map(([path,content])=>{
    path=sourceRelative(path);if(typeof content!=='string' || content.includes('\0') || hasSensitiveLiteral(content) || !classifyEntry(path,Buffer.from(content.slice(0,4096)),type).sharedText)throw Error('IMPORT_NON_TEXT_SHARED_FILE');
    return {path,bytes:Buffer.byteLength(content),sha256:sha256(content),text:true,sharedText:true,included:true};
  });assertUniqueSourcePaths(rows);if(!rows.some(row=>row.path===entryPath))throw Error('INTAKE_ENTRY_INVALID');
  const sourceFingerprint=sha256(stableJson({sourceKind:'draft',type,files:rows.sort((a,b)=>a.path.localeCompare(b.path))}));
  return {schema:'architecture-manager-intake/v1',workspaceRoot,platformId,type,sourceKind:'draft',sourcePath:null,sourceFingerprint,files:rows,excluded:[],excludes:[],selectedEntry:entryPath,draftFiles:files,sourceRetained:true,writePerformed:false,instructionsExecuted:false};
}
