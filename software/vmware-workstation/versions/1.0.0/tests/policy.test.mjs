import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertConfirm,
  assertNewPathInside,
  assertVmPath,
  assertWorkspacePath,
  redactSecrets
} from '../src/lib/policy.mjs';
import { buildVmrunArgv, redactArgv } from '../src/lib/vmrun.mjs';
import { buildCloneArgv } from '../src/lib/tools.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const config = {
  vmrunPath: process.execPath,
  hostType: 'ws',
  roots: [],
  workspaceRoot: null,
  guestUser: 'guest',
  guestPassword: 's3cret-value',
  readOnly: false,
  timeoutMs: 1000,
  maxOutputBytes: 1024
};

test('buildVmrunArgv: power and guest shapes', () => {
  const powerArgv = buildVmrunArgv(config, 'stop', ['C:\\vms\\a.vmx', 'hard']);
  assert.deepEqual(powerArgv, ['-T', 'ws', 'stop', 'C:\\vms\\a.vmx', 'hard']);

  const guestArgv = buildVmrunArgv(config, 'runProgramInGuest', ['C:\\vms\\a.vmx', '/bin/true'], { guest: true });
  assert.deepEqual(guestArgv, [
    '-T',
    'ws',
    '-gu',
    'guest',
    '-gp',
    's3cret-value',
    'runProgramInGuest',
    'C:\\vms\\a.vmx',
    '/bin/true'
  ]);
  assert.ok(!redactArgv(guestArgv, config).join(' ').includes('s3cret-value'));
});

test('assertConfirm refuses without confirm: true', () => {
  assert.throws(() => assertConfirm({}, 'hard stop'), (error) => error.code === 'CONFIRM_REQUIRED');
  assert.doesNotThrow(() => assertConfirm({ confirm: true }, 'hard stop'));
});

test('assertVmPath keeps .vmx inside configured roots', () => {
  const root = tempDir('vmware-root-');
  const outside = tempDir('vmware-outside-');
  const insideVmx = path.join(root, 'ok.vmx');
  const outsideVmx = path.join(outside, 'no.vmx');
  fs.writeFileSync(insideVmx, 'displayName = "ok"\n');
  fs.writeFileSync(outsideVmx, 'displayName = "no"\n');

  const scoped = { ...config, roots: [root] };
  assert.equal(assertVmPath(scoped, insideVmx), fs.realpathSync.native(insideVmx));
  assert.throws(() => assertVmPath(scoped, outsideVmx), (error) => error.code === 'PATH_DENIED');
  assert.throws(() => assertVmPath(scoped, path.join(root, 'missing.vmx')), (error) => error.code === 'VM_NOT_FOUND');
  assert.throws(() => assertVmPath(scoped, path.join(root, 'not-a-vmx.txt')), (error) => error.code === 'INVALID_ARGUMENT');
});

test('assertVmPath accepts a drive-root allowlist', () => {
  const driveRoot = path.parse(os.tmpdir()).root;
  const dir = tempDir('vmware-drive-root-');
  const vmx = path.join(dir, 'root.vmx');
  fs.writeFileSync(vmx, 'displayName = "root"\n');
  const scoped = { ...config, roots: [driveRoot] };
  assert.equal(assertVmPath(scoped, vmx), fs.realpathSync.native(vmx));
});

test('assertWorkspacePath and assertNewPathInside', () => {
  const root = tempDir('vmware-ws-');
  const outside = tempDir('vmware-ws-out-');
  const scoped = { ...config, roots: [root], workspaceRoot: root };

  const inside = path.join(root, 'file.txt');
  fs.writeFileSync(inside, 'x');
  assert.equal(assertWorkspacePath(scoped, inside, { mustExist: true }), inside);
  assert.throws(() => assertWorkspacePath(scoped, path.join(outside, 'file.txt'), { mustExist: false }), (error) => error.code === 'PATH_DENIED');

  const newVmx = path.join(root, 'new.vmx');
  assert.equal(assertNewPathInside(scoped, newVmx), newVmx);
  fs.writeFileSync(newVmx, '');
  assert.throws(() => assertNewPathInside(scoped, newVmx), (error) => error.code === 'PATH_EXISTS');
});

test('buildCloneArgv uses the -snapshot= flag, not a positional snapshot', () => {
  assert.deepEqual(buildCloneArgv('C:\\vms\\a.vmx', 'C:\\vms\\b.vmx', 'full'), ['C:\\vms\\a.vmx', 'C:\\vms\\b.vmx', 'full']);
  assert.deepEqual(buildCloneArgv('C:\\vms\\a.vmx', 'C:\\vms\\b.vmx', 'linked', 'base'), [
    'C:\\vms\\a.vmx',
    'C:\\vms\\b.vmx',
    'linked',
    '-snapshot=base'
  ]);
});

test('redactSecrets removes every occurrence', () => {
  assert.equal(redactSecrets('a s3cret-value b s3cret-value', ['s3cret-value']), 'a *** b ***');
  assert.equal(redactSecrets('nothing', [null, '']), 'nothing');
});
