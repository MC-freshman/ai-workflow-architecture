// N5 criteria: cli modules subcommand exposes registry/overrides read-only; scan/relayout unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(ROOT, 'src/cli.mjs');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: ROOT });

test('modules --json matches the committed registry verbatim on summary/views/overrides', () => {
  const r = run(['modules', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-registry.json'), 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-overrides.json'), 'utf8'));
  assert.equal(report.schema, 'architecture-manager-modules/v1');
  assert.deepEqual(report.summary, registry.summary);
  assert.deepEqual(report.views, registry.views.map(v => ({ id: v.id, label: v.label, group: v.group, panels: v.panels })));
  assert.deepEqual(report.overrides, overrides.overrides || {});
  assert.deepEqual(report.detached, []);
  assert.deepEqual(report.replaced, []);
  assert.equal(report.matrixCoverage.length, 23);
});

test('modules human output lists views and defaults', () => {
  const r = run(['modules']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /modules: \d+/);
  assert.match(r.stdout, /detached: none/);
  assert.match(r.stdout, /replaced: none/);
  assert.match(r.stdout, /governance \[运行与治理\] 治理/);
});

test('usage and scan/relayout dispatch unchanged', () => {
  const noArgs = run([]);
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stderr, /modules \[--json\]/);
  const badRoot = run(['Z:/definitely-absent-workspace-xyz']);
  assert.equal(badRoot.status, 1);
  assert.match(badRoot.stderr, /architecture-manager-error\/v1/);
});