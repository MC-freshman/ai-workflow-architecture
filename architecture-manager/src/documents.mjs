import { existsSync, readFileSync, statSync } from 'node:fs';
import { sha256 } from './core/hash.mjs';
import { join, normalize, relative, resolve, sep } from 'node:path';

export const TOP_LEVEL_REQUIREMENTS = new Set(['versions/架构基本原则.md', 'AGENTS.md', 'AI_ARCHITECTURE_SYSTEM_PROMPT.md', 'agentic-workflow-master-manual.md', 'HANDOFF.md', 'invocation-adapters-spec.md']);
export const EXTRA_DOCUMENTS = [...TOP_LEVEL_REQUIREMENTS].filter((path) => !path.includes('/')).concat(['architecture-manager/README.md']);
export const UPDATE_LOG_PATH = 'versions/更新日志.md';

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new Error('INVALID_DOCUMENT_PATH');
  const normalized = normalize(relativePath).split(sep).join('/');
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('DOCUMENT_PATH_OUTSIDE_WORKSPACE');
  }
  if (!(normalized.startsWith('versions/') || normalized.startsWith('docs-site/docs/') || EXTRA_DOCUMENTS.includes(normalized)) || !normalized.endsWith('.md')) {
    throw new Error('DOCUMENT_PATH_NOT_ALLOWED');
  }
  return normalized;
}

export function documentKind(path) {
  if (path === UPDATE_LOG_PATH) return 'update-log';
  if (TOP_LEVEL_REQUIREMENTS.has(path)) return 'top-level-requirements';
  if (path.includes('实施表')) return 'implementation-table';
  if (path.includes('方案')) return 'proposal';
  if (path.includes('台账') || path.includes('LEDGER')) return 'ledger';
  return 'architecture-document';
}

export function readDocument(workspaceRoot, relativePath) {
  const safePath = normalizeRelativePath(relativePath);
  const absolutePath = resolve(workspaceRoot, safePath);
  const rootRelative = relative(resolve(workspaceRoot), absolutePath);
  if (rootRelative.startsWith(`..${sep}`) || rootRelative === '..' || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error('DOCUMENT_NOT_FOUND');
  }
  const content = readFileSync(absolutePath, 'utf8');
  return {
    schema: 'architecture-manager-document/v1',
    path: safePath,
    kind: documentKind(safePath),
    sensitive: TOP_LEVEL_REQUIREMENTS.has(safePath),
    sha256: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    content,
    writePerformed: false
  };
}

export function buildDocumentPlan({ workspaceRoot, relativePath, beforeText, afterText, baselineSha256, highSensitivityConfirmed = false, now = new Date().toISOString() }) {
  const safePath = normalizeRelativePath(relativePath);
  if (typeof beforeText !== 'string' || typeof afterText !== 'string') throw new Error('INVALID_DOCUMENT_CONTENT');
  const actualBeforeHash = sha256(beforeText);
  if (typeof baselineSha256 !== 'string' || baselineSha256 !== actualBeforeHash) throw new Error('DOCUMENT_BASELINE_MISMATCH');
  if (TOP_LEVEL_REQUIREMENTS.has(safePath) && highSensitivityConfirmed !== true) throw new Error('TOP_LEVEL_CONFIRMATION_REQUIRED');
  if (beforeText === afterText) throw new Error('NO_DOCUMENT_CHANGE');
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `document-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'document-edit',
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { path: safePath, documentKind: documentKind(safePath), highSensitivity: TOP_LEVEL_REQUIREMENTS.has(safePath) },
    steps: [{
      operation: 'replace-document-content',
      target: safePath,
      oldSha256: actualBeforeHash,
      newSha256: sha256(afterText),
      oldBytes: Buffer.byteLength(beforeText, 'utf8'),
      newBytes: Buffer.byteLength(afterText, 'utf8'),
      checkpoint: true
    }],
    verification: ['re-read the file before apply and require the baseline hash', 'run document build/format checks after apply', 'preserve the old content for rollback']
  };
}
