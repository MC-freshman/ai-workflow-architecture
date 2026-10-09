import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {parseJson} from './core/json.mjs';
import {defaultAuditRoot,targetPath} from './core/paths.mjs';
import {sha256} from './core/hash.mjs';
import {auditEventHash,sanitizeAuditEvent} from './transactions/audit-content.mjs';

function normalizeEvent(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)) return null;
  const action=value.action || value.kind;
  if(typeof action!=='string' || !action || typeof value.status!=='string' || !value.status) return null;
  for(const key of ['target','workspaceRoot','occurredAt','at','error','planId','operationId','parentOperationId','transactionId','phase','checkpointPath','checkpointSha256','oldSha256','newSha256','eventSha256','writeState']) {
    if(value[key]!=null && typeof value[key]!=='string')return null;
  }
  if(value.writePerformed!=null && typeof value.writePerformed!=='boolean')return null;
  const sealed=typeof value.eventSha256==='string';
  const checksum=sealed?(auditEventHash(value)===value.eventSha256?'verified':'mismatch'):'legacy-unsealed';
  const clean=sanitizeAuditEvent(value);
  return {...clean,action,occurredAt:value.occurredAt || value.at || null,integrity:{checksum,checkpoint:'not-recorded'}};
}

function checkCheckpoint(event,auditRoot) {
  if(!event.checkpointPath || !event.checkpointSha256) return 'not-recorded';
  try {
    const name=relative(resolve(auditRoot),resolve(event.checkpointPath));
    if(!name.replaceAll('\\','/').startsWith('checkpoints/')) return 'outside-audit-root';
    const file=targetPath(auditRoot,name);
    if(!existsSync(file)) return 'missing';
    return sha256(readFileSync(file))===event.checkpointSha256?'verified':'mismatch';
  } catch { return 'unreadable-or-unsafe'; }
}

export function readAuditEvents(options = {}) {
  const auditRoot=options.auditRoot ?? defaultAuditRoot(),eventsPath=join(auditRoot,'events.jsonl');
  const integrity={hashed:0,verified:0,mismatches:0,legacyUnsealed:0,missingTimestamps:0,checkpointProblems:0};
  const report={auditRoot,eventsPath,present:existsSync(eventsPath),totalEvents:0,corruptLines:0,invalidEvents:0,checkpointCount:0,matchedEvents:0,events:[],integrity};
  try { report.checkpointCount=readdirSync(join(auditRoot,'checkpoints'),{withFileTypes:true}).filter(e=>e.isFile() && e.name.endsWith('.before')).length; } catch { /* no checkpoints yet */ }
  if(!report.present) return report;
  const events=[],operations=new Map();
  for(const line of readFileSync(eventsPath,'utf8').split('\n').filter(l=>l.trim())) {
    let value; try { value=parseJson(line); } catch { report.corruptLines++; continue; }
    const event=normalizeEvent(value);if(!event){report.invalidEvents++;continue;}
    report.totalEvents++;
    if(event.integrity.checksum==='legacy-unsealed') integrity.legacyUnsealed++;else {integrity.hashed++;if(event.integrity.checksum==='verified')integrity.verified++;else integrity.mismatches++;}
    if(!event.occurredAt) integrity.missingTimestamps++;
    if(options.workspaceRoot && (!event.workspaceRoot || resolve(event.workspaceRoot)!==resolve(options.workspaceRoot))) continue;
    if(event.phase==='operation' && event.operationId)operations.set(event.operationId,event);
    if(options.status && event.status!==options.status) continue;
    if(options.planId && event.planId!==options.planId && event.operationId!==options.planId) continue;
    events.push(event);
  }
  report.matchedEvents=events.length;
  report.operationsWithoutTerminal=[...operations.values()].filter(event=>event.status==='started').map(event=>({operationId:event.operationId,planId:event.planId,occurredAt:event.occurredAt}));
  const limit=Number.isFinite(options.limit) && options.limit>0?Math.max(1,Math.min(500,Math.floor(options.limit))):100;
  report.events=events.slice(-limit);
  if(options.verifyCheckpoints!==false) for(const event of report.events) {
    event.integrity.checkpoint=checkCheckpoint(event,auditRoot);
    if(!['verified','not-recorded'].includes(event.integrity.checkpoint)) integrity.checkpointProblems++;
  }
  report.checkedCheckpointEvents=report.events.length;
  report.ok=!report.corruptLines && !report.invalidEvents && !integrity.mismatches && !integrity.checkpointProblems;
  return report;
}
