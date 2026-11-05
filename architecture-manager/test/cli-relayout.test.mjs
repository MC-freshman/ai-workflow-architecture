import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(managerRoot, 'src', 'cli.mjs');
const canonical = path.join(managerRoot, 'src', 'runtime');
const COMPONENTS = [
  'bridge/manager-client/cli_client.py',
  'bridge/manager-client/mcp_service.py',
  'bridge/manager-client/platform_defaults.mjs',
  'bridge/manager-providers/platform_provider.py',
  'bridge/manager-providers/peer_dispatcher.py'
];
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function makeWorkspace(t, { tamper = 'codex' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-relayout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ['codex', 'doubao']) {
    for (const rel of COMPONENTS) {
      const dst = path.join(root, id, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(canonical, path.basename(rel)), dst);
    }
    fs.writeFileSync(path.join(root, id, 'bridge.json'), JSON.stringify({ platform: id }));
  }
  if (tamper) fs.writeFileSync(path.join(root, tamper, COMPONENTS[4]), 'tampered\n');
  return root;
}

const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: managerRoot, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

test('legacy scan usage still returns an inventory JSON', async () => {
  const result = await run([path.resolve(managerRoot, '..')]);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.ok(data.formalTopLevelDirectories);
  assert.ok(!data.schema?.startsWith('architecture-manager-relayout'));
});

test('relayout repairs a drifted copy, backs it up and verifies', async t => {
  const root = makeWorkspace(t);
  const target = path.join(root, 'codex', COMPONENTS[4]);
  const before = sha(target);
  const result = await run(['relayout', '--root', root]);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  assert.equal(data.changes.length, 1);
  assert.equal(data.changes[0].platformId, 'codex');
  assert.equal(data.backups, 1);
  assert.equal(sha(target), sha(path.join(canonical, 'peer_dispatcher.py')));
  assert.notEqual(before, sha(target));
  const backupRoot = path.join(root, 'inbox', 'backup', 'codex', 'runtime-components');
  assert.equal(fs.readdirSync(backupRoot).length, 1);
  const backupFile = path.join(backupRoot, fs.readdirSync(backupRoot)[0], COMPONENTS[4].replace(/\//g, '__'));
  assert.equal(sha(backupFile), before);
});

test('--dry-run reports the change without writing anything', async t => {
  const root = makeWorkspace(t);
  const target = path.join(root, 'codex', COMPONENTS[4]);
  const before = sha(target);
  const result = await run(['relayout', '--root', root, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.dryRun, true);
  assert.equal(data.changes.length, 1);
  assert.equal(data.backups, 0);
  assert.equal(sha(target), before);
  assert.equal(fs.existsSync(path.join(root, 'inbox')), false);
});

test('relayout is idempotent on a clean workspace', async t => {
  const root = makeWorkspace(t, { tamper: null });
  const result = await run(['relayout', '--root', root]);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  assert.deepEqual(data.changes, []);
  assert.equal(data.backups, 0);
});
