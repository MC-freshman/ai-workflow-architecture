import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.env.ARCH_WORKSPACE_ROOT || '';
const err = (code, message) => Object.assign(new Error(message), { code });
function root() {
  if (!ROOT) throw err('ARCH_WORKSPACE_ROOT_REQUIRED', 'Set ARCH_WORKSPACE_ROOT to the workspace root.');
  const p = path.resolve(ROOT);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw err('ARCH_WORKSPACE_ROOT_INVALID', 'Root is not a directory.');
  return p;
}
function inside(rel) {
  const r = root(), p = path.resolve(r, rel);
  if (p !== r && !p.startsWith(r + path.sep)) throw err('ARCH_PATH_ESCAPE', 'Path escapes workspace root.');
  return p;
}
function readJson(rel) {
  const p = inside(rel);
  if (!fs.existsSync(p)) throw err('ARCH_FILE_NOT_FOUND', rel);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function readText(rel) {
  const p = inside(rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}
const ID = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' } }, required: ['id'] };
const EMPTY = { type: 'object', additionalProperties: false, properties: {} };
export const TOOLS = [
  { name: 'arch_software_list', description: 'List shared software registry entries.', inputSchema: EMPTY },
  { name: 'arch_software_read', description: 'Read one software pointer and its manifest summary.', inputSchema: ID },
  { name: 'arch_versions_current', description: 'Read the pinned shared component versions.', inputSchema: EMPTY },
  { name: 'arch_defects_list', description: 'Read defect book counts and non-closed ids.', inputSchema: EMPTY },
  { name: 'arch_conform_status', description: 'Read the last conform evidence summary.', inputSchema: EMPTY },
  { name: 'arch_governance_status', description: 'Read the named baseline from the three authoritative lists.', inputSchema: EMPTY },
  { name: 'arch_platform_pins', description: 'Read runtimeComponentVersion for every platform.', inputSchema: EMPTY }
];
export async function handle(name, args) {
  if (name === 'arch_software_list') {
    const d = readJson('software/registry.json');
    return { schema: 'arch-software-list/v1', ids: d.software.map(e => e.id), entries: d.software };
  }
  if (name === 'arch_software_read') {
    const id = String(args.id || '');
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw err('ARCH_ID_INVALID', 'Invalid software id.');
    const cur = readJson(`software/${id}/current.json`);
    const rel = `software/${id}/versions/${cur.version}/manifest.json`;
    const p = inside(rel);
    const manifest = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
    return { schema: 'arch-software-read/v1', id, version: cur.version, kind: manifest?.kind || null, capabilities: manifest?.capabilities?.length || 0 };
  }
  if (name === 'arch_versions_current') {
    const a = readJson('versions/anchor.json');
    return { schema: 'arch-versions-current/v1', engine: a.engine, checker: a.checker, judge: a.judge, contracts: a.contracts, conformance: a.conformance };
  }
  if (name === 'arch_defects_list') {
    const d = readJson('versions/缺陷状态簿.json');
    const rows = d.defects || [];
    const counts = {};
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    return { schema: 'arch-defects-list/v1', total: rows.length, counts, nonClosed: rows.filter(r => !['closed', 'ruled', 'absorbed'].includes(r.status)).map(r => r.id) };
  }
  if (name === 'arch_conform_status') {
    const p = inside('architecture-manager/conform.json');
    if (!fs.existsSync(p)) return { schema: 'arch-conform-status/v1', available: false, reason: 'EVIDENCE_NOT_FOUND' };
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { schema: 'arch-conform-status/v1', available: true, ok: d.ok, digest: d.digest, recordedAt: d.recordedAt };
  }
  if (name === 'arch_governance_status') {
    const out = {};
    for (const f of ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md']) {
      const m = readText(f).match(/当前命名基线[^\r\n]{0,180}/);
      out[f] = m ? (m[0].match(/\d+\.\d+\.\d+/) || [null])[0] : null;
    }
    return { schema: 'arch-governance-status/v1', baselines: out };
  }
  if (name === 'arch_platform_pins') {
    const r = root(), out = {};
    for (const e of fs.readdirSync(r, { withFileTypes: true })) {
      if (!e.isDirectory() || !fs.existsSync(path.join(r, e.name, 'bridge.json'))) continue;
      const b = JSON.parse(fs.readFileSync(path.join(r, e.name, 'bridge.json'), 'utf-8'));
      out[e.name] = b.runtimeComponentVersion || null;
    }
    return { schema: 'arch-platform-pins/v1', pins: out };
  }
  throw err('TOOL_UNKNOWN', name);
}
