// P4 contract tests: the self-written pilot replacement (pilot/runs-alt*.mjs) must produce
// verbatim-identical output to the runs domain on shared fixtures before it may be activated
// via module-overrides.json. See docs/module-replacement.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRunLedger, summarizeRunLock, inspectRunDirectory, listPlatformRuns } from '../src/domains/runs/runs.mjs';
import { listRunLedgerAlt, summarizeRunLockAlt, inspectRunDirectoryAlt, listPlatformRunsAlt } from '../src/renderer/features/workspace/pilot/runs-alt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-runs-contract-'));
after(() => { fs.rmSync(fixture, { recursive: true, force: true }); });

const lockV13 = {
  schemaVersion: 'ai-run-lock/v1.3',
  platform: 'qoder',
  runId: '20261111-contract-1',
  createdAt: '2026-11-11T00:00:00.000Z',
  selection: { agent: null, workflow: 'expert-task', runner: 'wf-runner' },
  execution: { rigor: 'balanced', gated: true, frozen: false, stages: [{ id: 'intake' }, { id: 'plan' }] },
  resources: [
    { kind: 'workflow', id: 'expert-task', version: '1.4.0', resolvedFrom: { kind: 'tool-lock' } },
    { kind: 'skill', id: 'demo', version: '1.0.0' }
  ]
};
const lockV12 = { schemaVersion: 'ai-run-lock/v1.2', platform: 'qoder', runId: 'r2', selection: {}, execution: { stages: [] }, resources: [] };

const runsRoot = path.join(fixture, 'qoder', 'runtime', 'runs');
fs.mkdirSync(path.join(runsRoot, 'run-ok'), { recursive: true });
fs.writeFileSync(path.join(runsRoot, 'run-ok', 'run-lock.json'), JSON.stringify(lockV13));
fs.mkdirSync(path.join(runsRoot, 'run-v12'), { recursive: true });
fs.writeFileSync(path.join(runsRoot, 'run-v12', 'run-lock.json'), JSON.stringify(lockV12));
fs.mkdirSync(path.join(runsRoot, 'run-corrupt'), { recursive: true });
fs.writeFileSync(path.join(runsRoot, 'run-corrupt', 'run-lock.json'), '{not json');
fs.mkdirSync(path.join(runsRoot, 'run-nolock'), { recursive: true });

test('pilot replacement is independent of the runs domain source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/features/workspace/pilot/runs-alt.mjs'), 'utf8');
  assert.ok(!/from\s+'[^']*domains\/runs/.test(src), 'pilot must not import the domain it replaces');
  const core = fs.readFileSync(path.join(ROOT, 'src/renderer/features/workspace/pilot/runs-alt-core.mjs'), 'utf8');
  assert.ok(!/node:/.test(core), 'renderer-safe core must not import node builtins');
});

test('summarizeRunLock contract: identical output across lock shapes', () => {
  const shapes = [lockV13, lockV12, { schemaVersion: 'ai-run-lock/v2.0' }, { schemaVersion: '' }, null, undefined, {}, { schemaVersion: 'ai-run-lock/v1.9', resources: 'bad', execution: null, selection: null }];
  for (const shape of shapes) {
    assert.deepEqual(summarizeRunLockAlt(shape), summarizeRunLock(shape), 'shape: ' + JSON.stringify(shape));
  }
});

test('inspectRunDirectory contract: ok / v1.2 / corrupt / missing', () => {
  for (const name of ['run-ok', 'run-v12', 'run-corrupt', 'run-nolock']) {
    const dir = path.join(runsRoot, name);
    assert.deepEqual(inspectRunDirectoryAlt(dir), inspectRunDirectory(dir), name);
  }
});

test('listPlatformRuns and listRunLedger contract: verbatim equality on fixture workspace', () => {
  assert.deepEqual(listPlatformRunsAlt(fixture, 'qoder'), listPlatformRuns(fixture, 'qoder'));
  assert.deepEqual(listPlatformRunsAlt(fixture, 'codex'), listPlatformRuns(fixture, 'codex'));
  assert.deepEqual(listRunLedgerAlt(fixture), listRunLedger(fixture));
  const ledger = listRunLedgerAlt(fixture);
  assert.equal(ledger.totalRuns, 4);
  assert.equal(ledger.totals.qoder, 4);
});

test('replacement activation is declarative and default-off', () => {
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-overrides.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-registry.json'), 'utf8'));
  const runs = registry.modules.find((m) => m.id === 'panel-runs');
  assert.equal(runs.enabled, true, 'pilot must not detach runs by default');
  assert.equal(runs.replacement, null, 'pilot must not replace runs by default');
  assert.deepEqual(overrides.overrides, {}, 'committed overrides must be empty (demo states are temporary)');
});