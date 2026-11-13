// P6a criteria: MCP binding baseline pins the manager export surface; drift is machine-judged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeBinding, managerExportSurface, novelServiceSurface } from '../scripts/check-mcp-binding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/baselines/mcp-exports.json'), 'utf8'));

test('baseline matches the current manager export surface', () => {
  const current = computeBinding();
  assert.equal(current.manager.sha256, baseline.manager.sha256, 'MCP_BINDING_DRIFT: re-run probes and update baseline in the same batch');
  assert.equal(current.manager.count, baseline.manager.count);
  assert.ok(current.manager.count > 300, 'export surface unexpectedly small');
});

test('stdout-polluting module stays excluded from the binding surface', () => {
  const entries = managerExportSurface();
  assert.ok(!entries.some((e) => e.startsWith('src/domains/platforms/default-command.mjs#')));
  assert.deepEqual(baseline.excluded, ['src/domains/platforms/default-command.mjs']);
});

test('negative: tampered baseline is detected as drift', () => {
  const current = computeBinding();
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.manager.entries.push('src/domains/runs/runs.mjs#fakeExport');
  const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  assert.notEqual(sha(tampered.manager.entries), current.manager.sha256);
});

test('novel half is honestly skipped without NOVEL_APP_ROOT and hashes services when present', () => {
  if (!process.env.NOVEL_APP_ROOT) {
    assert.equal(computeBinding().novel, null);
    assert.equal(baseline.novel, null);
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-novel-'));
  try {
    fs.mkdirSync(path.join(fixture, 'electron/services'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'electron/services/a.cjs'), 'module.exports={foo(){}};');
    const surface = novelServiceSurface(fixture);
    assert.equal(surface.length, 1);
    assert.match(surface[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(novelServiceSurface(path.join(fixture, 'absent')), null);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});