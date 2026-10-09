import {runScopedProcess as execFileSync} from './infrastructure/process-scope.mjs';
// Workspace bootstrap (3.5.0 P10): clone an architecture repository into a
// fresh local root, verify it looks like an architecture workspace, and hand
// it to the normal first-scan flow. Local-only, single user, no server.
import { existsSync, readdirSync, rmSync, rmdirSync,renameSync, statSync, writeFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { join, resolve,dirname } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';
import { makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

const ARCHITECTURE_MARKERS = ['versions', 'tool', 'agent', 'software', 'AGENTS.md'];

function isEmptyDirectory(path) {
  if (!existsSync(path)) return true;
  if (!statSync(path).isDirectory()) return false;
  return readdirSync(path).length === 0;
}

export function buildWorkspaceClonePlan({ workspaceRoot = null, remote, destination, confirmed = false, now = new Date().toISOString() }) {
  if (confirmed !== true) throw new Error('WORKSPACE_CLONE_CONFIRMATION_REQUIRED');
  if (typeof remote !== 'string' || remote.trim() === '') throw new Error('CLONE_REMOTE_REQUIRED');
  if (!/^(https:\/\/|git@|file:\/\/\/|[A-Za-z]:[\\/])/i.test(remote.trim())) throw new Error('CLONE_REMOTE_INVALID');
  const destinationRoot = resolve(String(destination || ''));
  if (!isEmptyDirectory(destinationRoot)) throw new Error('CLONE_DESTINATION_NOT_EMPTY');
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `workspace-clone-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'workspace-clone',
    workspaceRoot: destinationRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { remote: remote.trim(), destination: destinationRoot },
    steps: [{ operation: 'git-clone', remote: remote.trim(), destination: destinationRoot }],
    verification: ['destination becomes a git repository', 'architecture markers (versions/tool/agent/software/AGENTS.md) present', 'partial clone is removed on failure'],
    payload: {}
  };
}

export function applyWorkspaceClone({ plan }, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() } = {}) {
  requirePlan(plan);
  if (plan.kind !== 'workspace-clone' || resolve(plan.workspaceRoot) !== resolve(plan.target.destination) || plan.steps?.[0]?.remote !== plan.target.remote || resolve(plan.steps?.[0]?.destination || '') !== resolve(plan.target.destination)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  if (!isEmptyDirectory(plan.target.destination)) throw new Error('CLONE_DESTINATION_NOT_EMPTY');
  const destination = plan.target.destination;
  const id = makeId(plan, now);
  const staging=destination+'.manager-clone-'+randomUUID();
  try {
    execFileSync('git', ['-c', 'core.longpaths=true', 'clone', '--no-hardlinks', '--no-checkout', '-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', plan.target.remote, staging], { encoding: 'utf8', timeout: 600000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    const head = execFileSync('git', ['-C', staging, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    // Highest-priority local attributes also override nested upstream text=auto.
    // Set before the first checkout; frozen release bytes must equal their Git blobs.
    writeFileSync(join(staging, '.git/info/attributes'), '* -text\n', { flag: 'wx' });
    execFileSync('git', ['-C', staging, 'reset', '--hard', head], { encoding: 'utf8', timeout: 600000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const missing = ARCHITECTURE_MARKERS.filter((marker) => !existsSync(join(staging, marker)));
    if (missing.length > 0) throw Object.assign(new Error(`GIT_CLONE_NOT_ARCHITECTURE:${missing.join(',')}`), { missing });
    if(!isEmptyDirectory(destination)) throw Error('CLONE_DESTINATION_EXTERNAL_CHANGE');
    if(existsSync(destination)) rmdirSync(destination); // Never remove a nonempty user directory.
    renameSync(staging,destination);
    const event = writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: 'workspace-clone', status: 'applied', target: destination, newSha256: head, writePerformed: true });
    return { ...output(event), head, destination, bytePreservingCheckout: true };
  } catch (error) {
    const detail = String(error?.message ?? error);
    writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: 'workspace-clone', status: 'failed', target: destination, error: detail.slice(0, 400) });
    if (existsSync(staging) && dirname(staging)===dirname(destination) && staging.startsWith(destination+'.manager-clone-')) rmSync(staging, { recursive: true, force: true });
    throw /GIT_CLONE_NOT_ARCHITECTURE|CLONE_DESTINATION_EXTERNAL_CHANGE|TASK_CANCELLED/.test(detail) ? error : new Error('GIT_CLONE_FAILED');
  }
}
