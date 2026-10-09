import {parseJson as parseJsonText} from './core/json.mjs';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { atomicWrite, writeAudit } from './transactions/kernel.mjs';
import { inside } from './core/json.mjs';
import { isRegisteredPlatform } from './core/platforms.mjs';

function events(auditRoot) {
  const path = join(auditRoot, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [parseJsonText(line)]; } catch { return []; } });
}


export function listSoftwareRecoveries({ workspaceRoot, auditRoot = defaultAuditRoot() }) {
  const root = resolve(workspaceRoot);
  const rows = events(auditRoot).filter((item) => item.workspaceRoot === root && ['software-import', 'software-recipe-publish'].includes(item.action));
  const reverted = new Set(rows.filter((item) => item.status === 'reverted').map((item) => item.checkpointPath));
  return rows.filter((item) => ['applied', 'published-version-only', 'published-pending-verification'].includes(item.status) && item.checkpointPath && !reverted.has(item.checkpointPath))
    .filter(item=>{try{return parseJsonText(readFileSync(item.checkpointPath,'utf8')).schema!=='architecture-manager-runtime-body-checkpoint/v1';}catch{return false;}})
    .slice(-10).reverse().map((item) => ({ action: item.action, status: item.status, target: item.target, checkpointPath: item.checkpointPath, occurredAt: item.occurredAt }));
}

export function buildSoftwareRevertPlan({ workspaceRoot, checkpointPath, auditRoot = defaultAuditRoot(), now = new Date().toISOString() }) {
  const row = listSoftwareRecoveries({ workspaceRoot, auditRoot }).find((item) => item.checkpointPath === resolve(checkpointPath));
  if (!row) throw new Error('SOFTWARE_RECOVERY_NOT_AVAILABLE');
  return { schema: 'architecture-manager-plan/v1', planId: `software-revert-${now.replace(/[^0-9]/g, '').slice(0, 17)}`, kind: 'software-revert', workspaceRoot: resolve(workspaceRoot), generatedAt: now, applyMode: 'confirmation-required', writePerformed: false,
    target: { path: row.target, checkpointPath: row.checkpointPath, originalAction: row.action },
    steps: [{ operation: row.action === 'software-import' ? 'move-imported-body-to-trash' : 'disable-recipe-and-unbind-connector', target: row.target, checkpoint: true }],
    verification: row.action === 'software-import' ? ['body moved to inbox/trash, backup retained'] : ['registry disabled and connector binding removed; immutable release retained'] };
}

export function revertSoftwareTransaction({ plan, auditRoot = defaultAuditRoot(), actor = 'local-user', now = new Date().toISOString() }) {
  if (plan?.kind !== 'software-revert') throw new Error('INVALID_SOFTWARE_REVERT_PLAN');
  const { workspaceRoot, checkpointPath } = { workspaceRoot: plan.workspaceRoot, checkpointPath: plan.target?.checkpointPath };
  const rebuilt = buildSoftwareRevertPlan({ workspaceRoot, checkpointPath, auditRoot, now: plan.generatedAt });
  if (rebuilt.target.path !== plan.target.path || rebuilt.target.originalAction !== plan.target.originalAction) throw new Error('SOFTWARE_RECOVERY_TARGET_CHANGED');
  const root = resolve(workspaceRoot);
  const checkPath = resolve(checkpointPath);
  if (!inside(join(resolve(auditRoot), 'checkpoints'), checkPath) || !checkPath.endsWith('.before')) throw new Error('SOFTWARE_CHECKPOINT_OUTSIDE_AUDIT');
  const entry = events(auditRoot).findLast((item) => item.workspaceRoot === root && item.checkpointPath === checkPath && ['applied', 'published-version-only', 'published-pending-verification'].includes(item.status));
  if (!entry || !listSoftwareRecoveries({ workspaceRoot: root, auditRoot }).some((item) => item.checkpointPath === checkPath)) throw new Error('SOFTWARE_RECOVERY_NOT_AVAILABLE');
  const raw = readFileSync(checkPath, 'utf8');
  if (sha256(raw) !== entry.checkpointSha256) throw new Error('SOFTWARE_CHECKPOINT_CHANGED');
  const checkpoint = parseJsonText(raw);
  const transactionId = `${entry.transactionId}-revert`;
  const auditPlan = { planId: plan.planId, workspaceRoot: root };
  if (entry.action === 'software-import') {
    const { target, backup, rows, platformId, softwareId } = checkpoint;
    if (!isRegisteredPlatform(platformId, root) || !/^[a-z0-9][a-z0-9._-]*$/.test(softwareId) || resolve(target) !== join(root, platformId, 'runtime', 'software', softwareId) || !inside(join(root, 'inbox', 'backup', platformId, softwareId), backup)) throw new Error('SOFTWARE_RECOVERY_TARGET_INVALID');
    if (!existsSync(target) || !existsSync(backup) || lstatSync(target).isSymbolicLink() || lstatSync(backup).isSymbolicLink()) throw new Error('SOFTWARE_RECOVERY_TARGET_CHANGED');
    const registryPath = join(root, 'software', 'registry.json');
    if (existsSync(registryPath) && parseJsonText(readFileSync(registryPath, 'utf8')).software?.some((item) => item.id === softwareId)) throw new Error('SOFTWARE_RECIPE_STILL_REGISTERED');
    for (const row of rows) {
      for (const base of [target, join(backup, 'payload')]) {
        const file = resolve(base, row.path);
        if (!inside(base, file) || !existsSync(file) || sha256(readFileSync(file)) !== row.sha256) throw new Error('SOFTWARE_RECOVERY_TARGET_CHANGED');
      }
    }
    const trash = join(root, 'inbox', 'trash', 'architecture-manager', transactionId);
    if (existsSync(trash)) throw new Error('SOFTWARE_RECOVERY_TARGET_CHANGED');
    mkdirSync(resolve(trash, '..'), { recursive: true });
    renameSync(target, trash);
    try {
      const audit = writeAudit({ auditRoot, transactionId, plan: auditPlan, actor, action: entry.action, status: 'reverted', target, checkpointSha256: entry.checkpointSha256, checkpointPath: checkPath, writePerformed: true, now });
      return { status: 'reverted', action: entry.action, movedTo: trash, backupRetained: backup, audit };
    } catch (error) { renameSync(trash, target); throw error; }
  }
  if (checkpoint.schema !== 'architecture-manager-software-publish-checkpoint/v1') throw new Error('SOFTWARE_CHECKPOINT_INVALID');
  const { softwareId, bodyPath, registryPath, connectorPath, releasePath, releaseSumsSha256 } = checkpoint;
  if (!inside(join(root, 'software'), registryPath) || !inside(join(root, 'software'), releasePath) || !inside(join(root, checkpoint.platformId, 'bridge'), connectorPath)) throw new Error('SOFTWARE_RECOVERY_TARGET_INVALID');
  if (!existsSync(releasePath) || sha256(readFileSync(join(releasePath, 'SHA256SUMS'), 'utf8')) !== releaseSumsSha256) throw new Error('SOFTWARE_RELEASE_CHANGED');
  const registryBefore = readFileSync(registryPath, 'utf8');
  const connectorBefore = readFileSync(connectorPath, 'utf8');
  const registry = parseJsonText(registryBefore);
  const connector = parseJsonText(connectorBefore);
  const row = registry.software?.find((item) => item.id === softwareId);
  if (!row || row.enabled === false || connector.bodies?.[softwareId] !== bodyPath) throw new Error('SOFTWARE_RECOVERY_TARGET_CHANGED');
  const nextRegistry = `${JSON.stringify({ ...registry, version: Number.isInteger(registry.version) ? registry.version + 1 : registry.version, software: registry.software.map((item) => item.id === softwareId ? { ...item, enabled: false } : item) }, null, 2)}\n`;
  const bodies = { ...connector.bodies }; delete bodies[softwareId];
  const nextConnector = `${JSON.stringify({ ...connector, bodies }, null, 2)}\n`;
  try {
    atomicWrite(registryPath, nextRegistry, transactionId);
    atomicWrite(connectorPath, nextConnector, transactionId);
    const audit = writeAudit({ auditRoot, transactionId, plan: auditPlan, actor, action: entry.action, status: 'reverted', target: releasePath, checkpointSha256: entry.checkpointSha256, checkpointPath: checkPath, writePerformed: true, now });
    return { status: 'reverted', action: entry.action, releaseRetained: releasePath, audit };
  } catch (error) {
    atomicWrite(registryPath, registryBefore, `${transactionId}-restore`);
    atomicWrite(connectorPath, connectorBefore, `${transactionId}-restore`);
    throw error;
  }
}

export function verifySoftwareRevert({ plan }) {
  if (plan?.kind !== 'software-revert') throw new Error('INVALID_SOFTWARE_REVERT_PLAN');
  const checkpoint = parseJsonText(readFileSync(plan.target.checkpointPath, 'utf8'));
  if (plan.target.originalAction === 'software-import') {
    const audit = events(dirname(dirname(plan.target.checkpointPath))).findLast((item) => item.checkpointPath === plan.target.checkpointPath && item.status === 'reverted');
    const trash = audit ? join(plan.workspaceRoot, 'inbox', 'trash', 'architecture-manager', audit.transactionId) : null;
    return { ok: !existsSync(checkpoint.target) && existsSync(checkpoint.backup) && Boolean(trash && existsSync(trash)), target: checkpoint.target, trash, writePerformed: false };
  }
  const registry = parseJsonText(readFileSync(checkpoint.registryPath, 'utf8'));
  const connector = parseJsonText(readFileSync(checkpoint.connectorPath, 'utf8'));
  return { ok: registry.software?.find((item) => item.id === checkpoint.softwareId)?.enabled === false && !Object.hasOwn(connector.bodies || {}, checkpoint.softwareId) && existsSync(checkpoint.releasePath), target: checkpoint.releasePath, writePerformed: false };
}
