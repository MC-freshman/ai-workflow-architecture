import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'SHA256SUMS' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const files = walk(ROOT).sort();
const lines = files.map((relative) => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
  return `${digest}  ${relative}`;
});

fs.writeFileSync(path.join(ROOT, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, files: files.length, sha256Manifest: 'SHA256SUMS' }, null, 2));
