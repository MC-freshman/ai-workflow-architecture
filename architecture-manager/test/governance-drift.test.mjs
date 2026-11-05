import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(managerRoot, 'scripts', 'check-governance-drift.mjs');
const versions = ['0.13.1', '0.7.0', '1.5.2', '1.6.0', '1.6.3'];
const platformIds = ['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder', 'qoder-cn'];

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  for (const rel of ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md']) {
    put(rel, '当前命名基线 `架构3.7.0.md`（2026-11-05 定稿）；`架构3.6.0.md` 为历史基线。\n');
  }
  put('versions/anchor.json', JSON.stringify({
    schema: 'ai-architecture-anchor/v1',
    engine: { version: versions[0] }, checker: { version: versions[1] },
    judge: { version: versions[2] }, contracts: { version: versions[3] },
    conformance: { version: versions[4] }
  }, null, 2));
  put('versions/平台接入清单.md', '### 8.33 现行状态\n\n共享 current：' + versions.join(' / ') + '\n');
  put('architecture-manager/package.json', JSON.stringify({ name: 'architecture-manager', version: '0.8.14' }));
  put('architecture-manager/docs/发布门禁.md', '当前口径 456 例 / skip 2。\n');
  put('docs-site/README.md', '现行管理台为 0.8.14，七平台目录。\n');
  for (const id of platformIds) put(`${id}/bridge.json`, JSON.stringify({ platform: id }));
  return root;
}

const run = (root, extra = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, '--root', root, ...extra], { cwd: managerRoot, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

const report = result => JSON.parse(result.stdout);

test('consistent governance texts pass in fail mode', async t => {
  const result = await run(makeWorkspace(t));
  assert.equal(result.code, 0, result.stderr);
  const data = report(result);
  assert.equal(data.mode, 'fail');
  assert.equal(data.ok, true);
  assert.deepEqual(data.failed, []);
});

test('a stale baseline pointer is caught as FAIL', async t => {
  const root = makeWorkspace(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '当前命名基线 `架构3.6.0.md`（2026-10-01 定稿）。\n');
  const result = await run(root);
  assert.equal(result.code, 1);
  const data = report(result);
  assert.equal(data.ok, false);
  assert.ok(data.failed.includes('baseline:AGENTS.md'));
  assert.match(result.stderr, /GOVERNANCE_DRIFT: 1 check\(s\) failed/);
});

test('--warn reports drift without failing', async t => {
  const root = makeWorkspace(t);
  fs.writeFileSync(path.join(root, 'docs-site/README.md'), '现行管理台为 0.7.0。\n');
  const result = await run(root, ['--warn']);
  assert.equal(result.code, 0);
  const data = report(result);
  assert.equal(data.mode, 'warn');
  assert.equal(data.ok, false);
  assert.ok(data.failed.includes('manager:version'));
});

test('a missing platform is caught as FAIL', async t => {
  const root = makeWorkspace(t);
  fs.rmSync(path.join(root, 'qoder-cn'), { recursive: true, force: true });
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.equal(report(result).ok, false);
  assert.ok(report(result).failed.includes('platforms:count'));
});
