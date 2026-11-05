// NP2 tests: L1 dual-cell criterion. Selection is deterministic; the verdict
// reads the real matrix rows (workflow+agent, both PASS, claimed+stopped);
// deferral propagation includes l1-dual-cell under environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectL1Cells, runL1DualCell } from '../src/domains/onboarding/onboarding-l1.mjs';
import { DEFAULT_CHECK_SCOPE } from '../src/domains/platforms/platform-check.mjs';
import { onboardingDeferrals } from '../src/domains/platforms/onboarding-resume.mjs';

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `l1-dual-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function putRegistry(root, repo, section, entries) {
  const path = join(root, repo, 'registry.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: 'ai-tool-registry/v2', version: 1, [section]: entries }, null, 2));
}

test('selectL1Cells picks the lexicographically first enabled invocable entries', (t) => {
  const root = scratch(t, 'pick');
  putRegistry(root, 'tool', 'workflows', [
    { id: 'zeta-flow', current: 'zeta-flow/current.json', enabled: true, invocable: true },
    { id: 'disabled-flow', enabled: false, invocable: true },
    { id: 'repo-lint', enabled: true, invocable: true },
    { id: 'alpha-flow', enabled: true, invocable: true }
  ]);
  putRegistry(root, 'agent', 'agents', [
    { id: 'zeta-agent', current: 'zeta-agent/current.json', enabled: true },
    { id: 'off-agent', enabled: false },
    { id: 'beta-agent', enabled: true }
  ]);
  const cells = selectL1Cells({ workspaceRoot: root });
  assert.deepEqual(cells, { workflow: 'alpha-flow', agent: 'beta-agent' });
});

test('selectL1Cells fails closed when no cell is available', (t) => {
  const root = scratch(t, 'empty');
  putRegistry(root, 'tool', 'workflows', [{ id: 'only-flow', enabled: false, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'only-agent', enabled: true }]);
  assert.throws(() => selectL1Cells({ workspaceRoot: root }), /L1_CELL_UNAVAILABLE:workflow/);
});

function mockCheck(t, root, rows) {
  const matrixPath = join(root, `matrix-${rows.length}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(matrixPath, JSON.stringify({ schema: 'ai-invocation-matrix/v1', rows }, null, 2));
  const seen = [];
  const check = async (input) => { seen.push(input); return { matrixActualPath: matrixPath, evidencePath: join(root, 'check.json'), counts: { pass: rows.length } }; };
  return { check, seen };
}

const PASS_ROWS = (workflow, agent) => ([
  { kind: 'workflow', id: workflow, version: '1.0.0', status: 'PASS', claimed: true, stopped: true },
  { kind: 'agent', id: agent, version: '2.0.0', status: 'PASS', claimed: true, stopped: true }
]);

test('runL1DualCell passes a genuine dual-cell matrix and records evidence hashes', (t) => {
  const root = scratch(t, 'pass');
  putRegistry(root, 'tool', 'workflows', [{ id: 'alpha-flow', enabled: true, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'beta-agent', enabled: true }]);
  const { check, seen } = mockCheck(t, root, PASS_ROWS('alpha-flow', 'beta-agent'));
  const result = runL1DualCell({ workspaceRoot: root, platformId: 'workbuddy', check });
  return Promise.resolve(result).then((r) => {
    assert.equal(r.status, 'passed');
    assert.deepEqual(r.cells.map((cell) => cell.kind), ['workflow', 'agent']);
    assert.deepEqual(r.cells.map((cell) => cell.status), ['PASS', 'PASS']);
    assert.equal(r.counts.pass, 2);
    assert.ok(r.matrixSha256 && r.matrixPath);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].only, 'workflow:alpha-flow,agent:beta-agent');
  });
});

test('runL1DualCell refuses FAIL rows, missing agents, and unclaimed cells', async (t) => {
  const root = scratch(t, 'fail');
  putRegistry(root, 'tool', 'workflows', [{ id: 'alpha-flow', enabled: true, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'beta-agent', enabled: true }]);
  const broken = [
    PASS_ROWS('alpha-flow', 'beta-agent').map((row) => ({ ...row, status: 'FAIL' })),
    [{ kind: 'workflow', id: 'alpha-flow', version: '1.0.0', status: 'PASS', claimed: true, stopped: true }],
    PASS_ROWS('alpha-flow', 'beta-agent').map((row) => ({ ...row, claimed: false }))
  ];
  for (const rows of broken) {
    const { check } = mockCheck(t, root, rows);
    await assert.rejects(runL1DualCell({ workspaceRoot: root, platformId: 'workbuddy', check }), /L1_DUAL_CELL_NOT_PASSED/);
  }
});

test('environment deferral propagates to l1-dual-cell', () => {
  const reasons = onboardingDeferrals(['environment']);
  assert.match(reasons['l1-dual-cell'], /运行环境/);
  const untouched = onboardingDeferrals(['software']);
  assert.equal(untouched['l1-dual-cell'], undefined);
});

// ---- D-156 regression guard ----
// The L1 criterion has to describe the two cells it selected, not the whole report.
// Once a platform owns a baseline, the incremental selection drags every drifted cell
// into the same run, so `rows.length === 2` refused every gateway-bound platform after
// any software drift: qoder 2026-10-14T11-18-13-391Z ran 2 + 6 rows that all passed and
// still threw L1_DUAL_CELL_NOT_PASSED. The stub below answers through the genuine
// snapshot/selection/merge machinery and keeps runPlatformCheck's own scope default;
// only the matrix output is synthetic, because the runner itself needs a child process.
import { certificationFixture } from './support/certification.mjs';
import { seedRelease, seedPointer } from './support/resources.mjs';
import { certificationSnapshot } from '../src/domains/certification/fingerprints.mjs';
import { certificationSelection } from '../src/domains/certification/selection.mjs';
function l1CheckStub(f, { failCell = null } = {}) {
  return async (input) => {
    const scope = input.scope ?? 'full';
    const snapshot = certificationSnapshot(f.root, f.id, f.config, { scope });
    const selection = certificationSelection(f.root, f.id, snapshot, { mode: input.mode, only: input.only });
    const rows = selection.selected.map((key) => {
      const row = f.positive(snapshot.cells[key]);
      return key === failCell ? { ...row, status: 'FAIL' } : row;
    });
    const published = f.publish(selection, snapshot, rows);
    return { matrixActualPath: published.actual, evidencePath: join(published.directory, 'check.json'), counts: { rows: rows.length, pass: rows.filter((row) => row.status === 'PASS').length, fail: rows.filter((row) => row.status === 'FAIL').length } };
  };
}
function driftedFixture(t) {
  const f = certificationFixture(t);
  // A third invocable cell placed after expert-task lexicographically: it can drift
  // without ever belonging to the selected pair.
  seedRelease(f.root, 'tool', 'new-flow', '1.0.0'); seedPointer(f.root, 'tool', 'new-flow', '1.0.0');
  f.registries.tool.workflows.push({ id: 'new-flow', enabled: true, current: 'new-flow/current.json' });
  f.put('tool/registry.json', f.registries.tool);
  f.baseline();
  return f;
}
function seedInvocationCoverage(f) {
  const snapshot = certificationSnapshot(f.root, f.id, f.config, { scope: 'invocation' });
  f.publish(certificationSelection(f.root, f.id, snapshot, { mode: 'full' }), snapshot);
}
test('D-156: full scope pulls a drifted software cell into the L1 selection, invocation scope does not', (t) => {
  const f = certificationFixture(t); f.baseline();
  f.put(`${f.id}/bridge/gateway.json`, { bodies: { 'demo-cli': 'absent body' }, launchProvider: ['provider-two'] });
  const cells = selectL1Cells({ workspaceRoot: f.root }), only = `workflow:${cells.workflow},agent:${cells.agent}`;
  const full = certificationSelection(f.root, f.id, certificationSnapshot(f.root, f.id, f.config), { mode: 'quick', only });
  assert.deepEqual([...full.selected].sort(), ['agent:profile-task', 'software:demo-cli', 'workflow:expert-task']);
  const invocation = certificationSelection(f.root, f.id, certificationSnapshot(f.root, f.id, f.config, { scope: 'invocation' }), { mode: 'quick', only });
  assert.deepEqual([...invocation.selected].sort(), ['agent:profile-task', 'workflow:expert-task']);
});
test('D-156: L1 earns its receipt after the software gateway drifts', async (t) => {
  const f = certificationFixture(t); f.baseline();
  f.put(`${f.id}/bridge/gateway.json`, { bodies: { 'demo-cli': 'absent body' }, launchProvider: ['provider-two'] });
  const result = await runL1DualCell({ workspaceRoot: f.root, platformId: f.id, check: l1CheckStub(f) });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.cells.map((cell) => `${cell.kind}:${cell.id}`), ['workflow:expert-task', 'agent:profile-task']);
  assert.equal(result.counts.fail, 0);
});
test('D-156: rows for cells outside the selected pair no longer invalidate the receipt', async (t) => {
  const f = driftedFixture(t); seedInvocationCoverage(f);
  seedRelease(f.root, 'tool', 'new-flow', '1.1.0'); seedPointer(f.root, 'tool', 'new-flow', '1.1.0');
  const result = await runL1DualCell({ workspaceRoot: f.root, platformId: f.id, check: l1CheckStub(f) });
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.rows, 3);
  assert.deepEqual(result.extraRows.map((row) => `${row.kind}:${row.id}`), ['workflow:new-flow']);
});
test('D-156: a failing row anywhere keeps the receipt refused', async (t) => {
  const f = driftedFixture(t); seedInvocationCoverage(f);
  seedRelease(f.root, 'tool', 'new-flow', '1.1.0'); seedPointer(f.root, 'tool', 'new-flow', '1.1.0');
  await assert.rejects(runL1DualCell({ workspaceRoot: f.root, platformId: f.id, check: l1CheckStub(f, { failCell: 'workflow:new-flow' }) }), /L1_DUAL_CELL_NOT_PASSED/);
});

// P3 guard rail (root cause of D-156): the L1 verdict reads a strictly two-cell
// result, so it must NOT inherit the platform-check default scope -- a
// full-scope report carries the software cells as well. Both halves are pinned
// here: the default itself, and L1's deliberate deviation from it.
test('L1 judges in the invocation scope, not the platform-check default scope', (t) => {
  const root = scratch(t, 'scope');
  putRegistry(root, 'tool', 'workflows', [{ id: 'alpha-flow', enabled: true, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'beta-agent', enabled: true }]);
  assert.equal(DEFAULT_CHECK_SCOPE, 'full', 'the default scope changed -- re-read this guard before adjusting it');
  const { check, seen } = mockCheck(t, root, PASS_ROWS('alpha-flow', 'beta-agent'));
  return Promise.resolve(runL1DualCell({ workspaceRoot: root, platformId: 'workbuddy', check })).then(() => {
    assert.equal(seen.length, 1);
    assert.equal(seen[0].scope, 'invocation', 'L1 must not inherit the full-scope default (D-156)');
  });
});
