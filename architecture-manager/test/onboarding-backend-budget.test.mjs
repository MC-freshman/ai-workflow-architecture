// Environment verification budget. The engine only enforces the 1..3600 range; how long a
// platform is willing to wait for its own sealed environment is that platform's declaration
// (codex's backends carry 120 today). Rewriting a backend must not silently reset that choice,
// and a value outside the range has to fail closed instead of being clamped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveVerifyTimeoutSeconds, VERIFY_TIMEOUT_DEFAULT } from '../src/domains/onboarding/onboarding-runtime.mjs';

function backendFile(t, verifyTimeoutSeconds) {
  const root = mkdtempSync(join(tmpdir(), 'backend-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'manager-sealed.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(verifyTimeoutSeconds === undefined ? { schema: 'wf-runner-execution-backend/v1', kind: 'wsl2' } : { schema: 'wf-runner-execution-backend/v1', kind: 'wsl2', verifyTimeoutSeconds }, null, 2) + '\n');
  return path;
}

test('a fresh backend gets the manager default', (t) => {
  assert.equal(resolveVerifyTimeoutSeconds({}), VERIFY_TIMEOUT_DEFAULT);
  assert.equal(resolveVerifyTimeoutSeconds({ backendPath: join(tmpdir(), 'does-not-exist.json') }), VERIFY_TIMEOUT_DEFAULT);
});

test('an existing declaration survives a rewrite instead of being reset', (t) => {
  const path = backendFile(t, 120);
  assert.equal(resolveVerifyTimeoutSeconds({ backendPath: path }), 120, 'the platform budget is kept');
});

test('the wizard can set the budget, and out-of-range values fail closed', (t) => {
  const path = backendFile(t, 120);
  assert.equal(resolveVerifyTimeoutSeconds({ explicit: 900, backendPath: path }), 900, 'an explicit choice wins over the stored one');
  assert.equal(resolveVerifyTimeoutSeconds({ explicit: '600' }), 600, 'a numeric string from the panel is accepted');
  for (const bad of [0, 3601, 4000, -5, 1.5, 'abc', '']) {
    if (bad === '') continue; // empty means "not set", which falls through to the stored or default value
    assert.throws(() => resolveVerifyTimeoutSeconds({ explicit: bad }), /RUNTIME_VERIFY_BUDGET_OUT_OF_RANGE/, `${bad} must be refused`);
  }
});

test('a backend file that cannot be read falls back to the default', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'backend-budget-broken-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'manager-sealed.json');
  writeFileSync(path, 'not json at all');
  assert.equal(resolveVerifyTimeoutSeconds({ backendPath: path }), VERIFY_TIMEOUT_DEFAULT);
});
