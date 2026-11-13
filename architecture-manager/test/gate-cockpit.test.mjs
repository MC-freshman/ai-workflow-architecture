// N1 criteria: cockpit aggregates recorded evidence only; missing evidence degrades to null;
// source-snapshot drift is surfaced, never hidden (approved U-table 20261113).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGateCockpit } from '../src/domains/audit/cockpit.mjs';
import { sourceSnapshot } from '../scripts/conform-proof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-'));
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const evidenceDir = path.join(tmp, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const workspaceRoot = path.join(tmp, 'ws');
fs.mkdirSync(path.join(workspaceRoot, 'versions'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'versions', '缺陷状态簿.json'), JSON.stringify({
  defects: [
    { id: 'D-1', status: 'open', title: 'x' },
    { id: 'D-2', status: 'closed', title: 'y' },
    { id: 'D-3', status: 'unverified-registration', title: 'z' }
  ]
}));

test('cockpit degrades to null when no evidence exists (never fabricated green)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-empty-'));
  try {
    const data = readGateCockpit({ workspaceRoot, evidenceDir: empty });
    assert.equal(data.conform, null);
    assert.equal(data.supplyChain.sbom, null);
    assert.equal(data.supplyChain.audit, null);
    assert.equal(data.defects.redRows.length, 2);
    assert.ok(data.mcpBinding.manager.count > 300);
    assert.equal(data.mcpBinding.novelSkipped, true);
    assert.ok(data.notes.length >= 1);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('cockpit reads recorded conform/sbom/audit evidence verbatim', () => {
  fs.writeFileSync(path.join(evidenceDir, 'conform.json'), JSON.stringify({
    ok: true, digest: 'a'.repeat(64), recordedAt: '2026-11-13T00:00:00.000Z', sourceStable: true,
    results: [{ name: 'lint', ok: true }, { name: 'tests', ok: true, tests: 10, pass: 10, fail: 0, skipped: 0 }],
    sources: sourceSnapshot(ROOT)
  }));
  fs.writeFileSync(path.join(evidenceDir, 'sbom.cdx.json'), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'x' }, { name: 'y' }] }));
  fs.writeFileSync(path.join(evidenceDir, 'audit.json'), JSON.stringify({ metadata: { vulnerabilities: { moderate: 1, high: 0, critical: 0 } }, vulnerabilities: { 'fast-uri': {} } }));
  const data = readGateCockpit({ workspaceRoot, evidenceDir });
  assert.equal(data.conform.ok, true);
  assert.equal(data.conform.digest, 'a'.repeat(64));
  assert.equal(data.conform.sourcesDrifted, false);
  assert.equal(data.conform.tests.pass, 10);
  assert.equal(data.supplyChain.sbom.components, 2);
  assert.equal(data.supplyChain.audit.counts.moderate, 1);
  assert.deepEqual(data.supplyChain.audit.names, ['fast-uri']);
});

test('tampered evidence sources surface as sourcesDrifted=true', () => {
  const conform = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'conform.json'), 'utf8'));
  conform.sources = [...conform.sources, { path: 'src/fake.mjs', sha256: 'b'.repeat(64) }];
  fs.writeFileSync(path.join(evidenceDir, 'conform.json'), JSON.stringify(conform));
  const data = readGateCockpit({ workspaceRoot, evidenceDir });
  assert.equal(data.conform.sourcesDrifted, true);
});

test('corrupt defect book degrades honestly', () => {
  fs.writeFileSync(path.join(workspaceRoot, 'versions', '缺陷状态簿.json'), '{bad');
  const data = readGateCockpit({ workspaceRoot, evidenceDir });
  assert.equal(data.defects.corrupt, true);
  assert.deepEqual(data.defects.redRows, []);
});