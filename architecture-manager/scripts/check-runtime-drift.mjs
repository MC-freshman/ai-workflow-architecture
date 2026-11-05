// Check that every managed platform's laid-out runtime components still match
// the canonical copies in src/runtime/. Detects D-176 (platform copies lagging behind).
// Read-only; never writes to the workspace.
//
// usage: node scripts/check-runtime-drift.mjs --root <workspaceRoot> [--warn]
//   --warn  report drift without failing (used until the lagging platforms are refreshed)
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const argv = process.argv.slice(2);
const read = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const warn = argv.includes('--warn');
const root = path.resolve(read('--root', '..'));
const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeDir = path.join(managerRoot, 'src', 'runtime');

const COMPONENTS = [
  'bridge/manager-client/cli_client.py',
  'bridge/manager-client/mcp_service.py',
  'bridge/manager-client/platform_defaults.mjs',
  'bridge/manager-providers/platform_provider.py',
  'bridge/manager-providers/peer_dispatcher.py'
].map(rel => ({rel, name: path.basename(rel)}));

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonical = {};
for (const c of COMPONENTS) {
  const src = path.join(runtimeDir, c.name);
  canonical[c.name] = fs.existsSync(src) ? sha256(src) : null;
}

const managerVersion = JSON.parse(fs.readFileSync(path.join(managerRoot, 'package.json'), 'utf8')).version;
// A managed platform is any root dir that carries a bridge/ folder with one of the
// known config files (same discovery rule as provider-templates.mjs).
const configNames = id => ['bridge.json', 'runner-config.json', `${id}-config.json`];
const platforms = fs.readdirSync(root, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(id => fs.existsSync(path.join(root, id, 'bridge')) && configNames(id).some(name => fs.existsSync(path.join(root, id, 'bridge', name))));

const rows = platforms.map(id => {
  const components = COMPONENTS.map(c => {
    const file = path.join(root, id, c.rel);
    if (!fs.existsSync(file)) return {path: c.rel, status: 'absent'};
    if (!canonical[c.name]) return {path: c.rel, status: 'no-canonical'};
    const installed = sha256(file);
    return {path: c.rel, status: installed === canonical[c.name] ? 'current' : 'drift', installedSha256: installed};
  });
  let pinned = null;
  // The root-level bridge.json is the governance config entry point and takes
  // precedence; the laid-out bridge/ copy is only a fallback for platforms that
  // do not keep a root-level descriptor.
  for (const candidate of [path.join(root, id, 'bridge.json'), path.join(root, id, 'bridge', 'bridge.json')]) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8')).runtimeComponentVersion ?? null;
      if (value !== null) { pinned = value; break; }
    } catch { /* absent or unreadable: try the next candidate */ }
  }
  const pinStatus = pinned === null ? 'unpinned' : pinned === managerVersion ? 'current' : 'stale';
  const drift = components.filter(row => row.status === 'drift');
  const ok = drift.length === 0 && pinStatus !== 'stale';
  return {platformId: id, ok, pinStatus, pinned, expectedVersion: managerVersion, drifted: drift.map(row => row.path), components};
});

const report = {
  schema: 'architecture-manager-runtime-drift/v1',
  mode: warn ? 'warn' : 'fail',
  managerVersion,
  checkedAt: new Date().toISOString(),
  platforms: rows,
  drifted: rows.filter(row => !row.ok).map(row => row.platformId),
  ok: rows.every(row => row.ok)
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok && !warn) {
  console.error(`RUNTIME_COMPONENT_DRIFT: ${report.drifted.length} platform(s) need re-layout: ${report.drifted.join(', ')}`);
  process.exitCode = 1;
}
