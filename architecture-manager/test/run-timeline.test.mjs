// P5 criteria: run timeline query is read-only, structurally checks the event chain,
// and links manager audit events only via transactionId/planId (approved P-table 20261111).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRunTimeline } from '../src/domains/runs/runs.mjs';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-timeline-'));
after(() => { fs.rmSync(fixture, { recursive: true, force: true }); });

const runRoot = path.join(fixture, 'qoder', 'runtime', 'runs', 'run-t1');
fs.mkdirSync(runRoot, { recursive: true });
fs.writeFileSync(path.join(runRoot, 'run-lock.json'), JSON.stringify({
  schemaVersion: 'ai-run-lock/v1.3',
  platform: 'qoder',
  runId: 'run-t1',
  execution: { stages: [{ id: 'INTAKE', action: 'prompt', dependsOn: [] }, { id: 'WORK', action: 'script', dependsOn: ['INTAKE'] }, { id: 'AUDIT', action: 'script', dependsOn: ['WORK'] }] }
}));
fs.writeFileSync(path.join(runRoot, 'state.json'), JSON.stringify({
  activeAttempt: { stageId: 'WORK', attempt: 1 },
  completed: [{ stageId: 'INTAKE', attempt: 1, gates: [{ gateId: 'intake-check', status: 'passed' }], outputs: [] }]
}));
const events = [
  { sequence: 1, type: 'prepared', status: 'prepared', at: '2026-11-11T00:00:00Z', transactionId: 'tx-1', eventSha256: 'a1', previousEventSha256: null },
  { sequence: 2, type: 'stage-completed', status: 'succeeded', at: '2026-11-11T00:01:00Z', transactionId: 'tx-1', eventSha256: 'a2', previousEventSha256: 'a1' },
  { sequence: 3, type: 'stage-started', status: 'started', at: '2026-11-11T00:02:00Z', transactionId: 'tx-2', eventSha256: 'a3', previousEventSha256: 'a2' }
];
fs.writeFileSync(path.join(runRoot, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
const auditRoot = path.join(fixture, 'audit');
fs.mkdirSync(path.join(auditRoot, 'checkpoints'), { recursive: true });
fs.writeFileSync(path.join(auditRoot, 'events.jsonl'), [
  JSON.stringify({ action: 'transaction-apply', status: 'succeeded', occurredAt: '2026-11-11T00:01:30Z', workspaceRoot: fixture, transactionId: 'tx-1', planId: 'plan-1' }),
  JSON.stringify({ action: 'transaction-apply', status: 'succeeded', occurredAt: '2026-11-11T00:03:00Z', workspaceRoot: fixture, transactionId: 'tx-other', planId: 'plan-2' })
].join('\n') + '\n');

const input = { workspaceRoot: fixture, platformId: 'qoder', runId: 'run-t1', auditRoot };

test('timeline stages derive completed/active/pending from state.json', () => {
  const detail = inspectRunTimeline(input);
  assert.equal(detail.error, undefined);
  assert.deepEqual(detail.stages.map((s) => [s.id, s.status]), [['INTAKE', 'completed'], ['WORK', 'active'], ['AUDIT', 'pending']]);
  assert.equal(detail.stages[0].gates[0].gateId, 'intake-check');
  assert.equal(detail.stages[0].attempts, 1);
});

test('timeline events keep sequence/seal and structural chain check', () => {
  const detail = inspectRunTimeline(input);
  assert.equal(detail.events.length, 3);
  assert.equal(detail.eventChain, 'ok');
  assert.equal(detail.events.every((e) => e.sealed), true);
  const broken = JSON.parse(JSON.stringify(events));
  broken[2].previousEventSha256 = 'wrong';
  fs.writeFileSync(path.join(runRoot, 'events.jsonl'), broken.map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.equal(inspectRunTimeline(input).eventChain, 'broken');
  fs.writeFileSync(path.join(runRoot, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
});

test('audit linkage only via transactionId/planId, never fabricated', () => {
  const detail = inspectRunTimeline(input);
  assert.equal(detail.audit.linked.length, 1);
  assert.equal(detail.audit.linked[0].transactionId, 'tx-1');
  const byPlan = inspectRunTimeline({ ...input, planId: 'plan-2' });
  assert.equal(byPlan.audit.linked.length, 2, 'planId filter adds the explicitly requested plan');
  const noLink = inspectRunTimeline({ ...input, runId: 'run-t1', planId: 'plan-none' });
  assert.equal(noLink.audit.linked.length, 1);
});

test('timeline rejects missing input and path escape; corrupt lines counted', () => {
  assert.equal(inspectRunTimeline({}).error, 'RUN_TIMELINE_INPUT_REQUIRED');
  assert.equal(inspectRunTimeline({ workspaceRoot: fixture, platformId: 'qoder', runId: '../evil' }).error, 'RUN_TIMELINE_PATH_ESCAPE');
  assert.equal(inspectRunTimeline({ workspaceRoot: fixture, platformId: 'qoder', runId: 'a/b' }).error, 'RUN_TIMELINE_PATH_ESCAPE');
  fs.writeFileSync(path.join(runRoot, 'events.jsonl'), '{bad\n' + events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const detail = inspectRunTimeline(input);
  assert.equal(detail.corruptLines, 1);
  assert.equal(detail.events.length, 3);
});

test('timeline is read-only: fixture bytes unchanged after queries', () => {
  const before = fs.readdirSync(runRoot).sort().map((f) => [f, fs.readFileSync(path.join(runRoot, f), 'utf8')]);
  inspectRunTimeline(input);
  inspectRunTimeline({ ...input, planId: 'plan-1' });
  const afterState = fs.readdirSync(runRoot).sort().map((f) => [f, fs.readFileSync(path.join(runRoot, f), 'utf8')]);
  assert.deepEqual(afterState, before);
});