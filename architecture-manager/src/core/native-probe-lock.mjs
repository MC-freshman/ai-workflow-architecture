// Platform-local serialization for native vendor probes.
//
// Concurrent probe attempts against the same vendor collide inside the shared
// vendor config directory (auth operations discard each other: "a newer auth
// operation won", D-150). The lock is per platform (each vendor CLI owns its own
// config dir) and fails closed: a live holder refuses a second probe instead of
// letting both runs interfere.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

const pidAlive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
};

const holderLive = (lockPath, ttlMs) => {
  try {
    const holder = read(lockPath);
    const age = Date.now() - Date.parse(holder.startedAt);
    return Boolean(holder.pid) && pidAlive(holder.pid) && age >= 0 && age < ttlMs;
  } catch {
    return false;
  }
};

const claim = (lockPath, attemptId) => {
  fs.mkdirSync(dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, json({ attemptId, pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
};

// Returns a release function. Throws NATIVE_PROBE_ALREADY_RUNNING when another
// live attempt holds the lock; stale holders (dead pid or expired ttl) are broken.
export function acquireNativeProbeLock(lockPath, attemptId = randomUUID(), ttlMs = 15 * 60 * 1000) {
  try {
    claim(lockPath, attemptId);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    if (holderLive(lockPath, ttlMs)) throw Error('NATIVE_PROBE_ALREADY_RUNNING');
    fs.rmSync(lockPath, { force: true });
    claim(lockPath, attemptId);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (read(lockPath).attemptId === attemptId) fs.rmSync(lockPath, { force: true });
    } catch { /* another holder already replaced it */ }
  };
}
