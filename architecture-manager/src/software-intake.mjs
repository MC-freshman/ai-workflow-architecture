import {parseJson as parseJsonText} from './core/json.mjs';
import {applyRuntimeBody,verifyRuntimeBody} from './domains/intake/runtime-body.mjs';
import {renameOwnedDirectory} from './infrastructure/filesystem.mjs';
import {removeOwnedDirectory} from './transactions/recovery.mjs';
import {sha256} from './core/hash.mjs';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';
import { makeId, output, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';
import { inside } from './core/json.mjs';

import { isRegisteredPlatform } from './core/platforms.mjs';
const SOFTWARE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const KINDS = new Set(['portable-file', 'unpacked-directory', 'installer']);

function digest(path) {
  const hash = createHash('sha256');
  const file = openSync(path, 'r');
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  try { let count; while ((count = readSync(file, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count)); }
  finally { closeSync(file); }
  return hash.digest('hex');
}
function hashSource(path, kind) {
  const rows = [];
  const walk = (directory, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('SOFTWARE_SYMLINK_NOT_ALLOWED');
      const next = join(directory, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(next, rel);
      else if (item.isFile()) rows.push({ path: rel, sha256: digest(next), bytes: statSync(next).size });
      else throw new Error('SOFTWARE_FILE_TYPE_NOT_ALLOWED');
    }
  };
  if (kind === 'unpacked-directory') walk(path);
  else rows.push({ path: basename(path), sha256: digest(path), bytes: statSync(path).size });
  if (!rows.length) throw new Error('SOFTWARE_SOURCE_EMPTY');
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}
function copyRows(source, destination, kind, rows, onProgress = () => {}, stage = '') {
  const bytesTotal = rows.reduce((sum, row) => sum + row.bytes, 0);
  let bytesDone = 0;
  for (const [index, row] of rows.entries()) {
    const from = kind === 'unpacked-directory' ? join(source, row.path) : source;
    const to = join(destination, row.path);
    mkdirSync(dirname(to), { recursive: true });
    const sourceFile = openSync(from, 'r');
    let destinationFile;
    try {
      destinationFile = openSync(to, 'wx');
      const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
      let count;
      while ((count = readSync(sourceFile, chunk, 0, chunk.length, null)) > 0) {
        let offset = 0;
        while (offset < count) offset += writeSync(destinationFile, chunk, offset, count - offset);
        bytesDone += count;
        onProgress({ stage, path: row.path, bytesDone, bytesTotal, filesDone: index, filesTotal: rows.length });
      }
    } finally { closeSync(sourceFile); if (destinationFile !== undefined) closeSync(destinationFile); }
    onProgress({ stage, path: row.path, bytesDone, bytesTotal, filesDone: index + 1, filesTotal: rows.length });
  }
}
function assertRows(directory, rows) {
  for (const row of rows) if (digest(join(directory, row.path)) !== row.sha256) throw new Error('SOFTWARE_HASH_MISMATCH');
}

export function buildSoftwareImportPlan({ workspaceRoot, platformId, softwareId, sourcePath, intakeKind, now = new Date().toISOString() }) {
  const root = resolve(workspaceRoot);
  if (!isRegisteredPlatform(platformId, root) || !SOFTWARE_ID.test(softwareId) || !KINDS.has(intakeKind)) throw new Error('INVALID_SOFTWARE_INTAKE');
  const platformRoot = join(root, platformId);
  if (!existsSync(platformRoot) || !lstatSync(platformRoot).isDirectory()) throw new Error('PLATFORM_DIRECTORY_NOT_FOUND');
  const source = resolve(sourcePath);
  if (inside(join(root, 'software'), source)) throw new Error('SOURCE_IN_SHARED_SOFTWARE_REPOSITORY');
  if (!existsSync(source) || lstatSync(source).isSymbolicLink()) throw new Error('SOFTWARE_SOURCE_INVALID');
  if (intakeKind === 'unpacked-directory' ? !lstatSync(source).isDirectory() : !lstatSync(source).isFile()) throw new Error('SOFTWARE_SOURCE_KIND_MISMATCH');
  const rows = hashSource(source, intakeKind);
  const target = join(platformRoot, 'runtime', 'software', softwareId);
  if (existsSync(target)) throw new Error('SOFTWARE_TARGET_EXISTS');
  const stamp = now.replace(/[^0-9]/g, '').slice(0, 17);
  const backup = join(root, 'inbox', 'backup', platformId, softwareId, stamp);
  if (existsSync(backup)) throw new Error('SOFTWARE_BACKUP_EXISTS');
  return {
    schema: 'architecture-manager-plan/v1', planId: `software-import-${softwareId}-${stamp}`, kind: 'software-import', workspaceRoot: root,
    generatedAt: now, applyMode: 'confirmation-required', writePerformed: false,
    target: { platformId, softwareId, source, intakeKind, path: target, backup },
    steps: [
      { operation: 'copy-full-backup', target: backup, files: rows.length },
      { operation: 'restore-drill', target: join(platformRoot, 'runtime', 'software'), files: rows.length },
      { operation: 'copy-verified-body', target, files: rows.length }
    ],
    verification: ['source hashes unchanged before apply', 'backup fully copied and restored once', 'body and backup hashes equal source'],
    estimatedAdditionalBytes: 2 * rows.reduce((sum, row) => sum + row.bytes, 0),
    rows
  };
}

export function applySoftwareImport({ plan }, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), onProgress = () => {}, failAfterCheckpoint = false } = {}) {
  if(plan?.payload?.intake)return applyRuntimeBody({plan},{actor,auditRoot,onProgress});
  if (plan?.kind !== 'software-import') throw new Error('INVALID_SOFTWARE_IMPORT_PLAN');
  const fresh = buildSoftwareImportPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, softwareId: plan.target.softwareId, sourcePath: plan.target.source, intakeKind: plan.target.intakeKind, now: plan.generatedAt });
  if (JSON.stringify(fresh.rows) !== JSON.stringify(plan.rows) || fresh.target.path !== plan.target.path || fresh.target.backup !== plan.target.backup) throw new Error('SOFTWARE_SOURCE_CHANGED');
  const { source, intakeKind, path: target, backup } = plan.target;
  const transactionId = makeId(plan, now);
  const checkpoint = saveCheckpoint(auditRoot, transactionId, `${JSON.stringify({ schema: 'architecture-manager-new-software/v1', platformId: plan.target.platformId, softwareId: plan.target.softwareId, target, backup, targetExisted: false, backupExisted: false, rows: plan.rows }, null, 2)}\n`);
  if (failAfterCheckpoint) {
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-import', status: 'interrupted-before-write', target, checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, error: 'SIMULATED_INTERRUPT', now });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit, checkpointPath: checkpoint.path });
  }
  const runtimeParent = dirname(target);
  const backupParent = dirname(backup);
  mkdirSync(runtimeParent, { recursive: true });
  mkdirSync(backupParent, { recursive: true });
  const backupStage = mkdtempSync(join(backupParent, '.backup-stage-'));
  const bodyStage = mkdtempSync(join(runtimeParent, '.body-stage-'));
  let backupCommitted = false;
  let bodyCommitted = false;
  let backupManifestText = null;
  try {
    copyRows(source, join(backupStage, 'payload'), intakeKind, plan.rows, onProgress, 'backup');
    assertRows(join(backupStage, 'payload'), plan.rows);
    copyRows(join(backupStage, 'payload'), bodyStage, 'unpacked-directory', plan.rows, onProgress, 'restore-and-body');
    assertRows(bodyStage, plan.rows);
    const manifest = { schema: 'architecture-manager-software-backup/v1', platformId: plan.target.platformId, softwareId: plan.target.softwareId, sourceName: basename(source), intakeKind, files: plan.rows, restoreDrill: { performed: true, verifiedFiles: plan.rows.length, at: new Date().toISOString() }, target };
    backupManifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(join(backupStage, 'MANIFEST.json'), backupManifestText, { flag: 'wx' });
    renameOwnedDirectory(plan.workspaceRoot,backupStage,backup);
    backupCommitted = true;
    renameOwnedDirectory(plan.workspaceRoot,bodyStage,target);
    bodyCommitted = true;
    assertRows(target, plan.rows);
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-import', status: 'applied', target, newSha256: createHash('sha256').update(JSON.stringify(plan.rows)).digest('hex'), checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, writePerformed: true, now });
    return { ...output(audit, checkpoint.path), status: 'staged-awaiting-recipe', audit, platformId: plan.target.platformId, softwareId: plan.target.softwareId, target, backup, files: plan.rows.length, restored: true };
  } catch (error) {
    const bodyExpected=new Map(plan.rows.map(row=>[row.path,row.sha256]));
    const backupExpected=new Map([...plan.rows.map(row=>['payload/'+row.path,row.sha256]),['MANIFEST.json',sha256(backupManifestText || '')]]);
    const destinations=[...(bodyCommitted?[{path:target,expected:bodyExpected}]:[]),...(backupCommitted?[{path:backup,expected:backupExpected}]:[])];
    if(destinations.some(destination=>!removeOwnedDirectory(destination.path,destination.expected,{remove:false}).ok)) {
      const audit=writeAudit({auditRoot,transactionId,plan,actor,action:plan.kind,status:'failed-external-change',target,checkpointPath:checkpoint.path,error:'RECOVERY_EXTERNAL_CHANGE',now});
      throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{audit,checkpointPath:checkpoint.path});
    }
    for(const destination of destinations) if(!removeOwnedDirectory(destination.path,destination.expected).ok) throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:checkpoint.path});
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-import', status: 'recovered-after-failure', target, checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, error: String(error?.message || error), now });
    throw Object.assign(error, { audit, checkpointPath: checkpoint.path });
  } finally {
    for (const staging of [backupStage, bodyStage]) if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

export function verifySoftwareImport({ plan }) {
  if(plan?.payload?.intake)return verifyRuntimeBody({plan});
  if (plan?.kind !== 'software-import') throw new Error('INVALID_SOFTWARE_IMPORT_PLAN');
  const backup = join(plan.target.backup, 'payload');
  try {
    assertRows(plan.target.path, plan.rows);
    assertRows(backup, plan.rows);
    const manifest = parseJsonText(readFileSync(join(plan.target.backup, 'MANIFEST.json'), 'utf8'));
    return { ok: manifest.restoreDrill?.performed === true, target: plan.target.path, backup: plan.target.backup, writePerformed: false };
  } catch { return { ok: false, target: plan.target.path, backup: plan.target.backup, writePerformed: false }; }
}
