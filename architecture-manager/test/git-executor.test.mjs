import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { buildGitPlan } from '../src/git.mjs';
import { applyPlan, verifyPlanTarget } from '../src/transactions.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'am-git-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'manager@test.local']);
  git(root, ['config', 'user.name', 'manager-test']);
  writeFileSync(join(root, 'README.md'), 'hello\n');
  git(root, ['add', '--', 'README.md']);
  git(root, ['commit', '-m', 'init']);
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-git-audit-'));
  return { root, auditRoot };
}

function head(root) {
  return git(root, ['rev-parse', 'HEAD']);
}

function cleanup(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
}

test('commits only the explicitly listed paths and verifies by HEAD advance', () => {
  const fixture = makeRepo();
  mkdirSync(join(fixture.root, 'docs'), { recursive: true });
  writeFileSync(join(fixture.root, 'docs', 'a.md'), 'content a\n');
  const before = head(fixture.root);
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'commit', message: 'add docs a', paths: ['docs/a.md'] });
  assert.equal(plan.target.headBefore, before);
  assert.deepEqual(plan.target.paths, ['docs/a.md']);
  const applied = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(applied.status, 'applied');
  assert.notEqual(head(fixture.root), before);
  assert.match(git(fixture.root, ['log', '-1', '--format=%s']), /add docs a/);
  assert.equal(verifyPlanTarget({ plan }).ok, true);
  assert.ok(existsSync(applied.checkpointPath) === false, 'git transactions do not use file checkpoints');
  cleanup(fixture);
});

test('rejects add -A, dot, wildcards and absolute paths by construction', () => {
  const fixture = makeRepo();
  for (const bad of [['.'], ['-A'], ['--all'], ['..'], ['src/../..'], ['*'], ['C:/Windows/x'], ['/etc']]) {
    assert.throws(() => buildGitPlan({ workspaceRoot: fixture.root, action: 'commit', message: 'x y z', paths: bad }), /GIT_ADD_ALL_FORBIDDEN|COMMIT_PATHS_REQUIRED/, bad.join());
  }
  cleanup(fixture);
});

test('rejects stale plans after HEAD moved externally', () => {
  const fixture = makeRepo();
  writeFileSync(join(fixture.root, 'b.txt'), 'b\n');
  git(fixture.root, ['add', '--', 'b.txt']);
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'commit', message: 'stale plan', paths: ['b.txt'] });
  writeFileSync(join(fixture.root, 'c.txt'), 'c\n');
  git(fixture.root, ['add', '--', 'c.txt']);
  git(fixture.root, ['commit', '-m', 'external commit']);
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }), /GIT_EXTERNAL_CHANGE/);
  cleanup(fixture);
});

test('blocks commits whose staged paths hit the sensitive scan', () => {
  const fixture = makeRepo();
  writeFileSync(join(fixture.root, 'key.txt'), 'private_key: AAAA\n');
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'commit', message: 'oops secret', paths: ['key.txt'] });
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }), /COMMIT_BLOCKED_SENSITIVE/);
  assert.equal(git(fixture.root, ['status', '--short']).includes('A  key.txt'), false);
  cleanup(fixture);
});

test('creates branch and tag plans and verifies the refs', () => {
  const fixture = makeRepo();
  const branchPlan = buildGitPlan({ workspaceRoot: fixture.root, action: 'branch', branch: 'feature/x' });
  assert.equal(applyPlan({ plan: branchPlan, auditRoot: fixture.auditRoot }).status, 'applied');
  assert.ok(git(fixture.root, ['rev-parse', '--verify', 'refs/heads/feature/x']));
  assert.equal(verifyPlanTarget({ plan: branchPlan }).ok, true);
  const tagPlan = buildGitPlan({ workspaceRoot: fixture.root, action: 'tag', tag: 'v0.3.0' });
  applyPlan({ plan: tagPlan, auditRoot: fixture.auditRoot });
  assert.ok(git(fixture.root, ['rev-parse', '--verify', 'refs/tags/v0.3.0']));
  assert.throws(() => buildGitPlan({ workspaceRoot: fixture.root, action: 'branch', branch: '-oProxyCommand=evil' }), /INVALID_BRANCH_NAME/);
  cleanup(fixture);
});

test('rollback uses revert --no-edit and produces a revert commit', () => {
  const fixture = makeRepo();
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'rollback', commit: head(fixture.root) });
  applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.match(git(fixture.root, ['log', '-1', '--format=%s']), /Revert/);
  cleanup(fixture);
});

test('export backup writes the archive and SHA256SUMS under inbox/archive', () => {
  const fixture = makeRepo();
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'backup', backupName: 'night-1' });
  const applied = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(applied.status, 'applied');
  const sums = join(fixture.root, 'inbox', 'archive', 'night-1', 'SHA256SUMS');
  assert.ok(existsSync(sums));
  const archivePath = join(fixture.root, 'inbox', 'archive', 'night-1', 'repo.zip');
  const digest = sha256(readFileSync(archivePath));
  assert.ok(readFileSync(sums, 'utf8').includes(`${digest}  repo.zip\n`));
  assert.equal(JSON.parse(readFileSync(join(fixture.root,plan.target.destination,'MANIFEST.json'),'utf8')).restoreVerified,true);
  assert.equal(verifyPlanTarget({ plan }).ok, true);
  assert.throws(() => buildGitPlan({ workspaceRoot: fixture.root, action: 'backup', backupName: '../escape' }), /INVALID_BACKUP_NAME/);
  cleanup(fixture);
});

test('a configured but unreachable local remote fails with a structured git error and an audit row', () => {
  const fixture = makeRepo();
  git(fixture.root,['remote','add','origin',join(fixture.root,'missing.git')]);
  const plan = buildGitPlan({ workspaceRoot: fixture.root, action: 'push', remote: 'origin' });
  assert.throws(() => applyPlan({ plan, auditRoot: fixture.auditRoot }), /GIT_COMMAND_FAILED/);
  const events = readFileSync(join(fixture.auditRoot, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.action === 'git-push' && event.status === 'failed'));
  cleanup(fixture);
});
