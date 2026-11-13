import fs from 'node:fs';
import path from 'node:path';

const VMRUN_CANDIDATES = [
  'D:\\VMwareVMware\\vmrun.exe',
  'C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe',
  'C:\\Program Files\\VMware\\VMware Workstation\\vmrun.exe',
  'C:\\Program Files (x86)\\VMware\\VMware VIX\\vmrun.exe'
];

function unquote(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function splitRoots(value) {
  return String(value || '')
    .split(';')
    .map((item) => unquote(item))
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSecretFile(filePath) {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  } catch {
    return null;
  }
}

export function resolveVmruns(env) {
  const explicit = unquote(env.VMWARE_VMRUN || env.VMRUN_PATH || '');
  if (explicit) return explicit;
  for (const candidate of VMRUN_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadConfig(env = process.env) {
  const passwordFile = unquote(env.VMWARE_GUEST_PASSWORD_FILE || '');
  const passwordFromFile = readSecretFile(passwordFile);
  const passwordFromEnv = env.VMWARE_GUEST_PASSWORD || '';
  const guestPassword = passwordFromFile ?? (passwordFromEnv || null);

  return {
    vmrunPath: resolveVmruns(env),
    hostType: unquote(env.VMWARE_HOST_TYPE || 'ws') || 'ws',
    roots: splitRoots(env.VMWARE_VMX_ROOTS),
    workspaceRoot: unquote(env.VMWARE_WORKSPACE_ROOT || '') ? path.resolve(unquote(env.VMWARE_WORKSPACE_ROOT)) : null,
    guestUser: env.VMWARE_GUEST_USER || null,
    guestPassword,
    guestPasswordFile: passwordFile || null,
    readOnly: env.VMWARE_READ_ONLY === '1',
    debug: env.VMWARE_MCP_DEBUG === '1',
    logFile: unquote(env.VMWARE_MCP_LOG || '') ? path.resolve(unquote(env.VMWARE_MCP_LOG)) : null,
    timeoutMs: positiveInt(env.VMWARE_TIMEOUT_MS, 60000),
    cloneTimeoutMs: positiveInt(env.VMWARE_CLONE_TIMEOUT_MS, 600000),
    maxOutputBytes: positiveInt(env.VMWARE_MAX_OUTPUT_BYTES, 8 * 1024 * 1024)
  };
}

export function configSummary(config) {
  return {
    vmrunPath: config.vmrunPath,
    hostType: config.hostType,
    roots: config.roots,
    workspaceRoot: config.workspaceRoot,
    guestCredentials: Boolean(config.guestUser && config.guestPassword),
    readOnly: config.readOnly
  };
}
