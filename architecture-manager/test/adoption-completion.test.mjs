// Owner ruling 2026-10-28: 完全接入 = 能够流畅跑通架构管理（入驻）的所有步骤。
// These tests pin that definition as the single machine answer, so no module can
// go back to spelling `architectureComplete` with its own formula (D-167, D-168,
// D-169: five competing formulas answered differently on the same journal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ONBOARDING_STEP_SEQUENCE, COMPLETION_TOLERATED_STEP_STATUSES, readAdoptionCompletion } from '../src/domains/platforms/adoption-completion.mjs';
import { buildAutomaticOnboardingPlan, verifyAutomaticOnboarding } from '../src/domains/onboarding/onboarding-auto.mjs';
import { readOnboardingThreeLayer } from '../src/domains/onboarding/onboarding-state.mjs';
import { seedRuntimeReleases } from './support/resources.mjs';

const PLATFORM = 'ruling-client';

function fixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), `adoption-completion-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seedRuntimeReleases(root);
  const put = (file, value) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const [repo, key] of [['tool', 'workflows'], ['agent', 'agents'], ['software', 'software']]) put(`${repo}/registry.json`, { [key]: [] });
  for (const name of ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', 'versions/平台接入清单.md', 'versions/更新日志.md']) put(name, '# Fixture governance\n');
  put('.gitignore', '*/runtime/\ninbox/\naudit/\n');
  return { root, put };
}

function journal(root, plan, { omit = [], nativeStatus = 'auxiliary', status = 'complete', pendingSoftware = [] } = {}) {
  const skipped = new Set(omit);
  const steps = ONBOARDING_STEP_SEQUENCE.filter((name) => !skipped.has(name)).map((name) => {
    if (name === 'l1-dual-cell') return { step: name, status: 'passed', result: { schema: 'architecture-manager-l1-check/v1', status: 'passed', cells: [{ kind: 'workflow', id: 'alpha-flow', version: '1.0.0', status: 'PASS' }, { kind: 'agent', id: 'beta-agent', version: '2.0.0', status: 'PASS' }], matrixPath: 'm.json', matrixSha256: 'a'.repeat(64), checkedAt: '2026-10-28T07:00:00.000Z' } };
    if (name === 'certification') return { step: name, status: 'passed', result: { coverageComplete: true, checkedAt: '2026-10-28T07:00:00.000Z' } };
    if (name === 'native') return { step: name, status: nativeStatus, reason: nativeStatus === 'auxiliary' ? 'D-152 vendor defect; auxiliary per owner ruling' : 'not verified' };
    return { step: name, status: 'passed', result: {} };
  });
  return {
    schema: 'architecture-manager-auto/v1', platformId: PLATFORM, planId: plan.planId, lastAppliedPlanId: plan.planId,
    status, steps, inputs: plan.target.inputs, inputsSha256: plan.target.inputsSha256,
    pending: nativeStatus === 'pending' ? [{ step: 'native', reason: 'not verified' }] : [],
    auxiliary: nativeStatus === 'auxiliary' ? [{ step: 'native', reason: 'D-152 vendor defect; auxiliary per owner ruling' }] : [],
    native: { nativeVendorClientVerified: false, ...(nativeStatus === 'auxiliary' ? { auxiliary: true } : {}) },
    pendingSoftware, finalTargets: {}, startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
  };
}

function plan(root) {
  return buildAutomaticOnboardingPlan({
    workspaceRoot: root, platformId: PLATFORM, confirmed: true,
    deferred: ['environment', 'software', 'git'], fields: { displayName: 'Ruling' }, nativeVerification: 'auxiliary'
  });
}

test('the step sequence is the one the onboarding run actually walks', () => {
  assert.deepEqual(ONBOARDING_STEP_SEQUENCE, ['configuration', 'backend', 'environment', 'providers', 'client', 'capabilities', 'l1-dual-cell', 'native', 'certification', 'governance', 'git']);
  assert.deepEqual(COMPLETION_TOLERATED_STEP_STATUSES, ['passed', 'auxiliary']);
});

test('every step run through with auxiliary native is full adoption', (t) => {
  const { root, put } = fixture(t, 'all-steps');
  const built = plan(root);
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built));
  const completion = readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(completion.complete, true, 'full adoption = every onboarding step ran through');
  assert.deepEqual(completion.missingSteps, []);
  assert.deepEqual(completion.blockedSteps, []);
  assert.equal(completion.pipelineEra, 'current-criteria');
  assert.equal(verifyAutomaticOnboarding(built).architectureComplete, true);
});

test('a journal that never walked the current sequence is not silently mapped to complete', (t) => {
  const { root, put } = fixture(t, 'early-journal');
  const built = plan(root);
  // Pre-criteria journal: only the steps the older pipeline recorded.
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, {
    ...journal(root, built), steps: [{ step: 'configuration', status: 'passed', result: {} }, { step: 'native', status: 'auxiliary', reason: 'D-152' }]
  });
  const completion = readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(completion.complete, false, 'owner ruling 2026-10-28: early journals are re-earned, never migrated');
  assert.equal(completion.pipelineEra, 'pre-criteria');
  assert.ok(completion.missingSteps.includes('l1-dual-cell'));
  assert.equal(completion.missingSteps.length, 9);
  assert.equal(verifyAutomaticOnboarding(built).architectureComplete, false);
});

test('one step that did not run through blocks full adoption and names the reason', (t) => {
  const { root, put } = fixture(t, 'blocked-step');
  const built = plan(root);
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built, { nativeStatus: 'pending' }));
  const completion = readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(completion.complete, false, 'auxiliary does not gate, but a step that did not run through does');
  assert.deepEqual(completion.blockedSteps, [{ step: 'native', status: 'pending', reason: 'not verified' }]);
  assert.equal(verifyAutomaticOnboarding(built).architectureComplete, false);
});

test('a deferred step is missing, not passed, and a non-complete journal is never complete', (t) => {
  const { root, put } = fixture(t, 'deferred');
  const built = plan(root);
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built, { omit: ['governance'] }));
  assert.equal(readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM }).complete, false);
  assert.deepEqual(readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM }).missingSteps, ['governance']);
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built, { status: 'configured-pending', pendingSoftware: [{ id: 'missing-tool', reason: '本平台尚未绑定软件本体' }] }));
  const pending = readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(pending.complete, false);
  assert.equal(pending.journalStatus, 'configured-pending');
  assert.equal(pending.pendingSoftware, 1, 'the gap stays visible instead of being rounded away');
});

test('no journal means not complete, and the missing steps are all of them', (t) => {
  const { root } = fixture(t, 'empty');
  const completion = readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(completion.complete, false);
  assert.equal(completion.journalStatus, null);
  assert.equal(completion.reason, 'no onboarding journal');
  assert.equal(completion.missingSteps.length, ONBOARDING_STEP_SEQUENCE.length);
  assert.equal(existsSync(join(root, PLATFORM, 'runtime/maintenance/manager-onboarding/automatic.json')), false);
});

test('the three-layer L3 reading and the completion reading never disagree', (t) => {
  const { root, put } = fixture(t, 'layer-agreement');
  const built = plan(root);
  const read = () => ({ three: readOnboardingThreeLayer({ workspaceRoot: root, platformId: PLATFORM }), completion: readAdoptionCompletion({ workspaceRoot: root, platformId: PLATFORM }) });
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built));
  const full = read();
  assert.equal(full.completion.complete, true);
  assert.equal(full.three.l3.status, 'achieved');
  // A journal marked complete while a step never ran must not show L1/L2/L3 green
  // and completion red at the same time -- that was the D-167 shape.
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, journal(root, built, { omit: ['governance'] }));
  const holed = read();
  assert.equal(holed.completion.complete, false);
  assert.notEqual(holed.three.l3.status, 'achieved', 'L3 must not be achieved over a journal that skipped a step');
});
