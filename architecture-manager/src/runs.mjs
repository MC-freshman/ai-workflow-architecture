import {parseJson as parseJsonText} from './core/json.mjs';
// Read-only run-ledger domain (3.5.0 P1①).
// Parses platform run directories and their run-lock.json without writing anything.
// Lock files reach tens of KB because environment manifests are inlined, so only a
// summary is materialized. Schemas outside ai-run-lock/v1.x classify as
// unknown-schema and are never guessed into a shape.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allPlatformIds, PLATFORM_IDS } from './core/platforms.mjs';

const LOCK_SCHEMA_PATTERN = /^ai-run-lock\/v(\d+)\.\d+$/;
const KNOWN_LOCK_MAJOR = 1;

function readJsonFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { status: 'missing' };
  }
  try {
    return { status: 'ok', value: parseJsonText(raw) };
  } catch {
    return { status: 'corrupt' };
  }
}

function summarizeResource(resource) {
  if (!resource || typeof resource !== 'object') return null;
  const kind = typeof resource.kind === 'string' ? resource.kind : 'unknown';
  const id = typeof resource.id === 'string' ? resource.id : 'unknown';
  return {
    key: typeof resource.key === 'string' ? resource.key : `${kind}:${id}`,
    kind,
    id,
    version: typeof resource.version === 'string' ? resource.version : '',
    resolvedFrom: resource.resolvedFrom && typeof resource.resolvedFrom.kind === 'string'
      ? resource.resolvedFrom.kind
      : 'unspecified'
  };
}

export function summarizeRunLock(lock) {
  if (!lock || typeof lock !== 'object') return { lockStatus: 'unknown-schema', schemaVersion: null };
  const schema = typeof lock.schemaVersion === 'string' ? lock.schemaVersion : '';
  const major = LOCK_SCHEMA_PATTERN.exec(schema);
  if (!major || Number(major[1]) !== KNOWN_LOCK_MAJOR) {
    return { lockStatus: 'unknown-schema', schemaVersion: schema || null };
  }
  const resources = Array.isArray(lock.resources)
    ? lock.resources.map(summarizeResource).filter(Boolean)
    : [];
  const execution = lock.execution && typeof lock.execution === 'object' ? lock.execution : {};
  const stages = Array.isArray(execution.stages) ? execution.stages : [];
  const selection = lock.selection && typeof lock.selection === 'object' ? lock.selection : {};
  return {
    lockStatus: 'ok',
    schemaVersion: schema,
    platform: typeof lock.platform === 'string' ? lock.platform : null,
    runId: typeof lock.runId === 'string' ? lock.runId : null,
    createdAt: typeof lock.createdAt === 'string' ? lock.createdAt : null,
    selection: {
      agent: selection.agent ?? null,
      workflow: selection.workflow ?? null,
      runner: selection.runner ?? null
    },
    execution: {
      rigor: typeof execution.rigor === 'string' ? execution.rigor : null,
      gated: typeof execution.gated === 'boolean' ? execution.gated : null,
      frozen: typeof execution.frozen === 'boolean' ? execution.frozen : null,
      stageCount: stages.length
    },
    resourceCount: resources.length,
    resources
  };
}

export function inspectRunDirectory(runRoot) {
  const lock = readJsonFile(join(runRoot, 'run-lock.json'));
  if (lock.status === 'missing') return { runRoot, lockStatus: 'missing' };
  if (lock.status === 'corrupt') return { runRoot, lockStatus: 'corrupt' };
  return { runRoot, ...summarizeRunLock(lock.value) };
}

export function listPlatformRuns(workspaceRoot, platformId) {
  const runsRoot = join(workspaceRoot, platformId, 'runtime', 'runs');
  let entries;
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true });
  } catch {
    return { platform: platformId, runsRoot, runsRootPresent: false, total: 0, runs: [] };
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    runs.push(inspectRunDirectory(join(runsRoot, entry.name)));
  }
  return { platform: platformId, runsRoot, runsRootPresent: true, total: runs.length, runs };
}

export function listRunLedger(workspaceRoot) {
  const platformIds = workspaceRoot ? allPlatformIds(workspaceRoot) : [...PLATFORM_IDS];
  const platforms = platformIds.map((id) => listPlatformRuns(workspaceRoot, id));
  const totals = Object.fromEntries(platforms.map((platform) => [platform.platform, platform.total]));
  return {
    workspaceRoot,
    platforms,
    totals,
    totalRuns: platforms.reduce((sum, platform) => sum + platform.total, 0)
  };
}
