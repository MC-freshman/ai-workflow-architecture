// Resident supply-chain audit 2/3 (P7b): reverse orphans + binary bodies + hidden files.
// Orphans = files inside released version directories not covered by any SHA256SUMS.
// Known registered exception: software/PacketTracer 8.0/ (user-registered, untracked) is
// reported separately and never counted against frozen-content orphans.
// usage: node scripts/audit/orphans.mjs [--root <workspace>] [--json <out>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv.includes('--root') ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repos = ['tool', 'agent', 'software'].map((r) => path.join(root, r)).filter((p) => fs.existsSync(p));
const BINARY = /\.(exe|dll|so|pyd|zip|7z|jar|msi)$/i;
const report = { schema: 'manager-audit-orphans/v1', versionDirs: 0, frozenOrphans: [], registeredExceptions: [], binaries: [], hidden: [] };

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
    if (BINARY.test(name)) report.binaries.push(fp);
    if (name.startsWith('.') && name !== '.gitignore' && name !== '.gitattributes') report.hidden.push(fp);
  });
  const versionsRoots = [];
  walk(repo, (fp, name) => { if (name === 'SHA256SUMS') versionsRoots.push(path.dirname(fp)); });
  for (const dir of versionsRoots) {
    if (!/[\\/]versions[\\/][^\\/]+$/.test(dir)) continue;
    report.versionDirs++;
    const covered = new Set();
    for (const sums of fs.readdirSync(dir).filter((n) => /^SHA256SUMS/.test(n))) {
      for (const line of fs.readFileSync(path.join(dir, sums), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^[0-9a-f]{64}\s+\*?(.+)$/);
        if (m) covered.add(path.resolve(dir, m[1].trim()));
      }
    }
    walk(dir, (fp) => {
      if (/^SHA256SUMS/.test(path.basename(fp))) return;
      if (covered.has(path.resolve(fp))) return;
      if (fp.includes('PacketTracer 8.0')) report.registeredExceptions.push(fp);
      else report.frozenOrphans.push(fp);
    });
  }
}
report.clean = report.frozenOrphans.length === 0 && report.binaries.length === 0;
const text = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], text);
console.log(JSON.stringify({ ...report, frozenOrphans: report.frozenOrphans.slice(0, 20), registeredExceptions: report.registeredExceptions.length, binaries: report.binaries.slice(0, 20), hidden: report.hidden.slice(0, 20) }, null, 2));
process.exit(report.clean ? 0 : 1);