import { gitRaw, gitText } from './infrastructure/git.mjs';
import { parseGitStatus, assertConfiguredRemote } from './domains/git/state.mjs';
import { scanPaths } from './domains/git/sensitive.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SHA = /^[0-9a-f]{7,40}$/i;
const GIT_REF_NAME = /^[A-Za-z0-9._/-]{1,120}$/;

function git(root, args) {
  return gitText(root,args);
}



export function inspectGit(root) {
  const result = { isRepository: false, branch: null, head: null, upstream: null, ahead: null, behind: null, remotes: [], status: [], error: null };
  try {
    result.isRepository = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
    if (!result.isRepository) return result;
    result.branch = git(root, ['branch', '--show-current']) || null;
    result.head = git(root, ['rev-parse', 'HEAD']);
    result.status = parseGitStatus(gitRaw(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    result.remotes = git(root, ['remote', '-v']).split(/\r?\n/).filter(Boolean).map((line) => line.trim());
    try {
      result.upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      const [behind, ahead] = git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).split(/\s+/).map(Number);
      result.ahead = Number.isFinite(ahead) ? ahead : null;
      result.behind = Number.isFinite(behind) ? behind : null;
    } catch {
      result.upstream = null;
    }
  } catch (error) {
    result.error = String(error?.message ?? error);
  }
  return result;
}

function changedPaths(root) {
  return inspectGit(root).status.map((item) => item.path);
}

export function scanSensitiveFiles(root) {
  return {schema:'architecture-manager-sensitive-scan/v1',...scanPaths(root,changedPaths(root)),writePerformed:false};
}

export function buildGitPlan({ workspaceRoot, action, message = '', remote = 'origin', branch = '', tag = '', commit = '', backupName = '', backupMode = 'snapshot', platformId = '', paths = [], now = new Date().toISOString() }) {
  if (!['commit', 'branch', 'tag', 'push', 'rollback', 'backup'].includes(action)) throw new Error('INVALID_GIT_ACTION');
  const inspected = inspectGit(workspaceRoot);
  if (!inspected.isRepository || !inspected.head) throw new Error('GIT_REPOSITORY_REQUIRED');
  const plan = {
    schema: 'architecture-manager-plan/v1',
    planId: `git-${action}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: `git-${action}`,
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { headBefore: inspected.head, branch: inspected.branch },
    steps: [],
    verification: ['re-read HEAD before apply and reject stale plans', 'reject git add -A/. and force push by construction', 'audit the outcome without storing file bodies']
  };
  if (action === 'commit') {
    if (typeof message !== 'string' || message.trim().length < 3) throw new Error('COMMIT_MESSAGE_REQUIRED');
    const staged = validateStagedPaths(paths);
    if (staged.length === 0) throw new Error('COMMIT_PATHS_REQUIRED');
    plan.target.paths = staged;
    plan.steps.push({ operation: 'commit', message: message.trim(), paths: staged, command: ['git', 'add', '--', ...staged, '&&', 'git', 'commit', '-m', message.trim()] });
  } else if (action === 'branch') {
    if (!GIT_REF_NAME.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('INVALID_BRANCH_NAME');
    plan.steps.push({ operation: 'create-branch', branch, command: ['git', 'branch', branch] });
  } else if (action === 'tag') {
    if (!GIT_REF_NAME.test(tag) || tag.startsWith('-') || tag.includes('..')) throw new Error('INVALID_TAG_NAME');
    plan.steps.push({ operation: 'create-tag', tag, command: ['git', 'tag', tag] });
  } else if (action === 'push') {
    assertConfiguredRemote(workspaceRoot,remote);
    plan.steps.push({ operation: 'push', remote, force: false, command: ['git', 'push', remote] });
  } else if (action === 'rollback') {
    if (!SHA.test(commit)) throw new Error('INVALID_COMMIT_SHA');
    if (inspected.status.length) throw new Error('GIT_ROLLBACK_DIRTY');
    plan.steps.push({ operation: 'revert-commit', commit, command: ['git', 'revert', '--no-edit', commit], destructive: false });
  } else {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(backupName)) throw new Error('INVALID_BACKUP_NAME');
    if (!['snapshot','history'].includes(backupMode)) throw new Error('INVALID_BACKUP_MODE');
    if(backupMode==='history' && (!/^[a-z][a-z0-9-]{1,30}$/.test(platformId) || !existsSync(join(workspaceRoot,platformId)))) throw new Error('GIT_BACKUP_PLATFORM_REQUIRED');
    const destination = backupMode==='history' ? `inbox/backup/${platformId}/${backupName}` : `inbox/archive/${backupName}`;
    plan.target.backupMode=backupMode;plan.target.platformId=platformId;plan.target.label=backupMode==='history' ? 'Git 历史与未提交内容备份（需恢复验证）' : '仅 HEAD 文件快照（不是历史备份）';
    plan.target.destination = destination;
    plan.steps.push({ operation: 'export-backup', backupMode, destination, command: backupMode==='history' ? ['git','bundle','create',`${destination}/source.bundle`,'--all'] : ['git','-c','core.autocrlf=false','archive','--format=zip','-o',`${destination}/repo.zip`,'HEAD'] });
  }
  return plan;
}

export function validateStagedPaths(paths) {
  if (!Array.isArray(paths)) throw new Error('GIT_ADD_ALL_FORBIDDEN');
  const forbidden = new Set(['.', './', '-A', '--all', '..', ':/', '*']);
  const staged = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') throw new Error('GIT_ADD_ALL_FORBIDDEN');
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (forbidden.has(trimmed) || trimmed.startsWith('-') || trimmed.includes('..') || /[*?\[\]\0]/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
      throw new Error('GIT_ADD_ALL_FORBIDDEN');
    }
    const normalized = trimmed.split('\\').join('/');
    if (!staged.includes(normalized)) staged.push(normalized);
  }
  return staged;
}

export function scanSensitivePaths(root,paths) { return scanPaths(root,paths); }
