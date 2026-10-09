// Keep Electron alive until its own in-flight writes and cancellation evidence settle.
export function taskLifecycle(cancelAll) {
  const active = new Set();
  let closing = null;
  return {
    get pending() { return active.size; },
    async track(operation) {
      if (closing) throw new Error('APPLICATION_CLOSING');
      const task = Promise.resolve().then(operation); active.add(task);
      try { return await task; } finally { active.delete(task); }
    },
    close() {
      if (!closing) {
        cancelAll();
        closing = Promise.allSettled([...active]);
      }
      return closing;
    }
  };
}
