// Seed integration tests (P6, owner requirements ①/②, rulings 2026-10-13/14):
// empty workspaces get the seed laid down and verified; non-empty workspaces
// are authoritative and never overwritten; seed absence changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { locateSeed, assessSeed, applySeed } from '../src/domains/onboarding/onboarding-seed.mjs';

const SEED_FILES = {
  'tool/registry.json': JSON.stringify({ schema: 'ai-tool-registry/v2', version: 1, workflows: [{ id: 'demo-flow', current: 'demo-flow/current.json', enabled: true, kind: 'workflow', invocable: true }] }, null, 2),
  'tool/demo-flow/current.json': JSON.stringify({ schema: 'ai-workflow-pointer/v1', id: 'demo-flow', version: '1.0.0', hashManifest: 'SHA256SUMS' }, null, 2),
  'tool/demo-flow/versions/1.0.0/manifest.json': '{"kind":"workflow"}\n',
  'tool/demo-flow/versions/1.0.0/flow.json': '{"steps":[]}\n',
  'agent/registry.json': JSON.stringify({ schema: 'ai-agent-registry/v1', version: 1, agents: [] }, null, 2),
  'software/registry.json': JSON.stringify({ schema: 'ai-software-registry/v1', version: 1, software: [] }, null, 2)
};

function materialize(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}

function buildSeed(seedRoot, overrides = {}) {
  rmSync(seedRoot, { recursive: true, force: true });
  const files = { ...SEED_FILES, ...overrides };
  materialize(seedRoot, files);
  const index = {};
  let bytes = 0;
  for (const [rel, content] of Object.entries(files)) {
    const buffer = Buffer.from(content);
    index[rel] = { sha256: sha256(buffer), size: buffer.length };
    bytes += buffer.length;
  }
  const manifest = { schema: 'ai-seed-manifest/v1', generatedAt: '2026-10-14T00:00:00.000Z', workspaceRoot: 'test', totals: { files: Object.keys(files).length, bytes }, files: index };
  writeFileSync(join(seedRoot, 'seed-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return seedRoot;
}

function scratch(label) {
  const root = join(tmpdir(), `manager-seed-test-${label}-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

test('locateSeed prefers the packaged resources and falls back to the dev root', () => {
  const base = scratch('locate');
  const packaged = buildSeed(join(base, 'resources', 'seed'));
  const dev = buildSeed(join(base, 'dev', 'seed'));
  assert.equal(locateSeed({ resourcesPath: join(base, 'resources'), devRoot: join(base, 'dev') }), packaged);
  assert.equal(locateSeed({ resourcesPath: join(base, 'missing'), devRoot: join(base, 'dev') }), dev);
  assert.equal(locateSeed({ resourcesPath: join(base, 'missing'), devRoot: join(base, 'also-missing') }), null);
});

test('applySeed lays an empty workspace down and records a verified apply', () => {
  const workspaceRoot = scratch('empty');
  const seedRoot = buildSeed(join(scratch('empty-seed'), 'seed'));
  const result = applySeed({ workspaceRoot, seedRoot });
  assert.equal(result.applied, true);
  assert.equal(result.assessment.status, 'seeded');
  assert.equal(result.record.filesApplied, Object.keys(SEED_FILES).length);
  assert.equal(result.record.verified, true);
  assert.ok(existsSync(result.record.recordPath));
  for (const rel of Object.keys(SEED_FILES)) assert.ok(existsSync(join(workspaceRoot, rel)), rel);
  const replay = applySeed({ workspaceRoot, seedRoot });
  assert.equal(replay.applied, false);
  assert.equal(replay.assessment.status, 'workspace-authoritative');
  assert.deepEqual(replay.assessment.registryMissing, []);
  assert.deepEqual(replay.assessment.registryDrifted, []);
});

test('applySeed never overwrites a non-empty workspace even when registries drifted', () => {
  const workspaceRoot = scratch('nonempty');
  materialize(workspaceRoot, { 'tool/registry.json': '{"schema":"ai-tool-registry/v2","version":99}' });
  const before = readFileSync(join(workspaceRoot, 'tool/registry.json'));
  const seedRoot = buildSeed(join(scratch('nonempty-seed'), 'seed'));
  const result = applySeed({ workspaceRoot, seedRoot });
  assert.equal(result.applied, false);
  assert.equal(result.assessment.status, 'workspace-authoritative');
  assert.deepEqual(result.assessment.registryDrifted, ['tool']);
  assert.deepEqual(result.assessment.registryMissing, ['agent', 'software']);
  assert.ok(before.equals(readFileSync(join(workspaceRoot, 'tool/registry.json'))));
  assert.ok(!existsSync(join(workspaceRoot, 'agent/registry.json')));
});

test('assessSeed reports seed-absent without touching the workspace', () => {
  const workspaceRoot = scratch('absent');
  const assessment = assessSeed({ workspaceRoot, seedRoot: join(scratch('absent-seed'), 'seed') });
  assert.equal(assessment.status, 'seed-absent');
  assert.equal(assessment.workspaceEmpty, true);
  assert.ok(!existsSync(join(workspaceRoot, 'tool')));
});

test('applySeed fails closed on seed integrity mismatch', () => {
  const workspaceRoot = scratch('integrity');
  const seedRoot = buildSeed(join(scratch('integrity-seed'), 'seed'));
  const manifestPath = join(seedRoot, 'seed-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files['tool/registry.json'].sha256 = '0'.repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => applySeed({ workspaceRoot, seedRoot }), /SEED_INTEGRITY_MISMATCH:tool\/registry\.json/);
});
