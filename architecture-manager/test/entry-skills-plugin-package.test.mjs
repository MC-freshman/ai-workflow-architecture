// D-162: a client with no local command slot used to receive the rendered bytes only in staging,
// where no client ever reads them. The manager now also lays the same bytes out as a plugin
// package — the shape a Qoder-family client loads — while placement stays a human step, because
// whether a client reads a workspace-level plugin directory is a property of that client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { collectEntrySkillFiles } from '../src/domains/onboarding/onboarding-entry-skills.mjs';

const PYTHON = '<local-user-path>';

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `entry-plugin-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function putConfig(root, platformId, config) {
  const path = join(root, platformId, 'bridge', `${platformId}-config.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

test('a platform outside the surveyed table gets a complete plugin package, not loose files', (t) => {
  const root = scratch(t, 'outside');
  putConfig(root, 'qoder-cn', { interpreters: { '.py': PYTHON } });
  const { files, summary } = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'qoder-cn' });
  const paths = files.map((file) => file.path);
  assert.ok(summary.pluginPackage, 'the package is reported');
  assert.ok(paths.includes('qoder-cn/runtime/entry-skills-export/plugin/ai-workflow-hub/.qoder-plugin/plugin.json'), 'the manifest is part of the plan');
  for (const skill of ['wf', 'wfa']) {
    assert.ok(paths.includes(`qoder-cn/runtime/entry-skills-export/plugin/ai-workflow-hub/skills/${skill}/SKILL.md`), `${skill} lands inside the package`);
  }
  const manifest = JSON.parse(files.find((file) => file.path.endsWith('plugin.json')).content);
  assert.equal(manifest.name, 'ai-workflow-hub');
  assert.match(manifest.displayName, /qoder-cn/, 'the package says which platform it was rendered for');
});

test('the package carries the very same rendered bytes as the staging export', (t) => {
  const root = scratch(t, 'same-bytes');
  putConfig(root, 'qoder-cn', { interpreters: { '.py': PYTHON } });
  const { files, summary } = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'qoder-cn' });
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  for (const skill of ['wf', 'wfa']) {
    const staged = byPath.get(`qoder-cn/runtime/entry-skills-export/${skill}/SKILL.md`);
    const packaged = byPath.get(`qoder-cn/runtime/entry-skills-export/plugin/ai-workflow-hub/skills/${skill}/SKILL.md`);
    assert.equal(sha256(packaged), sha256(staged), `${skill} is byte-identical in both places`);
    assert.ok(!packaged.includes('{{'), 'no residual placeholder reaches the client');
  }
  assert.deepEqual(summary.pluginPackage.skills.sort(), [
    'qoder-cn/runtime/entry-skills-export/plugin/ai-workflow-hub/skills/wf/SKILL.md',
    'qoder-cn/runtime/entry-skills-export/plugin/ai-workflow-hub/skills/wfa/SKILL.md'
  ]);
  assert.match(summary.pluginPackage.placementHint, /plugins/, 'the hint names the workspace plugin slot');
});

test('a surveyed slot keeps its own path and gets no package', (t) => {
  const root = scratch(t, 'surveyed');
  putConfig(root, 'workbuddy', { interpreters: { '.py': PYTHON } });
  const { files, summary } = collectEntrySkillFiles({ workspaceRoot: root, platformId: 'workbuddy' });
  const paths = files.map((file) => file.path);
  assert.equal(summary.pluginPackage, null, 'a client with a real slot needs no package');
  assert.ok(paths.some((path) => path.startsWith('.workbuddy/skills/')), 'it still writes the surveyed slot');
  assert.ok(!paths.some((path) => path.includes('plugin/ai-workflow-hub')), 'and nothing else');
});
