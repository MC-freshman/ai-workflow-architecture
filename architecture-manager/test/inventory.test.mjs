import {seedRelease,seedPointer} from './support/resources.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertWithinRoot, FORMAL_TOP_LEVEL_DIRECTORIES, inspectPlatformDirectory, scanWorkspace } from '../src/domains/resources/inventory.mjs';
import { buildPlatformViewPlan, buildResourcePointerPlan } from '../src/domains/plans/plans.mjs';
import { buildRegistryPlan, readCatalogEntry } from '../src/domains/resources/catalog.mjs';
import { buildDocumentPlan, readDocument } from '../src/domains/docs/documents.mjs';
import { buildSoftwareLaunchPlan, listSoftware } from '../src/domains/software/software.mjs';
import { buildGitPlan, scanSensitiveFiles } from '../src/domains/git/git.mjs';
import { applyPlan, verifyPlanTarget } from '../src/transactions/router.mjs';
import { buildIntegrationPlan, listIntegrationTargets, readIntegrationTarget, suggestPlatformBridge } from '../src/domains/platforms/integration.mjs';
import { inspectPlatformConnection, runPlatformCheck } from '../src/domains/platforms/platform-check.mjs';
import { latestStableVersion } from '../src/core/versions.mjs';
import { buildSoftwareImportPlan } from '../src/domains/software/software-intake.mjs';
import { applySoftwareRecipe, buildSoftwareRecipePlan, listSoftwareIntakes, verifySoftwareRecipe } from '../src/domains/software/software-publish.mjs';
import { buildSoftwareRevertPlan, listSoftwareRecoveries } from '../src/domains/software/software-recovery.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'architecture-manager-'));
  mkdirSync(join(root, 'tool', 'demo'), { recursive: true });
  mkdirSync(join(root, 'agent', 'demo'), { recursive: true });
  mkdirSync(join(root, 'software', 'demo'), { recursive: true });
  mkdirSync(join(root, 'versions'), { recursive: true });
  mkdirSync(join(root, 'codex', 'bridge'), { recursive: true });
  writeFileSync(join(root, 'tool', 'demo', 'current.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }));
  writeFileSync(join(root, 'agent', 'demo', 'current.json'), JSON.stringify({ id: 'demo-agent', version: '1.0.0' }));
  writeFileSync(join(root, 'software', 'demo', 'current.json'), JSON.stringify({ id: 'demo-software', version: '1.0.0' }));
  mkdirSync(join(root, 'software', 'demo', 'versions', '1.1.0'), { recursive: true });
  writeFileSync(join(root, 'software', 'demo', 'versions', '1.1.0', 'SHA256SUMS'), 'demo\n');
  mkdirSync(join(root, 'tool', 'demo', 'versions', '1.1.0'), { recursive: true });
  seedRelease(root,'tool','demo','1.1.0');
  seedRelease(root,'software','demo','1.1.0');
  for(const repository of ['tool','agent','software']) seedPointer(root,repository,'demo','1.0.0');
  writeFileSync(join(root, 'codex', 'bridge', 'bridge.json'), JSON.stringify({ schema: 'ai-platform-bridge/v1', platform: 'codex', shared: { agentRegistry: join(root, 'agent', 'registry.json'), toolRegistry: join(root, 'tool', 'registry.json'), architecturePrompt: join(root, 'AI_ARCHITECTURE_SYSTEM_PROMPT.md'), readOnly: true }, runtimeRoot: join(root, 'codex', 'runtime'), modes: ['workflow'] }, null, 2));
  writeFileSync(join(root, 'versions', 'architecture.md'), '# test');
  return root;
}

test('scans a workspace without writing', () => {
  const root = fixture();
  try {
    const result = scanWorkspace(root);
    assert.equal(result.schema, 'architecture-manager-inventory/v2');
    assert.equal(result.writePerformed, false);
    assert.equal(result.sharedRepositories[0].pointers[0].version, '1.0.0');
    assert.equal(result.platforms.find((item) => item.id === 'codex').bridge, 'codex/bridge/bridge.json');
    assert.equal(result.platforms.find((item) => item.id === 'codex').markers.filter((item) => item.label === 'bridge.json').length, 1);
    assert.deepEqual(result.architectureDocuments, ['versions/architecture.md']);
    assert.equal(result.documentSummaries[0].bytes > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('suggests the newest stable release without silently changing current', () => {
  assert.equal(latestStableVersion(['1.9.0', '1.10.0', '2.0.0-beta.1', '1.8.9']), '1.10.0');
  const root = fixture();
  try {
    const before = readFileSync(join(root, 'tool', 'demo', 'current.json'), 'utf8');
    const pointer = scanWorkspace(root).sharedRepositories.find((repo) => repo.repository === 'tool').pointers[0];
    assert.equal(pointer.latestStableVersion, '1.1.0');
    assert.equal(pointer.version, '1.0.0');
    assert.equal(readFileSync(join(root, 'tool', 'demo', 'current.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('shows the update log first with the same document kind in scan and read views', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'versions', '更新日志.md'), '# 更新日志\n');
    const inventory = scanWorkspace(root);
    assert.equal(FORMAL_TOP_LEVEL_DIRECTORIES.includes('architecture-manager'), true);
    // D-165: the registered CN platform belongs to the formal list; a top-level directory the
    // workspace never had does not (ai学习笔记 lives under inbox/ since 2026-09-29).
    assert.equal(FORMAL_TOP_LEVEL_DIRECTORIES.includes('qoder-cn'), true);
    assert.equal(FORMAL_TOP_LEVEL_DIRECTORIES.includes('ai学习笔记'), false);
    assert.equal(inventory.architectureDocuments[0], 'versions/更新日志.md');
    assert.equal(inventory.documentSummaries[0].kind, 'update-log');
    assert.equal(readDocument(root, 'versions/更新日志.md').kind, 'update-log');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates platform markers and persists only a local view plan', () => {
  const root = fixture();
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = join(root, 'localappdata');
  try {
    const inspected = inspectPlatformDirectory(root, 'codex');
    assert.equal(inspected.validForView, true);
    const plan = buildPlatformViewPlan({ workspaceRoot: root, platformId: 'codex', currentEnabled: true, desiredEnabled: false, directoryRelative: inspected.directoryRelative, markers: inspected.markers });
    const applied = applyPlan({ plan, auditRoot: join(root, 'audit') });
    assert.equal(applied.status, 'applied');
    assert.equal(verifyPlanTarget({ plan }).actualEnabled, false);
    assert.equal(existsSync(join(root, 'codex', 'bridge', 'bridge.json')), true);
  } finally {
    process.env.LOCALAPPDATA = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('reads full agent/skill entries and applies a guarded registry plan', () => {
  const root = fixture();
  mkdirSync(join(root, 'agent', 'demo', 'versions', '1.0.0'), { recursive: true });
  mkdirSync(join(root, 'tool', '_registry'), { recursive: true });
  writeFileSync(join(root, 'agent', 'demo', 'versions', '1.0.0', 'manifest.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }));
  writeFileSync(join(root, 'agent', 'demo', 'versions', '1.0.0', 'prompt.md'), '# Demo agent\n');
  writeFileSync(join(root, 'agent', 'registry.json'), JSON.stringify({ schema:'ai-agent-registry/v2',version:1,agents: [{ id: 'demo', current:'demo/current.json', version: '1.0.0', enabled: true }] }, null, 2));
  writeFileSync(join(root, 'tool', '_registry', 'skills-demo.json'), JSON.stringify({schema:'ai-skill-catalog/v1', skills: [{ id: 'demo-skill', version: '1.0.0' }] }, null, 2));
  writeFileSync(join(root, 'tool', 'registry.json'), JSON.stringify({ schema:'ai-tool-registry/v2',version:1,skills: [{ id: 'skills-demo', path: '_registry/skills-demo.json', kind: 'skill-catalog', enabled: true }] }, null, 2));
  try {
    const detail = readCatalogEntry({ workspaceRoot: root, kind: 'agent', id: 'demo' });
    assert.match(detail.prompt, /Demo agent/);
    const skill = readCatalogEntry({ workspaceRoot: root, kind: 'skill', id: 'skills-demo' });
    assert.equal(skill.skillCount, 1);
    const before = readFileSync(join(root, 'agent', 'registry.json'), 'utf8');
    const plan = buildRegistryPlan({ workspaceRoot: root, kind: 'agent', action: 'disable', id: 'demo', baselineSha256: createHash('sha256').update(before, 'utf8').digest('hex') });
    const applied = applyPlan({ plan, afterText: plan.payload.afterText, auditRoot: join(root, 'audit') });
    assert.equal(applied.status, 'applied');
    assert.equal(JSON.parse(readFileSync(join(root, 'agent', 'registry.json'), 'utf8')).agents[0].enabled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('registry guard ignores obsolete releases but blocks the active release', () => {
  const root = fixture();
  const agentRegistry = join(root, 'agent', 'registry.json');
  const oldRelease = join(root, 'tool', 'demo', 'versions', '1.0.0');
  const activeRelease = join(root, 'tool', 'demo', 'versions', '1.1.0');
  mkdirSync(oldRelease, { recursive: true });
  mkdirSync(activeRelease, { recursive: true });
  writeFileSync(join(root, 'tool', 'demo', 'current.json'), JSON.stringify({ id: 'demo', version: '1.1.0' }));
  writeFileSync(join(root, 'tool', 'registry.json'), JSON.stringify({ workflows: [{ id: 'demo', enabled: true }] }));
  writeFileSync(join(oldRelease, 'workflow.yaml'), 'agent: game-builder\n');
  writeFileSync(join(activeRelease, 'workflow.yaml'), 'agent: other-agent\n');
  seedPointer(root,'agent','game-builder','1.0.0');
  writeFileSync(agentRegistry,JSON.stringify({schema:'ai-agent-registry/v2',version:1,agents:[{id:'game-builder',current:'game-builder/current.json',enabled:true}]}));
  try {
    const baselineSha256 = createHash('sha256').update(readFileSync(agentRegistry, 'utf8')).digest('hex');
    assert.doesNotThrow(() => buildRegistryPlan({ workspaceRoot: root, kind: 'agent', action: 'disable', id: 'game-builder', baselineSha256 }));
    writeFileSync(join(activeRelease, 'workflow.yaml'), 'agent: game-builder\n');
    assert.throws(() => buildRegistryPlan({ workspaceRoot: root, kind: 'agent', action: 'disable', id: 'game-builder', baselineSha256 }), /RESOURCE_REFERENCED:.*1\.1\.0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('classifies corrupt current.json instead of treating it as green', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'tool', 'demo', 'current.json'), '{broken');
    const result = scanWorkspace(root);
    assert.equal(result.sharedRepositories[0].pointers[0].valid, false);
    assert.match(result.sharedRepositories[0].pointers[0].error, /Unexpected|JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a missing root and paths outside the selected root', () => {
  assert.throws(() => scanWorkspace(join(tmpdir(), 'does-not-exist')), /not an existing directory/);
  const root = fixture();
  try {
    assert.throws(() => assertWithinRoot(root, tmpdir()), /outside workspace root/);
    assert.equal(assertWithinRoot(root, join(root, 'tool')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates a reversible platform view plan without applying it', () => {
  const plan = buildPlatformViewPlan({
    workspaceRoot: 'C:/workspace',
    platformId: 'codex',
    currentEnabled: true,
    desiredEnabled: false,
    now: '2026-09-25T00:00:00.000Z'
  });
  assert.equal(plan.kind, 'platform-view');
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.steps[0].operation, 'update-local-view');
  assert.equal(plan.steps[0].newValue, false);
});

test('rejects a stale or unavailable resource pointer target', () => {
  assert.throws(() => buildResourcePointerPlan({
    workspaceRoot: 'C:/workspace',
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    availableVersions: ['1.0.0']
  }), /TARGET_VERSION_UNAVAILABLE/);
  assert.throws(() => buildResourcePointerPlan({
    workspaceRoot: 'C:/workspace',
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.0.0',
    availableVersions: ['1.0.0']
  }), /NO_CHANGE/);
});

test('protects top-level requirements and creates a hashed document plan', () => {
  const beforeText = '# 原文\n';
  assert.throws(() => buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/架构基本原则.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256: 'wrong'
  }), /DOCUMENT_BASELINE_MISMATCH/);
  const baselineSha256 = createHash('sha256').update(beforeText, 'utf8').digest('hex');
  assert.throws(() => buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/架构基本原则.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256
  }), /TOP_LEVEL_CONFIRMATION_REQUIRED/);
  const plan = buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/普通文档.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256,
    now: '2026-09-25T00:00:00.000Z'
  });
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.steps[0].oldSha256, baselineSha256);
});

test('lists registered software and makes absent launch executor explicit', () => {
  const root = fixture();
  try {
    const software = listSoftware(root);
    assert.equal(software.length, 1);
    assert.equal(software[0].id, 'demo');
    const plan = buildSoftwareLaunchPlan({ workspaceRoot: root, softwareId: 'demo', mode: 'launch', now: '2026-09-25T00:00:00.000Z' });
    assert.equal(plan.kind, 'software-action');
    assert.equal(plan.writePerformed, false);
    assert.equal(plan.steps[0].dispatch, 'unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('imports a new software file into one platform with a full backup and real restore drill', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const source = join(root, 'downloaded-tool.exe');
  writeFileSync(source, 'harmless-test-body');
  try {
    const plan = buildSoftwareImportPlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'new-tool', sourcePath: source, intakeKind: 'portable-file', now: '2026-09-28T12:00:00.000Z' });
    assert.equal(plan.writePerformed, false);
    const progress = [];
    const result = applyPlan({ plan, auditRoot, onProgress: (item) => progress.push(item) });
    assert.equal(result.status, 'staged-awaiting-recipe');
    assert.equal(result.restored, true);
    assert.equal(progress.at(-1).stage, 'restore-and-body');
    assert.equal(existsSync(result.checkpointPath), true);
    assert.match(readFileSync(join(auditRoot, 'events.jsonl'), 'utf8'), /software-import/);
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    assert.equal(readFileSync(join(root, 'codex', 'runtime', 'software', 'new-tool', 'downloaded-tool.exe'), 'utf8'), 'harmless-test-body');
    assert.equal(existsSync(join(root, 'software', 'new-tool')), false);
    const recovery = listSoftwareRecoveries({ workspaceRoot: root, auditRoot })[0];
    const revertPlan = buildSoftwareRevertPlan({ workspaceRoot: root, checkpointPath: recovery.checkpointPath, auditRoot });
    const reverted = applyPlan({ plan: revertPlan, auditRoot });
    assert.equal(reverted.status, 'reverted');
    assert.equal(verifyPlanTarget({ plan: revertPlan }).ok, true);
    assert.equal(existsSync(join(root, 'codex', 'runtime', 'software', 'new-tool')), false);
    assert.equal(existsSync(result.backup), true);
    assert.equal(existsSync(reverted.movedTo), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('software import refuses changed source bytes before any copy', () => {
  const root = fixture();
  const source = join(root, 'downloaded-tool.exe');
  writeFileSync(source, 'first');
  try {
    const plan = buildSoftwareImportPlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'new-tool', sourcePath: source, intakeKind: 'portable-file', now: '2026-09-28T12:00:00.000Z' });
    writeFileSync(source, 'changed');
    assert.throws(() => applyPlan({ plan }), /SOFTWARE_SOURCE_CHANGED/);
    assert.equal(existsSync(join(root, 'codex', 'runtime', 'software', 'new-tool')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('software import checkpoint interruption leaves no body or backup', () => {
  const root = fixture();
  const source = join(root, 'downloaded-tool.exe');
  writeFileSync(source, 'body');
  try {
    const plan = buildSoftwareImportPlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'new-tool', sourcePath: source, intakeKind: 'portable-file' });
    assert.throws(() => applyPlan({ plan, auditRoot: join(root, 'audit'), failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
    assert.equal(existsSync(plan.target.path), false);
    assert.equal(existsSync(plan.target.backup), false);
    assert.match(readFileSync(join(root, 'audit', 'events.jsonl'), 'utf8'), /interrupted-before-write/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('publishes only a probed CLI version capability and binds its platform connector', () => {
  const root = fixture();
  const source = join(root, 'my-tool.exe');
  writeFileSync(source, 'test-only-executable-bytes');
  writeFileSync(join(root, 'software', 'registry.json'), JSON.stringify({ schema: 'ai-software-registry/v1', version: 1, software: [] }));
  writeFileSync(join(root, 'codex', 'bridge', 'software-gateway-config.json'), JSON.stringify({ softwareRoot: join(root, 'software'), bodies: {} }));
  writeFileSync(join(root, 'codex', 'bridge', 'runner-config.json'), JSON.stringify({ platform: 'codex', softwareGateway: join(root, 'software', '_connector', 'versions', '1.0.7', 'connector.py'), softwareGatewayConfig: join(root, 'codex', 'bridge', 'software-gateway-config.json') }));
  const probeVersion = () => 'my-tool 1.2.3';
  try {
    applyPlan({ plan: buildSoftwareImportPlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'my-tool', sourcePath: source, intakeKind: 'portable-file', now: '2026-09-28T12:00:00.000Z' }), auditRoot: join(root, 'audit') });
    assert.equal(listSoftwareIntakes({ workspaceRoot: root, platformId: 'codex' })[0].restored, true);
    const plan = buildSoftwareRecipePlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'my-tool', bodyName: 'my-tool.exe', displayName: 'My Tool', upstreamVersion: '1.2.3', license: 'unknown', now: '2026-09-28T12:30:00.000Z' }, { probeVersion });
    assert.equal(plan.writePerformed, false);
    assert.equal(existsSync(join(root, 'software', 'my-tool')), false);
    assert.throws(() => applySoftwareRecipe({ plan }, { probeVersion, auditRoot: join(root, 'audit'), failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
    assert.equal(existsSync(join(root, 'software', 'my-tool')), false);
    const applied = applySoftwareRecipe({ plan }, { probeVersion, auditRoot: join(root, 'audit'), verifyPublished: () => ({ connectorDispatchable: true, singleCellReached: true, issues: [] }) });
    assert.equal(applied.status, 'published-version-only');
    assert.equal(applied.check.singleCellReached, true);
    assert.equal(existsSync(applied.checkpointPath), true);
    assert.match(readFileSync(join(root, 'audit', 'events.jsonl'), 'utf8'), /software-recipe-publish/);
    assert.equal(verifySoftwareRecipe({ plan }).ok, true);
    assert.equal(JSON.parse(readFileSync(join(root, 'software', 'my-tool', 'versions', '1.0.0', 'capabilities.snapshot.json'), 'utf8')).frozen, true);
    assert.equal(JSON.parse(readFileSync(join(root, 'software', 'my-tool', 'current.json'), 'utf8')).version, '1.0.0');
    const checker = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tool', 'repo-lint', 'versions', '0.6.3', 'scripts');
    if (existsSync(checker)) {
      const script = 'import sys,json;sys.path.insert(0,sys.argv[1]);from software_lint import lint_software_root;print(json.dumps(lint_software_root(sys.argv[2],new_release=True)["findings"]))';
      const check = spawnSync('python', ['-B', '-c', script, checker, join(root, 'software')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      assert.equal(check.status, 0, check.stderr);
      assert.deepEqual(JSON.parse(check.stdout), []);
    }
    const recovery = listSoftwareRecoveries({ workspaceRoot: root, auditRoot: join(root, 'audit') }).find((item) => item.action === 'software-recipe-publish');
    const revertPlan = buildSoftwareRevertPlan({ workspaceRoot: root, checkpointPath: recovery.checkpointPath, auditRoot: join(root, 'audit') });
    const reverted = applyPlan({ plan: revertPlan, auditRoot: join(root, 'audit') });
    assert.equal(reverted.status, 'reverted');
    assert.equal(verifyPlanTarget({ plan: revertPlan }).ok, true);
    assert.equal(existsSync(join(root, 'software', 'my-tool', 'versions', '1.0.0')), true);
    assert.equal(JSON.parse(readFileSync(join(root, 'software', 'registry.json'), 'utf8')).software.find((row) => row.id === 'my-tool').enabled, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a published recipe stays pending when connector verification cannot complete', () => {
  const root = fixture();
  const source = join(root, 'my-tool.exe');
  writeFileSync(source, 'test-only-executable-bytes');
  writeFileSync(join(root, 'software', 'registry.json'), JSON.stringify({ schema: 'ai-software-registry/v1', version: 1, software: [] }));
  writeFileSync(join(root, 'codex', 'bridge', 'software-gateway-config.json'), JSON.stringify({ softwareRoot: join(root, 'software'), bodies: {} }));
  writeFileSync(join(root, 'codex', 'bridge', 'runner-config.json'), JSON.stringify({ platform: 'codex', softwareGateway: join(root, 'software', '_connector', 'versions', '1.0.7', 'connector.py'), softwareGatewayConfig: join(root, 'codex', 'bridge', 'software-gateway-config.json') }));
  const probeVersion = () => 'my-tool 1.2.3';
  try {
    applyPlan({ plan: buildSoftwareImportPlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'my-tool', sourcePath: source, intakeKind: 'portable-file' }), auditRoot: join(root, 'audit') });
    const plan = buildSoftwareRecipePlan({ workspaceRoot: root, platformId: 'codex', softwareId: 'my-tool', bodyName: 'my-tool.exe', displayName: 'My Tool', upstreamVersion: '1.2.3', license: 'unknown' }, { probeVersion });
    const result = applySoftwareRecipe({ plan }, { probeVersion, auditRoot: join(root, 'audit'), verifyPublished: () => { throw new Error('connector unavailable'); } });
    assert.equal(result.status, 'published-pending-verification');
    assert.equal(result.check.connectorDispatchable, false);
    assert.equal(verifySoftwareRecipe({ plan }).ok, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('creates guarded Git plans without applying them', () => {
  const root = mkdtempSync(join(tmpdir(), 'am-gitplan-'));
  const run = (args) => spawnSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  run(['init']);
  run(['config', 'user.email', 't@t.local']);
  run(['config', 'user.name', 't']);
  writeFileSync(join(root, 'README.md'), 'x\n');
  run(['add', '--', 'README.md']);
  run(['commit', '-m', 'init']);
  const commit = buildGitPlan({ workspaceRoot: root, action: 'commit', message: 'update manager', paths: ['README.md'], now: '2026-09-25T00:00:00.000Z' });
  assert.equal(commit.kind, 'git-commit');
  assert.equal(commit.writePerformed, false);
  assert.deepEqual(commit.target.paths, ['README.md']);
  run(['remote','add','origin',join(root,'remote.git')]);
  const push = buildGitPlan({ workspaceRoot: root, action: 'push', remote: 'origin' });
  assert.equal(push.steps[0].force, false);
  const rollback = buildGitPlan({ workspaceRoot: root, action: 'rollback', commit: '0123456789abcdef0123456789abcdef01234567' });
  assert.equal(rollback.steps[0].operation, 'revert-commit');
  const backup = buildGitPlan({ workspaceRoot: root, action: 'backup', backupName: 'before-upgrade' });
  assert.match(backup.target.destination, /before-upgrade$/);
  assert.throws(() => buildGitPlan({ workspaceRoot: root, action: 'commit', message: '' }), /COMMIT_MESSAGE_REQUIRED/);
  assert.throws(() => buildGitPlan({ workspaceRoot: root, action: 'commit', message: 'x y z', paths: ['-A'] }), /GIT_ADD_ALL_FORBIDDEN/);
  assert.throws(() => buildGitPlan({ workspaceRoot: root, action: 'rollback', commit: 'nope' }), /INVALID_COMMIT_SHA/);
  assert.throws(() => buildGitPlan({ workspaceRoot: root, action: 'branch', branch: '../escape' }), /INVALID_BRANCH_NAME/);
  rmSync(root, { recursive: true, force: true });
});



test('applies and verifies a document plan with checkpoint and idempotency', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'versions', 'architecture.md');
  const beforeText = readFileSync(target, 'utf8');
  const afterText = '# changed safely\n';
  const plan = buildDocumentPlan({
    workspaceRoot: root,
    relativePath: 'versions/architecture.md',
    beforeText,
    afterText,
    baselineSha256: createHash('sha256').update(beforeText, 'utf8').digest('hex'),
    now: '2026-09-25T00:00:00.000Z'
  });
  try {
    const applied = applyPlan({ plan, afterText, auditRoot, actor: 'test-user', now: '2026-09-25T00:00:01.000Z' });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.writePerformed, true);
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    const repeated = applyPlan({ plan, afterText, auditRoot, actor: 'test-user', now: '2026-09-25T00:00:02.000Z' });
    assert.equal(repeated.status, 'already-applied');
    const audit = readFileSync(join(auditRoot, 'events.jsonl'), 'utf8');
    assert.doesNotMatch(audit, /changed safely/);
    assert.ok(existsSync(applied.checkpointPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks external document changes and preserves the original on interruption', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'versions', 'architecture.md');
  const beforeText = readFileSync(target, 'utf8');
  const afterText = '# planned change\n';
  const plan = buildDocumentPlan({
    workspaceRoot: root,
    relativePath: 'versions/architecture.md',
    beforeText,
    afterText,
    baselineSha256: createHash('sha256').update(beforeText, 'utf8').digest('hex')
  });
  try {
    writeFileSync(target, '# changed outside manager\n');
    assert.throws(() => applyPlan({ plan, afterText, auditRoot }), /EXTERNAL_CHANGE_DETECTED/);
    writeFileSync(target, beforeText);
    assert.throws(() => applyPlan({ plan, afterText, auditRoot, failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
    assert.equal(readFileSync(target, 'utf8'), beforeText);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies and verifies a hashed shared current pointer plan', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'tool', 'demo', 'current.json');
  const beforeText = readFileSync(target, 'utf8');
  const baselineSha256 = createHash('sha256').update(beforeText, 'utf8').digest('hex');
  const plan = buildResourcePointerPlan({
    workspaceRoot: root,
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    availableVersions: ['1.0.0', '1.1.0'],
    baselineSha256
  });
  try {
    const applied = applyPlan({ plan, auditRoot, actor: 'test-user' });
    assert.equal(applied.status, 'applied');
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).version, '1.1.0');
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    const repeated = applyPlan({ plan, auditRoot });
    assert.equal(repeated.status, 'already-applied');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plans and applies GUI integration for platform config and shared resource pointer', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  try {
    const platform = readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'codex' });
    assert.equal(platform.path, 'codex/bridge.json');
    assert.equal(platform.exists, false);
    assert.equal(platform.migrationSource.path, 'codex/bridge/bridge.json');
    const platformPlan = buildIntegrationPlan({
      workspaceRoot: root,
      kind: 'platform',
      targetId: 'codex',
      mode: 'config',
      relativePath: platform.path,
      beforeText: platform.content,
      afterText: suggestPlatformBridge({ workspaceRoot: root, platformId: 'codex' }).afterText,
      baselineSha256: platform.sha256
    });
    assert.equal(platformPlan.kind, 'integration-config');
    assert.equal(applyPlan({ plan: platformPlan, afterText: platformPlan.payload.afterText, auditRoot }).status, 'applied');
    assert.equal(verifyPlanTarget({ plan: platformPlan }).ok, true);

    const current = readIntegrationTarget({ workspaceRoot: root, kind: 'software', targetId: 'demo' });
    const pointerPlan = buildIntegrationPlan({
      workspaceRoot: root,
      kind: 'software',
      targetId: 'demo',
      mode: 'pointer',
      relativePath: current.path,
      baselineSha256: current.sha256,
      targetVersion: '1.1.0',
      availableVersions: ['1.0.0', '1.1.0']
    });
    assert.equal(pointerPlan.kind, 'resource-pointer');
    assert.equal(applyPlan({ plan: pointerPlan, auditRoot }).status, 'applied');
    assert.equal(JSON.parse(readFileSync(join(root, 'software', 'demo', 'current.json'), 'utf8')).version, '1.1.0');
    assert.equal(verifyPlanTarget({ plan: pointerPlan }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migrates a legacy bridge and its runner reference together without deleting the old file', () => {
  const root = fixture();
  const runner = join(root, 'codex', 'bridge', 'runner-config.json');
  const oldBridge = join(root, 'codex', 'bridge', 'bridge.json');
  const newBridge = join(root, 'codex', 'bridge.json');
  writeFileSync(runner, `${JSON.stringify({ platform: 'codex', bridge: oldBridge }, null, 2)}\n`);
  try {
    const suggestion = suggestPlatformBridge({ workspaceRoot: root, platformId: 'codex' });
    const plan = buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', afterText: suggestion.afterText });
    assert.equal(plan.steps.length, 3);
    assert.equal(JSON.parse(readFileSync(runner, 'utf8')).bridge, oldBridge);
    const applied = applyPlan({ plan, auditRoot: join(root, 'audit') });
    assert.equal(applied.status, 'applied');
    assert.equal(JSON.parse(readFileSync(runner, 'utf8')).bridge, newBridge);
    assert.equal(readFileSync(newBridge, 'utf8'), readFileSync(oldBridge, 'utf8'));
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    assert.equal(applyPlan({ plan, auditRoot: join(root, 'audit') }).status, 'already-applied');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bridge migration interrupted after checkpoints leaves both files unchanged', () => {
  const root = fixture();
  const runner = join(root, 'codex', 'bridge', 'runner-config.json');
  const oldBridge = join(root, 'codex', 'bridge', 'bridge.json');
  writeFileSync(runner, `${JSON.stringify({ platform: 'codex', bridge: oldBridge }, null, 2)}\n`);
  const runnerBefore = readFileSync(runner, 'utf8');
  try {
    const plan = buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', afterText: suggestPlatformBridge({ workspaceRoot: root, platformId: 'codex' }).afterText });
    assert.throws(() => applyPlan({ plan, auditRoot: join(root, 'audit'), failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
    assert.equal(existsSync(join(root, 'codex', 'bridge.json')), false);
    assert.equal(readFileSync(runner, 'utf8'), runnerBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('generates a no-code root bridge for an existing platform directory without configuration', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'dsh'));
    const suggestion = suggestPlatformBridge({ workspaceRoot: root, platformId: 'dsh' });
    assert.equal(suggestion.source, 'generated');
    assert.equal(suggestion.nextStep, 'adapter-required');
    const target = readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'dsh' });
    const plan = buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'dsh', beforeText: target.content, afterText: suggestion.afterText, baselineSha256: target.sha256 });
    assert.equal(applyPlan({ plan, afterText: suggestion.afterText, auditRoot: join(root, 'audit') }).status, 'applied');
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    assert.equal(JSON.parse(readFileSync(join(root, 'dsh', 'bridge.json'), 'utf8')).platform, 'dsh');
    assert.equal(inspectPlatformConnection({ workspaceRoot: root, platformId: 'dsh' }).stage, 'adapter-required');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a real platform check when only a bridge marker exists', async () => {
  const root = fixture();
  try {
    assert.equal(inspectPlatformConnection({ workspaceRoot: root, platformId: 'codex' }).stage, 'adapter-required');
    await assert.rejects(() => runPlatformCheck({ workspaceRoot: root, platformId: 'codex' }), /PLATFORM_NOT_READY_FOR_CHECK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects GUI integration paths outside the existing workspace shape and raw secrets', () => {
  const root = fixture();
  try {
    assert.deepEqual(listIntegrationTargets({ workspaceRoot: root, kind: 'platform', targetId: 'codex' }).paths, ['codex/bridge.json']);
    const current = readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'codex' });
    assert.throws(() => buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', relativePath: '../outside.json', beforeText: current.content, afterText: '{}', baselineSha256: current.sha256 }), /INTEGRATION_TARGET_OUTSIDE_WORKSPACE|PLATFORM_CONFIG_TARGET_NOT_ALLOWED/);
    assert.throws(() => buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', relativePath: current.path, beforeText: current.content, afterText: '{"token":"plain-text"}', baselineSha256: current.sha256 }), /RAW_SECRET_NOT_ALLOWED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prefers root bridge and reports divergent legacy bridge without a duplicate marker', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'codex', 'bridge.json'), '{"platform":"codex"}\n');
    const inspected = inspectPlatformDirectory(root, 'codex');
    assert.equal(inspected.bridge, 'codex/bridge.json');
    assert.equal(inspected.bridgeLocation, 'root');
    assert.equal(inspected.bridgeConflict, true);
    assert.equal(inspected.status, 'bridge-conflict');
    assert.equal(inspected.markers.filter((item) => item.label === 'bridge.json').length, 1);
    assert.throws(() => buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', afterText: '{"platform":"codex","x":1}', baselineSha256: readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'codex' }).sha256 }), /PLATFORM_BRIDGE_AUTHORITY_REQUIRED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
