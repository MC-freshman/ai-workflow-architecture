import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { friendlyError, PLAN_WRITE_KINDS } from '../src/renderer/presenter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('renderer domains stay split and write kinds remain centralized', () => {
  const source = [
    'stats.jsx', 'platform.jsx', 'integration.jsx', 'catalog.jsx',
    'resources.jsx', 'documents.jsx', 'software.jsx', 'git.jsx',
    'safety.jsx', 'plan-preview.jsx', 'runs.jsx', 'governance.jsx', 'audit.jsx', 'inbox.jsx', 'releases.jsx', 'plancenter.jsx', 'pulse.jsx', 'onboard.jsx', 'clone.jsx'
  ].map((file) => readFileSync(join(root, 'src', 'renderer', 'panels', file), 'utf8')).join('\n');
  const domains = [
    'DashboardStats', 'PlatformPanel', 'IntegrationPanel', 'CatalogPanel',
    'ResourcePanel', 'DocumentPanel', 'SoftwarePanel', 'GitPanel',
    'SafetyPanel', 'HelpPanel', 'PlanPreview',
    'RunsPanel', 'GovernancePanel', 'AuditPanel', 'InboxPanel', 'ReleasePanel', 'PlanCenterPanel', 'HomePulse', 'OnboardPanel', 'ClonePanel'
  ];
  for (const domain of domains) {
    assert.match(source, new RegExp(`export function ${domain}\\b`), domain);
  }

  assert.deepEqual(PLAN_WRITE_KINDS, [
    'mcp-credential', 'mcp-credential-provider',
    'software-command',
    'platform-body',
    'body-import','body-import-revert',
    'platform-scaffold',
    'platform-configuration',
    'platform-backend',
    'platform-runtime',
    'platform-client',
    'platform-providers',
    'platform-attestation',
    'platform-governance',
    'platform-finalize',
    'platform-onboarding',
    'anchor-generation', 'platform-anchor-alignment',
    'document-edit', 'defect-book-edit', 'resource-pointer', 'platform-view', 'registry-edit',
    'integration-config', 'integration-registry', 'software-import', 'software-recipe-publish', 'software-revert',
    'git-commit', 'git-branch', 'git-tag', 'git-push', 'git-rollback', 'git-backup', 'release-publish', 'software-launch','software-binding','software-binding-migration'
  ]);
  assert.match(friendlyError(new Error('EXTERNAL_CHANGE_DETECTED')), /目标文件已被其他程序修改/);
});
