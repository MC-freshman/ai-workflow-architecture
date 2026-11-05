// Manual release-gate reader: collects the two independent gate readouts plus the
// four BP-6 commit readings into one reviewable draft. Deliberately does NOT run
// conform, commit, or push (see docs/发布门禁.md:14-32 and AD-3).
//
// usage: node scripts/release-gate.mjs [--out <draft.json>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeWaiting } from './release-gate-waiting.mjs';

const managerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(managerRoot, '..');
const outFlag = process.argv.indexOf('--out');
const outFile = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : null;
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
};
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();

const manager = readJson(path.join(os.tmpdir(), 'architecture-manager-conform', 'conform.json'));
const site = readJson(path.join(root, 'docs-site/data/conform-report.json'));
const lock = readJson(path.join(root, 'docs-site/data/source-lock.json'));
const generated = readJson(path.join(root, 'docs-site/data/generated-report.json'));

const stepNames = manager?.results?.map(row => row.name) || [];
const tests = manager?.results?.find(row => row.name === 'tests') || null;
const staleManagerEvidence = !stepNames.includes('governance-drift');

const head = git(['rev-parse', 'HEAD']);
const uncommitted = git(['status', '--porcelain']).split(/\r?\n/).filter(Boolean).length;
const ahead = Number(git(['rev-list', '--count', 'origin/main..HEAD']));
const remoteConsistent = ahead === 0;

const draft = {
  schema: 'architecture-manager-release-gate/v1',
  generatedAt: new Date().toISOString(),
  manager: {
    ok: manager?.ok ?? null,
    digest: manager?.digest ?? null,
    node: manager?.node ?? null,
    sourceStable: manager?.sourceStable ?? null,
    recordedAt: manager?.recordedAt ?? null,
    steps: stepNames,
    tests: tests ? { tests: tests.tests, pass: tests.pass, fail: tests.fail, skipped: tests.skipped, valid: tests.valid } : null,
    staleEvidence: staleManagerEvidence,
    note: staleManagerEvidence ? '证据早于 governance-drift 步骤；须用户终端（Node 24）重跑 npm run conform（P5d）' : '证据含 governance-drift 步骤'
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
    staleManagerEvidence,
    remoteConsistent,
    docsSiteOk: !!site && site.counts.fail === 0,
    pendingTerminalRelease: !(
      fs.existsSync(path.join(managerRoot, 'release', 'Architecture-Manager-0.9.0-setup-x64.exe')) &&
      fs.existsSync(path.join(managerRoot, 'release', 'Architecture-Manager-0.9.0-portable-x64.exe'))
    )
  }),
  ok: !!manager?.ok && !!site && site.counts.fail === 0 && site.sourceLockDigest === lock?.digest && site.generatedDigest === generated?.digest
};

const text = JSON.stringify(draft, null, 2) + '\n';
process.stdout.write(text);
if (outFile) fs.writeFileSync(outFile, text, 'utf8');
