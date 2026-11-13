// Manual release-gate reader: collects the two independent gate readouts plus the
// four BP-6 commit readings into one reviewable draft. Deliberately does NOT run
// conform, commit, or push (see docs/发布门禁.md:14-32 and AD-3).
//
// usage: node scripts/release-gate.mjs [--out <draft.json>] [--evidence <conform.json>]
//        [--with-sbom] [--with-audit]   (P7 manual optional supply-chain steps; no hooks)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeWaiting } from './release-gate-waiting.mjs';
import { sourceSnapshot } from './conform-proof.mjs';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(managerRoot, '..');
const managerVersion = JSON.parse(fs.readFileSync(path.join(managerRoot, 'package.json'), 'utf8')).version;
const outFlag = process.argv.indexOf('--out');
const outFile = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : null;
const evidenceFlag = process.argv.indexOf('--evidence');
const evidenceFile = evidenceFlag >= 0 ? path.resolve(process.argv[evidenceFlag + 1]) : null;
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
};
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();

const manager = readJson(evidenceFile || path.join(os.tmpdir(), 'architecture-manager-conform', 'conform.json'));
const site = readJson(path.join(root, 'docs-site/data/conform-report.json'));
const lock = readJson(path.join(root, 'docs-site/data/source-lock.json'));
const generated = readJson(path.join(root, 'docs-site/data/generated-report.json'));

const stepNames = manager?.results?.map(row => row.name) || [];
const tests = manager?.results?.find(row => row.name === 'tests') || null;
// P6b (approved P-table 20261111): staleEvidence must also detect source-byte changes,
// not only the absence of the governance-drift step (ledger 2026-11-05 §4 limitation).
let sourcesDrifted = null;
try {
  const currentSources = sourceSnapshot(managerRoot);
  sourcesDrifted = Array.isArray(manager?.sources) ? JSON.stringify(manager.sources) !== JSON.stringify(currentSources) : null;
} catch { sourcesDrifted = null; }
const missingGovernanceStep = !stepNames.includes('governance-drift');
const staleManagerEvidence = missingGovernanceStep || sourcesDrifted === true;
const staleNote = missingGovernanceStep
  ? '证据早于 governance-drift 步骤；须用户终端（Node 24）重跑 npm run conform'
  : sourcesDrifted === true
    ? '证据源快照与当前源码不一致（sourceSnapshot 漂移）；须用户终端重跑 npm run conform 回填新 digest'
    : sourcesDrifted === null
      ? '证据含 governance-drift 步骤；源快照比对不可用（缺失或 CONFORM_SOURCE_LINK）'
      : '证据含 governance-drift 步骤且源快照与当前源码一致';

const head = git(['rev-parse', 'HEAD']);
const uncommitted = git(['status', '--porcelain']).split(/\r?\n/).filter(Boolean).length;
const ahead = Number(git(['rev-list', '--count', 'origin/main..HEAD']));
const remoteConsistent = ahead === 0;

// P7a (approved P-table 20261111): manual optional supply-chain steps.
// SBOM is offline-capable (npm built-in, CycloneDX); audit needs registry network and
// is honestly marked skipped-offline when unreachable. high/critical block the gate.
const evidenceDir = outFile ? path.dirname(outFile) : path.join(os.tmpdir(), 'architecture-manager-conform');
let supplyChain = null;
if (process.argv.includes('--with-sbom') || process.argv.includes('--with-audit')) {
  supplyChain = { sbom: null, audit: null };
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (process.argv.includes('--with-sbom')) {
    const run = spawnSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--json'], { cwd: managerRoot, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
    try {
      const bom = JSON.parse(run.stdout);
      const file = path.join(evidenceDir, 'sbom.cdx.json');
      fs.writeFileSync(file, JSON.stringify(bom, null, 2) + '\n');
      supplyChain.sbom = { file, bomFormat: bom.bomFormat, specVersion: bom.specVersion, components: (bom.components || []).length };
    } catch {
      supplyChain.sbom = { error: 'SBOM_PARSE_FAILED', detail: String(run.stderr || '').slice(0, 300) };
    }
  }
  if (process.argv.includes('--with-audit')) {
    const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: managerRoot, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    try {
      const report = JSON.parse(run.stdout);
      const counts = report.metadata?.vulnerabilities || {};
      const file = path.join(evidenceDir, 'audit.json');
      fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
      supplyChain.audit = {
        file,
        counts,
        names: Object.keys(report.vulnerabilities || {}),
        blocking: (counts.high || 0) + (counts.critical || 0) > 0,
        offline: false
      };
    } catch {
      supplyChain.audit = { offline: true, skipped: 'skipped-offline', detail: String(run.stderr || '').slice(0, 300) };
    }
  }
}
const supplyChainBlocking = !!supplyChain?.audit?.blocking || !!supplyChain?.sbom?.error;

const draft = {
  schema: 'architecture-manager-release-gate/v1',
  generatedAt: new Date().toISOString(),
  version: managerVersion,
  manager: {
    ok: manager?.ok ?? null,
    digest: manager?.digest ?? null,
    node: manager?.node ?? null,
    sourceStable: manager?.sourceStable ?? null,
    recordedAt: manager?.recordedAt ?? null,
    steps: stepNames,
    tests: tests ? { tests: tests.tests, pass: tests.pass, fail: tests.fail, skipped: tests.skipped, valid: tests.valid } : null,
    staleEvidence: staleManagerEvidence,
    sourcesDrifted,
    note: staleNote
  },
  docsSite: site ? {
    profile: site.profile,
    counts: site.counts,
    digest: site.digest,
    sourceLockDigest: site.sourceLockDigest,
    generatedDigest: site.generatedDigest,
    sourceLockMatches: site.sourceLockDigest === lock?.digest,
    generatedMatches: site.generatedDigest === generated?.digest
  } : null,
  fourReadings: {
    headSha: head,
    cleanStatus: uncommitted === 0,
    uncommitted,
    remoteConsistent,
    ahead,
    committedBeforeChanges: true,
    note: remoteConsistent ? '远端一致' : `远端落后 ${ahead} 提交（P6c 外部依赖）`
  },
  waiting: computeWaiting({
    version: managerVersion,
    staleManagerEvidence,
    remoteConsistent,
    docsSiteOk: !!site && site.counts.fail === 0,
    pendingTerminalRelease: !(
      fs.existsSync(path.join(managerRoot, 'release', `Architecture-Manager-${managerVersion}-setup-x64.exe`)) &&
      fs.existsSync(path.join(managerRoot, 'release', `Architecture-Manager-${managerVersion}-portable-x64.exe`))
    )
  }),
  supplyChain,
  ok: !!manager?.ok && !staleManagerEvidence && !supplyChainBlocking && !!site && site.counts.fail === 0 && site.sourceLockDigest === lock?.digest && site.generatedDigest === generated?.digest
};

const text = JSON.stringify(draft, null, 2) + '\n';
process.stdout.write(text);
if (outFile) fs.writeFileSync(outFile, text, 'utf8');
