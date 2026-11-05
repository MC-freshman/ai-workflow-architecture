// NP1 tests: entry-skill rendering + client-plan integration. Rendering is
// deterministic; slots that already hold a file are never overwritten
// (kept-identical / kept-divergent); slot-less clients are unplaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { renderEntrySkills, collectEntrySkillFiles, entrySkillSlots } from '../src/domains/onboarding/onboarding-entry-skills.mjs';
import { buildOnboardingConfigPlan, applyOnboardingConfig } from '../src/domains/onboarding/onboarding-config.mjs';
import { buildOnboardingClientPlan } from '../src/domains/onboarding/onboarding-client.mjs';
import { seedRuntimeReleases } from './support/resources.mjs';

const PYTHON = '<local-user-path>';

// managementRuntimePlan validates the host node through spawnSync. Inside the
// WorkBuddy agent process tree every spawnSync is EBUSY (environment fact
// recorded 2026-10-10/14), so these two cases can only pass authoritatively in
// a real terminal. D-164 replaced the single MANAGEMENT_NODE_REQUIRED code with
// three named ones, so the skip guard has to follow the current names or it
// silently loses the ability to skip.
const NODE_DISCOVERY_CODES = ['NODE_SPAWN_FAILED', 'NODE_VERSION_UNSUPPORTED', 'NODE_NOT_FOUND'];
function isHostNodeDiscoveryFailure(error) {
  return NODE_DISCOVERY_CODES.some((code) => error.message === code || error.message.startsWith(`${code}:`));
}

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `entry-skills-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function putConfig(root, platformId, file, config) {
  const path = join(root, platformId, 'bridge', file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

test('renderEntrySkills fills every placeholder from on-disk config', (t) => {
  const root = scratch(t, 'render');
  putConfig(root, 'workbuddy', 'workbuddy-config.json', { interpreters: { '.py': PYTHON } });
  writeFileSync(join(root, 'workbuddy', 'bridge', 'invocation-manual.md'), 'manual\n');
  const rendered = renderEntrySkills({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.equal(rendered.entries.length, 2);
  for (const entry of rendered.entries) {
    assert.equal(entry.kind, 'skill');
    assert.equal(entry.targetRel, `.workbuddy/skills/${entry.skill}/SKILL.md`);
    assert.equal(entry.existingSha256, null);
    assert.deepEqual(entry.issues, []);
    assert.ok(!entry.content.includes('{{'), `residual placeholder in ${entry.skill}`);
    // The wf template carries {{PYTHON_EXE}}; wfa delegates to "same as /wf" by
    // design, so only its own placeholders (CONFIG_PATH) must be resolved.
    if (entry.skill === 'wf') assert.ok(entry.content.includes(PYTHON), 'python missing in wf');
    else assert.ok(entry.content.includes(join(root, 'workbuddy', 'bridge', 'workbuddy-config.json')), 'config path missing in wfa');
  }
});

test('collectEntrySkillFiles keeps existing slot files and reports divergence honestly', (t) => {
  const root = scratch(t, 'keep');
  putConfig(root, 'workbuddy', 'workbuddy-config.json', { interpreters: { '.py': PYTHON } });
  const first = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.equal(first.files.length, 2);
  assert.deepEqual(first.summary.keptIdentical, []);
  assert.deepEqual(first.summary.keptDivergent, []);
  // Simulate a platform-specific text: lay one file with different content.
  const wfaPath = join(root, '.workbuddy', 'skills', 'wfa', 'SKILL.md');
  mkdirSync(dirname(wfaPath), { recursive: true });
  writeFileSync(wfaPath, 'platform-specific wfa body');
  const second = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.deepEqual(second.summary.keptDivergent, ['.workbuddy/skills/wfa/SKILL.md']);
  assert.ok(!second.files.some((file) => file.path === '.workbuddy/skills/wfa/SKILL.md'));
  assert.equal(second.summary.files.length, 1);
  // Identical bytes are kept-identical, not rewritten.
  mkdirSync(join(root, '.workbuddy', 'skills', 'wf'), { recursive: true });
  writeFileSync(join(root, '.workbuddy', 'skills', 'wf', 'SKILL.md'), second.files[0].content);
  const third = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'workbuddy' });
  assert.deepEqual(third.summary.keptIdentical, ['.workbuddy/skills/wf/SKILL.md']);
  assert.ok(!third.files.some((file) => file.path === '.workbuddy/skills/wf/SKILL.md'));
});

test('slot-less clients export rendered files for manual pickup; zcode renders command form without the name line', (t) => {
  const rootDoubao = scratch(t, 'doubao');
  putConfig(rootDoubao, 'doubao', 'doubao-config.json', { interpreters: { '.py': PYTHON } });
  const doubao = collectEntrySkillFiles({ workspaceRoot: rootDoubao, platformId: 'doubao' });
  // Owner ruling 2026-10-14: no local slot still means the bytes are generated
  // (into the platform's own runtime staging area), never a silent gap.
  assert.deepEqual(doubao.summary.exported, [
    'doubao/runtime/entry-skills-export/wf/SKILL.md',
    'doubao/runtime/entry-skills-export/wfa/SKILL.md'
  ]);
  // D-162: `files` is wider than `exported` now — the same bytes also leave as a plugin package.
  assert.ok(doubao.summary.exported.every((path) => doubao.summary.files.includes(path)));
  assert.ok(doubao.summary.pluginPackage, 'a slot-less client also gets a plugin package');
  assert.equal(doubao.summary.unplaced.length, 2);
  for (const row of doubao.summary.unplaced) {
    assert.equal(row.reason, 'NO_LOCAL_COMMAND_SLOT');
    assert.ok(row.exportRel && doubao.summary.exported.includes(row.exportRel), 'unplaced row must point at its export file');
  }
  for (const file of doubao.files) assert.ok(!file.content.includes('{{'), 'export must carry no residual placeholder');
  // Staging is deterministic: a second collect reproduces identical bytes.
  const again = collectEntrySkillFiles({ workspaceRoot: rootDoubao, platformId: 'doubao' });
  assert.equal(JSON.stringify(again.summary), JSON.stringify(doubao.summary));

  const rootZcode = scratch(t, 'zcode');
  putConfig(rootZcode, 'zcode', 'zcode-config.json', { interpreters: { '.py': PYTHON } });
  writeFileSync(join(rootZcode, 'zcode', 'bridge', 'invocation-manual.md'), 'manual\n');
  const zcode = collectEntrySkillFiles({ workspaceRoot: rootZcode, platformId: 'zcode' });
  assert.deepEqual(zcode.summary.files, ['.zcode/commands/wf.md', '.zcode/commands/wfa.md']);
  for (const file of zcode.files) assert.ok(!/^name: /m.test(file.content), 'command head must not carry a name line');
});

test('client plan carries entry skills through the transaction payload', (t) => {
  const root = scratch(t, 'plan');
  seedRuntimeReleases(root);
  const configPlan = buildOnboardingConfigPlan({ workspaceRoot: root, platformId: 'workbuddy', confirmed: true, fields: { pythonExecutable: PYTHON } });
  applyOnboardingConfig(configPlan, { auditRoot: join(root, 'audit') });
  let plan;
  try {
    plan = buildOnboardingClientPlan({ workspaceRoot: root, platformId: 'workbuddy' });
  } catch (error) {
    // managementRuntimePlan validates the host node via spawnSync; inside the
    // WorkBuddy agent process tree every spawnSync is EBUSY (environment fact
    // recorded 2026-10-10/14), so the authoritative run of this case belongs
    // to a real terminal. Rendering itself is covered by the cases above.
    if (isHostNodeDiscoveryFailure(error)) { t.skip('host cannot spawnSync (agent tree); run in a user terminal for the authoritative pass'); return; }
    throw error;
  }
  assert.ok(plan.payload.entrySkills, 'entrySkills summary missing from payload');
  assert.equal(plan.payload.entrySkills.schema, 'entry-skills-plan/v1');
  assert.deepEqual(plan.payload.entrySkills.files, ['.workbuddy/skills/wf/SKILL.md', '.workbuddy/skills/wfa/SKILL.md']);
  for (const rel of plan.payload.entrySkills.files) {
    const file = plan.payload.files.find((row) => row.path === rel);
    assert.ok(file, `${rel} not in payload.files`);
    assert.equal(file.entrySkill, true);
    assert.equal(file.beforeSha256, null);
  }
  const entrySteps = plan.steps.filter((step) => step.operation === 'install-entry-skill');
  assert.equal(entrySteps.length, 2);
  assert.ok(entrySteps.every((step) => step.target.startsWith('.workbuddy/skills/')));
  // Rendering is deterministic: rebuilding the plan reproduces the same summary bytes.
  const rebuilt = buildOnboardingClientPlan({ workspaceRoot: root, platformId: 'workbuddy', now: plan.generatedAt });
  assert.equal(JSON.stringify(rebuilt.payload.entrySkills), JSON.stringify(plan.payload.entrySkills));
});

// ---- D-158 (registered 2026-10-15) ----------------------------------------
// The slot table covers the six surveyed platforms only. A platform outside it
// must DEGRADE to the slot-less export path, not throw: onboarding a seventh
// client is a production route (domains/intake/platform-body.mjs -> 
// buildOnboardingClientPlan). Before the fix every case below threw
// ENTRY_SKILL_SLOT_UNKNOWN, so any platform outside the table could not even
// get a plan built.

test('D-158: a platform outside the slot table degrades to the export path instead of throwing', (t) => {
  const root = scratch(t, 'unknown-slot');
  putConfig(root, 'brand-new-client', 'brand-new-client-config.json', { interpreters: { '.py': PYTHON } });
  const collected = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'brand-new-client' });
  assert.equal(collected.summary.slotKind, 'none');
  assert.equal(collected.summary.derivedSlot, true, 'a derived slot must be recorded, not silently treated as a surveyed slot-less client');
  assert.deepEqual(collected.summary.exported, [
    'brand-new-client/runtime/entry-skills-export/wf/SKILL.md',
    'brand-new-client/runtime/entry-skills-export/wfa/SKILL.md'
  ]);
  assert.ok(collected.summary.pluginPackage, 'D-162: a derived slot gets the plugin package too');
  assert.equal(collected.summary.unplaced.length, 2);
  for (const row of collected.summary.unplaced) {
    assert.equal(row.reason, 'NO_LOCAL_COMMAND_SLOT');
    assert.ok(row.exportRel && collected.summary.exported.includes(row.exportRel));
  }
  for (const file of collected.files) assert.ok(!file.content.includes('{{'), 'export must carry no residual placeholder');
});

test('D-158: a derived slot still resolves python from the platform config, never renders an empty interpreter', (t) => {
  // Rung 1: <id>/bridge/<id>-config.json (the shape buildOnboardingConfigPlan writes).
  const rootConfig = scratch(t, 'derived-config');
  putConfig(rootConfig, 'brand-new-client', 'brand-new-client-config.json', { interpreters: { '.py': PYTHON } });
  const fromConfig = renderEntrySkills({ workspaceRoot: rootConfig, platformId: 'brand-new-client' });
  for (const entry of fromConfig.entries) {
    assert.deepEqual(entry.issues, [], `${entry.skill} must not report PYTHON_UNRESOLVED when the config carries an interpreter`);
    if (entry.skill === 'wf') assert.ok(entry.content.includes(PYTHON), 'python missing in wf');
  }
  // Rung 2: <id>/bridge/runner-config.json (the codex/dsh shape).
  const rootRunner = scratch(t, 'derived-runner');
  putConfig(rootRunner, 'runner-shape', 'runner-config.json', { interpreters: { '.py': PYTHON } });
  const fromRunner = renderEntrySkills({ workspaceRoot: rootRunner, platformId: 'runner-shape' });
  for (const entry of fromRunner.entries) assert.deepEqual(entry.issues, []);
  // Rung 3: <id>/bridge.json runner.python.
  const rootBridge = scratch(t, 'derived-bridge');
  mkdirSync(join(rootBridge, 'bridge-shape', 'bridge'), { recursive: true });
  writeFileSync(join(rootBridge, 'bridge-shape', 'bridge.json'), JSON.stringify({ runner: { python: PYTHON } }));
  const fromBridge = renderEntrySkills({ workspaceRoot: rootBridge, platformId: 'bridge-shape' });
  for (const entry of fromBridge.entries) assert.deepEqual(entry.issues, []);
  // Nothing resolvable still reports the gap honestly instead of inventing one.
  const rootBare = scratch(t, 'derived-bare');
  const bare = renderEntrySkills({ workspaceRoot: rootBare, platformId: 'bare-shape' });
  for (const entry of bare.entries) assert.deepEqual(entry.issues, ['PYTHON_UNRESOLVED']);
});

// qoder-cn (registered 2026-10-28) is the seventh platform directory and has no
// surveyed command slot, so it must travel the D-158 derived route: the python
// interpreter comes from qoder-cn/bridge/qoder-cn-config.json, which is exactly
// the file name its own bridge.json points at.
test('the seventh platform resolves its interpreter through the derived slot, not a surveyed one', (t) => {
  assert.deepEqual(entrySkillSlots('qoder-cn'), { config: null, manual: null, kind: 'none', dir: null, derived: true });
  const root = scratch(t, 'qoder-cn-slot');
  putConfig(root, 'qoder-cn', 'qoder-cn-config.json', { interpreters: { '.py': PYTHON } });
  const rendered = renderEntrySkills({ workspaceRoot: root, platformId: 'qoder-cn' });
  for (const entry of rendered.entries) {
    assert.deepEqual(entry.issues, [], `${entry.skill} must not report PYTHON_UNRESOLVED for qoder-cn`);
    if (entry.skill === 'wf') assert.ok(entry.content.includes(PYTHON), 'python missing in wf for qoder-cn');
  }
});

// Guard rail: the degradation above must not turn into a blanket accept.
test('D-158: an empty or malformed platform id still fails closed', () => {
  for (const bad of ['', null, undefined, 'Not A Platform', '../escape', '-leading', 'UPPER']) {
    assert.throws(
      () => collectEntrySkillFiles({ workspaceRoot: join(tmpdir(), 'd158-never-created'), platformId: bad }),
      /ENTRY_SKILL_SLOT_UNKNOWN/,
      `platformId ${String(bad)} must fail closed`
    );
  }
  // Prototype safety: a bare SLOTS[id] read returns Object.prototype members
  // ('constructor', 'toString') as truthy values, which used to slip through
  // instead of failing closed. They are syntactically valid ids, so they must
  // now degrade to a derived slot -- never resolve to a prototype function.
  // 'constructor' is all-lowercase and therefore a syntactically valid id, so
  // it degrades to a derived slot. 'toString'/'valueOf' fail the id shape and
  // keep failing closed. None of them may resolve to a prototype function.
  const derived = entrySkillSlots('constructor');
  assert.equal(typeof derived, 'object', 'constructor must not resolve to a prototype member');
  assert.equal(derived.derived, true, 'constructor is a syntactically valid id, so it degrades to a derived slot');
  for (const name of ['toString', 'valueOf']) {
    assert.throws(() => entrySkillSlots(name), /ENTRY_SKILL_SLOT_UNKNOWN/, `${name} must fail closed`);
  }
});

test('D-158: the client plan carries entry skills for a platform outside the slot table', (t) => {
  const root = scratch(t, 'plan-unknown');
  seedRuntimeReleases(root);
  const configPlan = buildOnboardingConfigPlan({ workspaceRoot: root, platformId: 'brand-new-client', confirmed: true, fields: { pythonExecutable: PYTHON } });
  applyOnboardingConfig(configPlan, { auditRoot: join(root, 'audit') });
  let plan;
  try {
    plan = buildOnboardingClientPlan({ workspaceRoot: root, platformId: 'brand-new-client' });
  } catch (error) {
    if (isHostNodeDiscoveryFailure(error)) { t.skip('host cannot spawnSync (agent tree); run in a user terminal for the authoritative pass'); return; }
    throw error;
  }
  assert.equal(plan.payload.entrySkills.derivedSlot, true);
  assert.deepEqual(plan.payload.entrySkills.exported, [
    'brand-new-client/runtime/entry-skills-export/wf/SKILL.md',
    'brand-new-client/runtime/entry-skills-export/wfa/SKILL.md'
  ]);
  assert.ok(plan.payload.entrySkills.pluginPackage, 'D-162: the client plan carries the package');
  const rebuilt = buildOnboardingClientPlan({ workspaceRoot: root, platformId: 'brand-new-client', now: plan.generatedAt });
  assert.equal(JSON.stringify(rebuilt.payload.entrySkills), JSON.stringify(plan.payload.entrySkills));
});
