// P6b criteria: release-gate staleEvidence detects source-byte drift, not only step names.
// Uses --evidence to point at synthetic drafts; never touches the real conform evidence.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceSnapshot } from '../scripts/conform-proof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-stale-'));
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const currentSources = sourceSnapshot(ROOT);
function runGate(evidence) {
  const evidenceFile = path.join(tmp, 'evidence-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  const outFile = path.join(tmp, 'draft-' + Math.random().toString(36).slice(2) + '.json');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release-gate.mjs'), '--evidence', evidenceFile, '--out', outFile], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(fs.readFileSync(outFile, 'utf8'));
}
const baseEvidence = {
  ok: true,
  digest: 'x'.repeat(64),
  recordedAt: '2026-11-11T00:00:00.000Z',
  sourceStable: true,
  results: [{ name: 'lint' }, { name: 'preload' }, { name: 'runtime-drift' }, { name: 'governance-drift' }, { name: 'tests', tests: 1, pass: 1, fail: 0, skipped: 0, valid: true }],
  sources: currentSources
};

test('fresh evidence with matching source snapshot is not stale', () => {
  const draft = runGate(baseEvidence);
  assert.equal(draft.manager.staleEvidence, false);
  assert.equal(draft.manager.sourcesDrifted, false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(draft.version, pkg.version, 'N6: draft version derives from package.json');
});

test('source-byte drift with governance-drift step present is stale (ledger limitation fixed)', () => {
  const drifted = JSON.parse(JSON.stringify(baseEvidence));
  drifted.sources = [...drifted.sources, { path: 'src/fake.mjs', sha256: 'y'.repeat(64) }];
  const draft = runGate(drifted);
  assert.equal(draft.manager.staleEvidence, true);
  assert.equal(draft.manager.sourcesDrifted, true);
  assert.match(draft.manager.note, /源快照/);
});

test('missing governance-drift step remains stale (legacy criterion preserved)', () => {
  const legacy = JSON.parse(JSON.stringify(baseEvidence));
  legacy.results = legacy.results.filter((r) => r.name !== 'governance-drift');
  const draft = runGate(legacy);
  assert.equal(draft.manager.staleEvidence, true);
  assert.match(draft.manager.note, /governance-drift/);
});

test('evidence without sources array degrades honestly (sourcesDrifted null)', () => {
  const noSources = JSON.parse(JSON.stringify(baseEvidence));
  delete noSources.sources;
  const draft = runGate(noSources);
  assert.equal(draft.manager.sourcesDrifted, null);
  assert.equal(draft.manager.staleEvidence, false);
});