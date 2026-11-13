import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools } from '../src/lib/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function check(id, condition, detail = undefined) {
  checks.push({ id, pass: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  if (!condition) failures.push({ id, detail });
}

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
const jsonFiles = files.filter((file) => file.endsWith('.json'));
const parsed = new Map();

for (const file of jsonFiles) {
  try {
    parsed.set(file, JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    check(`json:${file}`, true);
  } catch (error) {
    check(`json:${file}`, false, error.message);
  }
}

const manifest = parsed.get('manifest.json');
const snapshot = parsed.get('capabilities.snapshot.json');
const pkg = parsed.get('package.json');
let pointer = null;
try {
  pointer = JSON.parse(fs.readFileSync(path.join(ROOT, '..', '..', 'current.json'), 'utf8'));
  check('json:../../current.json', true);
} catch (error) {
  check('json:../../current.json', false, error.message);
}

check('manifest:schema', manifest?.schema === 'ai-software/v1');
check('manifest:id', manifest?.id === 'vmware-workstation');
check('manifest:kind', manifest?.kind === 'mcp-stdio');
check('manifest:version-matches-package', manifest?.version === pkg?.version, `${manifest?.version} vs ${pkg?.version}`);
check('manifest:version-matches-pointer', manifest?.version === pointer?.version, `${manifest?.version} vs ${pointer?.version}`);
check('pointer:available', Array.isArray(pointer?.available) && pointer.available.includes(manifest?.version));
check('pointer:hash-manifest', pointer?.hashManifest === 'SHA256SUMS');
check('manifest:capability-count', manifest?.capabilities?.length === tools.length, `${manifest?.capabilities?.length} vs ${tools.length}`);
check('snapshot:capability-count', snapshot?.capabilities?.length === tools.length);
check('snapshot:frozen', snapshot?.frozen === true);

for (const capability of manifest?.capabilities ?? []) {
  check(`capability:${capability.name}:input-schema`, fs.existsSync(path.join(ROOT, capability.inputSchemaRef)), capability.inputSchemaRef);
  check(`capability:${capability.name}:output-schema`, fs.existsSync(path.join(ROOT, capability.outputSchemaRef)), capability.outputSchemaRef);
  check(`capability:${capability.name}:frozen-name`, capability.invocation?.frozenToolName === capability.name);
}

for (const [file, value] of parsed) {
  if (!file.endsWith('.json')) continue;
  if (!file.startsWith('schemas/')) continue;
  check(`schema-dialect:${file}`, value.$schema === 'http://json-schema.org/draft-07/schema#', value.$schema);
}

const sumsPath = path.join(ROOT, 'SHA256SUMS');
if (fs.existsSync(sumsPath)) {
  const declared = new Map();
  for (const line of fs.readFileSync(sumsPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
    if (!match) {
      check('sums:format', false, line);
      continue;
    }
    declared.set(match[2], match[1]);
  }
  check('sums:file-count', declared.size === files.length, `${declared.size} vs ${files.length}`);
  for (const file of files) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
    check(`sums:${file}`, declared.get(file) === actual, declared.get(file) ? undefined : 'not listed');
  }
} else {
  check('sums:present', false, 'SHA256SUMS is missing');
}

const summary = {
  ok: failures.length === 0,
  root: ROOT,
  files: files.length,
  jsonFiles: jsonFiles.length,
  capabilities: manifest?.capabilities?.length ?? null,
  checks: checks.length,
  failures
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.ok ? 0 : 1;
