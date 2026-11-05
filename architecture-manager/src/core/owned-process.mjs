import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runtimeFile } from './runtime-path.mjs';

export function runOwnedProcess({ python, executable = python, args, input = null, cwd, scopeRoot = cwd, timeout = 120000, env = process.env, registerCancel = () => {}, onOutput = () => {} }) {
  if (!python || !existsSync(python)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  mkdirSync(cwd, { recursive: true });
  const cancelPath = join(cwd, `cancel-${randomUUID()}.flag`);
  const child = spawn(python, ['-B', runtimeFile('job_controller.py')], { cwd, windowsHide: true, shell: false, env: { ...env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
  registerCancel(() => { writeFileSync(cancelPath, 'cancel'); });
  let stdout = ''; let stderr = ''; let overLimit = false;
  // AUD-D-004: once the 16MB cap trips, the controller kills the tree, but the 'data'
  // events kept firing until close and the buffered strings grew without bound. Stop
  // buffering past the cap; onOutput keeps streaming for as long as the child lives.
  child.stdout.on('data', (data) => { const text = data.toString('utf8'); onOutput(text); if (overLimit) return; stdout += text; if (stdout.length > 16 * 1024 * 1024) { overLimit = true; stderr = ''; writeFileSync(cancelPath, 'output-limit'); } });
  child.stderr.on('data', (data) => { if (overLimit) return; stderr += data.toString('utf8'); if (stderr.length > 16 * 1024 * 1024) { overLimit = true; stderr = ''; writeFileSync(cancelPath, 'output-limit'); } });
  child.stdin.end(JSON.stringify({ argv: [executable, ...args], input, cwd, scopeRoot, cancelPath, timeoutSeconds: timeout / 1000 }) + '\n');
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode) => { registerCancel(null); resolve({ stdout, stderr, exitCode, cancelled: exitCode === 125, timedOut: exitCode === 124 }); }); });
}
