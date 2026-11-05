import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(managerRoot, 'scripts', 'check-runtime-drift.mjs');
const canonical = path.join(managerRoot, 'src', 'runtime');
const managerVersion = JSON.parse(fs.readFileSync(path.join(managerRoot, 'package.json'), 'utf8')).version;
const COMPONENTS = [
  'bridge/manager-client/cli_client.py',
  'bridge/manager-client/mcp_service.py',
  'bridge/manager-client/platform_defaults.mjs',
  'bridge/manager-providers/platform_provider.py',
  'bridge/manager-providers/peer_dispatcher.py'
];

const run = (root, extra = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, '--root', root, ...extra], { cwd: managerRoot, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

function makeWorkspace(t, { pinned = managerVersion } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const platformRoot = path.join(root, 'probe');
  const bridge = path.join(platformRoot, 'bridge');
  fs.mkdirSync(path.join(bridge, 'manager-client'), { recursive: true });
  fs.mkdirSync(path.join(bridge, 'manager-providers'), { recursive: true });
  for (const rel of COMPONENTS) {
    fs.copyFileSync(path.join(canonical, path.basename(rel)), path.join(platformRoot, rel));
  }
  // Discovery needs a config file inside bridge/; the pin is written only at the
  // root-level bridge.json so the fallback read is exercised by every case.
  fs.writeFileSync(path.join(bridge, 'bridge.json'), JSON.stringify({ schema: 'ai-platform-bridge/v1.1', platform: 'probe' }));
  fs.writeFileSync(path.join(platformRoot, 'bridge.json'), JSON.stringify({ schema: 'ai-platform-bridge/v1.1', platform: 'probe', runtimeComponentVersion: pinned }));
  return { root, platformRoot };
}

const report = result => JSON.parse(result.stdout);

test('clean laid-out components with current pin pass in fail mode', async t => {
  const { root } = makeWorkspace(t);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const data = report(result);
  assert.equal(data.mode, 'fail');
  assert.equal(data.ok, true);
  assert.deepEqual(data.drifted, []);
  assert.equal(data.platforms[0].pinStatus, 'current');
});

test('an injected bad hash is caught as FAIL', async t => {
  const { root, platformRoot } = makeWorkspace(t);
  fs.writeFileSync(path.join(platformRoot, 'bridge/manager-providers/peer_dispatcher.py'), 'tampered\n');
  const result = await run(root);
  assert.equal(result.code, 1);
  const data = report(result);
  assert.equal(data.ok, false);
  assert.deepEqual(data.drifted, ['probe']);
  assert.match(result.stderr, /RUNTIME_COMPONENT_DRIFT: 1 platform\(s\) need re-layout/);
});

test('--warn reports drift without failing', async t => {
  const { root, platformRoot } = makeWorkspace(t);
  fs.writeFileSync(path.join(platformRoot, 'bridge/manager-client/platform_defaults.mjs'), 'tampered\n');
  const result = await run(root, ['--warn']);
  assert.equal(result.code, 0);
  const data = report(result);
  assert.equal(data.mode, 'warn');
  assert.equal(data.ok, false);
  assert.deepEqual(data.drifted, ['probe']);
});

test('a stale runtimeComponentVersion is caught as FAIL', async t => {
  const { root } = makeWorkspace(t, { pinned: '0.0.0' });
  const result = await run(root);
  assert.equal(result.code, 1);
  const data = report(result);
  assert.equal(data.ok, false);
  assert.equal(data.platforms[0].pinStatus, 'stale');
  assert.match(result.stderr, /RUNTIME_COMPONENT_DRIFT: 1 platform\(s\) need re-layout/);
});
