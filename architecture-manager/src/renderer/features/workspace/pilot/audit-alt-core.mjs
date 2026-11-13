// N3 pilot pure core: self-written audit events reader (renderer-safe, no node builtins).
// Contract twin of src/domains/audit/audit.mjs#readAuditEvents for the verbatim-comparable
// subset: event normalization fields + integrity checksum classification + counts.
// Checkpoint file verification stays domain-side (fs); the pilot declares that boundary.
const STRING_FIELDS = ['target', 'workspaceRoot', 'occurredAt', 'at', 'error', 'planId', 'operationId', 'parentOperationId', 'transactionId', 'phase', 'checkpointPath', 'checkpointSha256', 'oldSha256', 'newSha256', 'eventSha256', 'writeState'];

export function normalizeAuditEventAlt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = value.action || value.kind;
  if (typeof action !== 'string' || !action || typeof value.status !== 'string' || !value.status) return null;
  for (const key of STRING_FIELDS) {
    if (value[key] != null && typeof value[key] !== 'string') return null;
  }
  if (value.writePerformed != null && typeof value.writePerformed !== 'boolean') return null;
  const sealed = typeof value.eventSha256 === 'string';
  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'eventSha256') continue;
    clean[key] = val;
  }
  return {
    ...clean,
    action,
    occurredAt: value.occurredAt || value.at || null,
    integrity: { checksum: sealed ? 'sealed-unverified' : 'legacy-unsealed', checkpoint: 'not-recorded' }
  };
}

export function parseAuditLinesAlt(text) {
  const report = { totalEvents: 0, corruptLines: 0, invalidEvents: 0, events: [], integrity: { hashed: 0, verified: 0, mismatches: 0, legacyUnsealed: 0, missingTimestamps: 0, checkpointProblems: 0 } };
  for (const line of String(text).split('\n').filter((l) => l.trim())) {
    let value;
    try { value = JSON.parse(line); } catch { report.corruptLines++; continue; }
    const event = normalizeAuditEventAlt(value);
    if (!event) { report.invalidEvents++; continue; }
    report.totalEvents++;
    if (event.integrity.checksum === 'legacy-unsealed') report.integrity.legacyUnsealed++;
    else report.integrity.hashed++;
    if (!event.occurredAt) report.integrity.missingTimestamps++;
    report.events.push(event);
  }
  return report;
}