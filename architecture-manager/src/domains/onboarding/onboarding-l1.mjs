// L1 = the "usable" machine criterion (owner rulings 2026-10-13/14): one
// invocable workflow plus one agent really driven prepare→next→stop through
// the platform runner, replacing the unreachable vendor native read receipt
// as the connection criterion. Cells are picked deterministically
// (lexicographically first enabled invocable entry per registry) so a rebuilt
// plan reproduces the same selection. The step is deliberately cheaper than
// the full first matrix and stays on the journal even when certification is
// deferred — a configured-pending workspace still carries a usable receipt.
// The pair is judged in the invocation certification scope, which is what the
// criterion describes: no software cell belongs in a workflow-plus-agent receipt
// (D-156).
import { existsSync, readFileSync } from 'node:fs';
import { sha256 } from '../../core/hash.mjs';
import { targetPath } from '../../core/paths.mjs';
import { parseJson } from '../../core/json.mjs';
import { runPlatformCheck } from '../platforms/platform-check.mjs';

export function selectL1Cells({ workspaceRoot }) {
  const pick = (repo, section, kind) => {
    const registry = parseJson(readFileSync(targetPath(workspaceRoot, `${repo}/registry.json`), 'utf8'));
    // tool entries carry invocable:true/false; agent entries are invocable by
    // shape (no invocable key) — enabled!==false is the only filter there.
    const entries = (registry[section] || [])
      .filter((row) => row.enabled !== false && (repo === 'tool' ? row.invocable !== false : true))
      .map((row) => row.id)
      .sort();
    if (!entries.length) throw new Error(`L1_CELL_UNAVAILABLE:${kind}`);
    return entries[0];
  };
  return { workflow: pick('tool', 'workflows', 'workflow'), agent: pick('agent', 'agents', 'agent') };
}

export async function runL1DualCell({ workspaceRoot, platformId, registerCancel = () => {}, onProgress = () => {}, check = runPlatformCheck }) {
  const cells = selectL1Cells({ workspaceRoot });
  const only = `workflow:${cells.workflow},agent:${cells.agent}`;
  onProgress({ platformId, phase: 'l1-dual-cell', cells, reused: false });
  // scope:'invocation' is the criterion itself, said out loud once: the check defaults to
  // 'full', which puts a drifted software cell into this same matrix and used to make the
  // row test below refuse every gateway-bound platform (D-156 — qoder 2026-10-14 measured
  // 2 + 6 rows that had all passed).
  const result = await check({ workspaceRoot, platformId, mode: 'quick', only, scope: 'invocation', stopOnFloorFailure: false, onProgress, registerCancel });
  const matrixPath = result.matrixActualPath || result.matrixPath;
  if (!matrixPath || !existsSync(matrixPath)) throw new Error('L1_EVIDENCE_MISSING');
  const matrix = parseJson(readFileSync(matrixPath, 'utf8'));
  const rows = matrix.rows || [];
  // The incremental selection may attach other drifted cells to the same run, so the
  // receipt tests the two cells it selected instead of the report's size; anything else
  // is recorded, not charged against the pair. A failed row anywhere still refuses the
  // receipt — a usable platform is never read off a matrix that lost a cell.
  const selected = (row, kind, id) => row.kind === kind && row.id === id;
  const dual = rows.filter((row) => selected(row, 'workflow', cells.workflow) || selected(row, 'agent', cells.agent));
  const extra = rows.filter((row) => !dual.includes(row));
  const usable = dual.length === 2 && dual.every((row) => row.status === 'PASS' && row.claimed === true && row.stopped === true) && !rows.some((row) => row.status === 'FAIL');
  if (!usable) throw new Error(`L1_DUAL_CELL_NOT_PASSED:${JSON.stringify(rows.map((row) => ({ kind: row.kind, id: row.id, status: row.status })))}`);
  return {
    schema: 'architecture-manager-l1-check/v1',
    status: 'passed',
    platformId,
    cells: dual.map((row) => ({ kind: row.kind, id: row.id, version: row.version, status: row.status })),
    counts: { rows: rows.length, pass: rows.filter((row) => row.status === 'PASS').length, fail: rows.filter((row) => row.status === 'FAIL').length },
    extraRows: extra.map((row) => ({ kind: row.kind, id: row.id, status: row.status })),
    matrixPath,
    matrixSha256: sha256(readFileSync(matrixPath)),
    evidencePath: result.evidencePath || null,
    checkedAt: new Date().toISOString(),
    writePerformed: true
  };
}
