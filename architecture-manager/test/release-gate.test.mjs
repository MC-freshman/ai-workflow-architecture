import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWaiting } from '../scripts/release-gate-waiting.mjs';

const base = {
  version: '0.9.1',
  staleManagerEvidence: false,
  remoteConsistent: true,
  docsSiteOk: true,
  pendingTerminalRelease: false
};

test('fully green state has an empty waiting list', () => {
  assert.deepEqual(computeWaiting(base), []);
});

test('stale manager evidence is reported', () => {
  const result = computeWaiting({ ...base, staleManagerEvidence: true });
  assert.deepEqual(result, ['P5d 用户终端权威 conform digest']);
});

test('an unpushed remote is reported', () => {
  const result = computeWaiting({ ...base, remoteConsistent: false });
  assert.deepEqual(result, ['P6c 推送（需代理可用）']);
});

test('red docs-site gate and pending terminal release are both reported in order', () => {
  const result = computeWaiting({ ...base, docsSiteOk: false, pendingTerminalRelease: true });
  assert.deepEqual(result, ['文档站 docs-conform 判据', '0.9.1 发布轮终端执行（P5/P6）与权威 conform（P7）']);
});

test('N6: waiting text derives from state.version, never hardcoded', () => {
  const result = computeWaiting({ ...base, version: '0.9.2', pendingTerminalRelease: true });
  assert.deepEqual(result, ['0.9.2 发布轮终端执行（P5/P6）与权威 conform（P7）']);
  const fallback = computeWaiting({ staleManagerEvidence: false, remoteConsistent: true, docsSiteOk: true, pendingTerminalRelease: true });
  assert.deepEqual(fallback, ['0.0.0 发布轮终端执行（P5/P6）与权威 conform（P7）']);
});

test('all four gaps are reported without duplication', () => {
  const result = computeWaiting({
    staleManagerEvidence: true, remoteConsistent: false, docsSiteOk: false, pendingTerminalRelease: true
  });
  assert.equal(result.length, 4);
  assert.equal(new Set(result).size, 4);
});
