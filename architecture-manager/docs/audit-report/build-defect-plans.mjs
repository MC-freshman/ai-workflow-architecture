// P8 defect-book registration driver (audit QA Yan).
// Uses the app's own governance flow ONLY:
//   build:  src/defects.mjs buildDefectBookEditPlan (SHA baseline, plan payload)
//   apply:  src/transactions.mjs applyPlan (requirePlan + checkpoint + atomicWrite + audit chain)
// This script never writes the book JSON directly.
// Usage:
//   node build-defect-plans.mjs rows.json plan          # build plan #1 against current book (read-only evidence)
//   node build-defect-plans.mjs rows.json chain         # sequential build->applyPlan for every row (after user confirmation)
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildDefectBookEditPlan } from '../../src/domains/audit/defects.mjs';
import { applyPlan } from '../../src/transactions/router.mjs';

const [, , rowsPath, mode] = process.argv;
const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
const bookPath = 'E:/ai/versions/缺陷状态簿.json';
const baseline = () => {
  const bytes = fs.readFileSync(bookPath);
  return { text: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex') };
};

if (mode === 'plan') {
  const { sha256 } = baseline();
  const plan = buildDefectBookEditPlan({ workspaceRoot: 'E:/ai', operation: 'append', row: rows[0], baselineSha256: sha256 });
  console.log(JSON.stringify({ baselineSha256: sha256, plan }, null, 2));
} else if (mode === 'chain') {
  const applied = [];
  for (const row of rows) {
    const { sha256 } = baseline();
    const plan = buildDefectBookEditPlan({ workspaceRoot: 'E:/ai', operation: 'append', row, baselineSha256: sha256 });
    const result = applyPlan({ plan });
    applied.push({ id: row.id, planId: plan.planId, status: result.status, transactionId: result.transactionId, checkpointPath: result.checkpointPath, checkpointSha256: result.checkpointSha256, newSha256: result.newSha256 });
    console.error(JSON.stringify(applied.at(-1)));
  }
  const { sha256 } = baseline();
  console.log(JSON.stringify({ appliedCount: applied.length, applied, finalBookSha256: sha256 }, null, 2));
} else {
  console.error('unknown mode');
  process.exit(1);
}
