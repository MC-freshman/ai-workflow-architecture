// N2 criteria: auto-refresh default off, 30s floor, stop clears timer (U-table 20261113).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshController } from '../src/renderer/shared/refresh-controller.mjs';

function fakeTimers() {
  const scheduled = new Map();
  let next = 1;
  return {
    scheduled,
    timers: {
      setInterval: (fn, ms) => { const id = next++; scheduled.set(id, { fn, ms }); return id; },
      clearInterval: (id) => { scheduled.delete(id); }
    },
    fire: () => { for (const { fn } of scheduled.values()) fn(); }
  };
}

test('default off: no timer scheduled until enabled', () => {
  const ft = fakeTimers();
  let calls = 0;
  const c = createRefreshController({ load: () => { calls++; }, timers: ft.timers });
  assert.equal(c.enabled, false);
  assert.equal(ft.scheduled.size, 0);
  ft.fire();
  assert.equal(calls, 0);
});

test('enabled schedules at >=30s and ticks load; disabling clears', () => {
  const ft = fakeTimers();
  let calls = 0;
  const c = createRefreshController({ load: () => { calls++; }, intervalMs: 1000, timers: ft.timers });
  assert.equal(c.intervalMs, 30000, 'interval floor enforced');
  c.setEnabled(true);
  assert.equal(ft.scheduled.size, 1);
  assert.equal([...ft.scheduled.values()][0].ms, 30000);
  ft.fire(); ft.fire();
  assert.equal(calls, 2);
  c.setEnabled(false);
  assert.equal(ft.scheduled.size, 0);
  ft.fire();
  assert.equal(calls, 2);
});

test('stop clears and disables; re-enable reschedules exactly one timer', () => {
  const ft = fakeTimers();
  const c = createRefreshController({ load: () => {}, timers: ft.timers });
  c.setEnabled(true);
  c.setEnabled(true);
  assert.equal(ft.scheduled.size, 1, 'no duplicate timers');
  c.stop();
  assert.equal(c.enabled, false);
  assert.equal(ft.scheduled.size, 0);
  c.setEnabled(true);
  assert.equal(ft.scheduled.size, 1);
  c.stop();
});

test('load is required', () => {
  assert.throws(() => createRefreshController({}), /REFRESH_LOAD_REQUIRED/);
});