// N1 (approved U-table 20261113): read-only governance cockpit aggregation.
// Reads RECORDED evidence only (never runs drift/audit scripts live); every block carries
// its recordedAt and missing evidence degrades to null — never fabricated green.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDefectBook } from './defects.mjs';
import { computeBinding } from '../../../scripts/check-mcp-binding.mjs';
import { sourceSnapshot } from '../../../scripts/conform-proof.mjs';

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

export function readGateCockpit(options = {}) {
  const workspaceRoot = options.workspaceRoot ?? path.resolve(managerRoot, '..');
  const evidenceDir = options.evidenceDir ?? path.join(os.tmpdir(), 'architecture-manager-conform');
  const conform = readJson(path.join(evidenceDir, 'conform.json'));
  let sourcesDrifted = null;
  if (conform && Array.isArray(conform.sources)) {
    try { sourcesDrifted = JSON.stringify(conform.sources) !== JSON.stringify(sourceSnapshot(managerRoot)); }
    catch { sourcesDrifted = null; }
  }
  const sbom = readJson(path.join(evidenceDir, 'sbom.cdx.json'));
  const audit = readJson(path.join(evidenceDir, 'audit.json'));
  const binding = computeBinding();
  const defects = readDefectBook(workspaceRoot);
  const registry = readJson(path.join(managerRoot, 'src/app/module-registry.json'));
  const overrides = readJson(path.join(managerRoot, 'src/app/module-overrides.json'));
  return {
    schema: 'manager-gate-cockpit/v1',
    generatedAt: new Date().toISOString(),
    evidenceDir,
    conform: conform ? {
      ok: conform.ok ?? null,
      digest: conform.digest ?? null,
      recordedAt: conform.recordedAt ?? null,
      sourceStable: conform.sourceStable ?? null,
      steps: (conform.results || []).map((row) => ({ name: row.name, ok: row.ok })),
      tests: (() => { const t = (conform.results || []).find((row) => row.name === 'tests'); return t ? { tests: t.tests, pass: t.pass, fail: t.fail, skipped: t.skipped } : null; })(),
      sourcesDrifted
    } : null,
    mcpBinding: {
      manager: { count: binding.manager.count, sha256: binding.manager.sha256 },
      novel: binding.novel ? { count: binding.novel.count, sha256: binding.novel.sha256 } : null,
      novelSkipped: binding.novel === null
    },
    supplyChain: {
      sbom: sbom ? { bomFormat: sbom.bomFormat, specVersion: sbom.specVersion, components: (sbom.components || []).length } : null,
      audit: audit ? { counts: audit.metadata?.vulnerabilities ?? null, names: Object.keys(audit.vulnerabilities || {}) } : null
    },
    defects: defects.present && !defects.corrupt
      ? { total: defects.total, counts: defects.counts, redRows: defects.redRows }
      : { present: !!defects.present, corrupt: !!defects.corrupt, redRows: [] },
    registry: registry ? { summary: registry.summary, overrides: overrides?.overrides ?? {} } : null,
    notes: [
      '证据非实时：conform/供应链读最近一次落盘证据，drift 与审计脚本仍为手动判据。',
      '缺失证据降级为 null，不假绿；sourcesDrifted=true 表示证据源快照与当前源码不一致。'
    ]
  };
}