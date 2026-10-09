import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuditEvents } from '../src/audit.mjs';

function makeAuditRoot() {
  const auditRoot = join(mkdtempSync(join(tmpdir(), 'am-audit-')), 'audit');
  mkdirSync(join(auditRoot, 'checkpoints'), { recursive: true });
  const lines = [
    JSON.stringify({ kind: 'document-edit', status: 'applied', at: '2026-09-28T10:00:00Z' }),
    JSON.stringify({ kind: 'resource-pointer', status: 'applied', at: '2026-09-28T11:00:00Z' }),
    '{broken json line',
    JSON.stringify({ kind: 'software-import', status: 'reverted', at: '2026-09-29T09:00:00Z' })
  ];
  writeFileSync(join(auditRoot, 'events.jsonl'), lines.join('\n') + '\n');
  writeFileSync(join(auditRoot, 'checkpoints', 'tx-1.before'), 'old content');
  return auditRoot;
}

test('parses events, counts corrupt lines, and honors the limit', () => {
  const auditRoot = makeAuditRoot();
  const full = readAuditEvents({ auditRoot });
  assert.equal(full.present, true);
  assert.equal(full.totalEvents, 3);
  assert.equal(full.corruptLines, 1);
  assert.equal(full.checkpointCount, 1);
  const limited = readAuditEvents({ auditRoot, limit: 2 });
  assert.equal(limited.events.length, 2);
  assert.equal(limited.totalEvents, 3);
  assert.equal(limited.events[1].kind, 'software-import');
  rmSync(auditRoot, { recursive: true, force: true });
});

test('reports a missing audit root instead of failing', () => {
  const missing = readAuditEvents({ auditRoot: join(tmpdir(), 'am-audit-does-not-exist') });
  assert.equal(missing.present, false);
  assert.equal(missing.totalEvents, 0);
});
