import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectRunDirectory, listPlatformRuns, listRunLedger } from '../src/runs.mjs';

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'am-runs-'));
  const runsRoot = join(root, 'zcode', 'runtime', 'runs');
  mkdirSync(runsRoot, { recursive: true });
  return { root, runsRoot };
}

function writeRun(runsRoot, name, lock) {
  const dir = join(runsRoot, name);
  mkdirSync(dir, { recursive: true });
  if (lock !== undefined) writeFileSync(join(dir, 'run-lock.json'), JSON.stringify(lock));
  return dir;
}

function snapshot(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      out.push(path + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) walk(path);
    }
  })(dir);
  return out.sort();
}

const V11_LOCK = {
  canonicalization: 'sha256-cjson-safe-v1',
  createdAt: '2026-09-19T02:29:06.374702+00:00',
  execution: { maxParallel: 1, resume: false, stages: [{ action: 'script', dependsOn: [], id: 'inspect', requiredGates: [] }] },
  parentRunId: null,
  platform: 'zcode',
  recordType: 'execution',
  resources: [
    { key: 'workflow:repo-lint', id: 'repo-lint', kind: 'workflow', version: '0.3.0', resolvedFrom: { kind: 'explicit' } },
    { key: 'runner:wf-runner', id: 'wf-runner', kind: 'runner', version: '0.7.7', resolvedFrom: { kind: 'explicit' } }
  ],
  runId: 'v6p77d',
  runRoot: 'X:\\zcode\\runtime\\runs\\v6p77d',
  schemaVersion: 'ai-run-lock/v1.1',
  selection: { agent: null, environment: ['interpreter:python'], runner: 'runner:wf-runner', workflow: 'workflow:repo-lint' }
};

const V13_LOCK = {
  schemaVersion: 'ai-run-lock/v1.3',
  createdAt: '2026-09-27T10:00:00+00:00',
  platform: 'zcode',
  runId: 'v13run',
  execution: { rigor: 'delivery', gated: true, frozen: false, stages: [{ id: 'a' }, { id: 'b' }] },
  resources: [{ key: 'workflow:repo-lint', id: 'repo-lint', kind: 'workflow', version: '0.6.3', resolvedFrom: { kind: 'platform-default' } }],
  selection: { agent: null, workflow: 'workflow:repo-lint', runner: 'runner:wf-runner' }
};

test('summarizes a v1.1 lock without inventing fields the generation lacks', () => {
  const { root, runsRoot } = makeWorkspace();
  const dir = writeRun(runsRoot, 'v6p77d', V11_LOCK);
  const summary = inspectRunDirectory(dir);
  assert.equal(summary.lockStatus, 'ok');
  assert.equal(summary.schemaVersion, 'ai-run-lock/v1.1');
  assert.equal(summary.selection.workflow, 'workflow:repo-lint');
  assert.equal(summary.selection.agent, null);
  assert.equal(summary.resourceCount, 2);
  assert.equal(summary.resources[0].resolvedFrom, 'explicit');
  assert.equal(summary.execution.stageCount, 1);
  assert.equal(summary.execution.rigor, null);
  rmSync(root, { recursive: true, force: true });
});

test('summarizes a v1.3 lock with rigor fields', () => {
  const { root, runsRoot } = makeWorkspace();
  const dir = writeRun(runsRoot, 'v13run', V13_LOCK);
  const summary = inspectRunDirectory(dir);
  assert.equal(summary.lockStatus, 'ok');
  assert.equal(summary.schemaVersion, 'ai-run-lock/v1.3');
  assert.equal(summary.execution.rigor, 'delivery');
  assert.equal(summary.execution.gated, true);
  assert.equal(summary.execution.frozen, false);
  assert.equal(summary.execution.stageCount, 2);
  rmSync(root, { recursive: true, force: true });
});

test('classifies missing, corrupt and unknown-schema locks instead of guessing', () => {
  const { root, runsRoot } = makeWorkspace();
  assert.equal(inspectRunDirectory(writeRun(runsRoot, 'no-lock')).lockStatus, 'missing');
  const corruptDir = writeRun(runsRoot, 'corrupt');
  writeFileSync(join(corruptDir, 'run-lock.json'), '{not json');
  assert.equal(inspectRunDirectory(corruptDir).lockStatus, 'corrupt');
  const futureDir = writeRun(runsRoot, 'future', { ...V13_LOCK, schemaVersion: 'ai-run-lock/v2.0' });
  const future = inspectRunDirectory(futureDir);
  assert.equal(future.lockStatus, 'unknown-schema');
  assert.equal(future.schemaVersion, 'ai-run-lock/v2.0');
  rmSync(root, { recursive: true, force: true });
});

test('lists platform runs read-only and skips non-directories', () => {
  const { root, runsRoot } = makeWorkspace();
  writeRun(runsRoot, 'run-a', V11_LOCK);
  writeRun(runsRoot, 'run-b', V13_LOCK);
  writeRun(runsRoot, 'run-c');
  writeFileSync(join(runsRoot, 'stray.txt'), 'not a run');
  const before = snapshot(runsRoot);
  const listing = listPlatformRuns(root, 'zcode');
  assert.equal(listing.runsRootPresent, true);
  assert.equal(listing.total, 3);
  assert.deepEqual(listing.runs.map((run) => run.lockStatus).sort(), ['missing', 'ok', 'ok']);
  assert.deepEqual(snapshot(runsRoot), before);
  rmSync(root, { recursive: true, force: true });
});

test('lists the ledger across all six platforms with totals', () => {
  const { root, runsRoot } = makeWorkspace();
  writeRun(runsRoot, 'run-a', V11_LOCK);
  writeRun(runsRoot, 'run-b', V13_LOCK);
  writeRun(runsRoot, 'run-c');
  const qoderRuns = join(root, 'qoder', 'runtime', 'runs');
  mkdirSync(qoderRuns, { recursive: true });
  writeRun(qoderRuns, 'q-run', V13_LOCK);
  const ledger = listRunLedger(root);
  assert.equal(ledger.platforms.length, 6);
  assert.equal(ledger.totals.zcode, 3);
  assert.equal(ledger.totals.qoder, 1);
  assert.equal(ledger.totals.codex, 0);
  assert.equal(ledger.totalRuns, 4);
  rmSync(root, { recursive: true, force: true });
});
