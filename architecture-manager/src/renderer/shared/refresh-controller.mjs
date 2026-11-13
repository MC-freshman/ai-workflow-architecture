// N2 (approved U-table 20261113): DOM-free auto-refresh controller.
// Default OFF; interval floor 30s; stopping clears the timer. Panels keep their own
// request-version guards for stale-response discard; this factory only owns the clock.
export function createRefreshController({ load, intervalMs = 30000, timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) } } = {}) {
  if (typeof load !== 'function') throw Error('REFRESH_LOAD_REQUIRED');
  const interval = Math.max(30000, Number(intervalMs) || 30000);
  let handle = null;
  let enabled = false;
  const clear = () => { if (handle !== null) { timers.clearInterval(handle); handle = null; } };
  return {
    get enabled() { return enabled; },
    get intervalMs() { return interval; },
    setEnabled(on) {
      enabled = !!on;
      if (enabled && handle === null) handle = timers.setInterval(() => load(), interval);
      if (!enabled) clear();
    },
    stop() { enabled = false; clear(); }
  };
}