import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.mjs';

function compareKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function realpath(pathValue, mustExist) {
  const resolved = path.resolve(pathValue);
  if (!mustExist) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    throw new ToolError('PATH_NOT_FOUND', `path does not exist: ${resolved}`);
  }
}

function isInside(root, target) {
  const rootKey = compareKey(root);
  const targetKey = compareKey(target);
  const prefix = rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep;
  return targetKey === rootKey || targetKey.startsWith(prefix);
}

export function assertVmPath(config, vmPath, { mustExist = true } = {}) {
  if (!config.roots.length) {
    throw new ToolError('CONFIG_MISSING', 'VMWARE_VMX_ROOTS is not set; configure at least one absolute VM root');
  }
  if (typeof vmPath !== 'string' || !vmPath.trim()) {
    throw new ToolError('INVALID_ARGUMENT', 'vmPath must be a non-empty string');
  }
  const resolved = path.resolve(vmPath);
  if (path.extname(resolved).toLowerCase() !== '.vmx') {
    throw new ToolError('INVALID_ARGUMENT', 'vmPath must point to a .vmx file');
  }
  if (mustExist && !fs.existsSync(resolved)) {
    throw new ToolError('VM_NOT_FOUND', `vmx does not exist: ${resolved}`);
  }
  const target = realpath(resolved, mustExist);
  for (const root of config.roots) {
    if (!fs.existsSync(root)) continue;
    if (isInside(realpath(root, true), target)) return target;
  }
  throw new ToolError('PATH_DENIED', `vmPath is outside VMWARE_VMX_ROOTS: ${resolved}`);
}

export function assertWorkspacePath(config, targetPath, { mustExist = true, label = 'path' } = {}) {
  if (!config.workspaceRoot) {
    throw new ToolError('CONFIG_MISSING', 'VMWARE_WORKSPACE_ROOT is not set; host file operations need a workspace root');
  }
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new ToolError('INVALID_ARGUMENT', `${label} must be a non-empty string`);
  }
  const resolved = path.resolve(targetPath);
  if (mustExist && !fs.existsSync(resolved)) {
    throw new ToolError('PATH_NOT_FOUND', `${label} does not exist: ${resolved}`);
  }
  const rootReal = realpath(config.workspaceRoot, true);
  const anchor = mustExist ? realpath(resolved, true) : realpath(path.dirname(resolved), true);
  if (!isInside(rootReal, anchor)) {
    throw new ToolError('PATH_DENIED', `${label} is outside VMWARE_WORKSPACE_ROOT: ${resolved}`);
  }
  return resolved;
}

export function assertNewPathInside(config, targetPath, { label = 'path' } = {}) {
  if (!config.roots.length) {
    throw new ToolError('CONFIG_MISSING', 'VMWARE_VMX_ROOTS is not set');
  }
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new ToolError('INVALID_ARGUMENT', `${label} must be a non-empty string`);
  }
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    throw new ToolError('PATH_EXISTS', `${label} already exists: ${resolved}`);
  }
  const parent = realpath(path.dirname(resolved), true);
  for (const root of config.roots) {
    if (!fs.existsSync(root)) continue;
    if (isInside(realpath(root, true), parent)) return resolved;
  }
  throw new ToolError('PATH_DENIED', `${label} is outside VMWARE_VMX_ROOTS: ${resolved}`);
}

export function assertConfirm(args, action) {
  if (args.confirm !== true) {
    throw new ToolError('CONFIRM_REQUIRED', `${action} requires confirm: true`);
  }
}

export function assertMutable(config, action) {
  if (config.readOnly) {
    throw new ToolError('READ_ONLY', `VMWARE_READ_ONLY=1 refuses ${action}`);
  }
}

export function assertVmrun(config) {
  if (!config.vmrunPath) {
    throw new ToolError('VMRUN_NOT_FOUND', 'vmrun.exe was not found; set VMWARE_VMRUN to its absolute path');
  }
  if (!fs.existsSync(config.vmrunPath)) {
    throw new ToolError('VMRUN_NOT_FOUND', `vmrun.exe does not exist: ${config.vmrunPath}`);
  }
}

export function redactSecrets(text, secrets) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (secret && String(secret).length > 0) {
      output = output.split(String(secret)).join('***');
    }
  }
  return output;
}
