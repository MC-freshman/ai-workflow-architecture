import {seedRuntimeReleases} from './support/resources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildOnboardingConfigPlan, applyOnboardingConfig, verifyOnboardingConfig, readOnboardingConfig } from '../src/onboarding-config.mjs';
import { sha256 } from '../src/core/hash.mjs';
import { allPlatformIds } from '../src/core/platforms.mjs';
import { inspectPlatformConnection } from '../src/platform-check.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'manager-config-'));
  const auditRoot = join(root, 'audit');
  const put = (name, value) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value); };
  seedRuntimeReleases(root);
  return { root, auditRoot, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a non-base platform is configured, discovered and checked without source edits or PIN', () => {
  const f = fixture();
  try {
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client' }), /CONFIRMATION_REQUIRED/);
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true, fields: { pythonExecutable: process.execPath } });
    assert.doesNotMatch(JSON.stringify(plan), /<PIN>/);
    applyOnboardingConfig(plan, { auditRoot: f.auditRoot });
    assert.equal(verifyOnboardingConfig(plan).ok, true);
    assert.ok(allPlatformIds(f.root).includes('another-client'));
    assert.equal(inspectPlatformConnection({ workspaceRoot: f.root, platformId: 'another-client' }).stage, 'configured');
    const capabilities = JSON.parse(readFileSync(join(f.root, 'another-client/bridge/capabilities.json')));
    assert.deepEqual(capabilities.checks, {}, 'generated declarations are not evidence');
    const gateway = JSON.parse(readFileSync(join(f.root,'another-client/bridge/software-gateway-config.json')));
    assert.equal(gateway.platformId, 'another-client');
    assert.notEqual(gateway.platform, gateway.platformId, 'OS recipe selection must not use the architecture platform identifier');
  } finally { f.cleanup(); }
});

test('existing fields survive a configuration update and partial writes are restored', () => {
  const f = fixture();
  try {
    const initial = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true });
    applyOnboardingConfig(initial, { auditRoot: f.auditRoot });
    const path = join(f.root, 'another-client/bridge/another-client-config.json');
    const value = JSON.parse(readFileSync(path)); value.customUserSetting = 'preserve';
    writeFileSync(path, JSON.stringify(value));
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { displayName: 'Changed' } });
    const before = plan.payload.files.map((file) => readFileSync(join(f.root, file.path), 'utf8'));
    assert.throws(() => applyOnboardingConfig(plan, { auditRoot: f.auditRoot, failAfterFiles: 2 }), /SIMULATED_INTERRUPT/);
    assert.deepEqual(plan.payload.files.map((file) => readFileSync(join(f.root, file.path), 'utf8')), before);
    applyOnboardingConfig(plan, { auditRoot: f.auditRoot });
    assert.equal(JSON.parse(readFileSync(path)).customUserSetting, 'preserve');
  } finally { f.cleanup(); }
});

test('changed baselines, raw credentials and another platform environment are rejected', () => {
  const f = fixture();
  try {
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true });
    f.put('another-client/bridge.json', '{}');
    assert.throws(() => applyOnboardingConfig(plan, { auditRoot: f.auditRoot }), /BASELINE_MISMATCH/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { apiKey: 'do-not-store' } }), /RAW_SECRET/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { environmentManifest: join(f.root, 'codex/runtime/environment.json') } }), /PATH_MISMATCH/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'software', confirmed: true }), /INVALID_PLATFORM_ID/);
  } finally { f.cleanup(); }
});

test('re-entry restores only persisted inputs whose original content hash still matches', () => {
  const f = fixture();
  try {
    applyOnboardingConfig(buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true }), { auditRoot: f.auditRoot });
    const inputs = { fields: { displayName: 'Recover' }, bodies: { app: 'selected-program' }, backendFields: { distro: 'selected-backend' }, interpreterAliases: {}, confirmed: true };
    const record = { status: 'failed', stoppedAt: 'environment', inputs, inputsSha256: sha256(`${JSON.stringify(inputs, null, 2)}\n`) };
    const path = 'another-client/runtime/maintenance/manager-onboarding/automatic.json';
    f.put(path, JSON.stringify(record));
    assert.deepEqual(readOnboardingConfig({ workspaceRoot: f.root, platformId: 'another-client' }).pendingAutomatic.inputs, inputs);
    record.inputs.bodies.app = 'changed-without-a-plan'; f.put(path, JSON.stringify(record));
    assert.equal(readOnboardingConfig({ workspaceRoot: f.root, platformId: 'another-client' }).pendingAutomatic, null);
  } finally { f.cleanup(); }
});
