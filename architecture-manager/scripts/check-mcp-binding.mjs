// P6a (approved P-table 20261111): MCP injection-layer binding drift gate.
// The shared MCP recipes (software/architecture-manager-mcp, ai-novel-platform-mcp) inline
// whitelists bound to the target software's function signatures. When the manager's domain
// export surface drifts, the recipes MUST be re-probed (r3_probe) and the redline blacklist
// re-reviewed before the next recipe release. This gate makes that maintenance item machine-judged.
// Read-only: never writes the recipes, never imports manager domains (static export parse).
//
// usage: node scripts/check-mcp-binding.mjs [--write-baseline]
// novel half: requires NOVEL_APP_ROOT (workspace-external); absent => honestly skipped.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'baselines', 'mcp-exports.json');
// Mirrors the MCP injection layer's stdout-pollution exclusion (two-MCP 2.0.0 round).
const EXCLUDED = ['src/domains/platforms/default-command.mjs'];

function walkMjs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMjs(fp));
    else if (entry.name.endsWith('.mjs')) out.push(fp);
  }
  return out;
}
function exportNames(file) {
  const names = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    let m = line.match(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/);
    if (m) names.push(m[1]);
    m = line.match(/^export\s*\{([^}]+)\}/);
    if (m) for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  });
  return [...new Set(names)].sort();
}
export function managerExportSurface() {
  const entries = [];
  for (const file of walkMjs(path.join(ROOT, 'src/domains'))) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    if (EXCLUDED.includes(rel)) continue;
    for (const name of exportNames(file)) entries.push(rel + '#' + name);
  }
  return entries.sort();
}
export function novelServiceSurface(novelRoot) {
  const services = path.join(novelRoot, 'electron', 'services');
  if (!fs.existsSync(services)) return null;
  const rows = [];
  for (const entry of fs.readdirSync(services, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.cjs')) continue;
    const bytes = fs.readFileSync(path.join(services, entry.name));
    rows.push({ file: 'electron/services/' + entry.name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return rows;
}
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function computeBinding() {
  const manager = managerExportSurface();
  const novelRoot = process.env.NOVEL_APP_ROOT || null;
  const novel = novelRoot ? novelServiceSurface(novelRoot) : null;
  return {
    schema: 'mcp-binding-baseline/v1',
    excluded: EXCLUDED,
    manager: { count: manager.length, sha256: sha(manager), entries: manager },
    novel: novel ? { root: 'NOVEL_APP_ROOT', count: novel.length, sha256: sha(novel), files: novel } : null
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const current = computeBinding();
  if (process.argv.includes('--write-baseline')) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    console.log('baseline written: manager', current.manager.count, 'exports; novel', current.novel ? current.novel.count + ' files' : 'skipped (NOVEL_APP_ROOT absent)');
  } else {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const problems = [];
    if (baseline.manager.sha256 !== current.manager.sha256) {
      const before = new Set(baseline.manager.entries);
      const after = new Set(current.manager.entries);
      const added = [...after].filter((x) => !before.has(x));
      const removed = [...before].filter((x) => !after.has(x));
      problems.push('MANAGER_EXPORT_DRIFT added=' + added.length + ' removed=' + removed.length + ' :: ' + [...added, ...removed].slice(0, 10).join(', '));
    }
    if (baseline.novel && current.novel && baseline.novel.sha256 !== current.novel.sha256) problems.push('NOVEL_SERVICE_DRIFT');
    if (baseline.novel && !current.novel) problems.push('NOVEL_BASELINE_PRESENT_BUT_ROOT_ABSENT (set NOVEL_APP_ROOT to verify; skipped honestly)');
    if (problems.length) {
      console.error('MCP_BINDING_DRIFT\n' + problems.join('\n') + '\n须重跑 MCP 探针（r3_probe）并复核红线黑名单后，再发布配方新版本或更新基线（--write-baseline 与探针重跑同批登记）。');
      process.exit(1);
    }
    console.log('mcp-binding ok: manager', current.manager.count, 'exports; novel', current.novel ? current.novel.count + ' files' : 'skipped (NOVEL_APP_ROOT absent)');
  }
}