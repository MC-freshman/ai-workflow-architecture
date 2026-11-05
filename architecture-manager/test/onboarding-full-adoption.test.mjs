// P4 (2026-10-28): onboarding has to actually FIND everything it depends on --
// nodejs, a python + WSL isolation backend, the platform's own client body and
// the software bodies bound for this platform -- and the completion reading has
// to stay consistent between the two machine sources (verifyAutomaticOnboarding
// and readOnboardingThreeLayer). Every face is asserted on both sides: what was
// found, and why nothing was found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverManagementNode, managementNodeCandidates } from '../src/domains/platforms/management-runtime.mjs';
import { discoverOnboardingRuntime } from '../src/domains/platforms/runtime-discovery.mjs';
import { discoverNativeBodies, ownNativePath } from '../src/domains/platforms/native-profile.mjs';
import { readOnboardingThreeLayer } from '../src/domains/onboarding/onboarding-state.mjs';
import { ONBOARDING_STEP_SEQUENCE } from '../src/domains/platforms/adoption-completion.mjs';
import { buildAutomaticOnboardingPlan, verifyAutomaticOnboarding } from '../src/domains/onboarding/onboarding-auto.mjs';
import { seedRuntimeReleases } from './support/resources.mjs';

const PLATFORM = 'local-client';

function fixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), `full-adoption-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  seedRuntimeReleases(root);
  const put = (file, value) => {
    const path = join(root, file);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const [repo, key] of [['tool', 'workflows'], ['agent', 'agents'], ['software', 'software']]) put(`${repo}/registry.json`, { [key]: [] });
  for (const name of ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', 'versions/平台接入清单.md', 'versions/更新日志.md']) put(name, '# Fixture governance\n');
  put('.gitignore', '*/runtime/\ninbox/\naudit/\n');
  return { root, put };
}

function capture(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('the call was expected to throw');
}

// ---------------------------------------------------------------- nodejs face
test('node discovery really finds the host node it would later install', (t) => {
  const { root } = fixture(t, 'node');
  const outside = mkdtempSync(join(tmpdir(), 'full-adoption-node-bin-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const source = join(outside, 'node.exe');
  writeFileSync(source, 'fake');
  const found = discoverManagementNode({
    root,
    platformId: PLATFORM,
    env: { PATH: '' },
    execPath: 'C:/node-host/WorkBuddy.exe',
    resolver: () => [source],
    probe: () => ({ status: 0, stdout: 'v24.18.0' })
  });
  assert.equal(found.source, source, 'the discovered node must be reported, not assumed');
  assert.equal(found.target.toLowerCase(), join(root, PLATFORM, 'runtime/manager-node/node.exe').toLowerCase());
  assert.ok(found.attempts.some((attempt) => attempt.outcome === 'ok' && attempt.version === 'v24.18.0'));
});

test('node discovery names every reason it found nothing instead of asking for an install', (t) => {
  const { root } = fixture(t, 'node-absent');
  const missing = join(root, 'absent', 'node.exe');
  const notFound = capture(() => discoverManagementNode({
    root,
    platformId: PLATFORM,
    env: { PATH: '' },
    execPath: 'C:/node-host/WorkBuddy.exe',
    resolver: () => [missing, 'not-node.exe'],
    probe: () => ({ status: 0, stdout: 'v24.18.0' })
  }));
  assert.match(notFound.message, /^NODE_NOT_FOUND:/, 'absent candidates are a not-found, never a launch failure');
  assert.match(notFound.message, /outcomes=missing=\d/, 'the outcome breakdown travels with the error');
  // A candidate that exists but cannot launch outranks "nothing installed" (D-164).
  const broken = mkdtempSync(join(tmpdir(), 'full-adoption-node-broken-'));
  t.after(() => rmSync(broken, { recursive: true, force: true }));
  const real = join(broken, 'node.exe');
  writeFileSync(real, 'fake');
  const launchFailed = capture(() => discoverManagementNode({
    root,
    platformId: PLATFORM,
    env: { PATH: '' },
    execPath: 'C:/node-host/WorkBuddy.exe',
    resolver: () => [real],
    probe: () => ({ status: 1, stderr: 'access denied' })
  }));
  assert.match(launchFailed.message, /^NODE_SPAWN_FAILED:/);
  assert.match(launchFailed.message, /candidate=/);
});

// ------------------------------------------------------- python + WSL face
test('runtime discovery finds both a compatible host python and a usable WSL guest', async (t) => {
  const { root, put } = fixture(t, 'runtime');
  const python = mkdtempSync(join(tmpdir(), 'full-adoption-python-'));
  t.after(() => rmSync(python, { recursive: true, force: true }));
  const interpreter = join(python, 'python.exe');
  writeFileSync(interpreter, 'fake');
  put(`${PLATFORM}/bridge.json`, {
    schema: 'ai-platform-bridge/v1.1', platform: PLATFORM,
    shared: { readOnly: true }, runtimeRoot: join(root, PLATFORM, 'runtime')
  });
  const result = await discoverOnboardingRuntime(
    { workspaceRoot: root, platformId: PLATFORM, fields: { pythonExecutable: interpreter }, backendFields: { wslExecutable: 'C:/Windows/System32/wsl.exe', distro: 'Ubuntu' } },
    {
      probe: async () => ({ python: { version: [3, 10, 12] }, distributions: ['Ubuntu'], wslExecutable: 'C:/Windows/System32/wsl.exe' }),
      guestRun: async () => ({ stdout: '[3,10,12]' })
    }
  );
  assert.equal(result.pythonExecutable, interpreter);
  assert.deepEqual(result.backendFields, { wslExecutable: 'C:/Windows/System32/wsl.exe', distro: 'Ubuntu', guestInterpreter: '/usr/bin/python3' });
  assert.deepEqual(result.issues, [], 'a resolvable python and guest must not carry gaps');
});

test('runtime discovery reports both gaps in readable Chinese when neither side is usable', async (t) => {
  const { root } = fixture(t, 'runtime-absent');
  const result = await discoverOnboardingRuntime(
    { workspaceRoot: root, platformId: PLATFORM, fields: {}, backendFields: {} },
    { probe: async () => ({}), guestRun: async () => ({ stdout: 'nope' }) }
  );
  assert.equal(result.pythonExecutable, null);
  assert.equal(result.backendFields, null);
  assert.deepEqual(result.issues, [
    '需要安装 Python 3.10 或更新版本；现有解释器未达环境准备要求。',
    '需要已安装且能运行 Python 3.10 的 WSL 隔离环境；没有借用其他平台环境。'
  ], 'a missing backend must be named, never silently skipped');
});

// ------------------------------------------------------- platform body face
test('the platform body is found inside its own directory, including names with a space', (t) => {
  const { root, put } = fixture(t, 'body');
  const body = `${PLATFORM}/Qoder CN.exe`;
  put(body, 'fake body');
  const bodies = discoverNativeBodies(root, PLATFORM);
  assert.equal(bodies.length, 1, 'the CN executable has a space in its name and must still be seen');
  assert.equal(ownNativePath(root, PLATFORM, bodies[0]), fs.realpathSync(join(root, body)));
});

test('a body owned by another platform directory is refused with the owner named', (t) => {
  const { root, put } = fixture(t, 'body-foreign');
  put(`qoder/Qoder CN.exe`, 'foreign body');
  assert.throws(() => ownNativePath(root, PLATFORM, join(root, 'qoder/Qoder CN.exe')), (error) => {
    assert.match(error.message, /^NATIVE_BODY_OUTSIDE_PLATFORM:/);
    assert.match(error.message, /owner=qoder/);
    assert.match(error.message, /path=qoder\/Qoder CN\.exe/);
    return true;
  });
});

// ------------------------------------------------------------ software face
test('every enabled software either has a body bound for this platform or is listed as missing', (t) => {
  const { root, put } = fixture(t, 'software');
  const bound = mkdtempSync(join(tmpdir(), 'full-adoption-software-'));
  t.after(() => rmSync(bound, { recursive: true, force: true }));
  const executable = join(bound, 'tool.exe');
  writeFileSync(executable, 'fake');
  put('software/registry.json', {
    schema: 'ai-software-registry/v1', version: 1,
    software: [
      { id: 'bound-tool', current: 'bound-tool/current.json', enabled: true, kind: 'cli-wrapper' },
      { id: 'missing-tool', current: 'missing-tool/current.json', enabled: true, kind: 'cli-wrapper' },
      { id: 'disabled-tool', current: 'disabled-tool/current.json', enabled: false, kind: 'cli-wrapper' }
    ]
  });
  put(`${PLATFORM}/bridge/software-gateway-config.json`, {
    schema: 'ai-software-gateway-config/v1', softwareRoot: join(root, 'software'), bodies: { 'bound-tool': executable }
  });
  const registry = JSON.parse(fs.readFileSync(join(root, 'software/registry.json'), 'utf8'));
  const bodies = JSON.parse(fs.readFileSync(join(root, PLATFORM, 'bridge/software-gateway-config.json'), 'utf8')).bodies || {};
  const enabled = registry.software.filter((row) => row.enabled !== false && !row.id.startsWith('_'));
  const found = enabled.filter((row) => bodies[row.id] && fs.existsSync(bodies[row.id]));
  const pending = enabled.filter((row) => !(bodies[row.id] && fs.existsSync(bodies[row.id])));
  assert.deepEqual(found.map((row) => row.id), ['bound-tool']);
  assert.deepEqual(pending.map((row) => row.id), ['missing-tool'], 'disabled entries are excluded from both lists');
});

// --------------------------------------------------- reaching full adoption
test('a fully bound journal reads as complete in both machine sources at once', (t) => {
  const { root, put } = fixture(t, 'complete');
  const plan = buildAutomaticOnboardingPlan({
    workspaceRoot: root, platformId: PLATFORM, confirmed: true,
    deferred: ['environment', 'software', 'git'], fields: { displayName: 'Complete' }, nativeVerification: 'auxiliary'
  });
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, completeJournal(plan, {}));
  const verified = verifyAutomaticOnboarding(plan);
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(verified.architectureComplete, true);
  assert.equal(three.pipelineEra, 'current-criteria');
  assert.equal(three.l1.status, 'achieved');
  assert.equal(three.l2.status, 'achieved');
  assert.equal(three.l3.status, 'achieved');
});

test('unbound software keeps L3 incomplete: completion cannot be claimed over a gap', (t) => {
  const { root, put } = fixture(t, 'pending-software');
  const plan = buildAutomaticOnboardingPlan({
    workspaceRoot: root, platformId: PLATFORM, confirmed: true,
    deferred: ['environment', 'software', 'git'], fields: { displayName: 'Pending' }, nativeVerification: 'auxiliary'
  });
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, completeJournal(plan, {
    pendingSoftware: [{ id: 'missing-tool', reason: '本平台尚未绑定软件本体' }]
  }));
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(three.l1.status, 'achieved');
  assert.equal(three.l2.status, 'achieved');
  assert.deepEqual(three.l3, { status: 'incomplete', pendingSoftware: 1 });
});

test('D-167 (closed by the 2026-10-28 ruling): without the L1 receipt both sources now answer incomplete', (t) => {
  const { root, put } = fixture(t, 'no-l1');
  const plan = buildAutomaticOnboardingPlan({
    workspaceRoot: root, platformId: PLATFORM, confirmed: true,
    deferred: ['environment', 'software', 'git'], fields: { displayName: 'No L1' }, nativeVerification: 'auxiliary'
  });
  put(`${PLATFORM}/runtime/maintenance/manager-onboarding/automatic.json`, completeJournal(plan, { l1: false }));
  const verified = verifyAutomaticOnboarding(plan);
  const three = readOnboardingThreeLayer({ workspaceRoot: root, platformId: PLATFORM });
  // Owner ruling 2026-10-28: full adoption means every onboarding step ran
  // through, so a journal without the l1-dual-cell step is incomplete here too.
  // Both machine sources must now refuse it -- that was the D-167 contradiction.
  assert.equal(verified.architectureComplete, false, 'a missing step cannot be reported as full adoption');
  assert.equal(three.pipelineEra, 'pre-criteria');
  assert.equal(three.l1.status, 'not-earned');
});

// ---------------------------------------------------------------- helpers
function completeJournal(plan, { pendingSoftware = [], l1 = true, certification = true, omit = [] } = {}) {
  const skipped = new Set(omit);
  if (!l1) skipped.add('l1-dual-cell');
  if (!certification) skipped.add('certification');
  const steps = ONBOARDING_STEP_SEQUENCE.filter((name) => !skipped.has(name)).map((name) => {
    if (name === 'l1-dual-cell') return { step: name, status: 'passed', result: L1_RESULT };
    if (name === 'certification') return { step: name, status: 'passed', result: { coverageComplete: true, checkedAt: '2026-10-28T07:00:00.000Z' } };
    if (name === 'native') return { step: name, status: 'auxiliary', reason: 'D-152 vendor defect; auxiliary per owner ruling' };
    return { step: name, status: 'passed', result: {} };
  });
  return {
    schema: 'architecture-manager-auto/v1', platformId: PLATFORM, planId: plan.planId, lastAppliedPlanId: plan.planId,
    status: 'complete', steps, inputs: plan.target.inputs, inputsSha256: plan.target.inputsSha256,
    pending: [], auxiliary: [{ step: 'native', reason: 'D-152 vendor defect; auxiliary per owner ruling' }],
    native: { nativeVendorClientVerified: false, auxiliary: true, reason: 'D-152' }, pendingSoftware,
    finalTargets: {}, startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
  };
}

const L1_RESULT = {
  schema: 'architecture-manager-l1-check/v1', status: 'passed',
  cells: [{ kind: 'workflow', id: 'alpha-flow', version: '1.0.0', status: 'PASS' }, { kind: 'agent', id: 'beta-agent', version: '2.0.0', status: 'PASS' }],
  matrixPath: 'm.json', matrixSha256: 'a'.repeat(64), checkedAt: '2026-10-28T07:00:00.000Z'
};
