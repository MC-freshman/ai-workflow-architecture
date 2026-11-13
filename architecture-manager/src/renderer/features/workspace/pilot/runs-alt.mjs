// P4 pilot: minimal SELF-WRITTEN replacement for the runs read-only domain contract.
// Independent implementation (does not import src/domains/runs). Node-side only (fs);
// the renderer-safe pure core lives in runs-alt-core.mjs. Activated only via
// module-overrides.json replacement + contract tests (test/module-replacement-pilot.test.mjs).
// See docs/module-replacement.md for the detach/replace/recombine procedure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allPlatformIds, PLATFORM_IDS } from '../../../../core/platforms.mjs';
import { summarizeRunLockAlt } from './runs-alt-core.mjs';

export { summarizeRunLockAlt };

function loadLock(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { state: 'missing' }; }
  try { return { state: 'ok', lock: JSON.parse(text) }; } catch { return { state: 'corrupt' }; }
}

export function inspectRunDirectoryAlt(runRoot) {
  const loaded = loadLock(join(runRoot, 'run-lock.json'));
  if (loaded.state === 'missing') return { runRoot, lockStatus: 'missing' };
  if (loaded.state === 'corrupt') return { runRoot, lockStatus: 'corrupt' };
  return { runRoot, ...summarizeRunLockAlt(loaded.lock) };
}

export function listPlatformRunsAlt(workspaceRoot, platformId) {
  const runsRoot = join(workspaceRoot, platformId, 'runtime', 'runs');
  let entries;
  try { entries = readdirSync(runsRoot, { withFileTypes: true }); } catch {
    return { platform: platformId, runsRoot, runsRootPresent: false, total: 0, runs: [] };
  }
  const runs = entries.filter((e) => e.isDirectory()).map((e) => inspectRunDirectoryAlt(join(runsRoot, e.name)));
  return { platform: platformId, runsRoot, runsRootPresent: true, total: runs.length, runs };
}

export function listRunLedgerAlt(workspaceRoot) {
  const ids = workspaceRoot ? allPlatformIds(workspaceRoot) : [...PLATFORM_IDS];
  const platforms = ids.map((id) => listPlatformRunsAlt(workspaceRoot, id));
  return {
    workspaceRoot,
    platforms,
    totals: Object.fromEntries(platforms.map((p) => [p.platform, p.total])),
    totalRuns: platforms.reduce((sum, p) => sum + p.total, 0)
  };
}