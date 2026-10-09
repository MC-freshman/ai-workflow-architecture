import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyWorkspaceClone, buildWorkspaceClonePlan } from '../src/workspace-bootstrap.mjs';

function makeSourceRepo(withArchitecture = true) {
  const source = mkdtempSync(join(tmpdir(), 'am-clone-src-'));
  execFileSync('git', ['-C', source, 'init'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'config', 'user.email', 't@t.local'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'config', 'user.name', 't'], { stdio: 'ignore' });
  for (const marker of withArchitecture ? ['versions', 'tool', 'agent', 'software'] : []) {
    mkdirSync(join(source, marker), { recursive: true });
    writeFileSync(join(source, marker, '.keep'), '');
  }
  if (withArchitecture) writeFileSync(join(source, 'AGENTS.md'), '# workspace\n');
  writeFileSync(join(source, 'README.md'), 'repo\n');
  execFileSync('git', ['-C', source, 'add', '--', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'commit', '-m', 'init'], { stdio: 'ignore' });
  return source;
}

test('clones an architecture repo, verifies markers, records HEAD', () => {
  const source = makeSourceRepo(true);
  const destination = join(mkdtempSync(join(tmpdir(), 'am-clone-dst-')), 'workspace');
  assert.throws(() => buildWorkspaceClonePlan({ remote: source, destination, confirmed: false }), /WORKSPACE_CLONE_CONFIRMATION_REQUIRED/);
  const plan = buildWorkspaceClonePlan({ remote: source, destination, confirmed: true });
  assert.equal(plan.kind, 'workspace-clone');
  const applied = applyWorkspaceClone({ plan }, { auditRoot: join(destination, '..', 'audit'), now: new Date().toISOString() });
  assert.equal(applied.status, 'applied');
  assert.ok(existsSync(join(destination, 'versions')));
  assert.match(applied.head, /^[0-9a-f]{40}$/);
  rmSync(destination, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test('rejects non-empty destinations, bad remotes and non-architecture repos with cleanup', () => {
  const source = makeSourceRepo(false);
  const dirty = mkdtempSync(join(tmpdir(), 'am-clone-dirty-'));
  writeFileSync(join(dirty, 'existing.txt'), 'not empty');
  assert.throws(() => buildWorkspaceClonePlan({ remote: source, destination: dirty, confirmed: true }), /CLONE_DESTINATION_NOT_EMPTY/);
  assert.throws(() => buildWorkspaceClonePlan({ remote: 'not a remote', destination: join(tmpdir(), 'am-clone-x'), confirmed: true }), /CLONE_REMOTE_INVALID/);
  const destination = join(mkdtempSync(join(tmpdir(), 'am-clone-dst2-')), 'ws');
  const plan = buildWorkspaceClonePlan({ remote: source, destination, confirmed: true });
  assert.throws(() => applyWorkspaceClone({ plan }, { auditRoot: join(tmpdir(), 'am-clone-audit') }), /GIT_CLONE_NOT_ARCHITECTURE/);
  assert.ok(!existsSync(destination), 'partial clone removed');
  rmSync(dirty, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test('nested upstream EOL attributes cannot change frozen bytes during clone', () => {
  const source = makeSourceRepo(true);
  const parent = mkdtempSync(join(tmpdir(), 'am-byte-clone-'));
  const destination = join(parent, 'workspace');
  const relative = 'tool/sample/versions/1.0.0/upstream';
  try {
    mkdirSync(join(source, relative), { recursive: true });
    writeFileSync(join(source, relative, '.gitattributes'), '* text eol=crlf\n');
    writeFileSync(join(source, relative, 'frozen.txt'), 'frozen\nbytes\n');
    execFileSync('git', ['-C', source, 'add', '--', relative], { stdio: 'ignore' });
    execFileSync('git', ['-C', source, 'commit', '-m', 'nested upstream attribute'], { stdio: 'ignore' });
    const blob = execFileSync('git', ['-C', source, 'cat-file', 'blob', `HEAD:${relative}/frozen.txt`]);
    const result = applyWorkspaceClone({ plan: buildWorkspaceClonePlan({ remote: source, destination, confirmed: true }) }, { auditRoot: join(parent, 'audit') });
    assert.equal(result.bytePreservingCheckout, true);
    assert.deepEqual(readFileSync(join(destination, relative, 'frozen.txt')), blob);
    assert.equal(execFileSync('git', ['-C', destination, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  } finally { rmSync(parent, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); }
});
