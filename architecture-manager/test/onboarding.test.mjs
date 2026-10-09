import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allPlatformIds } from '../src/core/platforms.mjs';
import { applyPlan, verifyPlanTarget } from '../src/transactions.mjs';
import { buildOnboardingCard, buildPlatformScaffoldPlan, governanceOnboardingDraft, runOnboardingPipeline } from '../src/onboarding.mjs';

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'am-onboard-'));
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-onboard-audit-'));
  return { root, auditRoot };
}

test('scaffold plan creates a platform directory only with explicit confirmation', () => {
  const fixture = makeWorkspace();
  assert.throws(() => buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'newp', confirmed: false }), /PLATFORM_SCAFFOLD_CONFIRMATION_REQUIRED/);
  assert.throws(() => buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'zcode', confirmed: true }), /PLATFORM_ID_RESERVED/);
  const plan = buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'newp', displayName: 'New Platform', confirmed: true });
  assert.equal(plan.kind, 'platform-scaffold');
  applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(verifyPlanTarget({ plan }).ok, true);
  const config = JSON.parse(readFileSync(join(fixture.root, 'newp', 'bridge', 'newp-config.json'), 'utf8'));
  assert.equal(config.platform, 'newp');
  assert.ok(Array.isArray(config.pendingKeys));
  const capabilities = JSON.parse(readFileSync(join(fixture.root, 'newp', 'bridge', 'capabilities.json'), 'utf8'));
  assert.ok(capabilities.declaredAbsent.length > 0, 'honest floor starts absent');
  assert.ok(allPlatformIds(fixture.root).includes('newp'), 'discovered without code change');
  assert.throws(() => buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'newp', confirmed: true }), /PLATFORM_DIRECTORY_EXISTS/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('forged scaffold payload never writes outside its generated target', () => {
  const fixture = makeWorkspace();
  const plan = buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'newp', confirmed: true });
  plan.payload.files[0].path = '../escaped.json';
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }), /PLAN_PAYLOAD_MISMATCH/);
  assert.equal(existsSync(join(fixture.root, 'newp')), false);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('pipeline awaits the check and stops on its actual gap result', async () => {
  const calls = [];
  const report = await runOnboardingPipeline({ workspaceRoot: 'fixture', platformId: 'newp', includeMatrix: true }, {
    inspect: () => ({ stage: 'configured' }),
    check: async ({ mode }) => { calls.push(mode); await new Promise((resolve) => setTimeout(resolve, 10)); return { issues: ['gap'], stage: 'callable' }; }
  });
  assert.deepEqual(calls, ['full']);
  assert.equal(report.stoppedAt, 'certification');
  assert.equal(report.steps[1].result.stage, 'callable');
  const invalid = await runOnboardingPipeline({ workspaceRoot: 'fixture', platformId: 'newp' }, { inspect: () => ({ stage: 'invalid-bridge' }), check: () => { throw new Error('must-not-dispatch'); } });
  assert.equal(invalid.stoppedAt, 'precheck');
});

test('scaffold failure cleans up created files', () => {
  const fixture = makeWorkspace();
  const plan = buildPlatformScaffoldPlan({ workspaceRoot: fixture.root, platformId: 'newp', confirmed: true });
  // Sabotage: pre-create one target file so the write phase fails midway.
  mkdirSync(join(fixture.root, 'newp', 'bridge'), { recursive: true });
  writeFileSync(join(fixture.root, 'newp', 'bridge.json'), 'blocker');
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }));
  assert.ok(!existsSync(join(fixture.root, 'newp', 'bridge', 'platform.md')), 'later files were not written');
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('governance drafts cover five documents and the current card requires a client loop without maintenance AI', () => {
  const fixture = makeWorkspace();
  const drafts = governanceOnboardingDraft(fixture.root, 'newp');
  assert.equal(drafts.drafts.length, 5);
  assert.ok(drafts.drafts.some((draft) => draft.path === 'AGENTS.md'));
  const card = buildOnboardingCard(fixture.root, 'newp');
  assert.equal(card.scaffoldPresent, false);
  assert.match(card.card, /challenge/);
  assert.match(card.card, /不得以工具握手替代/);
  assert.doesNotMatch(card.card, /唯一需要平台 AI/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});
