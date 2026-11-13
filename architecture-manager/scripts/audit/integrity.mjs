// Resident supply-chain audit 1/3 (P7b, approved P-table 20261111): integrity.
// Recomputes every SHA256SUMS entry under tool/agent/software and checks current.json pointers.
// Periodic MANUAL audit (not part of conform; BP-3: not a per-change failure detector).
// usage: node scripts/audit/integrity.mjs [--root <workspace>] [--json <out>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = process.argv.includes('--root') ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repos = ['tool', 'agent', 'software'].map((r) => path.join(root, r)).filter((p) => fs.existsSync(p));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = { schema: 'manager-audit-integrity/v1', sumsFiles: 0, entries: 0, ok: 0, mismatch: [], missing: [], parseErrors: [], pointers: 0, brokenPointers: [] };

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, fn);
    else fn(fp, e.name);
  }
}
for (const repo of repos) {
  walk(repo, (fp, name) => {
    if (name === 'current.json') {
      report.pointers++;
      try {
        const pointer = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const version = pointer.version;
        if (version && !fs.existsSync(path.join(path.dirname(fp), 'versions', version))) report.brokenPointers.push(fp);
      } catch { report.brokenPointers.push(fp); }
      return;
    }
    if (!/^SHA256SUMS/.test(name)) return;
    report.sumsFiles++;
    const base = path.dirname(fp);
    for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      if (!m) { report.parseErrors.push(fp + ': ' + line.slice(0, 80)); continue; }
      report.entries++;
      const target = path.join(base, m[2].trim());
      if (!fs.existsSync(target)) { report.missing.push(target); continue; }
      if (sha(fs.readFileSync(target)) === m[1]) report.ok++;
      else report.mismatch.push(target);
    }
  });
}
report.clean = report.mismatch.length === 0 && report.missing.length === 0 && report.brokenPointers.length === 0 && report.parseErrors.length === 0;
const text = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], text);
console.log(text);
process.exit(report.clean ? 0 : 1);