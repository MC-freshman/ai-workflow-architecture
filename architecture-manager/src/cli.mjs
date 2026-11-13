import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanWorkspace } from './domains/resources/inventory.mjs';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const error = value => JSON.stringify({ schema: 'architecture-manager-error/v1', error: String(value?.message ?? value) });

// N5 (approved U-table 20261113): read-only module registry / override visibility for CLI & AI sessions.
function modules(args) {
  const asJson = args.includes('--json');
  const registry = JSON.parse(fs.readFileSync(path.join(managerRoot, 'src', 'app', 'module-registry.json'), 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(managerRoot, 'src', 'app', 'module-overrides.json'), 'utf8'));
  const detached = registry.modules.filter(m => m.enabled === false).map(m => m.id);
  const replaced = registry.modules.filter(m => m.replacement != null).map(m => ({ id: m.id, replacement: m.replacement }));
  const matrix = [...new Set(registry.modules.map(m => m.matrixRef))].sort();
  const report = {
    schema: 'architecture-manager-modules/v1',
    generatedAt: registry.generatedAt,
    summary: registry.summary,
    views: registry.views.map(v => ({ id: v.id, label: v.label, group: v.group, panels: v.panels })),
    overrides: overrides.overrides || {},
    detached,
    replaced,
    matrixCoverage: matrix,
    replaceableCount: registry.modules.filter(m => m.replaceable).length
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `modules: ${report.summary.moduleCount} (domains ${report.summary.domainCount} / panels ${report.summary.panelCount} / views ${report.summary.viewCount}) · channels ${report.summary.channelCount}`,
    `matrix coverage: ${matrix.join(' ')}`,
    `replaceable: ${report.replaceableCount} · detached: ${detached.length ? detached.join(', ') : 'none'} · replaced: ${replaced.length ? replaced.map(r => `${r.id}->${r.replacement}`).join(', ') : 'none'}`,
    `overrides: ${Object.keys(report.overrides).length ? JSON.stringify(report.overrides) : '{}'}`,
    'views:'
  ];
  for (const v of report.views) lines.push(`  ${v.id} [${v.group}] ${v.label} :: ${v.panels.join(', ')}`);
  process.stdout.write(lines.join('\n') + '\n');
}

const COMPONENTS = [
  'bridge/manager-client/cli_client.py',
  'bridge/manager-client/mcp_service.py',
  'bridge/manager-client/platform_defaults.mjs',
  'bridge/manager-providers/platform_provider.py',
  'bridge/manager-providers/peer_dispatcher.py'
];
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function relayout(args) {
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const root = path.resolve(flag('--root', path.resolve(managerRoot, '..')));
  const dryRun = args.includes('--dry-run');
  const stamp = new Date().toISOString().slice(0, 10);
  const canonical = path.join(managerRoot, 'src', 'runtime');
  const platforms = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'bridge')))
    .map(entry => entry.name)
    .filter(id => COMPONENTS.some(rel => fs.existsSync(path.join(root, id, rel))));

  const changes = [];
  const backups = [];
  for (const id of platforms) {
    for (const rel of COMPONENTS) {
      const dst = path.join(root, id, rel);
      const src = path.join(canonical, path.basename(rel));
      if (!fs.existsSync(dst) || !fs.existsSync(src)) continue;
      const want = sha(src);
      const have = sha(dst);
      if (want === have) continue;
      if (!dryRun) {
        const dir = path.join(root, 'inbox', 'backup', id, 'runtime-components', stamp);
        fs.mkdirSync(dir, { recursive: true });
        const backup = path.join(dir, rel.replace(/\//g, '__'));
        fs.copyFileSync(dst, backup);
        backups.push({ dst, backup });
        fs.copyFileSync(src, dst);
      }
      changes.push({ platformId: id, rel, before: have.slice(0, 12), after: want.slice(0, 12) });
    }
  }

  const mismatches = [];
  if (!dryRun) {
    for (const id of platforms) {
      for (const rel of COMPONENTS) {
        const dst = path.join(root, id, rel);
        const src = path.join(canonical, path.basename(rel));
        if (fs.existsSync(dst) && fs.existsSync(src) && sha(dst) !== sha(src)) mismatches.push(`${id}/${rel}`);
      }
    }
    if (mismatches.length) for (const item of backups) fs.copyFileSync(item.backup, item.dst);
  }

  const report = {
    schema: 'architecture-manager-relayout/v1',
    workspaceRoot: root,
    dryRun,
    checkedAt: new Date().toISOString(),
    platforms,
    changes,
    backups: backups.length,
    mismatches,
    ok: mismatches.length === 0
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (mismatches.length) process.exitCode = 1;
}

if (argv[0] === 'relayout') {
  try { relayout(argv.slice(1)); }
  catch (failure) { console.error(error(failure)); process.exitCode = 1; }
} else if (argv[0] === 'modules') {
  try { modules(argv.slice(1)); }
  catch (failure) { console.error(error(failure)); process.exitCode = 1; }
} else {
  const root = argv[0];
  if (!root) {
    console.error('usage: npm run scan -- <workspace-root> | node src/cli.mjs relayout [--dry-run] [--root <workspace-root>] | node src/cli.mjs modules [--json]');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(`${JSON.stringify(scanWorkspace(root), null, 2)}\n`); }
    catch (failure) { console.error(error(failure)); process.exitCode = 1; }
  }
}
