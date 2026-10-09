import { assertConfiguredRemote, assertSelectedIndex } from './domains/git/state.mjs';
import { scanIndex, scanOutgoing } from './domains/git/sensitive.mjs';
import { createGitBackup, verifyGitBackup } from './domains/git/backup.mjs';
import { validateStagedPaths } from './git.mjs';
import {gitRaw,gitText} from './infrastructure/git.mjs';
// Git command executors (3.5.0 P3). Plans are built by buildGitPlan; this module
// executes them with argument-array git calls (never shell:true), a HEAD
// staleness check, an explicit-path commit red line (no add -A/.), a sensitive
// scan before commits, force-free push, revert --no-edit only, and backups
// written under inbox/archive with a SHA256SUMS.
import { resolve } from 'node:path';
import { scanSensitivePaths } from './git.mjs';
import { defaultAuditRoot } from './core/paths.mjs';
import { makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

function run(root, args, timeoutMs = 120000) {
  try {
    return gitText(root,args,{timeout:timeoutMs});
  } catch (error) {
    const detail = [error.stderr, error.stdout].map((value) => String(value ?? '').trim()).filter(Boolean).join(' | ');
    throw new Error(`GIT_COMMAND_FAILED:${detail.slice(0, 400) || String(error?.message ?? error)}`);
  }
}

export function applyGitTransaction({ plan, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() }) {
  requirePlan(plan);
  const root = resolve(plan.workspaceRoot);
  const headBefore = run(root, ['rev-parse', 'HEAD']);
  if (headBefore !== plan.target?.headBefore) throw new Error('GIT_EXTERNAL_CHANGE');
  const step = plan.steps?.[0];
  if (!step) throw new Error('INVALID_TRANSACTION_PLAN');
  const id = makeId(plan, now);
  const context = { actor, auditRoot, now };
  const succeed = (target, extra = {}) => output(writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'applied', target, writePerformed: true, ...extra }));
  try {
    if (plan.kind === 'git-commit') {
      const paths=validateStagedPaths(step.paths);
      if(!paths.length) throw new Error('COMMIT_PATHS_REQUIRED');
      assertSelectedIndex(root,paths);
      const scan = scanSensitivePaths(root, paths);
      if (!scan.clean) throw Object.assign(new Error('COMMIT_BLOCKED_SENSITIVE'), { findings: scan.findings });
      run(root, ['add', '--', ...paths]);
      assertSelectedIndex(root,paths);
      if(!scanIndex(root,paths).clean) throw new Error('COMMIT_BLOCKED_SENSITIVE');
      const identityOptions = step.identity ? ['-c', `user.name=${step.identity.name}`, '-c', `user.email=${step.identity.email}`] : [];
      run(root, [...identityOptions, 'commit', '--only', '-m', step.message, '--', ...paths]);
      const head = run(root, ['rev-parse', 'HEAD']);
      return succeed(`HEAD:${head.slice(0, 12)}`, { oldSha256: headBefore, newSha256: head });
    }
    if (plan.kind === 'git-branch') {
      run(root, ['branch', step.branch]);
      return succeed(`branch:${step.branch}`);
    }
    if (plan.kind === 'git-tag') {
      run(root, ['tag', step.tag]);
      return succeed(`tag:${step.tag}`);
    }
    if (plan.kind === 'git-push') {
      assertConfiguredRemote(root,step.remote);
      if(step.force!==false) throw new Error('INVALID_REMOTE');
      const outgoing=scanOutgoing(root,step.remote);
      if(!outgoing.clean) throw Object.assign(new Error('PUSH_BLOCKED_SENSITIVE'),{findings:outgoing.findings});
      run(root, ['push', step.remote], 300000);
      return succeed(`remote:${step.remote}`);
    }
    if (plan.kind === 'git-rollback') {
      if(gitRaw(root,['status','--porcelain=v1','-z'])!=='') throw new Error('GIT_ROLLBACK_DIRTY');
      try { run(root, ['revert', '--no-edit', step.commit]); }
      catch(error) { try {run(root,['revert','--abort']);} catch { /* no active revert */ } throw error; }
      const head = run(root, ['rev-parse', 'HEAD']);
      return succeed(`HEAD:${head.slice(0, 12)}`, { oldSha256: headBefore, newSha256: head });
    }
    if (plan.kind === 'git-backup') {
      const backup=createGitBackup(root,plan);
      return succeed(plan.target.destination,{newSha256:backup.sha256,backupMode:backup.backupMode,restoreVerified:backup.restoreVerified});
    }
    throw new Error('TRANSACTION_KIND_UNSUPPORTED');
  } catch (error) {
    writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'failed', target: step.operation, error: String(error?.message ?? error) });
    throw error;
  }
}

export function verifyGitTransaction({ plan }) {
  const root = resolve(plan.workspaceRoot);
  const describe = (ok, extra = {}) => ({ schema: 'architecture-manager-verification/v1', ok, target: plan.target?.destination || plan.target?.branch || plan.kind, writePerformed: false, ...extra });
  try {
    if (plan.kind === 'git-commit' || plan.kind === 'git-rollback') {
      const head = run(root, ['rev-parse', 'HEAD']);
      return describe(head !== plan.target.headBefore, { head });
    }
    if (plan.kind === 'git-branch') {
      const ref = run(root, ['rev-parse', '--verify', `refs/heads/${plan.steps[0].branch}`]);
      return describe(Boolean(ref), { ref });
    }
    if (plan.kind === 'git-tag') {
      const ref = run(root, ['rev-parse', '--verify', `refs/tags/${plan.steps[0].tag}`]);
      return describe(Boolean(ref), { ref });
    }
    if (plan.kind === 'git-push') {
      const count = run(root, ['rev-list', '--count', `@{upstream}..HEAD`]);
      return describe(count === '0', { aheadCount: Number(count) });
    }
    if (plan.kind === 'git-backup') {
      const verification=verifyGitBackup(root,plan);
      return describe(verification.ok,verification);
    }
    return describe(false, { error: 'TRANSACTION_KIND_UNSUPPORTED' });
  } catch (error) {
    return describe(false, { error: String(error?.message ?? error) });
  }
}
