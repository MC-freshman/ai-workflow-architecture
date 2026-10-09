import {runScopedProcess as execFileSync} from './infrastructure/process-scope.mjs';
// docs-site operations (3.5.0 P6). Building and the link/conform check are
// command-type operations that write the site's derived inputs and build output; they invoke
// the site's own scripts directly with node, never npm shell indirection.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function docsSiteRoot(workspaceRoot) {
  const docsSite = resolve(workspaceRoot, 'docs-site');
  if (!existsSync(join(docsSite, 'package.json'))) throw new Error('DOCS_SITE_MISSING');
  return docsSite;
}

function runNode(docsSite, args, timeoutMs) {
  try {
    const output = execFileSync(process.execPath, args, { cwd: docsSite, env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: output.slice(-4000) };
  } catch (error) {
    return { ok: false, output: [error.stdout, error.stderr].filter(Boolean).join('\n').slice(-4000) };
  }
}

export function buildDocsSite(workspaceRoot) {
  const docsSite = docsSiteRoot(workspaceRoot);
  if (!existsSync(join(docsSite, 'scripts', 'build.mjs'))) throw new Error('DOCS_BUILD_SCRIPT_MISSING');
  return { schema: 'architecture-manager-docs-build/v1', site: docsSite, ...runNode(docsSite, ['scripts/build.mjs', '--profile', 'internal'], 600000), writeScope: 'docs-site/docs + generated + build + data/*.json + static/img/synced + .docusaurus (derived output; source governance documents are read-only)' };
}

export function checkDocsLinks(workspaceRoot) {
  const docsSite = docsSiteRoot(workspaceRoot);
  if (!existsSync(join(docsSite, 'scripts', 'docs-conform.mjs'))) throw new Error('DOCS_CONFORM_SCRIPT_MISSING');
  return { schema: 'architecture-manager-docs-conform/v1', site: docsSite, ...runNode(docsSite, ['scripts/docs-conform.mjs'], 300000), writeScope: 'none (read-only check)' };
}

export function diffDocument(workspaceRoot, relativePath) {
  const root = resolve(workspaceRoot);
  const output = execFileSync('git', ['-C', root, 'diff', '--', relativePath], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { schema: 'architecture-manager-document-diff/v1', path: relativePath, diff: output.slice(-20000), empty: output.trim() === '' };
}
