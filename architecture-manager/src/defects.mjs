import {parseJson as parseJsonText} from './core/json.mjs';
// Read-only defect-book domain (3.5.0 P1②).
// Reads versions/缺陷状态簿.json and runs the book's own stdlib checker
// (versions/缺陷状态簿.check.py) as an external subprocess. Neither writes.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from './core/hash.mjs';
import { targetPath } from './core/paths.mjs';

const RED_STATUSES = new Set(['open', 'unverified-registration']);
const STATUS_ORDER = ['open', 'closed', 'absorbed', 'ruled', 'unverified-registration'];

export function readDefectBook(workspaceRoot) {
  const bookPath = join(workspaceRoot, 'versions', '缺陷状态簿.json');
  if (!existsSync(bookPath)) return { bookPath, present: false };
  let raw;
  let book;
  try {
    raw = readFileSync(bookPath, 'utf8');
    book = parseJsonText(raw);
  } catch (error) {
    return { bookPath, present: true, corrupt: true, error: String(error) };
  }
  const defects = Array.isArray(book.defects) ? book.defects : [];
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  const redRows = [];
  for (const defect of defects) {
    if (defect && typeof defect.status === 'string' && defect.status in counts) counts[defect.status] += 1;
    if (defect && RED_STATUSES.has(defect.status)) {
      redRows.push({ id: defect.id ?? null, status: defect.status, title: defect.title ?? null });
    }
  }
  return {
    bookPath,
    present: true,
    corrupt: false,
    sha256: sha256(raw),
    generatedAt: typeof book.generatedAt === 'string' ? book.generatedAt : null,
    total: defects.length,
    counts,
    redRows,
    rows: defects.map((defect) => ({
      id: defect?.id ?? null,
      status: typeof defect?.status === 'string' ? defect.status : null,
      title: defect?.title ?? null,
      location: defect?.location ?? null,
      source: defect?.source ?? null
    }))
  };
}

export function buildDefectBookEditPlan({ workspaceRoot, operation, rowId = null, newStatus = null, row = null, note = null, baselineSha256, now = new Date().toISOString() }) {
  const BOOK_RELATIVE_PATH = 'versions/缺陷状态簿.json';
  if (operation !== 'set-status' && operation !== 'append') throw new Error('DEFECT_BOOK_OPERATION_INVALID');
  const root = resolve(workspaceRoot);
  const target = targetPath(root, BOOK_RELATIVE_PATH);
  if (!existsSync(target)) throw new Error('DEFECT_BOOK_NOT_FOUND');
  const before = readFileSync(target, 'utf8');
  const actualSha = sha256(before);
  if (typeof baselineSha256 !== 'string' || baselineSha256 !== actualSha) throw new Error('DEFECT_BOOK_BASELINE_MISMATCH');
  let book;
  try {
    book = parseJsonText(before);
  } catch {
    throw new Error('DEFECT_BOOK_CORRUPT');
  }
  if (!book || typeof book !== 'object' || !Array.isArray(book.defects)) throw new Error('DEFECT_BOOK_CORRUPT');
  let nextDefects;
  let description;
  if (operation === 'set-status') {
    if (!STATUS_ORDER.includes(newStatus)) throw new Error('DEFECT_BOOK_STATUS_INVALID');
    const index = book.defects.findIndex((defect) => defect && defect.id === rowId);
    if (index < 0) throw new Error('DEFECT_BOOK_ROW_NOT_FOUND');
    if (book.defects[index].status === newStatus) throw new Error('DEFECT_BOOK_NO_CHANGE');
    nextDefects = book.defects.map((defect, position) => (position === index ? { ...defect, status: newStatus } : defect));
    description = `缺陷 ${rowId} 状态 ${book.defects[index].status} → ${newStatus}`;
  } else {
    const candidate = row && typeof row === 'object' ? row : {};
    for (const field of ['id', 'title', 'status', 'location', 'source']) {
      if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') throw new Error(`DEFECT_BOOK_FIELD_REQUIRED:${field}`);
    }
    if (!STATUS_ORDER.includes(candidate.status)) throw new Error('DEFECT_BOOK_STATUS_INVALID');
    if (book.defects.some((defect) => defect && defect.id === candidate.id)) throw new Error('DEFECT_BOOK_ROW_EXISTS');
    nextDefects = [...book.defects, { ...candidate }];
    description = `登记缺陷 ${candidate.id}`;
  }
  const after = `${JSON.stringify({ ...book, defects: nextDefects }, null, 1)}\n`;
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `defect-book-${operation}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'defect-book-edit',
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { path: BOOK_RELATIVE_PATH, operation, rowId, newStatus, note: typeof note === 'string' ? note : null, description, row: operation === 'append' ? { ...row } : null },
    steps: [{ operation: 'replace-defect-book-json', target: BOOK_RELATIVE_PATH, oldSha256: actualSha, newSha256: sha256(after), checkpoint: true }],
    verification: ['re-read defect book baseline before apply', 'preserve checkpoint for rollback', 're-run 缺陷状态簿.check.py after apply'],
    payload: { afterText: after }
  };
}

export function verifyDefectBook(workspaceRoot, pythonExecutable = 'python') {
  const checkerPath = join(workspaceRoot, 'versions', '缺陷状态簿.check.py');
  if (!existsSync(checkerPath)) return { checkerPath, present: false };
  try {
    const output = execFileSync(pythonExecutable, ['-B', checkerPath], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { checkerPath, present: true, passed: true, exitCode: 0, output: output.slice(-2000) };
  } catch (error) {
    const code = typeof error.status === 'number' ? error.status : null;
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n').slice(-2000);
    return { checkerPath, present: true, passed: false, exitCode: code, output };
  }
}
