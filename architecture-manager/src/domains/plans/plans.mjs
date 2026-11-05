import { validateFrozenResource } from '../resources/versions.mjs';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const REPOSITORIES = new Set(['tool', 'agent', 'software']);
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertPublishedVersion(workspaceRoot,repository,resourceId,version) { return validateFrozenResource(workspaceRoot,repository,resourceId,version); }


export function validatePointerTransition({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions = [] }) {
  if (!REPOSITORIES.has(repository)) throw new Error('INVALID_SHARED_REPOSITORY');
  if (typeof resourceId !== 'string' || !RESOURCE_ID.test(resourceId)) throw new Error('INVALID_RESOURCE_ID');
  if (typeof currentVersion !== 'string' || !SEMVER.test(currentVersion)) throw new Error('INVALID_CURRENT_VERSION');
  if (typeof targetVersion !== 'string' || !SEMVER.test(targetVersion)) throw new Error('INVALID_TARGET_VERSION');
  if (currentVersion === targetVersion) throw new Error('NO_CHANGE');
  if (!Array.isArray(availableVersions) || !availableVersions.includes(targetVersion)) throw new Error('TARGET_VERSION_UNAVAILABLE');
  assertPublishedVersion(workspaceRoot, repository, resourceId, targetVersion);
}

function basePlan(kind, workspaceRoot, now) {
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `${kind}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind,
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    steps: [],
    verification: []
  };
}

export function buildPlatformViewPlan({ workspaceRoot, platformId, currentEnabled, desiredEnabled, directoryRelative = platformId, markers = [], now = new Date().toISOString() }) {
  if (typeof platformId !== 'string' || !RESOURCE_ID.test(platformId)) throw new Error('INVALID_PLATFORM_ID');
  if (typeof currentEnabled !== 'boolean' || typeof desiredEnabled !== 'boolean') throw new Error('INVALID_PLATFORM_STATE');
  const plan = basePlan('platform-view', workspaceRoot, now);
  plan.target = { platformId, currentEnabled, desiredEnabled, directoryRelative, markers };
  plan.steps.push({
    operation: 'update-local-view',
    target: `platform:${platformId}`,
    oldValue: currentEnabled,
    newValue: desiredEnabled,
    persistentStore: '%LOCALAPPDATA%/ArchitectureManager/views',
    markerCheck: markers
  });
  plan.verification.push('local view state is reversible and no platform directory is deleted');
  return plan;
}

export function buildResourcePointerPlan({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions = [], baselineSha256 = null, now = new Date().toISOString() }) {
  validatePointerTransition({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions });
  const plan = basePlan('resource-pointer', workspaceRoot, now);
  plan.target = { repository, resourceId, currentVersion, targetVersion, baselineSha256 };
  plan.steps.push({
    operation: 'replace-current-pointer',
    target: `${repository}/${resourceId}/current.json`,
    oldValue: { version: currentVersion },
    newValue: { version: targetVersion },
    ...(baselineSha256 ? { oldSha256: baselineSha256 } : {}),
    checkpoint: true
  });
  plan.verification.push('current pointer still contains the expected old version before apply');
  plan.verification.push('target version directory and SHA256SUMS pass after apply');
  return plan;
}

// The anchored generation is one file the workspace can read back and re-derive. It is deliberately
// not a shared repository pointer: the anchor states what this workspace intends to use, while the
// shared current pointers stay the engine-visible defaults that other platforms may lag behind.
export function createAnchorPlan({ workspaceRoot, digest, relativePath, path, content, beforeSha256 = null, now = new Date().toISOString() }) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('INVALID_ANCHOR_DIGEST');
  if (typeof content !== 'string' || !content.trim()) throw new Error('INVALID_ANCHOR_CONTENT');
  const plan = basePlan('anchor-generation', workspaceRoot, now);
  plan.target = { anchorDigest: digest, relativePath, beforeSha256 };
  plan.steps.push({
    operation: beforeSha256 === null ? 'create-anchor' : 'replace-anchor',
    target: relativePath,
    oldValue: beforeSha256 === null ? null : { sha256: beforeSha256 },
    newValue: { sha256: sha256Of(content), anchorDigest: digest },
    ...(beforeSha256 ? { oldSha256: beforeSha256 } : {}),
    checkpoint: true
  });
  plan.verification.push('the written anchor re-derives to the same digest, so it cannot drift from the workspace it describes');
  plan.verification.push('a no-change anchor never rewrites the file');
  return plan;
}

// One transaction for every version key a platform declares. Unrelated configuration is preserved.
export function replaceConfigPlan({ workspaceRoot, platformId, anchorDigest, files, now = new Date().toISOString() }) {
  if (typeof platformId !== 'string' || !RESOURCE_ID.test(platformId)) throw new Error('INVALID_PLATFORM_ID');
  if (typeof anchorDigest !== 'string' || !/^[a-f0-9]{64}$/.test(anchorDigest)) throw new Error('INVALID_ANCHOR_DIGEST');
  if (!Array.isArray(files) || files.some((file) => typeof file.path !== 'string' || typeof file.content !== 'string')) throw new Error('INVALID_ALIGNMENT_FILES');
  const plan = basePlan('platform-anchor-alignment', workspaceRoot, now);
  plan.target = { platformId, anchorDigest, files: files.map((file) => file.path) };
  for (const file of files) {
    assertAlignmentTarget(file.path, platformId);
    plan.steps.push({
      operation: file.beforeSha256 === null ? 'create-config' : 'replace-config',
      target: file.path,
      oldSha256: file.beforeSha256,
      newSha256: file.newSha256,
      checkpoint: true
    });
  }
  plan.verification.push('the anchor digest matches the materialised anchor before apply');
  plan.verification.push('read back every written file, then re-resolve the platform against the anchor');
  return plan;
}

// Only the platform's own configuration may be written here, and only the version-bearing pair of
// files: the bridge declaration and the platform configuration that names the toolchain.
function assertAlignmentTarget(relativePath, platformId) {
  const normalized = String(relativePath).replaceAll('\\', '/');
  const allowed = [`${platformId}/bridge.json`, `${platformId}/bridge/bridge.json`, `${platformId}/bridge/runner-config.json`, `${platformId}/bridge/${platformId}-config.json`];
  if (!allowed.includes(normalized)) throw new Error('ALIGNMENT_TARGET_NOT_ALLOWED');
}

function sha256Of(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
