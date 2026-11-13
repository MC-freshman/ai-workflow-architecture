// Resident supply-chain audit 3/3 (P7b): content poisoning / injection scan, 13 classes.
// R6 fixes from the 2026-11-06 audit are built in: sk- word boundary, UTF-8 BOM exclusion,
// upstream/ and tests/ hits downweighted into an informational bucket (never auto-executed).
// Periodic MANUAL audit; hits are leads for semantic review, not verdicts.
// usage: node scripts/audit/content.mjs [--root <workspace>] [--json <out>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv.includes('--root') ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repos = ['tool', 'agent', 'software'].map((r) => path.join(root, r)).filter((p) => fs.existsSync(p));
const TEXT = /\.(md|mjs|cjs|js|jsx|py|json|yaml|yml|txt|sh|ps1|html|css|toml|cfg|ini)$/i;
const RULES = [
  ['PI-01', /ignore (all |any )?(previous|prior|above) (instructions|rules|prompts)/i],
  ['PI-02', /you are now (in )?(developer|debug|dan|jailbreak) mode/i],
  ['EX-01', /curl[^|\n]{0,120}\|\s*(ba)?sh|wget[^|\n]{0,120}\|\s*(ba)?sh/i],
  ['EX-02', /reverse shell|bash -i >&|\/dev\/tcp\//i],
  ['EX-03', /\beval\s*\(|\bexec\s*\(|os\.system\s*\(|shell\s*=\s*True|child_process\.exec\s*\(/],
  ['EX-04', /(eval|exec|Function|innerHTML|document\.write|child_process|spawn|execSync)[^;\n]{0,80}\$\{|\$\{[^}]*\}[^;\n]{0,40}(eval|exec|innerHTML|document\.write)/],
  ['SEC-01', /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['SEC-02', /(password|passwd|secret|token)\s*[:=]\s*['"][^'"]{6,}['"]/i],
  ['BP1-01', /C:\\Users\\[A-Za-z0-9_.-]+\\|\/home\/[a-z0-9_-]+\//],
  ['BP2-01', /[A-Za-z]:\\ai\\[a-z-]+\\runtime|\/ai\/[a-z-]+\/runtime\//],
  ['SUP-01', /pip install git\+https|npm install [a-z0-9@/-]+@latest|npx [a-z0-9@/-]+@latest/i],
  ['HID-01', /<!--[^>]*(ignore|instruction|system prompt)[^>]*-->/i],
  ['HID-03', /[A-Za-z0-9+/]{200,}={0,2}/]
];
const report = { schema: 'manager-audit-content/v1', files: 0, bytes: 0, hits: {}, informational: {}, samples: {} };
for (const [id] of RULES) { report.hits[id] = 0; report.informational[id] = 0; report.samples[id] = []; }

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, fn);
    else fn(fp);
  }
}
for (const repo of repos) {
  walk(repo, (fp) => {
    if (!TEXT.test(fp)) return;
    let raw;
    try { raw = fs.readFileSync(fp, 'utf8'); } catch { return; }
    report.files++;
    report.bytes += Buffer.byteLength(raw);
    const rel = path.relative(root, fp).replaceAll('\\', '/');
    const downweighted = /(^|\/)(upstream|tests|test|fixtures)\//.test(rel) || rel.includes('PacketTracer 8.0');
    const lines = raw.split('\n');
    lines.forEach((line, i) => {
      const clean = i === 0 ? line.replace(/^﻿/, '') : line; // R6: BOM exclusion
      for (const [id, re] of RULES) {
        if (id === 'HID-02') continue;
        if (!re.test(clean)) continue;
        if (id === 'HID-03' && (!/^[A-Za-z0-9+/=\s]+$/.test(clean.trim()) || /^[0-9a-f\s]+$/.test(clean.trim()))) continue;
        if (downweighted) report.informational[id]++;
        else {
          report.hits[id]++;
          if (report.samples[id].length < 5) report.samples[id].push(rel + ':' + (i + 1));
        }
      }
      // HID-02 invisible unicode (BOM at line start excluded per R6)
      const invisible = clean.replace(/^﻿/, '').match(/[​-‏‪-‮⁦-⁩]/g);
      if (invisible) {
        if (downweighted) report.informational['HID-02'] = (report.informational['HID-02'] || 0) + 1;
        else {
          report.hits['HID-02'] = (report.hits['HID-02'] || 0) + 1;
          if ((report.samples['HID-02'] ||= []).length < 5) report.samples['HID-02'].push(rel + ':' + (i + 1));
        }
      }
    });
  });
}
report.totalHits = Object.values(report.hits).reduce((a, b) => a + b, 0);
report.totalInformational = Object.values(report.informational).reduce((a, b) => a + b, 0);
const text = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], text);
console.log(JSON.stringify({ files: report.files, bytes: report.bytes, totalHits: report.totalHits, totalInformational: report.totalInformational, hits: report.hits, samples: report.samples }, null, 2));