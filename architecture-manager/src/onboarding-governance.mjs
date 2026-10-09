import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { targetPath } from './core/paths.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from './transactions/onboarding-files.mjs';

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

export function onboardingGitPaths(workspaceRoot, platformId) {
  const paths = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md', 'versions/平台接入清单.md', 'versions/更新日志.md', '.gitignore', `${platformId}/bridge.json`];
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
