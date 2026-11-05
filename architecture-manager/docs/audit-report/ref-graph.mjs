// Audit helper: compute file-level and export-level reference graphs.
// Read-only over src/scripts/test; prints results as JSON to stdout.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const norm = (p) => p.split(path.sep).join('/');

const all = [
  ...walk(path.join(root, 'src')).filter((f) => /\.(mjs|cjs|jsx)$/.test(f)),
  ...walk(path.join(root, 'scripts')).filter((f) => f.endsWith('.mjs')),
  ...walk(path.join(root, 'test')).filter((f) => f.endsWith('.mjs'))
];
const rel = (f) => norm(path.relative(root, f));
const sources = all.filter((f) => rel(f).startsWith('src/'));

// ---- file-level import graph ----
const importedBy = new Map();
for (const f of all) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = norm(path.resolve(path.dirname(f), spec));
    const list = importedBy.get(resolved) || [];
    list.push(rel(f));
    importedBy.set(resolved, list);
  }
}
const entryCandidates = new Set(['src/main.mjs', 'src/cli.mjs', 'src/preload.cjs', 'src/renderer/main.jsx', 'src/runtime/platform_defaults.mjs', 'src/runtime/task_worker.mjs']);
const orphans = sources.filter((f) => {
  if (entryCandidates.has(rel(f))) return false;
  const r = rel(f).replace(/\.(mjs|cjs|jsx)$/, '');
  const cands = [rel(f), `${r}.mjs`, `${r}.cjs`, `${r}.jsx`, `${r}/index.mjs`];
  return !cands.some((c) => importedBy.has(norm(path.join(root, c))));
});

// ---- export-level reference counts ----
const textOf = new Map(all.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const deadExports = [];
for (const f of sources) {
  if (rel(f).startsWith('src/renderer/')) continue; // jsx handled separately
  const src = textOf.get(f);
  const names = [...src.matchAll(/export (?:async )?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
    .concat([...src.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
  for (const name of new Set(names)) {
    let refFiles = [];
    for (const [cf, ct] of textOf) {
      if (cf === f) continue;
      if (new RegExp(`\\b${name}\\b`).test(ct)) refFiles.push(rel(cf));
    }
    if (refFiles.length === 0) deadExports.push({ file: rel(f), name });
  }
}

console.log(JSON.stringify({
  zeroImportFiles: orphans.map(rel),
  zeroExternalRefExports: deadExports
}, null, 2));
