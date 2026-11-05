import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parseTestEvidence,sourceSnapshot} from './conform-proof.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outIndex=process.argv.indexOf('--out');
const out=outIndex>=0?path.resolve(process.argv[outIndex+1]):path.join(os.tmpdir(),'architecture-manager-conform');
fs.mkdirSync(out,{recursive:true});
const steps=[
  ['lint',[path.join(root,'node_modules/eslint/bin/eslint.js'),'src','scripts']],
  ['preload',[path.join(root,'scripts/generate-preload.mjs'),'--check']],
  // P4: fail on runtime component drift or a stale runtimeComponentVersion pin.
  ['runtime-drift',[path.join(root,'scripts/check-runtime-drift.mjs'),'--root',path.dirname(root)]],
  ['governance-drift',[path.join(root,'scripts/check-governance-drift.mjs'),'--root',path.dirname(root)]],
  ['tests',['--test','--test-reporter=tap','--test-concurrency=1','test/*.test.mjs']]
];
const proofIndex=process.argv.indexOf('--release-proof');
if(proofIndex>=0) steps.push(['release-proof',[path.join(root,'scripts/release-proof.mjs'),path.resolve(process.argv[proofIndex+1])]]);
const workspaceIndex=process.argv.indexOf('--workspace');
if(workspaceIndex>=0) steps.push(['workspace-audit',[path.join(root,'scripts/audit-workspace.mjs'),'--workspace',path.resolve(process.argv[workspaceIndex+1]),'--out',path.join(out,'workspace-audit.json')]]);
const results=[];
const sourcesBefore=sourceSnapshot(root);
for(const [name,args] of steps) {
  const start=performance.now();
  // The full serial suite (95 files, --test-concurrency=1) legitimately exceeds ten minutes;
  // the 600s cap used to kill the step mid-run and every test after it read as a timeout.
  const result=spawnSync(process.execPath,args,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:name==='tests'?1200000:600000});
  fs.writeFileSync(path.join(out,name+'.stdout'),result.stdout || '');fs.writeFileSync(path.join(out,name+'.stderr'),result.stderr || '');
  const row={name,ok:result.status===0,durationMs:performance.now()-start,exitCode:result.status,error:result.error?.message || null};
  if(name==='tests') { const evidence=parseTestEvidence(result.stdout);Object.assign(row,evidence);row.ok &&=evidence.valid; }
  results.push(row);console.log(JSON.stringify(row));
  if(!row.ok) break;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=sourceSnapshot(root);
const sourceStable=JSON.stringify(sourcesBefore)===JSON.stringify(sources);
const report={schema:'architecture-manager-conform/v1',evidenceVersion:2,recordedAt:new Date().toISOString(),ok:sourceStable && results.length===steps.length && results.every(row=>row.ok),results,sources,sourceStable,node:process.version,implementationComplete:false};
report.digest=sha(JSON.stringify({ok:report.ok,results:results.map(({durationMs,...row})=>row),sources}));
fs.writeFileSync(path.join(out,'conform.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,digest:report.digest,evidence:out}));
if(!report.ok) process.exitCode=1;
