// NP3 tests: three-layer status read from the automatic journal. A journal
// containing 'l1-dual-cell' marks the current-criteria pipeline; older
// journals are labelled stale-era and are never mapped to achieved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOnboardingThreeLayer } from '../src/domains/onboarding/onboarding-state.mjs';
import { ONBOARDING_STEP_SEQUENCE } from '../src/domains/platforms/adoption-completion.mjs';

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `three-layer-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function putJournal(root, journal) {
  const path = join(root, 'workbuddy', 'runtime', 'maintenance', 'manager-onboarding', 'automatic.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(journal, null, 2));
  return 'workbuddy';
}

const L1_RESULT = { schema: 'architecture-manager-l1-check/v1', status: 'passed', cells: [{ kind: 'workflow', id: 'alpha-flow', version: '1.0.0', status: 'PASS' }, { kind: 'agent', id: 'beta-agent', version: '2.0.0', status: 'PASS' }], matrixPath: 'm.json', matrixSha256: 'a'.repeat(64), checkedAt: '2026-10-14T03:00:00.000Z' };

test('no journal yields null (nothing to read)', (t) => {
  const root = scratch(t, 'absent');
  mkdirSync(join(root, 'workbuddy'), { recursive: true });
  assert.equal(readOnboardingThreeLayer({ workspaceRoot: root, platformId: 'workbuddy' }), null);
});

// Owner ruling 2026-10-28: "complete" means every onboarding step ran through, so
// the journal that earns all three layers has to carry the whole sequence.
function completeSteps() {
  return ONBOARDING_STEP_SEQUENCE.map((step) => {
    if (step === 'l1-dual-cell') return { step, status: 'passed', result: L1_RESULT };
    if (step === 'certification') return { step, status: 'passed', result: { coverageComplete: true, checkedAt: '2026-10-14T03:05:00.000Z' } };
    if (step === 'native') return { step, status: 'auxiliary', reason: 'D-152 vendor defect; auxiliary per owner ruling' };
    return { step, status: 'passed', result: {} };
  });
}

test('a current-criteria complete journal earns all three layers', (t) => {
  const root = scratch(t, 'modern');
  putJournal(root, {
    schema: 'architecture-manager-auto/v1', platformId: 'workbuddy', status: 'complete',
    steps: completeSteps(),
    pendingSoftware: []
  });
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.equal(three.pipelineEra, 'current-criteria');
  assert.equal(three.l1.status, 'achieved');
  assert.equal(three.l1.cells.length, 2);
  assert.equal(three.l1.matrixSha256, 'a'.repeat(64));
  assert.equal(three.l2.status, 'achieved');
  assert.equal(three.l3.status, 'achieved');
});

test('a pre-criteria journal keeps readings stale-era and never earns L1', (t) => {
  const root = scratch(t, 'legacy');
  putJournal(root, {
    schema: 'architecture-manager-auto/v1', platformId: 'workbuddy', status: 'complete',
    steps: [{ step: 'certification', status: 'passed', result: { coverageComplete: true } }],
    pendingSoftware: []
  });
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.equal(three.pipelineEra, 'pre-criteria');
  assert.equal(three.l1.status, 'not-earned');
  assert.equal(three.l2.status, 'stale-era');
  assert.match(three.l2.note, /旧口径/);
  assert.equal(three.l3.status, 'stale-era');
});

test('configured-pending with unbound software shows incomplete L3', (t) => {
  const root = scratch(t, 'pending');
  putJournal(root, {
    schema: 'architecture-manager-auto/v1', platformId: 'workbuddy', status: 'configured-pending',
    steps: [{ step: 'l1-dual-cell', status: 'passed', result: L1_RESULT }],
    pendingSoftware: [{ id: 'nmap', reason: '本平台尚未绑定软件本体' }, { id: 'burp-suite', reason: '同' }]
  });
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.equal(three.pipelineEra, 'current-criteria');
  assert.equal(three.l1.status, 'achieved');
  assert.equal(three.l2.status, 'not-earned');
  assert.equal(three.l3.status, 'incomplete');
  assert.equal(three.l3.pendingSoftware, 2);
});

test('a broken journal file degrades to null instead of throwing', (t) => {
  const root = scratch(t, 'broken');
  const path = join(root, 'workbuddy', 'runtime', 'maintenance', 'manager-onboarding');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'automatic.json'), '{not json');
  assert.equal(readOnboardingThreeLayer({ workspaceRoot: root, platformId: 'workbuddy' }), null);
});
