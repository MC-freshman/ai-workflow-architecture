import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';

export function runtimeFile(name) {
  if (!/^[a-z][a-z0-9_]*\.(?:py|mjs|ps1)$/.test(name)) throw new Error('INVALID_RUNTIME_HELPER');
  const original = fileURLToPath(new URL(`../runtime/${name}`, import.meta.url));
  const unpacked = original.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  return unpacked !== original && existsSync(unpacked) ? unpacked : original;
}
