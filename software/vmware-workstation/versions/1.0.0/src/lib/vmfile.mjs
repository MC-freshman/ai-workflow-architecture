import fs from 'node:fs';
import path from 'node:path';

export function readVmx(vmPath) {
  const text = fs.readFileSync(vmPath, 'utf8');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    values[key] = value;
  }

  return {
    vmxPath: path.resolve(vmPath),
    directory: path.dirname(path.resolve(vmPath)),
    displayName: values.displayName || path.basename(vmPath, path.extname(vmPath)),
    guestOS: values.guestOS || null,
    memoryMB: values.memsize ? Number(values.memsize) : null,
    numVCPUs: values.numvcpus ? Number(values.numvcpus) : null,
    firmware: values.firmware || null,
    virtualHWVersion: values['virtualHW.version'] || null,
    toolsUpgradePolicy: values['tools.upgrade.policy'] || null
  };
}
