import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { buildDefectBookEditPlan } from '../src/defects.mjs';
import { applyPlan, verifyPlanTarget } from '../src/transactions.mjs';

const BOOK_RELATIVE = join('versions', '缺陷状态簿.json');
const BOOK = {
  schema: 'ai-defect-status-book/v1',
  generatedAt: '2026-09-30T00:00:00+08:00',
  defects: [
    { id: 'D-T1', title: 'red row', status: 'open', location: 'somewhere', source: 'x.md' },
    { id: 'D-T2', title: 'done row', status: 'closed', location: 'elsewhere', source: 'y.md' }
  ]
};

function makeFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'am-defect-tx-'));
  mkdirSync(join(workspaceRoot, 'versions'), { recursive: true });
  writeFileSync(join(workspaceRoot, BOOK_RELATIVE), `${JSON.stringify(BOOK, null, 1)}\n`);
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-defect-tx-audit-'));
  return { workspaceRoot, auditRoot };
}

function bookSha(workspaceRoot) {
  return sha256(readFileSync(join(workspaceRoot, BOOK_RELATIVE), 'utf8'));
}

function readBook(workspaceRoot) {
  return JSON.parse(readFileSync(join(workspaceRoot, BOOK_RELATIVE), 'utf8'));
}

function cleanup(fixture) {
  rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
}

test('set-status goes through plan, apply, verify and stays idempotent', () => {
  const fixture = makeFixture();
  const plan = buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'closed', baselineSha256: bookSha(fixture.workspaceRoot) });
  assert.equal(plan.kind, 'defect-book-edit');
  assert.equal(plan.applyMode, 'confirmation-required');
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.target.path, 'versions/缺陷状态簿.json');
  const applied = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.writePerformed, true);
  assert.equal(readBook(fixture.workspaceRoot).defects[0].status, 'closed');
  assert.ok(existsSync(applied.checkpointPath));
  const verification = verifyPlanTarget({ plan });
  assert.equal(verification.ok, true);
  assert.equal(verification.writePerformed, false);
  const again = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(again.status, 'already-applied');
  cleanup(fixture);
});

test('external change between plan and apply is blocked without writing', () => {
  const fixture = makeFixture();
  const plan = buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'closed', baselineSha256: bookSha(fixture.workspaceRoot) });
  writeFileSync(join(fixture.workspaceRoot, BOOK_RELATIVE), `${JSON.stringify({ ...BOOK, generatedAt: 'tampered' }, null, 1)}\n`);
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }), /EXTERNAL_CHANGE_DETECTED/);
  assert.equal(readBook(fixture.workspaceRoot).generatedAt, 'tampered');
  cleanup(fixture);
});

test('append registers a new row and rejects duplicates and missing fields', () => {
  const fixture = makeFixture();
  const plan = buildDefectBookEditPlan({
    workspaceRoot: fixture.workspaceRoot,
    operation: 'append',
    row: { id: 'D-T9', title: 'new defect', status: 'open', location: 'here', source: 'ledger.md' },
    baselineSha256: bookSha(fixture.workspaceRoot)
  });
  applyPlan({ plan, auditRoot: fixture.auditRoot });
  const book = readBook(fixture.workspaceRoot);
  assert.equal(book.defects.length, 3);
  assert.equal(book.defects[2].id, 'D-T9');
  assert.throws(() => buildDefectBookEditPlan({
    workspaceRoot: fixture.workspaceRoot,
    operation: 'append',
    row: { id: 'D-T9', title: 'dup', status: 'open', location: 'here', source: 'ledger.md' },
    baselineSha256: bookSha(fixture.workspaceRoot)
  }), /DEFECT_BOOK_ROW_EXISTS/);
  assert.throws(() => buildDefectBookEditPlan({
    workspaceRoot: fixture.workspaceRoot,
    operation: 'append',
    row: { id: 'D-T8', title: 'no source', status: 'open', location: 'here' },
    baselineSha256: bookSha(fixture.workspaceRoot)
  }), /DEFECT_BOOK_FIELD_REQUIRED/);
  cleanup(fixture);
});

test('builder rejects invalid status, wrong baseline and unknown operations', () => {
  const fixture = makeFixture();
  assert.throws(() => buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'probably-fixed', baselineSha256: bookSha(fixture.workspaceRoot) }), /DEFECT_BOOK_STATUS_INVALID/);
  assert.throws(() => buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-XX', newStatus: 'closed', baselineSha256: bookSha(fixture.workspaceRoot) }), /DEFECT_BOOK_ROW_NOT_FOUND/);
  assert.throws(() => buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'closed', baselineSha256: 'deadbeef' }), /DEFECT_BOOK_BASELINE_MISMATCH/);
  assert.throws(() => buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'delete-everything', baselineSha256: bookSha(fixture.workspaceRoot) }), /DEFECT_BOOK_OPERATION_INVALID/);
  assert.throws(() => buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'open', baselineSha256: bookSha(fixture.workspaceRoot) }), /DEFECT_BOOK_NO_CHANGE/);
  cleanup(fixture);
});

test('simulated interrupt after checkpoint leaves the book unchanged and restorable', () => {
  const fixture = makeFixture();
  const plan = buildDefectBookEditPlan({ workspaceRoot: fixture.workspaceRoot, operation: 'set-status', rowId: 'D-T1', newStatus: 'closed', baselineSha256: bookSha(fixture.workspaceRoot) });
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot, failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
  assert.equal(readBook(fixture.workspaceRoot).defects[0].status, 'open');
  const events = readFileSync(join(fixture.auditRoot, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.action === 'defect-book-edit' && event.status === 'interrupted-before-write'));
  assert.ok(events.every((event) => !JSON.stringify(event).includes('red row')));
  cleanup(fixture);
});
