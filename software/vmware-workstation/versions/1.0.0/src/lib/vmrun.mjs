import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolError } from './errors.mjs';
import { assertVmrun, redactSecrets } from './policy.mjs';

const execFileAsync = promisify(execFile);

function secretsOf(config) {
  return [config.guestPassword].filter(Boolean);
}

export function buildVmrunArgv(config, command, args = [], { guest = false } = {}) {
  assertVmrun(config);
  const argv = ['-T', config.hostType];
  if (guest) {
    if (!config.guestUser || !config.guestPassword) {
      throw new ToolError('CREDENTIALS_REQUIRED', 'guest operation needs VMWARE_GUEST_USER and VMWARE_GUEST_PASSWORD or VMWARE_GUEST_PASSWORD_FILE');
    }
    argv.push('-gu', config.guestUser, '-gp', config.guestPassword);
  }
  argv.push(command, ...args.map((item) => String(item)));
  return argv;
}

export function redactArgv(argv, config) {
  const secrets = secretsOf(config);
  return argv.map((item) => redactSecrets(item, secrets));
}

export async function runVmrun(config, command, args = [], options = {}) {
  const argv = buildVmrunArgv(config, command, args, options);
  const timeout = options.timeout ?? config.timeoutMs;
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(config.vmrunPath, argv, {
      timeout,
      windowsHide: true,
      maxBuffer: config.maxOutputBytes,
      encoding: 'utf8'
    });
    const stdout = redactSecrets(result.stdout || '', secretsOf(config));
    const stderr = redactSecrets(result.stderr || '', secretsOf(config));
    return {
      ok: !/^\s*Error:/m.test(stderr),
      exitCode: 0,
      stdout,
      stderr,
      argv: redactArgv(argv, config),
      durationMs: Date.now() - startedAt,
      timedOut: false
    };
  } catch (error) {
    const timedOut = error.killed === true || error.code === 'ETIMEDOUT';
    return {
      ok: false,
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: redactSecrets(error.stdout || '', secretsOf(config)),
      stderr: redactSecrets(error.stderr || error.message || '', secretsOf(config)),
      argv: redactArgv(argv, config),
      durationMs: Date.now() - startedAt,
      timedOut
    };
  }
}

export function vmrunFailure(result, context = 'vmrun') {
  if (result.timedOut) {
    return new ToolError('TIMEOUT', `${context} timed out`, { argv: result.argv });
  }
  const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ');
  return new ToolError('VMRUN_FAILED', `${context} failed (exit ${result.exitCode})${detail ? ': ' + detail : ''}`, {
    exitCode: result.exitCode,
    argv: result.argv
  });
}

export function assertVmrunOk(result, context = 'vmrun') {
  if (!result.ok) throw vmrunFailure(result, context);
  return result;
}
