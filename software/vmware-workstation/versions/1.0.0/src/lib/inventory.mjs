import fs from 'node:fs';
import path from 'node:path';
import { readVmx } from './vmfile.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_DEPTH = 4;
const MAX_VMS = 500;

function walk(root, depth, state) {
  if (depth > MAX_DEPTH || state.vms.length >= MAX_VMS) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    state.warnings.push(`cannot read ${root}: ${error.code || error.message}`);
    return;
  }
  for (const entry of entries) {
    if (state.vms.length >= MAX_VMS) return;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1, state);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.vmx') continue;
    try {
      const info = readVmx(full);
      state.vms.push({ ...info, running: null });
    } catch (error) {
      state.warnings.push(`cannot read vmx ${full}: ${error.code || error.message}`);
    }
  }
}

export function scanInventory(config, runningVms = null) {
  const state = { vms: [], warnings: [] };
  for (const root of config.roots) {
    if (!fs.existsSync(root)) {
      state.warnings.push(`root does not exist: ${root}`);
      continue;
    }
    walk(root, 0, state);
  }

  const runningKeys = new Set((runningVms || []).map((item) => path.resolve(item).toLowerCase()));
  for (const vm of state.vms) {
    vm.running = runningKeys.size ? runningKeys.has(path.resolve(vm.vmxPath).toLowerCase()) : null;
  }
  state.vms.sort((a, b) => a.vmxPath.localeCompare(b.vmxPath));

  return {
    roots: config.roots,
    count: state.vms.length,
    vms: state.vms,
    warnings: state.warnings
  };
}
