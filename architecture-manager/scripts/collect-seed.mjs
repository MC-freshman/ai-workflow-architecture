// Collects the three shared repositories' current-pointer releases plus the
// tool skills body into architecture-manager/seed/ for installer bundling
// (owner requirement ①, rulings 2026-10-13/14). Pointer semantics follow the
// software-registry S-P2 adjudication: a registry entry's `current` is the
// path of its pointer file, and the pointer's `version` selects the release.
// Only the current-pointer face is collected — never the frozen history
// (BP-3 minimality). The seed is a regenerable derivative; the workspace
// repositories stay the single source of truth (BP-7).
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/core/hash.mjs';
import { parseJson } from '../src/core/json.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const REPOS = ['tool', 'agent', 'software'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--workspace') args.workspace = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = resolve(args.workspace || resolve(scriptRoot, '..', '..'));
const outRoot = resolve(args.out || resolve(scriptRoot, '..', 'seed'));

const plan = [];
const filesIndex = {};
let totalBytes = 0;

function addFile(absPath) {
  const rel = relative(workspaceRoot, absPath).split(sep).join('/');
  if (filesIndex[rel]) return;
  const stat = statSync(absPath);
  if (!stat.isFile()) return;
  const digest = sha256(readFileSync(absPath));
  filesIndex[rel] = { sha256: digest, size: stat.size };
  totalBytes += stat.size;
  plan.push({ src: absPath, rel });
}

function addTree(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(absDir, entry.name);
    if (entry.isDirectory()) addTree(child);
    else if (entry.isFile()) addFile(child);
  }
}

const repoSummaries = {};
for (const repo of REPOS) {
  const registryPath = join(workspaceRoot, repo, 'registry.json');
  if (!existsSync(registryPath)) throw new Error(`SEED_REPO_MISSING:${repo}`);
  addFile(registryPath);
  const registry = parseJson(readFileSync(registryPath, 'utf8'));
  const entries = [];
  for (const [section, list] of Object.entries(registry)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry?.id || entry.id.startsWith('_')) continue;
      if (entry.current) {
        const pointerAbs = join(workspaceRoot, repo, entry.current);
        if (!existsSync(pointerAbs)) throw new Error(`SEED_POINTER_MISSING:${repo}/${entry.current}`);
        addFile(pointerAbs);
        const pointer = parseJson(readFileSync(pointerAbs, 'utf8'));
        if (!pointer?.version) throw new Error(`SEED_POINTER_VERSION_MISSING:${repo}/${entry.current}`);
        const releaseDir = join(dirname(pointerAbs), 'versions', String(pointer.version));
        if (!existsSync(releaseDir)) throw new Error(`SEED_RELEASE_MISSING:${repo}/${entry.current}@${pointer.version}`);
        addTree(releaseDir);
        entries.push({ section, id: entry.id, pointer: entry.current, version: pointer.version });
      } else if (entry.path) {
        const indexAbs = join(workspaceRoot, repo, entry.path);
        if (existsSync(indexAbs)) addFile(indexAbs);
        entries.push({ section, id: entry.id, index: entry.path });
      }
    }
  }
  repoSummaries[repo] = { entries: entries.length, pointers: entries.filter((e) => e.pointer).length, indexes: entries.filter((e) => e.index).length };
}

// Software-side gateway faces are not registry entries but are resolved the
// same way (ai-software-pointer/v1, id `_connector`/`_gateway`); collect them.
for (const special of ['_connector', '_gateway']) {
  const pointerAbs = join(workspaceRoot, 'software', special, 'current.json');
  if (!existsSync(pointerAbs)) continue;
  addFile(pointerAbs);
  const pointer = parseJson(readFileSync(pointerAbs, 'utf8'));
  const releaseDir = join(workspaceRoot, 'software', special, 'versions', String(pointer.version));
  if (existsSync(releaseDir)) addTree(releaseDir);
  repoSummaries[special] = { entries: 1, pointers: 1, indexes: 0, version: pointer.version };
}

// Skill-catalog entries are invocable:false indexes; their bodies live in
// tool/skills. Without them, skill-dependent workflows cannot run (owner
// requirement ④ conflict noted 2026-10-13), so the body ships with the seed.
const skillsDir = join(workspaceRoot, 'tool', 'skills');
if (existsSync(skillsDir)) addTree(skillsDir);

const manifest = {
  schema: 'ai-seed-manifest/v1',
  generatedAt: new Date().toISOString(),
  workspaceRoot,
  totals: { files: plan.length, bytes: totalBytes },
  repos: repoSummaries,
  files: filesIndex
};

// No bulk rm here: the sandbox bulk-delete guard blocks recursive removals
// (2026-10-10 precedent), so collection overwrites in place. Stale files from
// an older pointer face stay behind but never enter seed-manifest.json, and
// applySeed copies strictly by manifest — they are dead weight only. A fully
// clean rebuild is a manual `Remove-Item -Recurse seed` in the user terminal.
for (const item of plan) {
  const dest = join(outRoot, item.rel);
  mkdirSync(dirname(dest), { recursive: true });
  // Frozen releases carry the Windows read-only attribute, and CopyFile
  // propagates it to the seed copy — strip it before overwriting and after
  // writing so a recollection never dies on EPERM (2026-10-14 incident).
  if (existsSync(dest)) chmodSync(dest, 0o666);
  copyFileSync(item.src, dest);
  chmodSync(dest, 0o666);
}
writeFileSync(join(outRoot, 'seed-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const byRepo = {};
for (const item of plan) {
  const repo = item.rel.split(sep)[0].split('/')[0];
  byRepo[repo] = (byRepo[repo] || 0) + 1;
}
console.log(`seed written: ${outRoot}`);
console.log(`files: ${plan.length}  bytes: ${totalBytes}  (${(totalBytes / 1024 / 1024).toFixed(1)} MiB)`);
console.log(`per repo: ${JSON.stringify(byRepo)}  repos summary: ${JSON.stringify(repoSummaries)}`);
