import { existsSync, lstatSync, realpathSync } from './physical-fs.mjs';
import { homedir, tmpdir } from 'node:os';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { sha256 } from './hash.mjs';

export function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('INVALID_TRANSACTION_TARGET');
  const normalized = normalize(value).split(sep).join('/');
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return normalized;
}

export function targetPath(workspaceRoot, relativePath) {
  const root = realpathSync(workspaceRoot);
  const lexical = resolve(root, safeRelative(relativePath));
  // Check existing ancestors even when the leaf does not exist yet: a junction
  // below the workspace must not turn a planned new file into an external write.
  let ancestor = lexical;
  while (ancestor !== root) {
    try {
      const metadata = lstatSync(ancestor);
      if (metadata.isSymbolicLink() || (metadata.mode & 0o170000) === 0o120000) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
      const resolvedAncestor = realpathSync(ancestor);
      const ancestorRel = relative(root, resolvedAncestor);
      if (ancestorRel === '..' || ancestorRel.startsWith(`..${sep}`) || /^[A-Za-z]:/i.test(ancestorRel)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    const parent = resolve(ancestor, '..');
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const target = existsSync(lexical) ? realpathSync(lexical) : lexical;
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || /^[A-Za-z]:/i.test(rel)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return target;
}

export function defaultAuditRoot() {
  return join(process.env.LOCALAPPDATA || tmpdir(), 'ArchitectureManager', 'audit');
}

export function localViewPath(workspaceRoot) {
  const key = sha256(realpathSync(workspaceRoot)).slice(0, 24);
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(base, 'ArchitectureManager', 'views', `${key}.json`);
}

