// One-command verification digest (3.5.0 P12). Runs the test battery plus
// read-only readbacks against the real workspace and prints a sha256 digest
// over the machine-checkable results. Re-running must reproduce the digest
// for unchanged inputs.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRunLedger } from '../src/runs.mjs';
import { readDefectBook, verifyDefectBook } from '../src/defects.mjs';
import { inspectInbox } from '../src/inbox.mjs';
import { inspectGit } from '../src/git.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = process.argv[2] || 'E:/ai';
const results = { schema: 'architecture-manager-verify/v1', generatedAt: new Date().toISOString(), workspaceRoot };

const testRun = spawnSync(process.execPath, ['--test'], { cwd: repoRoot, encoding: 'utf8', timeout: 300000, shell: false });
results.tests = { exitCode: testRun.status, pass: /ℹ pass (\d+)/.exec(testRun.stdout)?.[1] ?? null, fail: /ℹ fail (\d+)/.exec(testRun.stdout)?.[1] ?? null };

const ledger = listRunLedger(workspaceRoot);
results.runs = { totalRuns: ledger.totalRuns, totals: ledger.totals, unknownSchema: ledger.platforms.flatMap((p) => p.runs).filter((r) => r.lockStatus === 'unknown-schema').length };
const book = readDefectBook(workspaceRoot);
const checker = verifyDefectBook(workspaceRoot);
results.defectBook = { total: book.total ?? null, redRows: book.redRows?.length ?? null, checkerPassed: checker.passed === true };
const inbox = inspectInbox(workspaceRoot);
results.inbox = Object.fromEntries(inbox.zones.map((zone) => [zone.zone, zone.entryCount]));
const git = inspectGit(workspaceRoot);
results.git = { isRepository: git.isRepository, branch: git.branch, head: git.head ? git.head.slice(0, 12) : null, changed: git.status.length };

const digestInput = JSON.stringify({ tests: results.tests, runs: results.runs, defectBook: results.defectBook, inbox: results.inbox });
results.digest = createHash('sha256').update(digestInput).digest('hex');

const outDir = mkdtempSync(join(tmpdir(), 'am-verify-'));
const reportPath = join(outDir, 'verify-report.json');
writeFileSync(reportPath, JSON.stringify(results, null, 1));
console.log(JSON.stringify({ digest: results.digest, tests: results.tests, runs: results.runs.totalRuns, redRows: results.defectBook.redRows, reportPath }, null, 1));
if (results.tests.fail !== '0' || results.defectBook.checkerPassed !== true) process.exit(1);
