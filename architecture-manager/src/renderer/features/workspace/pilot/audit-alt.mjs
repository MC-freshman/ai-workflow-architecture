// N3 pilot: self-written replacement for the audit read-only domain contract (Node side).
// Independent implementation (does not import src/domains/audit). Verbatim-comparable subset
// is pinned by test/module-replacement-audit.test.mjs; hash verification and checkpoint file
// checks remain domain-side by declared boundary (renderer-safe core cannot do fs/crypto).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAuditLinesAlt } from './audit-alt-core.mjs';

export { parseAuditLinesAlt, normalizeAuditEventAlt } from './audit-alt-core.mjs';

export function readAuditEventsAlt(options = {}) {
  const auditRoot = options.auditRoot;
  if (!auditRoot) return { auditRoot: null, present: false, totalEvents: 0, corruptLines: 0, invalidEvents: 0, checkpointCount: 0, matchedEvents: 0, events: [], integrity: { hashed: 0, verified: 0, mismatches: 0, legacyUnsealed: 0, missingTimestamps: 0, checkpointProblems: 0 }, operationsWithoutTerminal: [] };
  const eventsPath = join(auditRoot, 'events.jsonl');
  const present = existsSync(eventsPath);
  let checkpointCount = 0;
  try { checkpointCount = readdirSync(join(auditRoot, 'checkpoints'), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.before')).length; } catch { /* no checkpoints yet */ }
  if (!present) return { auditRoot, eventsPath, present, totalEvents: 0, corruptLines: 0, invalidEvents: 0, checkpointCount, matchedEvents: 0, events: [], integrity: { hashed: 0, verified: 0, mismatches: 0, legacyUnsealed: 0, missingTimestamps: 0, checkpointProblems: 0 }, operationsWithoutTerminal: [] };
  const parsed = parseAuditLinesAlt(readFileSync(eventsPath, 'utf8'));
  const operations = new Map();
  const events = [];
  for (const event of parsed.events) {
    if (event.phase === 'operation' && event.operationId) operations.set(event.operationId, event);
    if (options.workspaceRoot && (!event.workspaceRoot || join(event.workspaceRoot) !== join(options.workspaceRoot))) continue;
    if (options.status && event.status !== options.status) continue;
    if (options.planId && event.planId !== options.planId && event.operationId !== options.planId) continue;
    events.push(event);
  }
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.max(1, Math.min(500, Math.floor(options.limit))) : 100;
  return {
    auditRoot,
    eventsPath,
    present,
    totalEvents: parsed.totalEvents,
    corruptLines: parsed.corruptLines,
    invalidEvents: parsed.invalidEvents,
    checkpointCount,
    matchedEvents: events.length,
    events: events.slice(-limit),
    integrity: parsed.integrity,
    operationsWithoutTerminal: [...operations.values()].filter((e) => e.status === 'started').map((e) => ({ operationId: e.operationId, planId: e.planId, occurredAt: e.occurredAt }))
  };
}