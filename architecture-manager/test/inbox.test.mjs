import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectInbox } from '../src/inbox.mjs';

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'am-inbox-'));
  const inbox = join(root, 'inbox');
  mkdirSync(join(inbox, 'backup', 'zcode', 'some-soft'), { recursive: true });
  writeFileSync(join(inbox, 'backup', 'MANIFEST.json'), '{}');
  mkdirSync(join(inbox, 'archive'), { recursive: true });
  mkdirSync(join(inbox, '_inventory'), { recursive: true });
  writeFileSync(
    join(inbox, '_inventory', 'BP7-ledger.json'),
    JSON.stringify({ generatedAt: '2026-09-28', entries: [{ a: 1 }, { a: 2 }] })
  );
  return root;
}

test('inventories the three zones shallowly without requiring all of them', () => {
  const root = makeWorkspace();
  const inbox = inspectInbox(root);
  assert.equal(inbox.zones.length, 3);
  const backup = inbox.zones.find((zone) => zone.zone === 'backup');
  assert.equal(backup.present, true);
  assert.equal(backup.entryCount, 2);
  assert.deepEqual(backup.entries.map((entry) => entry.kind).sort(), ['directory', 'file']);
  const archive = inbox.zones.find((zone) => zone.zone === 'archive');
  assert.equal(archive.present, true);
  assert.equal(archive.entryCount, 0);
  const trash = inbox.zones.find((zone) => zone.zone === 'trash');
  assert.equal(trash.present, false);
  assert.equal(trash.entryCount, 0);
  rmSync(root, { recursive: true, force: true });
});

test('surfaces the BP-7 ledger when present', () => {
  const root = makeWorkspace();
  const inbox = inspectInbox(root);
  assert.equal(inbox.bp7Ledger.present, true);
  assert.equal(inbox.bp7Ledger.generatedAt, '2026-09-28');
  assert.equal(inbox.bp7Ledger.entryCount, 2);
  rmSync(root, { recursive: true, force: true });
});
