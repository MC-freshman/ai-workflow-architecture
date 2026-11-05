// NP4 tests: version-combination probe (diagnostic semantics — failures are
// data, never thrown) and resume version-consistency (clientBinding as the
// single fingerprint mechanism; mismatch = explicit warning, never a silent
// version switch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyOnboardingConfig, buildOnboardingConfigPlan } from '../src/domains/onboarding/onboarding-config.mjs';
import { buildMatrixArgs } from '../src/domains/platforms/platform-check.mjs';
import { parseVersionTargets, previewVersionCombo, runVersionComboProbe, verifyResumeVersionConsistency } from '../src/domains/platforms/version-combo.mjs';
import { seedRuntimeReleases, seedPointer, seedRelease } from './support/resources.mjs';

const PYTHON = '<local-user-path>';

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `version-combo-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function putRegistry(root, repo, section, entries) {
  const path = join(root, repo, 'registry.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: 'ai-tool-registry/v2', version: 1, [section]: entries }, null, 2));
}

test('parseVersionTargets validates kind, id and version shapes', () => {
  assert.deepEqual(parseVersionTargets([{ kind: 'workflow', id: 'demo-flow', version: '1.2.3' }]), [{ kind: 'workflow', id: 'demo-flow', version: '1.2.3' }]);
  assert.throws(() => parseVersionTargets([]), /VERSION_TARGETS_EMPTY/);
  assert.throws(() => parseVersionTargets([{ kind: 'software', id: 'x', version: '1.0.0' }]), /VERSION_TARGET_KIND_INVALID/);
  assert.throws(() => parseVersionTargets([{ kind: 'workflow', id: 'x', version: 'latest' }]), /VERSION_TARGET_VERSION_INVALID/);
});

test('previewVersionCombo rejects unknown, disabled and duplicate targets', (t) => {
  const root = scratch(t, 'preview');
  putRegistry(root, 'tool', 'workflows', [{ id: 'demo-flow', enabled: true, invocable: true }, { id: 'off-flow', enabled: false, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'demo-agent', enabled: true }]);
  const preview = previewVersionCombo({ workspaceRoot: root, platformId: 'workbuddy', targets: [{ kind: 'workflow', id: 'demo-flow', version: '1.0.0' }, { kind: 'agent', id: 'demo-agent', version: '2.0.0' }] });
  assert.equal(preview.only, 'workflow:demo-flow,agent:demo-agent');
  assert.equal(preview.targetsArg, 'workflow:demo-flow@1.0.0,agent:demo-agent@2.0.0');
  assert.throws(() => previewVersionCombo({ workspaceRoot: root, platformId: 'workbuddy', targets: [{ kind: 'workflow', id: 'ghost', version: '1.0.0' }] }), /VERSION_TARGET_UNKNOWN:workflow:ghost/);
  assert.throws(() => previewVersionCombo({ workspaceRoot: root, platformId: 'workbuddy', targets: [{ kind: 'workflow', id: 'off-flow', version: '1.0.0' }] }), /VERSION_TARGET_UNKNOWN:workflow:off-flow/);
  assert.throws(() => previewVersionCombo({ workspaceRoot: root, platformId: 'workbuddy', targets: [{ kind: 'workflow', id: 'demo-flow', version: '1.0.0' }, { kind: 'workflow', id: 'demo-flow', version: '2.0.0' }] }), /VERSION_TARGET_DUPLICATE/);
});

function mockComboCheck(t, root, rows) {
  const matrixPath = join(root, `combo-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(matrixPath, JSON.stringify({ schema: 'ai-invocation-matrix/v1', rows }, null, 2));
  const seen = [];
  return { seen, check: async (input) => { seen.push(input); return { matrixActualPath: matrixPath, evidencePath: join(root, 'check.json') }; } };
}

const ROW = (kind, id, version, status) => ({ kind, id, version, status, claimed: true, stopped: true });

test('runVersionComboProbe reports a failing combination as data, never throws', async (t) => {
  const root = scratch(t, 'probe');
  putRegistry(root, 'tool', 'workflows', [{ id: 'demo-flow', enabled: true, invocable: true }]);
  putRegistry(root, 'agent', 'agents', [{ id: 'demo-agent', enabled: true }]);
  const targets = [{ kind: 'workflow', id: 'demo-flow', version: '1.0.0' }, { kind: 'agent', id: 'demo-agent', version: '2.0.0' }];
  const good = mockComboCheck(t, root, [ROW('workflow', 'demo-flow', '1.0.0', 'PASS'), ROW('agent', 'demo-agent', '2.0.0', 'PASS')]);
  const ok = await runVersionComboProbe({ workspaceRoot: root, platformId: 'workbuddy', targets, check: good.check });
  assert.equal(ok.verdict, 'all-pass');
  assert.equal(ok.counts.fail, 0);
  assert.deepEqual(good.seen[0].targets, targets);
  assert.equal(good.seen[0].only, 'workflow:demo-flow,agent:demo-agent');
  const bad = mockComboCheck(t, root, [ROW('workflow', 'demo-flow', '1.0.0', 'FAIL'), ROW('agent', 'demo-agent', '2.0.0', 'PASS')]);
  const partial = await runVersionComboProbe({ workspaceRoot: root, platformId: 'workbuddy', targets, check: bad.check });
  assert.equal(partial.verdict, 'partial');
  assert.equal(partial.counts.fail, 1);
  const hole = mockComboCheck(t, root, [ROW('workflow', 'demo-flow', '1.0.0', 'PASS')]);
  const incomplete = await runVersionComboProbe({ workspaceRoot: root, platformId: 'workbuddy', targets, check: hole.check });
  assert.equal(incomplete.verdict, 'incomplete');
  assert.deepEqual(incomplete.missingRows, ['agent:demo-agent']);
});

test('verifyResumeVersionConsistency matches identical pins and names divergences', (t) => {
  const root = scratch(t, 'resume');
  seedRuntimeReleases(root);
  for (const platformId of ['alpha', 'beta']) {
    applyOnboardingConfig(buildOnboardingConfigPlan({ workspaceRoot: root, platformId, confirmed: true, fields: { pythonExecutable: PYTHON } }), { auditRoot: join(root, 'audit') });
  }
  const same = verifyResumeVersionConsistency({ workspaceRoot: root, sourcePlatformId: 'alpha', targetPlatformId: 'beta' });
  assert.equal(same.consistent, true);
  assert.equal(same.warning, null);
  assert.deepEqual(same.differences, []);
  // Move beta onto a different runtime-contracts release: the fingerprint must
  // diverge and the difference must name the key instead of a bare boolean.
  seedRelease(root, 'tool', 'runtime-contracts', '9.9.9', { 'contracts/runtime/validate_contracts.py': '# divergent pin\n' });
  seedPointer(root, 'tool', 'runtime-contracts', '9.9.9');
  applyOnboardingConfig(buildOnboardingConfigPlan({ workspaceRoot: root, platformId: 'beta', confirmed: true, fields: { pythonExecutable: PYTHON } }), { auditRoot: join(root, 'audit') });
  const diverged = verifyResumeVersionConsistency({ workspaceRoot: root, sourcePlatformId: 'alpha', targetPlatformId: 'beta' });
  assert.equal(diverged.consistent, false);
  assert.ok(diverged.differences.some((row) => row.key === 'contracts'));
  assert.match(diverged.warning, /不得静默换版/);
  assert.throws(() => verifyResumeVersionConsistency({ workspaceRoot: root, sourcePlatformId: 'beta', targetPlatformId: 'beta' }), /RESUME_SAME_PLATFORM/);
});

test('buildMatrixArgs lets explicit caller targets win over declared ones', () => {
  const args = buildMatrixArgs({ configPath: 'cfg', out: 'out', matrixPath: 'out/matrix.json', matrix: 'matrix', exceptionsPath: null, selection: { kind: 'partial', selected: ['workflow:demo-flow'] }, only: 'workflow:demo-flow', targets: [{ kind: 'workflow', id: 'demo-flow', version: '9.9.9' }], platformId: 'workbuddy', workspaceRoot: 'root' });
  const index = args.indexOf('--targets');
  assert.ok(index > -1);
  assert.equal(args[index + 1], 'workflow:demo-flow@9.9.9');
});
