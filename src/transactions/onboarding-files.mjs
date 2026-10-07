import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256 } from '../core/hash.mjs';
import { defaultAuditRoot, targetPath } from '../core/paths.mjs';
import { atomicWrite, makeId, output, requirePlan, saveCheckpoint, writeAudit } from './kernel.mjs';

export function plannedFiles(root, files) {
  return files.map((file) => ({ ...file, beforeSha256: existsSync(targetPath(root, file.path)) ? sha256(readFileSync(targetPath(root, file.path))) : null, newSha256: sha256(file.content) }));
}

export function verifyFiles(plan) {
  const files = (plan.payload?.files || []).map((file) => ({ path: file.path, ok: existsSync(targetPath(plan.workspaceRoot, file.path)) && sha256(readFileSync(targetPath(plan.workspaceRoot, file.path))) === file.newSha256 }));
  return { schema: 'architecture-manager-verification/v1', ok: files.length > 0 && files.every((file) => file.ok), files, writePerformed: false };
}

export function applyGeneratedFiles(plan, rebuild, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), failAfterFiles = null } = {}) {
  requirePlan(plan);
  const expected = rebuild();
  if(expected.kind!==plan.kind || expected.target.platformId!==plan.target.platformId)throw Error('PLAN_PAYLOAD_MISMATCH');
  if (JSON.stringify(expected.payload) !== JSON.stringify(plan.payload)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  for (const file of plan.payload.files) {
    const path = targetPath(plan.workspaceRoot, file.path);
    if ((existsSync(path) ? sha256(readFileSync(path)) : null) !== file.beforeSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  }
  const transactionId = makeId(plan, now);
  const before = plan.payload.files.map((file) => ({ ...file, before: file.beforeSha256 === null ? null : readFileSync(targetPath(plan.workspaceRoot, file.path), 'utf8') }));
  const checkpoint = saveCheckpoint(auditRoot, transactionId, JSON.stringify({ schema: 'onboarding-checkpoint/v1', workspaceRoot: plan.workspaceRoot, kind: plan.kind, files: before }));
  const written = [];
  try {
    for (const file of before) {
      const path = targetPath(plan.workspaceRoot, file.path);
      mkdirSync(dirname(path), { recursive: true }); atomicWrite(path, file.content, transactionId); written.push(file);
      if (written.length === failAfterFiles) throw new Error('SIMULATED_INTERRUPT');
    }
    if (!verifyFiles(plan).ok) throw new Error('ONBOARDING_READBACK_FAILED');
    return output(writeAudit({ actor, auditRoot, now, transactionId, plan, action: plan.kind, status: 'applied', target: plan.target.platformId, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, newSha256: sha256(JSON.stringify(plan.steps)), writePerformed: true }), checkpoint.path);
  } catch (error) {
    let drift = false;
    for (const file of written.reverse()) {
      const path = targetPath(plan.workspaceRoot, file.path);
      if (!existsSync(path) || sha256(readFileSync(path)) !== file.newSha256) { drift = true; continue; }
      if (file.before === null) unlinkSync(path); else atomicWrite(path, file.before, transactionId);
    }
    writeAudit({ actor, auditRoot, now, transactionId, plan, action: plan.kind, status: drift ? 'failed-external-change' : 'failed-restored', target: plan.target.platformId, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, error: String(error.message) });
    throw error;
  }
}
