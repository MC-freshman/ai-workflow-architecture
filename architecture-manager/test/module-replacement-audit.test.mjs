// N3 contract tests: second replacement pilot (audit). Verbatim-comparable subset only —
// hash verification (verified/mismatch) and checkpoint file checks remain domain-side by
// declared boundary; the pilot core is renderer-safe (no fs/crypto). U-table 20261113 R2-F10.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAuditEvents } from '../src/domains/audit/audit.mjs';
import { readAuditEventsAlt } from '../src/renderer/features/workspace/pilot/audit-alt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-contract-'));
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const auditRoot = path.join(tmp, 'audit');
fs.mkdirSync(path.join(auditRoot, 'checkpoints'), { recursive: true });
fs.writeFileSync(path.join(auditRoot, 'checkpoints', 'a.before'), 'x');
const wsA = path.join(tmp, 'wsA');
const wsB = path.join(tmp, 'wsB');
const events = [
  { action: 'transaction-apply', status: 'started', phase: 'operation', operationId: 'op-1', planId: 'plan-1', workspaceRoot: wsA, occurredAt: '2026-11-13T00:00:00Z', transactionId: 'tx-1', eventSha256: 'f'.repeat(64) },
  { action: 'transaction-apply', status: 'applied', phase: 'operation', operationId: 'op-1', planId: 'plan-1', workspaceRoot: wsA, occurredAt: '2026-11-13T00:01:00Z', transactionId: 'tx-1', eventSha256: 'f'.repeat(64) },
  { action: 'scan', status: 'completed', workspaceRoot: wsB, occurredAt: '2026-11-13T00:02:00Z' },
  { action: 'legacy', status: 'completed', workspaceRoot: wsA },
  { kind: 'renamed-action', status: 'completed', workspaceRoot: wsA, at: '2026-11-13T00:03:00Z' },
  { action: 'bad-field', status: 'completed', workspaceRoot: 42 },
  'not-an-object'
];
fs.writeFileSync(path.join(auditRoot, 'events.jsonl'), events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n{corrupt\n');

const SUBSET = ['action', 'status', 'occurredAt', 'planId', 'operationId', 'transactionId', 'phase', 'workspaceRoot'];
const subset = (e) => Object.fromEntries(SUBSET.map((k) => [k, e[k] ?? null]));

test('pilot audit replacement is independent of the audit domain source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/features/workspace/pilot/audit-alt.mjs'), 'utf8');
  assert.ok(!/from\s+'[^']*domains\/audit/.test(src), 'pilot must not import the domain it replaces');
  const core = fs.readFileSync(path.join(ROOT, 'src/renderer/features/workspace/pilot/audit-alt-core.mjs'), 'utf8');
  assert.ok(!/node:/.test(core), 'renderer-safe core must not import node builtins');
});

test('counts and integrity subset match verbatim (incl. corrupt/invalid/legacy)', () => {
  const domain = readAuditEvents({ auditRoot, limit: 500 });
  const alt = readAuditEventsAlt({ auditRoot, limit: 500 });
  for (const key of ['totalEvents', 'corruptLines', 'invalidEvents', 'matchedEvents', 'checkpointCount']) {
    assert.equal(alt[key], domain[key], key);
  }
  for (const key of ['hashed', 'legacyUnsealed', 'missingTimestamps']) {
    assert.equal(alt.integrity[key], domain.integrity[key], 'integrity.' + key);
  }
  assert.deepEqual(alt.events.map(subset), domain.events.map(subset));
  assert.deepEqual(alt.operationsWithoutTerminal, domain.operationsWithoutTerminal);
});

test('filters (workspaceRoot/status/planId/limit) behave identically on the subset', () => {
  for (const options of [{ workspaceRoot: wsA }, { status: 'completed' }, { planId: 'plan-1' }, { limit: 2 }, { workspaceRoot: wsA, status: 'applied' }]) {
    const domain = readAuditEvents({ auditRoot, ...options });
    const alt = readAuditEventsAlt({ auditRoot, ...options });
    assert.equal(alt.matchedEvents, domain.matchedEvents, JSON.stringify(options));
    assert.deepEqual(alt.events.map(subset), domain.events.map(subset), JSON.stringify(options));
  }
});

test('missing audit root degrades identically (present=false, zero counts)', () => {
  const domain = readAuditEvents({ auditRoot: path.join(tmp, 'absent') });
  const alt = readAuditEventsAlt({ auditRoot: path.join(tmp, 'absent') });
  assert.equal(alt.present, false);
  assert.equal(domain.present, false);
  assert.equal(alt.totalEvents, 0);
  assert.equal(alt.checkpointCount, 0);
});

test('replacement activation stays declarative and default-off', () => {
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-overrides.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-registry.json'), 'utf8'));
  const audit = registry.modules.find((m) => m.id === 'panel-audit');
  assert.equal(audit.enabled, true);
  assert.equal(audit.replacement, null);
  assert.deepEqual(overrides.overrides, {});
});