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
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data.toString('utf8'); onOutput(data.toString('utf8')); if (stdout.length > 16 * 1024 * 1024) writeFileSync(cancelPath, 'output-limit'); });
  child.stderr.on('data', (data) => { stderr += data.toString('utf8'); if (stderr.length > 16 * 1024 * 1024) writeFileSync(cancelPath, 'output-limit'); });
  child.stdin.end(JSON.stringify({ argv: [executable, ...args], input, cwd, scopeRoot, cancelPath, timeoutSeconds: timeout / 1000 }) + '\n');
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode) => { registerCancel(null); resolve({ stdout, stderr, exitCode, cancelled: exitCode === 125, timedOut: exitCode === 124 }); }); });
}
