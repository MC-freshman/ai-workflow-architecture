import {parseJson as parseJsonText} from './core/json.mjs';
// Read-only inbox inventory domain (3.5.0 P1③).
// Shallow, read-only listing of the three inbox zones plus the BP-7 ledger.
// BP-7 discipline: inventory is not discovery, not execution, never deletion —
// this module exposes no write-capable API on purpose.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ZONES = ['backup', 'archive', 'trash'];

function shallowEntries(zonePath) {
  let entries;
  try {
    entries = readdirSync(zonePath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== '.DS_Store')
    .map((entry) => {
      let kind = 'other';
      try {
        kind = statSync(join(zonePath, entry.name)).isDirectory() ? 'directory' : 'file';
      } catch {
        kind = 'unreadable';
      }
      return { name: entry.name, kind };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function inspectInbox(workspaceRoot) {
  const inboxRoot = join(workspaceRoot, 'inbox');
  const zones = ZONES.map((zone) => {
    const zonePath = join(inboxRoot, zone);
    const entries = shallowEntries(zonePath);
    return { zone, path: zonePath, present: existsSync(zonePath), entryCount: entries.length, entries };
  });
  const ledgerPath = join(inboxRoot, '_inventory', 'BP7-ledger.json');
  let bp7Ledger = null;
  if (existsSync(ledgerPath)) {
    try {
      const ledger = parseJsonText(readFileSync(ledgerPath, 'utf8'));
      bp7Ledger = {
        path: ledgerPath,
        present: true,
        generatedAt: typeof ledger.generatedAt === 'string' ? ledger.generatedAt : null,
        entryCount: Array.isArray(ledger.entries) ? ledger.entries.length : null
      };
    } catch {
      bp7Ledger = { path: ledgerPath, present: true, corrupt: true };
    }
  }
  return { inboxRoot, zones, bp7Ledger };
}
