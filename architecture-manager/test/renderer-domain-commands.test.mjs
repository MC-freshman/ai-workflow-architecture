// Behavioural tests for the renderer domain command layer (P4.2 of
// versions/管理台测试充分性评估与补测P表-20261015.md). Every commands.mjs is a
// DOM-free factory that takes its whole world from the context object, so these
// cases drive the real modules with a recording context and a strict fake api:
// no jsdom, no new dependency. The fake api throws on any channel a case did
// not declare, so a wrong channel or a wrong payload mapping fails loudly
// instead of silently passing. The real friendlyError and PLAN_WRITE_KINDS are
// imported, so the error-message and write-kind contracts are the production
// ones. Only plans/commands.mjs touches window (two CustomEvent branches); a
// minimal stub is installed for those, never a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommands as workspaceCommands } from '../src/renderer/features/workspace/commands.mjs';
import { createCommands as gitCommands } from '../src/renderer/features/git/commands.mjs';
import { createCommands as anchorCommands } from '../src/renderer/features/anchor/commands.mjs';
import { createCommands as documentsCommands } from '../src/renderer/features/documents/commands.mjs';
import { createCommands as integrationCommands } from '../src/renderer/features/integration/commands.mjs';
import { createCommands as platformCommands } from '../src/renderer/features/platform/commands.mjs';
import { createCommands as resourcesCommands } from '../src/renderer/features/resources/commands.mjs';
import { createCommands as softwareCommands } from '../src/renderer/features/software/commands.mjs';
import { createCommands as plansCommands } from '../src/renderer/features/plans/commands.mjs';
import { requestCoordinator, scopedContext } from '../src/renderer/shared/request-coordinator.mjs';
import { PLAN_WRITE_KINDS, friendlyError } from '../src/renderer/presenter.mjs';

const API_CHANNELS = [
  'scanWorkspace', 'inspectGit', 'scanSensitiveFiles', 'previewGitPlan',
  'readAnchorReport', 'previewAnchorPlan', 'previewAnchorAlignmentPlan',
  'readDocument', 'previewDocumentPlan',
  'readIntegrationTarget', 'suggestPlatformBridge', 'previewIntegrationPlan',
  'previewPlatformPlan', 'previewPlatformCheck', 'runPlatformCheck', 'refreshPlatform',
  'selectDirectory', 'inspectPlatform',
  'readCatalogEntry', 'selectCatalog', 'previewRegistryPlan', 'previewResourcePlan',
  'softwareHealth', 'previewSoftwarePlan', 'previewSoftwareImportPlan',
  'previewSoftwareRecipePlan', 'previewSoftwareRevertPlan',
  'previewSoftwareConnectorLaunchPlan',
  'confirm', 'openSoftwareLocation', 'applyPlan', 'verifyPlan',
  'readGlobalUpdateHistory', 'checkAfterAnchorAlignment'
];
const SETTERS = [
  'setMessage', 'setPlanPreview', 'setPlanPayload', 'setInventory', 'setGitDetails',
  'setSensitiveScan', 'setAnchorReport', 'setSelectedDocument', 'setDocumentDraft',
  'setSensitiveConfirmed', 'setIntegrationTarget', 'setIntegrationText',
  'setPlatformSuggestion', 'setIntegrationTargetVersion', 'setTargetVersions',
  'setBusy', 'setTransactionProgress', 'setCatalogDetail', 'setSkillDetail',
  'setSkillFilter', 'setSoftwareResults', 'setWorkspace'
];

function harness({ impl = {}, values = {} } = {}) {
  const calls = [];
  const setterCalls = [];
  const api = {};
  const defaults = { confirm: async () => true };
  for (const name of API_CHANNELS) {
    api[name] = async (...args) => {
      calls.push({ channel: name, args });
      const handler = name in impl ? impl[name] : defaults[name];
      if (!handler) throw new Error(`UNEXPECTED_API_CALL:${name}`);
      return handler(...args);
    };
  }
  const context = { api, friendlyError, PLAN_WRITE_KINDS };
  for (const name of SETTERS) context[name] = (...args) => setterCalls.push({ setter: name, args });
  Object.assign(context, values);
  return { context, calls, setterCalls };
}

const lastMessage = (h) => h.setterCalls.filter((c) => c.setter === 'setMessage').at(-1)?.args[0];
const setterArgs = (h, name) => h.setterCalls.filter((c) => c.setter === name).map((c) => c.args[0]);
const channelCalls = (h, name) => h.calls.filter((c) => c.channel === name);
const wasCalled = (h, name) => channelCalls(h, name).length > 0;

// ── workspace ────────────────────────────────────────────────────────────────

test('workspace scan replaces every panel state and reports a clean read-only pass', async () => {
  const h = harness({ impl: { scanWorkspace: async () => ({ workspaceRoot: 'E:/ws', git: { status: [] }, errors: [] }) } });
  await workspaceCommands().scan(h.context, 'E:/ws');
  assert.deepEqual(channelCalls(h, 'scanWorkspace')[0].args, ['E:/ws']);
  assert.deepEqual(setterArgs(h, 'setWorkspace'), ['E:/ws']);
  assert.equal(setterArgs(h, 'setGitDetails')[0].status.length, 0);
  assert.deepEqual(setterArgs(h, 'setPlanPreview'), [null]);
  assert.deepEqual(setterArgs(h, 'setSelectedDocument'), [null]);
  assert.deepEqual(setterArgs(h, 'setSoftwareResults'), [{}]);
  assert.match(lastMessage(h), /扫描完成，当前页面没有执行写入。/);
  assert.deepEqual(setterArgs(h, 'setBusy'), [true, false], 'busy must be released in finally');
});

test('workspace scan counts pending problems and surfaces failures through friendlyError', async () => {
  const ok = harness({ impl: { scanWorkspace: async () => ({ workspaceRoot: 'E:/ws', git: null, errors: [{}, {}] }) } });
  await workspaceCommands().scan(ok.context, 'E:/ws');
  assert.match(lastMessage(ok), /发现 2 个待处理问题/);
  const bad = harness({ impl: { scanWorkspace: async () => { throw new Error('boom'); } } });
  await workspaceCommands().scan(bad.context, 'E:/ws');
  assert.match(lastMessage(bad), /扫描失败：boom/);
  assert.deepEqual(setterArgs(bad, 'setBusy'), [true, false]);
});

test('workspace scan without a root touches nothing', async () => {
  const h = harness();
  await workspaceCommands().scan(h.context, '');
  assert.equal(h.calls.length, 0);
  assert.equal(lastMessage(h), undefined);
});

// ── git ──────────────────────────────────────────────────────────────────────

test('refreshGit reads git detail and the sensitive scan in parallel and merges them', async () => {
  const h = harness({
    impl: {
      inspectGit: async () => ({ status: ['a', 'b'] }),
      scanSensitiveFiles: async () => ({ clean: false, findings: [{}, {}, {}] })
    },
    values: { workspace: 'E:/ws' }
  });
  await gitCommands().refreshGit(h.context);
  assert.deepEqual(channelCalls(h, 'inspectGit')[0].args, ['E:/ws']);
  assert.deepEqual(channelCalls(h, 'scanSensitiveFiles')[0].args, ['E:/ws']);
  assert.equal(setterArgs(h, 'setGitDetails')[0].status.length, 2);
  const merged = setterArgs(h, 'setInventory')[0]({ platforms: [] });
  assert.equal(merged.git.status.length, 2, 'the inventory updater must fold git detail into the current state');
  assert.deepEqual(setterArgs(h, 'setSensitiveScan')[0].findings.length, 3);
  assert.match(lastMessage(h), /2 项改动/);
  assert.match(lastMessage(h), /3 项待核对/);
});

test('refreshGit reports a read failure without leaving stale detail claims', async () => {
  const h = harness({
    impl: {
      inspectGit: async () => { throw new Error('nope'); },
      scanSensitiveFiles: () => new Promise(() => {})
    },
    values: { workspace: 'E:/ws' }
  });
  await gitCommands().refreshGit(h.context);
  assert.match(lastMessage(h), /Git 状态读取失败：nope/);
  assert.equal(setterArgs(h, 'setSensitiveScan').length, 0, 'the failing read must not leave scan state behind');
  assert.equal(setterArgs(h, 'setGitDetails').length, 0);
});

test('previewGit maps the form into the plan input and remaps snapshot onto backup', async () => {
  const h = harness({ impl: { previewGitPlan: async (input) => ({ id: 'plan', input }) }, values: { workspace: 'E:/ws' } });
  await gitCommands().previewGit(h.context, 'snapshot', { message: 'm' });
  const input = channelCalls(h, 'previewGitPlan')[0].args[0];
  assert.equal(input.action, 'backup');
  assert.equal(input.backupMode, 'snapshot');
  assert.equal(input.message, 'm');
  assert.equal(setterArgs(h, 'setPlanPreview')[0].id, 'plan');
  assert.deepEqual(setterArgs(h, 'setPlanPayload'), [null]);
  assert.match(lastMessage(h), /尚未执行任何 Git 命令/);
});

test('previewGit refuses to build a plan from an empty form', async () => {
  const h = harness({ values: { workspace: 'E:/ws' } });
  await gitCommands().previewGit(h.context, 'commit', null);
  assert.equal(wasCalled(h, 'previewGitPlan'), false);
  assert.match(lastMessage(h), /请填写当前仓库操作表单/);
});

// ── anchor ───────────────────────────────────────────────────────────────────

test('inspectAnchor explains a refusal, a materialised anchor and a pending one', async () => {
  const refused = harness({ impl: { readAnchorReport: async () => ({ refusal: { code: 'ENGINE_UNRESOLVED' }, platforms: [] }) }, values: { workspace: 'E:/ws' } });
  await anchorCommands().inspectAnchor(refused.context);
  assert.match(lastMessage(refused), /锚定代尚不可用：ENGINE_UNRESOLVED/);

  const materialised = harness({
    impl: { readAnchorReport: async () => ({ materialised: true, computedDigest: 'abcdef1234567890', platforms: [{ ok: true, anchor: { aligned: false } }] }) },
    values: { workspace: 'E:/ws' }
  });
  await anchorCommands().inspectAnchor(materialised.context);
  assert.match(lastMessage(materialised), /锚定代已物化（abcdef123456…）；1 个平台与它不一致/);

  const pending = harness({
    impl: { readAnchorReport: async () => ({ materialised: false, anchor: { engine: { version: '1' }, contracts: { version: '2' }, checker: { version: '3' }, judge: { version: '4' } }, platforms: [] }) },
    values: { workspace: 'E:/ws' }
  });
  await anchorCommands().inspectAnchor(pending.context);
  assert.match(lastMessage(pending), /锚定代尚未落盘：引擎 1 \/ 契约 2 \/ 检查器 3 \/ 判据 4/);
});

test('previewAnchor short-circuits an unchanged anchor and otherwise stages the plan', async () => {
  const same = harness({ impl: { previewAnchorPlan: async () => ({ changed: false }) }, values: { workspace: 'E:/ws' } });
  await anchorCommands().previewAnchor(same.context);
  assert.match(lastMessage(same), /逐字一致，无需写入/);
  assert.equal(setterArgs(same, 'setPlanPreview').length, 0);

  const changed = harness({ impl: { previewAnchorPlan: async () => ({ changed: true, steps: [{}, {}] }) }, values: { workspace: 'E:/ws' } });
  await anchorCommands().previewAnchor(changed.context);
  assert.equal(setterArgs(changed, 'setPlanPreview')[0].steps.length, 2);
  assert.deepEqual(setterArgs(changed, 'setPlanPayload'), [null]);
  assert.match(lastMessage(changed), /已生成锚定件计划（2 项写入），尚未落盘/);
});

test('previewAnchorAlignment reports named warnings and keeps the payload clean', async () => {
  const h = harness({
    impl: { previewAnchorAlignmentPlan: async (input) => ({ changed: true, payload: { files: ['a', 'b', 'c'], warnings: ['w1', 'w2'] }, input }) },
    values: { workspace: 'E:/ws' }
  });
  await anchorCommands().previewAnchorAlignment(h.context, 'workbuddy');
  const input = channelCalls(h, 'previewAnchorAlignmentPlan')[0].args[0];
  assert.equal(input.platformId, 'workbuddy');
  assert.deepEqual(setterArgs(h, 'setPlanPayload'), [null]);
  assert.match(lastMessage(h), /将写 3 个文件，并记录 2 条具名警告/);
});

// ── documents ────────────────────────────────────────────────────────────────

test('openDocument loads the draft into memory only and resets the sensitivity flag', async () => {
  const h = harness({
    impl: { readDocument: async (input) => ({ path: input.relativePath, content: 'text', sha256: 'h' }) },
    values: { workspace: 'E:/ws', sensitiveConfirmed: true }
  });
  await documentsCommands().openDocument(h.context, 'docs/a.md');
  assert.deepEqual(channelCalls(h, 'readDocument')[0].args[0], { workspaceRoot: 'E:/ws', relativePath: 'docs/a.md' });
  assert.equal(setterArgs(h, 'setDocumentDraft')[0], 'text');
  assert.deepEqual(setterArgs(h, 'setSensitiveConfirmed'), [false]);
  assert.match(lastMessage(h), /已读取 docs\/a\.md，编辑仍只在本地内存中/);
});

test('previewDocument sends the full before/after contract including the sensitivity flag', async () => {
  const h = harness({
    impl: { previewDocumentPlan: async (input) => ({ id: 'plan', input }) },
    values: {
      workspace: 'E:/ws',
      selectedDocument: { path: 'docs/a.md', content: 'before', sha256: 'base' },
      documentDraft: 'after',
      sensitiveConfirmed: true
    }
  });
  await documentsCommands().previewDocument(h.context);
  const input = channelCalls(h, 'previewDocumentPlan')[0].args[0];
  assert.deepEqual(input, {
    workspaceRoot: 'E:/ws', relativePath: 'docs/a.md',
    beforeText: 'before', afterText: 'after', baselineSha256: 'base', highSensitivityConfirmed: true
  });
  assert.deepEqual(setterArgs(h, 'setPlanPayload')[0], { afterText: 'after' });
});

test('previewDocument without a loaded document builds nothing', async () => {
  const h = harness({ values: { workspace: 'E:/ws', selectedDocument: null } });
  await documentsCommands().previewDocument(h.context);
  assert.equal(wasCalled(h, 'previewDocumentPlan'), false);
});

// ── integration ──────────────────────────────────────────────────────────────

test('reloadIntegrationTarget guards the selector and reads a platform bridge suggestion', async () => {
  const guard = harness({ values: { workspace: 'E:/ws', integrationTargetId: '', integrationPath: '' } });
  await integrationCommands().reloadIntegrationTarget(guard.context);
  assert.match(lastMessage(guard), /请先选择接入对象和目标文件/);
  assert.equal(guard.calls.length, 0);

  const h = harness({
    impl: {
      readIntegrationTarget: async (input) => ({ path: input.relativePath, content: 'raw', sha256: 'h' }),
      suggestPlatformBridge: async () => ({ afterText: 'suggested' })
    },
    values: { workspace: 'E:/ws', integrationKind: 'platform', integrationTargetId: 'workbuddy', integrationPath: 'bridge/x.json' }
  });
  await integrationCommands().reloadIntegrationTarget(h.context);
  assert.deepEqual(channelCalls(h, 'suggestPlatformBridge')[0].args[0], { workspaceRoot: 'E:/ws', platformId: 'workbuddy' });
  assert.equal(setterArgs(h, 'setIntegrationText')[0], 'suggested');
  assert.match(lastMessage(h), /已重新读取 bridge\/x\.json，基线哈希已更新/);
});

test('reloadIntegrationTarget for a non-platform kind keeps the raw file content', async () => {
  const h = harness({
    impl: { readIntegrationTarget: async () => ({ path: 'tool/x.md', content: 'raw body', sha256: 'h' }) },
    values: { workspace: 'E:/ws', integrationKind: 'tool', integrationTargetId: 'x', integrationPath: 'tool/x.md' }
  });
  await integrationCommands().reloadIntegrationTarget(h.context);
  assert.equal(wasCalled(h, 'suggestPlatformBridge'), false);
  assert.equal(setterArgs(h, 'setIntegrationText')[0], 'raw body');
});

test('previewIntegration adds pointer versions only in pointer mode', async () => {
  const base = {
    workspace: 'E:/ws', integrationKind: 'tool', integrationTargetId: 'x', integrationPath: 'tool/x.md',
    integrationTarget: { content: 'before', sha256: 'base' }, integrationText: 'after',
    resources: [{ repository: 'tool', resourceId: 'x', version: '1.0.0', availableVersions: ['1.0.0', '1.1.0'] }]
  };
  const pointer = harness({
    impl: { previewIntegrationPlan: async (input) => ({ payload: { afterText: 'plan-after' }, input }) },
    values: { ...base, integrationMode: 'pointer', integrationTargetVersion: '1.1.0' }
  });
  await integrationCommands().previewIntegration(pointer.context);
  const input = channelCalls(pointer, 'previewIntegrationPlan')[0].args[0];
  assert.equal(input.currentVersion, '1.0.0');
  assert.equal(input.targetVersion, '1.1.0');
  assert.deepEqual(input.availableVersions, ['1.0.0', '1.1.0']);
  assert.deepEqual(setterArgs(pointer, 'setPlanPayload')[0], { afterText: 'plan-after' });

  const direct = harness({
    impl: { previewIntegrationPlan: async (input) => ({ payload: {}, input }) },
    values: { ...base, integrationMode: 'direct' }
  });
  await integrationCommands().previewIntegration(direct.context);
  const directInput = channelCalls(direct, 'previewIntegrationPlan')[0].args[0];
  assert.equal('currentVersion' in directInput, false);
  assert.equal('targetVersion' in directInput, false);
  assert.equal('availableVersions' in directInput, false);
  assert.deepEqual(setterArgs(direct, 'setPlanPayload'), [null]);
});

// ── platform ─────────────────────────────────────────────────────────────────

test('previewPlatform sends the enabled flip it is about to perform', async () => {
  const h = harness({
    impl: { previewPlatformPlan: async (input) => ({ id: 'plan', input }) },
    values: { workspace: 'E:/ws' }
  });
  await platformCommands().previewPlatform(h.context, { id: 'workbuddy', enabled: false, directoryRelative: 'workbuddy', markers: ['bridge.json'] });
  const input = channelCalls(h, 'previewPlatformPlan')[0].args[0];
  assert.equal(input.currentEnabled, false);
  assert.equal(input.desiredEnabled, true);
  assert.match(lastMessage(h), /workbuddy 将显示/);
});

test('checkPlatform runs the confirmed scope and folds the refreshed platform back in', async () => {
  const declined = harness({
    impl: {
      previewPlatformCheck: async () => ({ kind: 'full', selected: ['a'], reasons: { a: ['r'] }, reused: [], scopeDigest: 'd' }),
      confirm: async () => false
    },
    values: { workspace: 'E:/ws' }
  });
  await platformCommands().checkPlatform(declined.context, { id: 'workbuddy' }, 'full');
  assert.equal(wasCalled(declined, 'runPlatformCheck'), false, 'a declined confirmation must not run the matrix');

  const h = harness({
    impl: {
      previewPlatformCheck: async () => ({ kind: 'full', selected: ['a', 'b'], reasons: { a: ['r1'], b: ['r2'] }, reused: ['c'], scopeDigest: 'd' }),
      runPlatformCheck: async (input) => ({ stage: 'done', provenance: { actualRows: 2, reusedRows: 1 }, issues: [], evidencePath: '/evi', input }),
      refreshPlatform: async () => ({ id: 'workbuddy', refreshed: true })
    },
    values: { workspace: 'E:/ws' }
  });
  await platformCommands().checkPlatform(h.context, { id: 'workbuddy' }, 'full');
  assert.equal(channelCalls(h, 'runPlatformCheck')[0].args[0].expectedScopeDigest, 'd');
  const applied = setterArgs(h, 'setInventory').at(-1);
  assert.equal(applied({ platforms: [{ id: 'workbuddy' }] }).platforms[0].refreshed, true);
  assert.match(lastMessage(h), /实测 2 格，沿用 1 格；无缺口。证据：\/evi/);
  assert.deepEqual(setterArgs(h, 'setBusy'), [true, false]);
});

test('addPlatformDirectory refuses unknown and invalid directories before any plan', async () => {
  const unknown = harness({
    impl: { selectDirectory: async () => 'E:/some/unknown' },
    values: { workspace: 'E:/ws', inventory: { platforms: [{ id: 'workbuddy' }] } }
  });
  await platformCommands().addPlatformDirectory(unknown.context);
  assert.match(lastMessage(unknown), /未识别的平台目录：unknown/);
  assert.equal(wasCalled(unknown, 'inspectPlatform'), false);

  const invalid = harness({
    impl: {
      selectDirectory: async () => 'E:/ws/workbuddy',
      inspectPlatform: async () => ({ validForView: false, status: 'MISSING_MARKER' })
    },
    values: { workspace: 'E:/ws', inventory: { platforms: [{ id: 'workbuddy', enabled: false }] } }
  });
  await platformCommands().addPlatformDirectory(invalid.context);
  assert.match(lastMessage(invalid), /平台目录校验未通过：MISSING_MARKER/);
  assert.equal(wasCalled(invalid, 'previewPlatformPlan'), false);

  const valid = harness({
    impl: {
      selectDirectory: async () => 'E:/ws/workbuddy',
      inspectPlatform: async () => ({ validForView: true, directoryRelative: 'workbuddy', markers: ['bridge.json'] }),
      previewPlatformPlan: async (input) => ({ id: 'plan', input })
    },
    values: { workspace: 'E:/ws', inventory: { platforms: [{ id: 'workbuddy', enabled: false }] } }
  });
  await platformCommands().addPlatformDirectory(valid.context);
  assert.equal(channelCalls(valid, 'previewPlatformPlan')[0].args[0].desiredEnabled, true);
  assert.match(lastMessage(valid), /已验证 workbuddy：bridge 和目录标记齐全/);
});

// ── resources ────────────────────────────────────────────────────────────────

test('openCatalog opens one entry and clears the skill panel selection', async () => {
  const h = harness({
    impl: { readCatalogEntry: async (input) => ({ id: input.id, body: 'x' }) },
    values: { workspace: 'E:/ws' }
  });
  await resourcesCommands().openCatalog(h.context, 'agent', 'software-engineer');
  assert.deepEqual(channelCalls(h, 'readCatalogEntry')[0].args[0], { workspaceRoot: 'E:/ws', kind: 'agent', id: 'software-engineer' });
  assert.deepEqual(setterArgs(h, 'setSkillDetail'), [null]);
  assert.deepEqual(setterArgs(h, 'setSkillFilter'), ['']);
  assert.match(lastMessage(h), /已打开 agent\/software-engineer 全部内容/);
});

test('previewRegistryAction requires a registry baseline and resolves the add flow', async () => {
  const noBaseline = harness({ values: { workspace: 'E:/ws', inventory: { catalogRegistries: { agent: {} } } } });
  await resourcesCommands().previewRegistryAction(noBaseline.context, 'agent', 'add');
  assert.match(lastMessage(noBaseline), /缺少 registry 基线哈希/);
  assert.equal(wasCalled(noBaseline, 'selectCatalog'), false);

  const cancelled = harness({
    impl: { selectCatalog: async () => null },
    values: { workspace: 'E:/ws', inventory: { catalogRegistries: { agent: { sha256: 'base' } } } }
  });
  await resourcesCommands().previewRegistryAction(cancelled.context, 'agent', 'add');
  assert.match(lastMessage(cancelled), /已取消选择文件/);
  assert.equal(wasCalled(cancelled, 'previewRegistryPlan'), false);

  const h = harness({
    impl: {
      selectCatalog: async () => ({ id: 'software-engineer', entry: { version: '1.8.0' } }),
      previewRegistryPlan: async (input) => ({ payload: { afterText: 'new-registry' }, input })
    },
    values: { workspace: 'E:/ws', inventory: { catalogRegistries: { agent: { sha256: 'base' } } } }
  });
  await resourcesCommands().previewRegistryAction(h.context, 'agent', 'add');
  const input = channelCalls(h, 'previewRegistryPlan')[0].args[0];
  assert.equal(input.id, 'software-engineer');
  assert.deepEqual(input.entry, { version: '1.8.0' });
  assert.equal(input.baselineSha256, 'base');
  assert.deepEqual(setterArgs(h, 'setPlanPayload')[0], { afterText: 'new-registry' });
  assert.match(lastMessage(h), /已生成 agent registry add 计划，尚未写入/);
});

test('previewResource resolves the target version by explicit choice, then map, then stable', async () => {
  const resource = { repository: 'tool', resourceId: 'x', version: '1.0.0', latestStableVersion: '1.1.0', availableVersions: ['1.0.0', '1.1.0'], sha256: 's' };
  const byArgument = harness({
    impl: { previewResourcePlan: async (input) => ({ id: 'plan', input }) },
    values: { workspace: 'E:/ws' }
  });
  await resourcesCommands().previewResource(byArgument.context, resource, '1.0.0');
  assert.equal(channelCalls(byArgument, 'previewResourcePlan')[0].args[0].targetVersion, '1.0.0');

  const byMap = harness({
    impl: { previewResourcePlan: async (input) => ({ id: 'plan', input }) },
    values: { workspace: 'E:/ws', targetVersions: { 'tool/x': '1.0.0' } }
  });
  await resourcesCommands().previewResource(byMap.context, resource);
  assert.equal(channelCalls(byMap, 'previewResourcePlan')[0].args[0].targetVersion, '1.0.0');

  const byStable = harness({
    impl: { previewResourcePlan: async (input) => ({ id: 'plan', input }) },
    values: { workspace: 'E:/ws', targetVersions: {} }
  });
  await resourcesCommands().previewResource(byStable.context, resource);
  const input = channelCalls(byStable, 'previewResourcePlan')[0].args[0];
  assert.equal(input.targetVersion, '1.1.0');
  assert.equal(input.currentVersion, '1.0.0');
  assert.equal(input.baselineSha256, 's');

  const none = harness({ values: { workspace: 'E:/ws', targetVersions: {} } });
  await resourcesCommands().previewResource(none.context, { ...resource, latestStableVersion: '1.0.0' });
  assert.match(lastMessage(none), /请先选择目标版本/);
  assert.equal(wasCalled(none, 'previewResourcePlan'), false);
});

// ── software ─────────────────────────────────────────────────────────────────

test('checkSoftware keys the health result by platform and software', async () => {
  const h = harness({
    impl: { softwareHealth: async (input) => ({ status: 'healthy', description: 'ok' }) },
    values: { workspace: 'E:/ws' }
  });
  await softwareCommands().checkSoftware(h.context, { id: 'nmap' }, 'workbuddy');
  assert.deepEqual(channelCalls(h, 'softwareHealth')[0].args[0], { workspaceRoot: 'E:/ws', softwareId: 'nmap', platformId: 'workbuddy' });
  const results = setterArgs(h, 'setSoftwareResults').at(-1)({});
  assert.deepEqual(results, { 'workbuddy/nmap': { status: 'healthy', description: 'ok' } });
  assert.match(lastMessage(h), /workbuddy\/nmap 健康检查：ok/);
});

test('previewSoftware states plainly that the manager has no launcher', async () => {
  const h = harness({ impl: { previewSoftwarePlan: async (input) => ({ id: 'plan', input }) }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftware(h.context, { id: 'nmap' });
  assert.equal(channelCalls(h, 'previewSoftwarePlan')[0].args[0].mode, 'launch');
  assert.match(lastMessage(h), /当前管理台没有启动执行器，未启动软件/);
});

test('previewSoftwareImport estimates the backup plus body footprint in MiB', async () => {
  const h = harness({
    impl: { previewSoftwareImportPlan: async () => ({ rows: [{}, {}], estimatedAdditionalBytes: 3 * 1024 * 1024 }) },
    values: { workspace: 'E:/ws' }
  });
  await softwareCommands().previewSoftwareImport(h.context, { softwareId: 'nmap' });
  assert.match(lastMessage(h), /2 个文件，预计新增 3 MiB/);
});

test('previewSoftwareRecipe requires an explicit confirmation before touching a real program', async () => {
  const declined = harness({ impl: { confirm: async () => false }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareRecipe(declined.context, { softwareId: 'nmap', versionFlag: '--version' });
  assert.equal(wasCalled(declined, 'previewSoftwareRecipePlan'), false);

  const h = harness({
    impl: { previewSoftwareRecipePlan: async (input) => ({ id: 'plan', input }) },
    values: { workspace: 'E:/ws' }
  });
  await softwareCommands().previewSoftwareRecipe(h.context, { softwareId: 'nmap', versionFlag: '--version' });
  assert.equal(channelCalls(h, 'confirm').length, 1);
  assert.match(lastMessage(h), /只声明“版本查询”能力/);
});

test('previewSoftwareLocation and the connector launch plan carry their platform scope', async () => {
  const location = harness({ impl: { previewSoftwarePlan: async (input) => ({ id: 'plan', input }) }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareLocation(location.context, { id: 'nmap' }, 'workbuddy');
  const locationInput = channelCalls(location, 'previewSoftwarePlan')[0].args[0];
  assert.equal(locationInput.mode, 'open-location');
  assert.equal(locationInput.platformId, 'workbuddy');

  const guard = harness({ values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareConnectorLaunch(guard.context, { id: 'nmap' }, '');
  assert.equal(wasCalled(guard, 'previewSoftwareConnectorLaunchPlan'), false);

  const launch = harness({ impl: { previewSoftwareConnectorLaunchPlan: async (input) => ({ id: 'plan', input }) }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareConnectorLaunch(launch.context, { id: 'nmap' }, 'workbuddy');
  assert.deepEqual(channelCalls(launch, 'previewSoftwareConnectorLaunchPlan')[0].args[0], { workspaceRoot: 'E:/ws', platformId: 'workbuddy', softwareId: 'nmap' });
});

test('previewSoftwareRevert distinguishes an import rollback from a publish rollback', async () => {
  const h = harness({ impl: { previewSoftwareRevertPlan: async (input) => ({ id: 'plan', input }) }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareRevert(h.context, { checkpointPath: '/ck', action: 'software-import' });
  assert.equal(channelCalls(h, 'previewSoftwareRevertPlan')[0].args[0].checkpointPath, '/ck');
  assert.match(lastMessage(h), /本体将移入 inbox\/trash，备份保留/);

  const publish = harness({ impl: { previewSoftwareRevertPlan: async () => ({ id: 'plan' }) }, values: { workspace: 'E:/ws' } });
  await softwareCommands().previewSoftwareRevert(publish.context, { checkpointPath: '/ck', action: 'software-recipe-publish' });
  assert.match(lastMessage(publish), /已发布版本保留/);
});

// ── plans / executePlan ──────────────────────────────────────────────────────

let windowEvents;
test.before(() => {
  windowEvents = [];
  globalThis.window = {
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.init = init; } },
    dispatchEvent: (event) => { windowEvents.push(event); return true; }
  };
});
test.after(() => { delete globalThis.window; });

function planHarness(planPreview, { impl = {}, planPayload = null, values = {} } = {}) {
  return harness({
    impl,
    values: {
      workspace: 'E:/ws', planPreview, planPayload,
      reloadIntegrationTarget: async () => {}, inspectAnchor: async () => {},
      ...values
    }
  });
}

test('executePlan ignores a missing preview and any kind outside the write list', async () => {
  const none = planHarness(null);
  await plansCommands().executePlan(none.context);
  assert.equal(none.calls.length, 0);

  const readOnly = planHarness({ kind: 'not-a-write-kind' });
  await plansCommands().executePlan(readOnly.context);
  assert.equal(wasCalled(readOnly, 'applyPlan'), false);
  assert.equal(wasCalled(readOnly, 'confirm'), false, 'the kind gate runs before the confirmation');
});

test('executePlan opens a software location only after an explicit confirmation', async () => {
  const declined = planHarness({ kind: 'software-action', target: { mode: 'open-location', bodyPath: 'C:/sw', softwareId: 'nmap', platformId: 'workbuddy' } }, { impl: { confirm: async () => false } });
  await plansCommands().executePlan(declined.context);
  assert.equal(wasCalled(declined, 'openSoftwareLocation'), false);

  const h = planHarness({ kind: 'software-action', target: { mode: 'open-location', bodyPath: 'C:/sw', softwareId: 'nmap', platformId: 'workbuddy' } }, {
    impl: { openSoftwareLocation: async (input) => ({ ok: true, input }) }
  });
  await plansCommands().executePlan(h.context);
  assert.deepEqual(channelCalls(h, 'openSoftwareLocation')[0].args[0], { workspaceRoot: 'E:/ws', softwareId: 'nmap', platformId: 'workbuddy', expectedPath: 'C:/sw' });
  assert.deepEqual(setterArgs(h, 'setPlanPreview'), [null]);
  assert.match(lastMessage(h), /已打开软件本体目录/);
});

test('executePlan stops at a declined confirmation and writes nothing', async () => {
  const h = planHarness({ kind: 'document-edit', target: { path: 'docs/a.md' } }, { impl: { confirm: async () => false } });
  await plansCommands().executePlan(h.context);
  assert.equal(wasCalled(h, 'applyPlan'), false);
  assert.equal(wasCalled(h, 'verifyPlan'), false);
});

test('executePlan applies, verifies and rescans on the ordinary path', async () => {
  const h = planHarness({ kind: 'document-edit', target: { path: 'docs/a.md' } }, {
    impl: {
      applyPlan: async (input) => ({ status: 'applied', input }),
      verifyPlan: async () => ({ ok: true }),
      scanWorkspace: async () => ({ git: { status: ['x'] } })
    }
  });
  await plansCommands().executePlan(h.context);
  const applied = channelCalls(h, 'applyPlan')[0].args[0];
  assert.equal(applied.actor, 'local-user');
  assert.equal(applied.plan.kind, 'document-edit');
  assert.deepEqual(setterArgs(h, 'setGitDetails')[0].status, ['x']);
  assert.deepEqual(setterArgs(h, 'setPlanPreview'), [null]);
  assert.deepEqual(setterArgs(h, 'setPlanPayload'), [null]);
  assert.match(lastMessage(h), /计划已执行，验证通过/);
  assert.deepEqual(setterArgs(h, 'setBusy'), [true, false]);
});

test('executePlan clears a credential payload immediately but keeps a draft for retry', async () => {
  const credential = planHarness({ kind: 'mcp-credential', target: { path: 'x' } }, {
    impl: { applyPlan: async () => ({ status: 'applied' }), verifyPlan: async () => ({ ok: true }), scanWorkspace: async () => ({}) },
    planPayload: { credentialValue: 'secret' }
  });
  await plansCommands().executePlan(credential.context);
  assert.deepEqual(setterArgs(credential, 'setPlanPayload'), [null, null], 'a credential is cleared right after the apply and again on the shared path');

  const document = planHarness({ kind: 'document-edit', target: { path: 'docs/a.md' } }, {
    impl: { applyPlan: async (input) => ({ status: 'applied', afterTextSeen: input.afterText }), verifyPlan: async () => ({ ok: true }), scanWorkspace: async () => ({}) },
    planPayload: { afterText: 'draft' }
  });
  await plansCommands().executePlan(document.context);
  assert.equal(channelCalls(document, 'applyPlan')[0].args[0].afterText, 'draft', 'the draft reaches the apply call');
  assert.deepEqual(setterArgs(document, 'setPlanPayload'), [null], 'a draft survives the apply and is cleared once, at the end');
});

test('executePlan reports a stop that landed between atomic steps', async () => {
  const h = planHarness({ kind: 'document-edit', target: { path: 'docs/a.md' } }, {
    impl: { applyPlan: async () => ({ stoppedAfterCompletion: true }) }
  });
  await plansCommands().executePlan(h.context);
  assert.match(lastMessage(h), /停止请求到达时当前原子步骤已完成/);
  assert.equal(wasCalled(h, 'verifyPlan'), false, 'a stopped run must not be verified as if it finished');
  assert.deepEqual(setterArgs(h, 'setPlanPreview'), [null]);
});

test('executePlan keeps a partially completed onboarding previewable', async () => {
  const h = planHarness({ kind: 'platform-onboarding', target: { platformId: 'workbuddy' } }, {
    impl: { applyPlan: async () => ({ status: 'stopped', stoppedAt: 'platform-configuration', error: 'NATIVE_SERVICE_REQUIRED' }) }
  });
  await plansCommands().executePlan(h.context);
  assert.match(lastMessage(h), /接入已停止在 platform-configuration/);
  assert.match(lastMessage(h), /NATIVE_SERVICE_REQUIRED/);
  assert.equal(setterArgs(h, 'setPlanPreview').length, 0, 'the preview must survive so the run can continue');
});

test('executePlan drives the global update without a confirmation and announces both ends', async () => {
  windowEvents = [];
  const h = planHarness({ kind: 'platform-global-update', target: { platformIds: ['a', 'b'] } }, {
    impl: {
      applyPlan: async () => ({ results: [{ status: 'complete' }, { status: 'stopped' }], skipped: [] }),
      verifyPlan: async () => ({ ok: true }),
      scanWorkspace: async () => ({ git: null })
    }
  });
  await plansCommands().executePlan(h.context);
  assert.equal(wasCalled(h, 'confirm'), false, 'the global update runs without a per-run confirmation by design');
  assert.deepEqual(windowEvents.map((event) => event.type), ['global-update-started', 'global-update-result']);
  assert.equal(windowEvents[0].init.detail.workspaceRoot, 'E:/ws');
  assert.match(lastMessage(h), /1 个完成，1 个待补或已停止，0 个跳过/);
  assert.equal(wasCalled(h, 'scanWorkspace'), true);
});

test('executePlan reports a failed anchor alignment with the actual differences', async () => {
  const h = planHarness({ kind: 'platform-anchor-alignment', target: { platformId: 'workbuddy', anchorDigest: 'd' } }, {
    impl: {
      applyPlan: async () => ({ status: 'applied' }),
      verifyPlan: async () => ({ ok: false, differences: [{ key: 'engine', current: '1.0.0', expected: '1.1.0' }] }),
      scanWorkspace: async () => ({ git: null })
    }
  });
  await plansCommands().executePlan(h.context);
  assert.match(lastMessage(h), /workbuddy 的配置已写入，但回读未通过：engine 1\.0\.0→1\.1\.0/);
  assert.equal(wasCalled(h, 'checkAfterAnchorAlignment'), false);
  assert.equal(wasCalled(h, 'scanWorkspace'), true, 'the shared rescan runs before the per-kind branches');
});

test('executePlan re-certifies a platform after a successful anchor alignment', async () => {
  const h = planHarness({ kind: 'platform-anchor-alignment', target: { platformId: 'workbuddy', anchorDigest: 'd' } }, {
    impl: {
      applyPlan: async () => ({ status: 'applied' }),
      verifyPlan: async () => ({ ok: true }),
      checkAfterAnchorAlignment: async (input) => ({ status: 'complete', firstCertification: { counts: { pass: 41, fail: 0 } }, input }),
      scanWorkspace: async () => ({ git: null })
    }
  });
  await plansCommands().executePlan(h.context);
  const input = channelCalls(h, 'checkAfterAnchorAlignment')[0].args[0];
  assert.equal(input.platformId, 'workbuddy');
  assert.equal(input.anchorDigestSha256, 'd');
  assert.match(lastMessage(h), /矩阵 41 通过 \/ 0 失败/);
  assert.deepEqual(setterArgs(h, 'setTransactionProgress'), [null, { phase: 'workbuddy 对齐后认证', state: 'running' }, null, null], 'the branch finally and the outer finally both release the progress');
});

test('executePlan relays a software connector reply verbatim', async () => {
  const ok = planHarness({ kind: 'software-command', target: { capability: 'nmap-scan' } }, {
    impl: { applyPlan: async () => ({ reply: { ok: true, state: 'healthy' } }), verifyPlan: async () => ({ ok: true }), scanWorkspace: async () => ({}) }
  });
  await plansCommands().executePlan(ok.context);
  assert.match(lastMessage(ok), /连接器已返回真实结果：healthy/);

  const ambiguous = planHarness({ kind: 'software-command', target: { capability: 'nmap-scan' } }, {
    impl: { applyPlan: async () => ({ reply: { error: { named: { nativeCallMayHaveRun: true } } } }), verifyPlan: async () => ({ ok: true }), scanWorkspace: async () => ({}) }
  });
  await plansCommands().executePlan(ambiguous.context);
  assert.match(lastMessage(ambiguous), /功能可能已经执行，返回结果未能确认；请先核实，勿重复提交/);
});

// ── shared request coordinator ───────────────────────────────────────────────

test('the coordinator invalidates pending work when the session changes', () => {
  const control = requestCoordinator('s1');
  const first = control.begin('git');
  assert.equal(first.current(), true);
  control.updateSession('s2');
  assert.equal(first.current(), false);
  assert.throws(() => first.assert(), /STALE_TASK_RESULT/);
});

test('a newer request on the same key retires the older guard', () => {
  const control = requestCoordinator('s1');
  const first = control.begin('plan-surface');
  const second = control.begin('plan-surface');
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  control.invalidate('plan-surface');
  assert.equal(second.current(), false);
});

test('scopedContext drops late setters and refuses stale api resolutions', async () => {
  const seen = [];
  const base = {
    setMessage: (value) => seen.push(['message', value]),
    api: {
      slow: async () => { await Promise.resolve(); return 'value'; },
      quick: () => 'now'
    }
  };
  const control = requestCoordinator('s1');
  const scope = control.begin('git');
  const scoped = scopedContext(base, scope);
  assert.equal(await scoped.api.slow(), 'value');
  scoped.setMessage('fresh');
  assert.deepEqual(seen, [['message', 'fresh']]);

  control.updateSession('s2');
  const stale = scopedContext(base, control.begin('git'));
  control.updateSession('s3');
  stale.setMessage('late');
  assert.equal(seen.length, 1, 'a stale setter must not reach the real state');
  await assert.rejects(async () => stale.api.slow(), /STALE_TASK_RESULT/);
  await assert.rejects(async () => stale.api.quick(), /STALE_TASK_RESULT/);
});
