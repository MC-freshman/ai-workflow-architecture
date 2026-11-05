import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { targetPath } from '../../core/paths.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from '../../transactions/onboarding-files.mjs';

export function buildOnboardingGovernancePlan({ workspaceRoot, platformId,stagedConfig=null, now = new Date().toISOString() }) {
  const snapshot = stagedConfig?{exists:true,config:stagedConfig}:readOnboardingConfig({ workspaceRoot, platformId });
  if (!snapshot.exists || !snapshot.config.platform) throw new Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const marker = `<!-- architecture-manager-platform:${platformId} -->`;
  const end = `<!-- /architecture-manager-platform:${platformId} -->`;
  const paragraph = `${marker}\n\n### 管理台登记：${platformId}\n\n- 平台配置入口：\`${platformId}/bridge.json\`；平台章：\`${platformId}/bridge/platform.md\`。\n- 本平台接入记录位于自己的 runtime/maintenance/manager-onboarding；配置、环境、矩阵、客户端回环和 Git 读数全部通过才算完成。\n- 标准 CLI 入口无需维护型 AI 会话；业务模型输出与厂商原生客户端注册各自验证，不由目录存在推定。\n- 本轮钉版：${snapshot.config.runner.split(/[\\/]/).at(-1)} / ${snapshot.config.contracts.split(/[\\/]/).at(-1)} / ${snapshot.config.scannerRelease.split(/[\\/]/).at(-1)}。\n\n${end}\n`;
  const files = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', 'versions/平台接入清单.md', 'versions/更新日志.md'].map((path) => {
    const before = readFileSync(targetPath(workspaceRoot, path), 'utf8');
    const first = before.indexOf(marker); const last = before.indexOf(end);
    if ((first >= 0) !== (last >= 0)) throw new Error('GOVERNANCE_BLOCK_CORRUPT');
    return { path, content: first < 0 ? `${before.trimEnd()}\n\n${paragraph}` : before.slice(0, first) + paragraph + before.slice(last + end.length).trimStart() };
  });
  const ignorePath = targetPath(workspaceRoot, '.gitignore');
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  const ignoreMarker = `# architecture-manager platform ${platformId}`;
  if (!ignore.includes(ignoreMarker)) files.push({ path: '.gitignore', content: `${ignore.trimEnd()}\n\n${ignoreMarker}\n!/${platformId}/\n/${platformId}/*\n!/${platformId}/bridge.json\n!/${platformId}/bridge/\n/${platformId}/bridge/**\n!/${platformId}/bridge/**/\n!/${platformId}/bridge/**/*.json\n!/${platformId}/bridge/**/*.md\n!/${platformId}/bridge/**/*.py\n!/${platformId}/bridge/**/*.mjs\n/${platformId}/bridge/**/credentials*\n/${platformId}/bridge/**/secrets*\n/${platformId}/bridge/**/.env*\n` });
  const planned = plannedFiles(workspaceRoot, files);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-governance', planId: `governance-${randomUUID()}`, workspaceRoot, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId,stagedConfig }, payload: { files: planned }, steps: planned.map((file) => ({ operation: 'register-platform-governance', target: file.path, oldSha256: file.beforeSha256, newSha256: file.newSha256 })), verification: ['five governance documents agree', 'only platform configuration texts enter Git', 'registration text does not predeclare certification'] };
}
export function applyOnboardingGovernance(plan, options) { return applyGeneratedFiles(plan, () => buildOnboardingGovernancePlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId,stagedConfig:plan.target.stagedConfig, now: plan.generatedAt }), options); }
export const verifyOnboardingGovernance = verifyFiles;

// A governance text that is neither on disk nor tracked has been renamed away: after the rename is
// committed it can never be tracked again, so keeping it in the set would make every readback ask
// for a file that no longer exists (D-166). A brand-new text is on disk and stays in the set.
function presentOrTracked(workspaceRoot, path) {
  if (existsSync(targetPath(workspaceRoot, path))) return true;
  try {
    execFileSync('git', ['-C', workspaceRoot, 'ls-files', '--error-unmatch', '--', path], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}

export function onboardingGitPaths(workspaceRoot, platformId) {
  const paths = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', 'versions/平台接入清单.md', 'versions/更新日志.md', '.gitignore', `${platformId}/bridge.json`].filter((path) => presentOrTracked(workspaceRoot, path));
  function visit(relative) {
    for (const entry of readdirSync(targetPath(workspaceRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
      if (entry.isDirectory()) visit(path);
      else if (/\.(json|md|py|mjs)$/.test(entry.name) && !/credential|secret|\.env/i.test(entry.name)) paths.push(path);
    }
  }
  visit(`${platformId}/bridge`); return paths;
}

// D-166: a legitimate rename needs a route. The destination of a staged rename is never in the
// governance path set (that set is built from files that exist), so finalize has to judge the
// destination on its own: only a rename into this platform's own governance text is accepted.
export function isGovernanceTextPath(path, platformId) {
  if (typeof path !== 'string' || !path.trim()) return false;
  const normalized = path.trim().split('\\').join('/');
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(normalized)) return false;
  if (normalized.split('/').includes('..')) return false;
  if (!/\.(md|json|py|mjs)$/.test(normalized) && normalized !== '.gitignore') return false;
  if (/credential|secret|\.env/i.test(normalized)) return false;
  const topLevel = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', '.gitignore'];
  return topLevel.includes(normalized) || normalized.startsWith('versions/') || normalized.startsWith(`${platformId}/bridge/`);
}

// The departed sources of renames this platform's governance set accepts. They cannot be staged
// (`git add` cannot match a path that no longer exists) but they have to reach the commit line,
// or the deletion is left behind and the rename lands as a copy.
export function onboardingRenameSources(workspaceRoot, platformId) {
  const sources = [];
  for (const entry of stagedNameStatus(workspaceRoot)) {
    if (entry.status !== 'rename') continue;
    // The source has already left the path set once it is gone, so both halves are judged here.
    if (!isGovernanceTextPath(entry.from, platformId) || !isGovernanceTextPath(entry.path, platformId)) continue;
    if (!sources.includes(entry.from)) sources.push(entry.from);
  }
  return sources;
}

// The commit path set with a staged rename folded in: the destination replaces the departed source,
// because `git add -- <departed source>` fails on a path that no longer exists and every "is this
// governance file tracked" readback would otherwise demand a file that the rename already removed.
export function onboardingCommitPaths(workspaceRoot, platformId) {
  const paths = onboardingGitPaths(workspaceRoot, platformId);
  for (const entry of stagedNameStatus(workspaceRoot)) {
    if (entry.status !== 'rename') continue;
    if (!isGovernanceTextPath(entry.from, platformId) || !isGovernanceTextPath(entry.path, platformId)) continue;
    const index = paths.indexOf(entry.from);
    if (index >= 0) paths.splice(index, 1);
    if (!paths.includes(entry.path)) paths.push(entry.path);
  }
  return paths;
}

// `git diff --cached --name-only` reports only the destination of a rename and `git status` reports
// the pair as one line, so `--name-status` is the only view that gives both sides separately.
export function stagedNameStatus(workspaceRoot) {
  let out = '';
  try {
    // core.quotePath is on by default, so a non-ASCII path would arrive as an octal-escaped
    // quoted string and never match the path set; -z has a different shape for renames, so the
    // plain view with quoting disabled is the one that keeps both sides comparable.
    out = execFileSync('git', ['-C', workspaceRoot, '-c', 'core.quotePath=false', 'diff', '--cached', '--name-status'], { encoding: 'utf8', windowsHide: true });
  } catch { return []; }
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    if (status.startsWith('R') && rest.length >= 2) return { status: 'rename', path: rest[1], from: rest[0] };
    return { status, path: rest[0], from: null };
  });
}
