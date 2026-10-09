import {seedRelease,seedPointer} from './support/resources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { buildRegistryPlan } from '../src/catalog.mjs';
import { buildReleasePlan, listResourceReferences, readRegistryBaseline, verifyRelease } from '../src/releases.mjs';
import { applyPlan } from '../src/transactions.mjs';
import {execFileSync} from 'node:child_process';

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'am-release-'));
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-release-audit-'));
  // tool resource with a published 1.0.0
  const toolDir = join(root, 'tool', 'game-pipeline');
  mkdirSync(join(toolDir, 'versions', '1.0.0', 'tests'), { recursive: true });
  writeFileSync(join(toolDir, 'current.json'), `${JSON.stringify({ schema: 'ai-workflow-pointer/v1', id: 'game-pipeline', version: '1.0.0', hashManifest: 'SHA256SUMS' }, null, 2)}\n`);
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-tool-manifest/v2', id: 'game-pipeline', version: '1.0.0', entry: 'workflow.yaml' }, null, 2)}\n`);
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'workflow.yaml'), 'schema: ai-workflow-definition/v3\nid: game-pipeline\nstages: []\n');
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'tests', 'a.txt'), 'test\n');
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'logo.bin'), Buffer.from([1, 0, 2, 0]));
  // another tool resource that references game-pipeline
  const otherDir = join(root, 'tool', 'other-flow');
  mkdirSync(join(otherDir, 'versions', '1.0.0'), { recursive: true });
  writeFileSync(join(otherDir, 'current.json'), `${JSON.stringify({ schema: 'ai-workflow-pointer/v1', id: 'other-flow', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(otherDir, 'versions', '1.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-tool-manifest/v2', id: 'other-flow', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(otherDir, 'versions', '1.0.0', 'workflow.yaml'), 'schema: ai-workflow-definition/v3\nid: other-flow\ndependencies: [game-pipeline]\n');
  // agent resource
  const agentDir = join(root, 'agent', 'game-builder');
  mkdirSync(join(agentDir, 'versions', '2.0.0'), { recursive: true });
  writeFileSync(join(agentDir, 'current.json'), `${JSON.stringify({ schema: 'ai-agent-pointer/v1', id: 'game-builder', version: '2.0.0' }, null, 2)}\n`);
  writeFileSync(join(agentDir, 'versions', '2.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-agent-manifest/v2', id: 'game-builder', version: '2.0.0', prompt: 'prompt.md' }, null, 2)}\n`);
  writeFileSync(join(agentDir, 'versions', '2.0.0', 'prompt.md'), 'body\n');
  // registries
  mkdirSync(join(root, 'tool'), { recursive: true });
  writeFileSync(join(root, 'tool', 'registry.json'), `${JSON.stringify({ schema: 'ai-tool-registry/v2', version: 1, workflows: [{ id: 'game-pipeline', current: 'game-pipeline/current.json', enabled: true, kind: 'workflow', invocable: true }] }, null, 2)}\n`);
  writeFileSync(join(root, 'agent', 'registry.json'), `${JSON.stringify({ schema: 'ai-agent-registry/v2', version: 1, agents: [{ id: 'game-builder', current: 'game-builder/current.json', enabled: true }] }, null, 2)}\n`);
  seedRelease(root,'tool','game-pipeline','1.0.0',{'logo.bin':Buffer.from([1,0,2,0]),'tests/a.txt':'test\n'});
  seedRelease(root,'agent','game-builder','2.0.0');
  seedPointer(root,'agent','game-builder','2.0.0');
  mkdirSync(join(root,'local-client'),{recursive:true});writeFileSync(join(root,'local-client/bridge.json'),JSON.stringify({schema:'ai-platform-bridge/v1',platform:'local-client',shared:{readOnly:true}}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','--','.');git('commit','-m','baseline');
  return { root, auditRoot,platformId:'local-client' };
}

function hashTree(directory) {
  const files = [];
  (function walk(current, prefix) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, rel);
      else files.push([rel, sha256(readFileSync(path, 'utf8'))]);
    }
  })(directory, '');
  return Object.fromEntries(files);
}

test('upgrade preserves the previous version, bumps both identities, and verifies SHA256SUMS', async () => {
  const fixture = makeWorkspace();
  const before = hashTree(join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.0.0'));
  const plan = await buildReleasePlan({ workspaceRoot: fixture.root,platformId:fixture.platformId, repository: 'tool', resourceId: 'game-pipeline', targetVersion:'1.1.0',upgradeFrom:'1.0.0' });
  assert.equal(plan.kind, 'body-import');
  assert.equal(plan.writePerformed, false);
  const applied = await applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(applied.status, 'applied');
  const newRoot = join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.1.0');
  assert.ok(existsSync(newRoot));
  const manifest = JSON.parse(readFileSync(join(newRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '1.1.0');
  const source = JSON.parse(readFileSync(join(newRoot, 'SOURCE.json'), 'utf8'));
  assert.equal(plan.target.settings.sourceVersion, '1.0.0');assert(source.sourcePlanId===plan.planId);
  assert.equal(existsSync(join(newRoot,'logo.bin')),false); // Program/binary bytes do not enter a new shared text release.
  assert.equal((await verifyRelease({ plan })).ok, true);
  const again = await applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(again.status, 'already-applied');
  assert.deepEqual(hashTree(join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.0.0')), before);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('the fresh expert template is callable through an exactly locked main workflow', async () => {
  const fixture=makeWorkspace();
  const plan=await buildReleasePlan({workspaceRoot:fixture.root,platformId:fixture.platformId,repository:'agent',resourceId:'new-expert',targetVersion:'1.0.0'});await applyPlan({plan,auditRoot:fixture.auditRoot});
  const manifest=JSON.parse(readFileSync(join(fixture.root,plan.target.destination,'manifest.json')));assert.equal(manifest.schema,'ai-agent/v2');assert.equal(manifest.runnerWorkflow,'game-pipeline');assert.equal((await verifyRelease({plan})).ok,true);
  rmSync(fixture.root,{recursive:true,force:true});rmSync(fixture.auditRoot,{recursive:true,force:true});
});

test('rejects existing versions, bad semver and missing upgrade sources while allowing new IDs', async () => {
  const fixture = makeWorkspace();
  await assert.rejects(buildReleasePlan({ workspaceRoot: fixture.root,platformId:fixture.platformId, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '1.0.0' }), /RELEASE_VERSION_EXISTS/);
  await assert.rejects(buildReleasePlan({ workspaceRoot: fixture.root,platformId:fixture.platformId, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '1.0' }), /RELEASE_SEMVER_INVALID/);
  assert.equal((await buildReleasePlan({ workspaceRoot: fixture.root,platformId:fixture.platformId, repository: 'tool', resourceId: 'no-such', targetVersion: '1.0.0' })).target.resourceId,'no-such');
  await assert.rejects(buildReleasePlan({ workspaceRoot: fixture.root,platformId:fixture.platformId, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '2.0.0', upgradeFrom: '9.9.9' }), /RELEASE_UPGRADE_SOURCE_MISSING/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('lists references from other current releases before a pointer switch', () => {
  const fixture = makeWorkspace();
  const result = listResourceReferences(fixture.root, 'tool', 'game-pipeline');
  assert.ok(result.references.some((reference) => reference.path.includes('other-flow')), JSON.stringify(result));
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('mark action deprecates without disabling and keeps pinned runs resolvable', () => {
  const fixture = makeWorkspace();
  const baseline = readRegistryBaseline(fixture.root, 'workflow');
  assert.equal(baseline.path, 'tool/registry.json');
  const plan = buildRegistryPlan({ workspaceRoot: fixture.root, kind: 'workflow', action: 'mark', id: 'game-pipeline', entry: { supersededBy: 'game-sprint-plan', deprecationNote: 'collapsed' }, baselineSha256: baseline.sha256 });
  applyPlan({ plan, auditRoot: fixture.auditRoot, afterText: plan.payload.afterText });
  const registry = JSON.parse(readFileSync(join(fixture.root, 'tool', 'registry.json'), 'utf8'));
  const entry = registry.workflows.find((item) => item.id === 'game-pipeline');
  assert.equal(entry.deprecated, true);
  assert.equal(entry.supersededBy, 'game-sprint-plan');
  assert.equal(entry.enabled, true);
  assert.throws(() => buildRegistryPlan({ workspaceRoot: fixture.root, kind: 'workflow', action: 'mark', id: 'game-pipeline', entry: {}, baselineSha256: readRegistryBaseline(fixture.root, 'workflow').sha256 }), /CATALOG_SUPERSEDED_BY_REQUIRED/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});
