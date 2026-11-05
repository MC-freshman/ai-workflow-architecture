import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join,relative} from 'node:path';
import {readAuditEvents} from '../src/domains/audit/audit.mjs';
import {writeAudit,saveCheckpoint} from '../src/transactions/kernel.mjs';
import {auditPlanOperation} from '../src/transactions/operation-audit.mjs';
import {applyPlan} from '../src/transactions/router.mjs';
import {auditEventHash} from '../src/transactions/audit-content.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(join(os.tmpdir(),'am-audit-regression-')),auditRoot=join(root,'audit');
  t.after(()=>{assert.ok(relative(os.tmpdir(),root).startsWith('am-audit-regression-'));fs.rmSync(root,{recursive:true,force:true});});
  const plan={schema:'architecture-manager-plan/v1',planId:'audit-fixture',kind:'audit-test',workspaceRoot:root,applyMode:'confirmation-required',writePerformed:false,target:{path:'demo'}};
  return {root,auditRoot,plan};
}
const event=f=>writeAudit({...f,transactionId:'domain-event',actor:'test',action:'software-command',status:'applied',target:'demo'});

test('new audit events always have time and a content seal; no timestamp is invented for old events',t=>{
  const f=fixture(t),saved=event(f);assert.ok(Number.isFinite(Date.parse(saved.occurredAt)));assert.equal(saved.eventSha256,auditEventHash(saved));
  fs.appendFileSync(join(f.auditRoot,'events.jsonl'),JSON.stringify({kind:'old-operation',status:'applied'})+'\n');
  const report=readAuditEvents(f);assert.equal(report.integrity.verified,1);assert.equal(report.integrity.legacyUnsealed,1);assert.equal(report.integrity.missingTimestamps,1);assert.equal(report.events[1].occurredAt,null);
});

test('valid JSON scalars and wrong event shapes are rejected rather than sent to the renderer',t=>{
  const f=fixture(t);event(f);fs.appendFileSync(join(f.auditRoot,'events.jsonl'),'null\n42\n[]\n{}\n{"action":"x","status":"failed","target":{}}\n{bad\n');
  const report=readAuditEvents(f);assert.equal(report.totalEvents,1);assert.equal(report.invalidEvents,5);assert.equal(report.corruptLines,1);assert.equal(report.ok,false);assert.equal(report.events.length,1);
});
test('object-valued display fields cannot crash the renderer; started-only operations stay explicitly unresolved',t=>{
  const f=fixture(t);event(f);
  const rows=['error','planId','operationId','checkpointPath','occurredAt','at'].map(key=>({action:'x',status:'failed',[key]:{}}));
  fs.appendFileSync(join(f.auditRoot,'events.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  writeAudit({...f,transactionId:'unfinished',actor:'test',action:'x',phase:'operation',status:'started',target:'demo'});
  const file=join(f.auditRoot,'events.jsonl'),lines=fs.readFileSync(file,'utf8').trim().split('\n'),last=JSON.parse(lines.at(-1));last.operationId='operation-unfinished';last.eventSha256=auditEventHash(last);lines[lines.length-1]=JSON.stringify(last);fs.writeFileSync(file,lines.join('\n')+'\n');
  const report=readAuditEvents({...f,status:'failed'});assert.equal(report.invalidEvents,6);assert.equal(report.operationsWithoutTerminal.length,1);assert.equal(report.operationsWithoutTerminal[0].operationId,'operation-unfinished');
});

test('sealed-event alteration and checkpoint corruption are independently detected',t=>{
  const f=fixture(t),cp=saveCheckpoint(f.auditRoot,'checkpoint','original');
  writeAudit({...f,transactionId:'domain-event',actor:'test',action:'document-edit',status:'applied',target:'demo',checkpointPath:cp.path,checkpointSha256:cp.sha256});
  assert.equal(readAuditEvents(f).events[0].integrity.checkpoint,'verified');fs.writeFileSync(cp.path,'different');assert.equal(readAuditEvents(f).integrity.checkpointProblems,1);
  const file=join(f.auditRoot,'events.jsonl'),row=JSON.parse(fs.readFileSync(file,'utf8'));row.status='forged';fs.writeFileSync(file,JSON.stringify(row)+'\n');assert.equal(readAuditEvents(f).integrity.mismatches,1);
});

test('checkpoint references outside the audit namespace are not read',t=>{
  const f=fixture(t);writeAudit({...f,transactionId:'outside',actor:'test',action:'x',status:'failed',target:'demo',checkpointPath:join(f.root,'private.txt'),checkpointSha256:'a'.repeat(64)});
  assert.equal(readAuditEvents(f).events[0].integrity.checkpoint,'outside-audit-root');
});

test('unsupported and unconfirmed plans have correlated start/failure events without changing the workspace',t=>{
  const f=fixture(t);assert.throws(()=>applyPlan(f),/TRANSACTION_KIND_UNSUPPORTED/);
  let rows=readAuditEvents(f).events;assert.deepEqual(rows.map(e=>e.status),['started','failed']);assert.equal(rows[0].operationId,rows[1].operationId);assert.equal(rows[1].writeState,'unknown');
  f.plan.applyMode='unconfirmed';assert.throws(()=>applyPlan(f),/TRANSACTION_CONFIRMATION_REQUIRED/);rows=readAuditEvents(f).events;assert.equal(rows.length,4);assert.equal(fs.existsSync(join(f.root,'demo')),false);
});

test('an interruption after a checkpoint links the final failure to the actual recovery point',t=>{
  const f=fixture(t);assert.throws(()=>auditPlanOperation(f,()=>{saveCheckpoint(f.auditRoot,'interrupted','old bytes');throw Error('SIMULATED_INTERRUPT');}),/SIMULATED_INTERRUPT/);
  const row=readAuditEvents(f).events.at(-1);assert.ok(row.checkpointPath.endsWith('interrupted.before'));assert.equal(row.integrity.checkpoint,'verified');
});

test('async failures and cancellation preserve correlation and redact memory-only credential values',async t=>{
  const f=fixture(t),sentinel='REVIEW_SENTINEL_NOT_A_CREDENTIAL';
  await assert.rejects(auditPlanOperation({...f,credentialValue:sentinel},async()=>{throw Error('FAILED_DETAIL: '+sentinel);}),/FAILED_DETAIL/);
  await assert.rejects(auditPlanOperation(f,async()=>{throw Error('TASK_CANCELLED');}),/TASK_CANCELLED/);
  const raw=fs.readFileSync(join(f.auditRoot,'events.jsonl'),'utf8');assert.equal(raw.includes(sentinel),false);
  const rows=readAuditEvents(f).events;assert.equal(rows[1].status,'failed');assert.equal(rows[1].sensitiveRedacted,true);assert.equal(rows.at(-1).status,'cancelled');
});

test('parallel and nested operations do not mix identifiers or credential contexts',async t=>{
  const f=fixture(t),run=id=>auditPlanOperation({...f,plan:{...f.plan,planId:id}},async()=>{await new Promise(resolve=>setTimeout(resolve,1));writeAudit({...f,plan:{...f.plan,planId:id},transactionId:id,actor:'test',action:'child',status:'applied',target:id});return {writePerformed:false};});
  await Promise.all([run('first'),run('second')]);
  const rows=readAuditEvents(f).events;for(const id of ['first','second'])assert.equal(new Set(rows.filter(e=>e.planId===id).map(e=>e.operationId)).size,1);assert.notEqual(rows[0].operationId,rows[1].operationId);
  await auditPlanOperation(f,()=>auditPlanOperation({...f,plan:{...f.plan,planId:'nested'}},async()=>({writePerformed:false})));
  const nested=readAuditEvents(f).events.filter(e=>e.planId==='nested');assert.ok(nested[0].parentOperationId);assert.equal(nested[0].operationId,nested[1].operationId);
});

test('credential patterns are redacted on write and old events are redacted without rewriting their bytes',t=>{
  const f=fixture(t),value='REVIEW_SENTINEL_NOT_A_CREDENTIAL';
  writeAudit({...f,transactionId:'safe',actor:'test',action:'x',status:'failed',target:'https://user:'+value+'@example.invalid',error:'password='+value+' Authorization: Bearer '+value});
  assert.equal(fs.readFileSync(join(f.auditRoot,'events.jsonl'),'utf8').includes(value),false);
  const file=join(f.auditRoot,'events.jsonl');fs.appendFileSync(file,JSON.stringify({kind:'old',status:'failed',error:'password='+value})+'\n');const before=fs.readFileSync(file);
  assert.equal(JSON.stringify(readAuditEvents(f).events).includes(value),false);assert.ok(fs.readFileSync(file).equals(before));
});

test('audit write failure blocks dispatch and finalization failure never pretends an applied write did not occur',t=>{
  const f=fixture(t);fs.writeFileSync(f.auditRoot,'not a directory');let dispatched=0;
  assert.throws(()=>auditPlanOperation(f,()=>{dispatched++;}));assert.equal(dispatched,0);fs.unlinkSync(f.auditRoot);
  assert.throws(()=>auditPlanOperation(f,()=>{fs.rmSync(f.auditRoot,{recursive:true,force:true});fs.writeFileSync(f.auditRoot,'unavailable');return {writePerformed:true};}),e=>e.message==='AUDIT_FINALIZATION_FAILED' && e.writePerformed===true);
});

test('workspace/status/id filters and bounded limits select actual events',t=>{
  const f=fixture(t);event(f);writeAudit({...f,transactionId:'other',plan:{...f.plan,planId:'other',workspaceRoot:join(f.root,'other')},actor:'test',action:'x',status:'failed',target:'demo'});
  assert.equal(readAuditEvents({...f,workspaceRoot:f.root}).matchedEvents,1);assert.equal(readAuditEvents({...f,status:'failed'}).events.length,1);assert.equal(readAuditEvents({...f,planId:'other'}).events.length,1);assert.equal(readAuditEvents({...f,limit:0.5}).events.length,1);
});
