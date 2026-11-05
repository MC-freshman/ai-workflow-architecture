// D-170 (registered 2026-10-28): the resume-preview whitelist forgot the
// derived entry-skill staging area. A platform without a local command slot
// (doubao / dsh / qoder / qoder-cn / any seventh platform) writes its rendered
// wf+wfa bytes to <id>/runtime/entry-skills-export/<skill>/SKILL.md during the
// client step, and onboarding-auto records every written file in
// journal.finalTargets. validTarget() only allowed bridge/, bridge.json,
// runtime/software/software-environment.json, runtime/manager-host/<sha>/
// manifest.json and the six governance files, so the very next resume preview
// threw ONBOARDING_JOURNAL_INVALID even though both hashes were real and
// matched the disk -- no invalid hash, just a missing whitelist entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { collectEntrySkillFiles } from '../src/domains/onboarding/onboarding-entry-skills.mjs';
import { automaticJournalPath, onboardingResumePreview, assertResumePreview } from '../src/domains/platforms/onboarding-resume.mjs';

const PYTHON = '<local-user-path>';
const PLATFORM = 'doubao'; // surveyed slot-less client: kind === 'none'

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `resume-entry-skills-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Reproduces the production shape as closely as possible: the export bytes come
// from the real collector (so a renamed staging directory fails this test), and
// the journal is written exactly where automatic onboarding writes it.
function stagedPlatform(t, label) {
  const root = scratch(t, label);
  const configPath = join(root, PLATFORM, 'bridge', `${PLATFORM}-config.json`);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ interpreters: { '.py': PYTHON } }, null, 2) + '\n');
  const collected = collectEntrySkillFiles({ workspaceRoot: root, platformId: PLATFORM });
  assert.equal(collected.summary.slotKind, 'none', 'the fixture must travel the slot-less export route');
  const finalTargets = {};
  for (const file of collected.files) {
    const disk = join(root, file.path);
    mkdirSync(dirname(disk), { recursive: true });
    writeFileSync(disk, file.content);
    finalTargets[file.path] = sha256(Buffer.from(file.content));
  }
  const journal = automaticJournalPath(root, PLATFORM);
  mkdirSync(dirname(journal), { recursive: true });
  const writeJournal = value => writeFileSync(journal, JSON.stringify(value, null, 2) + '\n');
  writeJournal({
    schema: 'architecture-manager-auto/v1', planId: 'original', platformId: PLATFORM, status: 'running',
    steps: [{ step: 'configuration', status: 'passed' }, { step: 'providers', status: 'passed' }, { step: 'client', status: 'passed', completedAt: new Date().toISOString() }],
    finalTargets
  });
  return { root, journal, writeJournal, finalTargets, exported: collected.summary.exported };
}

test('D-170: a resume preview over staged entry-skill exports is valid, not ONBOARDING_JOURNAL_INVALID', t => {
  const { root, exported } = stagedPlatform(t, 'preview');
  assert.deepEqual(exported, [
    `${PLATFORM}/runtime/entry-skills-export/wf/SKILL.md`,
    `${PLATFORM}/runtime/entry-skills-export/wfa/SKILL.md`
  ]);
  const preview = onboardingResumePreview(root, PLATFORM, 'strict');
  assert.deepEqual(preview.changes, [], 'unchanged staging bytes must not be reported as drift');
  assert.deepEqual(preview.invalidatedSteps, []);
  assert.equal(preview.mode, 'strict');
  // strict mode with zero changes is exactly what automatic onboarding asserts.
  assertResumePreview(root, PLATFORM, preview, null);
});

test('D-170: drift in a staged export invalidates client and downstream steps, never the sealed install', t => {
  const { root, exported, writeJournal, finalTargets } = stagedPlatform(t, 'drift');
  const target = join(root, exported[0]);
  writeFileSync(target, readFileSync(target, 'utf8') + '\n# hand-edited\n');
  const preview = onboardingResumePreview(root, PLATFORM, 'reconcile');
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].path, exported[0]);
  assert.deepEqual(preview.changes[0].affectedSteps, ['client', 'certification', 'governance', 'git']);
  assert.deepEqual(preview.invalidatedSteps, ['client', 'certification', 'governance', 'git']);
  assert.ok(!preview.invalidatedSteps.includes('environment'), 'staging drift must not redo the sealed environment');
  // A removed staging file is drift too, and reconcile drops it from the targets.
  writeJournal({
    schema: 'architecture-manager-auto/v1', planId: 'original', platformId: PLATFORM, status: 'running',
    steps: [{ step: 'client', status: 'passed' }], finalTargets: { ...finalTargets, [exported[1]]: 'f'.repeat(64) }
  });
  const changed = onboardingResumePreview(root, PLATFORM, 'reconcile');
  assert.ok(changed.changes.some(row => row.path === exported[1] && row.newSha256 !== 'f'.repeat(64)));
});

test('D-170: the whitelist is still fail-closed for anything else under runtime/', t => {
  const { root, writeJournal } = stagedPlatform(t, 'fail-closed');
  for (const path of [`${PLATFORM}/runtime/entry-skills-export/../elsewhere/x.json`, `${PLATFORM}/runtime/other/x.json`, `${PLATFORM}/bridge/../runtime/entry-skills-export-2/wf/SKILL.md`, 'runtime/entry-skills-export/wf/SKILL.md']) {
    writeJournal({ schema: 'architecture-manager-auto/v1', planId: 'original', platformId: PLATFORM, status: 'running', steps: [], finalTargets: { [path]: 'a'.repeat(64) } });
    assert.throws(() => onboardingResumePreview(root, PLATFORM, 'strict'), /ONBOARDING_JOURNAL_INVALID/, `${path} must stay outside the whitelist`);
  }
  // A malformed hash stays invalid even inside the staging area.
  writeJournal({ schema: 'architecture-manager-auto/v1', planId: 'original', platformId: PLATFORM, status: 'running', steps: [], finalTargets: { [`${PLATFORM}/runtime/entry-skills-export/wf/SKILL.md`]: 'not-a-hash' } });
  assert.throws(() => onboardingResumePreview(root, PLATFORM, 'strict'), /ONBOARDING_JOURNAL_INVALID/);
  // Another platform's staging area is not this platform's business either.
  writeJournal({ schema: 'architecture-manager-auto/v1', planId: 'original', platformId: 'zcode', status: 'running', steps: [], finalTargets: { [`zcode/runtime/entry-skills-export/wf/SKILL.md`]: 'a'.repeat(64) } });
  assert.throws(() => onboardingResumePreview(root, PLATFORM, 'strict'), /ONBOARDING_JOURNAL_INVALID/);
});
