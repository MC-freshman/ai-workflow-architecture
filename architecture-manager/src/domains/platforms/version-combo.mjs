// NP4: explicit version-combination probe + resume version-consistency check.
//
// The combination probe is a DIAGNOSTIC tool, not a gate: it really drives the
// runner over a caller-chosen set of kind:id@version overrides and reports
// per-row outcomes honestly — a failing combination is returned as data, never
// thrown (opposite semantics to the L1 dual-cell gate, which fails closed).
// Explicit targets override the platform-declared ones (declarationTargets)
// for this probe only; nothing on disk is rewritten.
//
// Resume consistency reuses clientBinding as the single version-fingerprint
// mechanism (same-source rule): two platforms can resume the same project
// only when their runner/contracts/scannerRelease pins match; a mismatch is
// reported with a per-key difference list and an explicit warning — never a
// silent version switch (BP-4).
import { existsSync, readFileSync } from 'node:fs';
import { clientBinding } from '../onboarding/onboarding-client.mjs';
import { targetPath } from '../../core/paths.mjs';
import { parseJson } from '../../core/json.mjs';
import { sha256 } from '../../core/hash.mjs';

const KINDS = ['workflow', 'agent'];

export function parseVersionTargets(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('VERSION_TARGETS_EMPTY');
  return input.map((row) => {
    const kind = row?.kind;
    if (!KINDS.includes(kind)) throw new Error(`VERSION_TARGET_KIND_INVALID:${kind}`);
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(row.id || '')) throw new Error(`VERSION_TARGET_ID_INVALID:${row.id}`);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.version || '')) throw new Error(`VERSION_TARGET_VERSION_INVALID:${row.version}`);
    return { kind, id: row.id, version: row.version };
  });
}

function assertRegistryEntry(workspaceRoot, target) {
  const repo = target.kind === 'workflow' ? 'tool' : 'agent';
  const section = target.kind === 'workflow' ? 'workflows' : 'agents';
  const registry = parseJson(readFileSync(targetPath(workspaceRoot, `${repo}/registry.json`), 'utf8'));
  const entry = (registry[section] || []).find((row) => row.id === target.id);
  if (!entry || entry.enabled === false) throw new Error(`VERSION_TARGET_UNKNOWN:${target.kind}:${target.id}`);
}

// Same resolution order readOnboardingConfig uses (runner-config.json first).
function configPathOf(workspaceRoot, platformId) {
  for (const rel of ['bridge/runner-config.json', `bridge/${platformId}-config.json`]) {
    const abs = targetPath(workspaceRoot, `${platformId}/${rel}`);
    if (existsSync(abs)) return abs;
  }
  return targetPath(workspaceRoot, `${platformId}/bridge/${platformId}-config.json`);
}

export function previewVersionCombo({ workspaceRoot, platformId, targets }) {
  const parsed = parseVersionTargets(targets);
  const seen = new Set();
  for (const target of parsed) {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) throw new Error(`VERSION_TARGET_DUPLICATE:${key}`);
    seen.add(key);
    assertRegistryEntry(workspaceRoot, target);
  }
  return {
    schema: 'architecture-manager-version-combo-preview/v1',
    platformId,
    targets: parsed,
    only: parsed.map((target) => `${target.kind}:${target.id}`).join(','),
    targetsArg: parsed.map((target) => `${target.kind}:${target.id}@${target.version}`).join(','),
    writePerformed: false
  };
}

export async function runVersionComboProbe({ workspaceRoot, platformId, targets, registerCancel = () => {}, onProgress = () => {}, check }) {
  if (typeof check !== 'function') throw new Error('VERSION_COMBO_CHECK_REQUIRED');
  const preview = previewVersionCombo({ workspaceRoot, platformId, targets });
  onProgress({ platformId, phase: 'version-combo', targets: preview.targets });
  const result = await check({ workspaceRoot, platformId, mode: 'quick', only: preview.only, targets: preview.targets, stopOnFloorFailure: false, onProgress, registerCancel });
  const matrixPath = result.matrixActualPath || result.matrixPath;
  if (!matrixPath || !existsSync(matrixPath)) throw new Error('VERSION_COMBO_EVIDENCE_MISSING');
  const matrix = parseJson(readFileSync(matrixPath, 'utf8'));
  const rows = (matrix.rows || []).map((row) => ({ kind: row.kind, id: row.id, version: row.version, status: row.status, errorCode: row.errorCode || null }));
  const requested = new Set(preview.targets.map((target) => `${target.kind}:${target.id}`));
  const covered = rows.filter((row) => requested.has(`${row.kind}:${row.id}`));
  const missing = [...requested].filter((key) => !covered.some((row) => `${row.kind}:${row.id}` === key));
  const pass = covered.filter((row) => row.status === 'PASS').length;
  return {
    schema: 'architecture-manager-version-combo/v1',
    platformId,
    targets: preview.targets,
    rows: covered,
    missingRows: missing,
    counts: { requested: preview.targets.length, covered: covered.length, pass, fail: covered.length - pass },
    verdict: missing.length || covered.length !== preview.targets.length ? 'incomplete' : pass === covered.length ? 'all-pass' : pass > 0 ? 'partial' : 'all-fail',
    matrixPath,
    matrixSha256: sha256(readFileSync(matrixPath)),
    evidencePath: result.evidencePath || null,
    checkedAt: new Date().toISOString(),
    writePerformed: true
  };
}

export function verifyResumeVersionConsistency({ workspaceRoot, sourcePlatformId, targetPlatformId }) {
  if (sourcePlatformId === targetPlatformId) throw new Error('RESUME_SAME_PLATFORM');
  const source = clientBinding(workspaceRoot, sourcePlatformId);
  const target = clientBinding(workspaceRoot, targetPlatformId);
  const differences = [];
  if (source.versionsSha256 !== target.versionsSha256) {
    // The aggregate fingerprint differs; name the per-key divergences so the
    // operator sees exactly which pin moved instead of a bare boolean.
    const sourceConfig = parseJson(readFileSync(configPathOf(workspaceRoot, sourcePlatformId), 'utf8'));
    const targetConfig = parseJson(readFileSync(configPathOf(workspaceRoot, targetPlatformId), 'utf8'));
    for (const key of ['runner', 'contracts', 'scannerRelease']) {
      if ((sourceConfig[key] || '') !== (targetConfig[key] || '')) differences.push({ key, source: sourceConfig[key] || null, target: targetConfig[key] || null });
    }
  }
  const consistent = differences.length === 0 && source.versionsSha256 === target.versionsSha256;
  return {
    schema: 'architecture-manager-resume-consistency/v1',
    sourcePlatformId,
    targetPlatformId,
    consistent,
    sourceVersionsSha256: source.versionsSha256,
    targetVersionsSha256: target.versionsSha256,
    differences,
    warning: consistent ? null : '续跑版本不一致：不得静默换版（BP-4）；先对齐钉定或显式确认换版语义'
  };
}
