// Installer seed integration (owner requirements ①/②, rulings 2026-10-13/14):
// a packaged install carries the three repositories' current-pointer releases
// plus the tool skills body under <resources>/seed. Empty workspaces get the
// seed laid down with a sha256-verified record; a non-empty workspace is
// authoritative — the seed is assessed read-only and never overwrites
// (owner ruling 2026-10-13). Seed absence changes nothing: the onboarding
// pipeline keeps its original fail-closed behavior (BP-3 minimality).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../core/hash.mjs';
import { parseJson } from '../../core/json.mjs';
import { targetPath } from '../../core/paths.mjs';

const SEED_MANIFEST = 'seed-manifest.json';
const REPOS = ['tool', 'agent', 'software'];

// Packaged installs keep the seed next to the Electron resources; development
// runs fall back to the repository-level seed/ directory. `devRoot` exists for
// tests only.
export function locateSeed({ resourcesPath, devRoot } = {}) {
  const candidates = [];
  const resources = resourcesPath ?? process.resourcesPath;
  if (resources) candidates.push(join(resources, 'seed'));
  candidates.push(devRoot ? join(devRoot, 'seed') : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed'));
  return candidates.find((candidate) => existsSync(join(candidate, SEED_MANIFEST))) || null;
}

function workspaceEmpty(workspaceRoot) {
  return REPOS.every((repo) => !existsSync(join(workspaceRoot, repo, 'registry.json')));
}

export function assessSeed({ workspaceRoot, seedRoot }) {
  const base = { seedRoot: seedRoot || null, workspaceEmpty: workspaceEmpty(workspaceRoot) };
  if (!seedRoot || !existsSync(join(seedRoot, SEED_MANIFEST))) {
    return { ...base, status: 'seed-absent' };
  }
  const manifestPath = join(seedRoot, SEED_MANIFEST);
  const manifest = parseJson(readFileSync(manifestPath, 'utf8'));
  const manifestSha256 = sha256(readFileSync(manifestPath));
  if (!base.workspaceEmpty) {
    // Non-empty workspace is authoritative (owner ruling): read-only check of
    // the three registries against the seed baseline; no byte is written and
    // no full-tree audit runs — the workspace may legitimately be newer.
    return {
      ...base,
      status: 'workspace-authoritative',
      manifestSha256,
      totals: manifest.totals,
      registryMissing: REPOS.filter((repo) => !existsSync(join(workspaceRoot, repo, 'registry.json'))),
      registryDrifted: REPOS.filter((repo) => {
        const rel = `${repo}/registry.json`;
        const record = manifest.files[rel];
        const abs = join(workspaceRoot, rel);
        return existsSync(abs) && record && sha256(readFileSync(abs)) !== record.sha256;
      })
    };
  }
  return { ...base, status: 'empty-workspace', manifestSha256, totals: manifest.totals, files: manifest.totals.files, bytes: manifest.totals.bytes };
}

export function applySeed({ workspaceRoot, seedRoot }) {
  const assessment = assessSeed({ workspaceRoot, seedRoot });
  if (assessment.status !== 'empty-workspace') return { assessment, applied: false };
  const manifest = parseJson(readFileSync(join(seedRoot, SEED_MANIFEST), 'utf8'));
  let verified = 0;
  for (const [rel, record] of Object.entries(manifest.files)) {
    const dest = targetPath(workspaceRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(seedRoot, rel), dest);
    if (sha256(readFileSync(dest)) !== record.sha256) throw new Error(`SEED_INTEGRITY_MISMATCH:${rel}`);
    verified += 1;
  }
  const seededAt = new Date().toISOString();
  const record = {
    schema: 'manager-seed-apply/v1',
    seededAt,
    seedRoot,
    manifestSha256: assessment.manifestSha256,
    filesApplied: verified,
    bytesApplied: manifest.totals.bytes,
    workspaceRoot,
    verified: true
  };
  const recordDir = targetPath(workspaceRoot, 'inbox/manager-seed');
  mkdirSync(recordDir, { recursive: true });
  const recordPath = join(recordDir, `apply-${seededAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { assessment: { ...assessment, status: 'seeded' }, applied: true, record: { ...record, recordPath } };
}
