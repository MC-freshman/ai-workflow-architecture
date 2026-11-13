// P4 pilot pure core: self-written run-lock summarization (no node builtins, renderer-safe).
// Contract twin of src/domains/runs/runs.mjs#summarizeRunLock; equivalence is pinned by
// test/module-replacement-pilot.test.mjs on shared fixtures.
const SCHEMA_RE = /^ai-run-lock\/v(\d+)\.\d+$/;

function resourceRow(resource) {
  if (!resource || typeof resource !== 'object') return null;
  const kind = typeof resource.kind === 'string' ? resource.kind : 'unknown';
  const id = typeof resource.id === 'string' ? resource.id : 'unknown';
  return {
    key: typeof resource.key === 'string' ? resource.key : `${kind}:${id}`,
    kind,
    id,
    version: typeof resource.version === 'string' ? resource.version : '',
    resolvedFrom: resource.resolvedFrom && typeof resource.resolvedFrom.kind === 'string' ? resource.resolvedFrom.kind : 'unspecified'
  };
}

export function summarizeRunLockAlt(lock) {
  if (!lock || typeof lock !== 'object') return { lockStatus: 'unknown-schema', schemaVersion: null };
  const schema = typeof lock.schemaVersion === 'string' ? lock.schemaVersion : '';
  const matched = SCHEMA_RE.exec(schema);
  if (!matched || Number(matched[1]) !== 1) return { lockStatus: 'unknown-schema', schemaVersion: schema || null };
  const execution = lock.execution && typeof lock.execution === 'object' ? lock.execution : {};
  const selection = lock.selection && typeof lock.selection === 'object' ? lock.selection : {};
  const resources = Array.isArray(lock.resources) ? lock.resources.map(resourceRow).filter(Boolean) : [];
  return {
    lockStatus: 'ok',
    schemaVersion: schema,
    platform: typeof lock.platform === 'string' ? lock.platform : null,
    runId: typeof lock.runId === 'string' ? lock.runId : null,
    createdAt: typeof lock.createdAt === 'string' ? lock.createdAt : null,
    selection: { agent: selection.agent ?? null, workflow: selection.workflow ?? null, runner: selection.runner ?? null },
    execution: {
      rigor: typeof execution.rigor === 'string' ? execution.rigor : null,
      gated: typeof execution.gated === 'boolean' ? execution.gated : null,
      frozen: typeof execution.frozen === 'boolean' ? execution.frozen : null,
      stageCount: Array.isArray(execution.stages) ? execution.stages.length : 0
    },
    resourceCount: resources.length,
    resources
  };
}

export const ALT_LOCK_BADGE = { ok: 'pill good', missing: 'pill warn', corrupt: 'pill warn', 'unknown-schema': 'pill warn' };
export const ALT_LOCK_TEXT = { ok: '锁可读', missing: '无锁文件', corrupt: '锁损坏', 'unknown-schema': '未知锁形态' };