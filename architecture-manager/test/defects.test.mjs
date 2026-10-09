import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDefectBook, verifyDefectBook } from '../src/defects.mjs';

function makeWorkspace(book) {
  const root = mkdtempSync(join(tmpdir(), 'am-defects-'));
  const versions = join(root, 'versions');
  mkdirSync(versions, { recursive: true });
  if (book !== undefined) writeFileSync(join(versions, '缺陷状态簿.json'), JSON.stringify(book));
  return root;
}

const BOOK = {
  schema: 'ai-defect-status-book/v1',
  generatedAt: '2026-09-30T00:00:00+08:00',
  defects: [
    { id: 'D-T1', title: 'red row', status: 'open', location: 'somewhere', source: 'x.md' },
    { id: 'D-T2', title: 'done row', status: 'closed', location: 'elsewhere', source: 'y.md' },
    { id: 'D-T3', title: 'ruled row', status: 'ruled', location: 'third', source: 'z.md' }
  ]
};

test('reads the defect book with counts and red rows surfaced loudly', () => {
  const root = makeWorkspace(BOOK);
  const book = readDefectBook(root);
  assert.equal(book.present, true);
  assert.equal(book.total, 3);
  assert.equal(book.counts.open, 1);
  assert.equal(book.counts.closed, 1);
  assert.equal(book.counts.ruled, 1);
  assert.deepEqual(book.redRows, [{ id: 'D-T1', status: 'open', title: 'red row' }]);
  rmSync(root, { recursive: true, force: true });
});

test('reports a missing or corrupt book without inventing one', () => {
  const missing = readDefectBook(makeWorkspace());
  assert.equal(missing.present, false);
  const root = makeWorkspace(undefined);
  writeFileSync(join(root, 'versions', '缺陷状态簿.json'), '{broken');
  const corrupt = readDefectBook(root);
  assert.equal(corrupt.present, true);
  assert.equal(corrupt.corrupt, true);
  rmSync(root, { recursive: true, force: true });
});

test('runs the real stdlib checker when it exists on this host', () => {
  const workspaceRoot = join('E:/ai');
  const checkerPath = join(workspaceRoot, 'versions', '缺陷状态簿.check.py');
  if (!existsSync(checkerPath)) return;
  const result = verifyDefectBook(workspaceRoot);
  assert.equal(result.present, true);
  assert.equal(result.passed, true);
  assert.equal(result.exitCode, 0);
});
