// Check that the "current state" numbers written in governance texts still match
// machine-readable sources. Complements docs-site's C1..C11 (source lock / line fidelity);
// this script only judges numeric and pointer consistency. Read-only.
//
// usage: node scripts/check-governance-drift.mjs --root <workspaceRoot> [--warn]
//   --warn  report drift without failing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const read = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const warn = argv.includes('--warn');
const root = path.resolve(read('--root', '..'));
const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const text = rel => {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return ''; }
};
const json = rel => {
  try { return JSON.parse(text(rel)); }
  catch { return null; }
};

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

// 1. The three authoritative directory lists must point at the same named baseline.
const baselineFiles = ['AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'HANDOFF.md'];
for (const rel of baselineFiles) {
  const t = text(rel);
  const m = t.match(/当前命名基线[^\r\n]{0,180}/);
  const firstVersion = m ? m[0].match(/\d+\.\d+\.\d+/) : null;
  add(`baseline:${rel}`, !!firstVersion && firstVersion[0] === '3.7.0',
    firstVersion ? `first version after 当前命名基线 = ${firstVersion[0]}` : 'no 当前命名基线 line');
}

// 2. Shared current from anchor.json must appear verbatim in the platform checklist's current section.
const anchor = json('versions/anchor.json');
const checklist = text('versions/平台接入清单.md');
const section = checklist.includes('### 8.33') ? checklist.slice(checklist.indexOf('### 8.33')) : '';
const pinned = anchor ? [
  anchor.engine?.version, anchor.checker?.version, anchor.judge?.version,
  anchor.contracts?.version, anchor.conformance?.version
].filter(Boolean) : [];
add('anchor:present', !!anchor, anchor ? 'anchor.json parsed' : 'anchor.json missing');
for (const v of pinned) add(`anchor:in-checklist:${v}`, section.includes(v), `§8.33 mentions ${v}`);

// 3. Manager version must match the docs-site current statement.
const pkg = json('architecture-manager/package.json');
const siteReadme = text('docs-site/README.md');
add('manager:version', !!pkg && siteReadme.includes(`现行管理台为 ${pkg.version}`),
  pkg ? `package.json=${pkg.version}` : 'package.json missing');

// 4. Platform count from disk must be seven.
const platforms = fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'bridge.json')))
      .map(e => e.name)
  : [];
add('platforms:count', platforms.length === 7, platforms.join(','));

// 5. No stale readouts left in the release gate doc.
const gate = text('architecture-manager/docs/发布门禁.md');
const stale = ['339 例左右', '69 files', '0.8.2 已发布'].filter(s => gate.includes(s));
add('gate:no-stale', gate.length > 0 && stale.length === 0, stale.length ? 'stale: ' + stale.join(' / ') : 'clean');

const failed = checks.filter(c => !c.ok);
const report = {
  schema: 'architecture-manager-governance-drift/v1',
  mode: warn ? 'warn' : 'fail',
  workspaceRoot: root,
  managerRoot,
  checkedAt: new Date().toISOString(),
  checks,
  failed: failed.map(c => c.id),
  ok: failed.length === 0
};
console.log(JSON.stringify(report, null, 2));
if (failed.length && !warn) {
  console.error(`GOVERNANCE_DRIFT: ${failed.length} check(s) failed: ${failed.map(c => c.id).join(', ')}`);
  process.exitCode = 1;
}
