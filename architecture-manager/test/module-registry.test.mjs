// Module registry criteria (P2, approved P-table 20261111).
// The registry is a derived view: these tests pin schema validity, freshness against sources,
// channel completeness, view mapping, and M01–M23 matrix coverage. No writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { generateRegistry, serialize, withoutTimestamp } from '../scripts/generate-module-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(ROOT, 'src/app/module-registry.json');
const schemaPath = path.join(ROOT, 'src/app/module-registry.schema.json');
const committedText = fs.readFileSync(registryPath, 'utf8');
const committed = JSON.parse(committedText);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ strict: false });
const validate = ajv.compile(schema);

test('module registry satisfies ai-manager-module/v1 schema', () => {
  assert.equal(validate(committed), true, JSON.stringify(validate.errors));
  assert.equal(committed.schema, 'ai-manager-module/v1');
});

test('module registry is fresh against operations.json, domains, panels and views', () => {
  const regenerated = generateRegistry();
  assert.deepEqual(withoutTimestamp(regenerated), withoutTimestamp(committed), 'MODULE_REGISTRY_DRIFT: run node scripts/generate-module-registry.mjs');
  assert.equal(serialize({ ...committed }), committedText, 'registry serialization format drifted');
});

test('registry channels exactly match operations.json (no duplicates, no missing)', () => {
  const ops = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/operations.json'), 'utf8'));
  const declared = Object.values(ops.operations).map((o) => o.channel).sort();
  const registered = committed.modules.flatMap((m) => m.channels || []).sort();
  assert.deepEqual(registered, declared);
  assert.equal(new Set(registered).size, registered.length, 'duplicate channel attribution');
  assert.equal(committed.summary.channelCount, declared.length);
});

test('registry views match view-definitions.json and reference existing panel modules', () => {
  const defs = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/view-definitions.json'), 'utf8'));
  assert.equal(defs.schema, 'ai-manager-views/v1');
  assert.equal(committed.views.length, defs.views.length);
  const panelIds = new Set(committed.modules.filter((m) => m.kind === 'panel').map((m) => m.id));
  defs.views.forEach((v, i) => {
    const cv = committed.views[i];
    assert.equal(cv.id, v.id);
    assert.equal(cv.label, v.label);
    assert.equal(cv.group, v.group);
    assert.equal(cv.description, v.description || '');
    assert.deepEqual(cv.panels, v.panels);
    assert.equal(cv.order, i);
    if (v.sections) assert.deepEqual(cv.sections, v.sections);
    assert.ok(cv.panels.length > 0, 'view has no panels: ' + v.id);
    for (const p of cv.panels) assert.ok(panelIds.has(p), 'unknown panel ' + p + ' in view ' + v.id);
  });
});

test('every panel module has exactly one local lazy loader (no remote code)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/features/workspace/panel-loaders.mjs'), 'utf8');
  const keys = [...src.matchAll(/^\s*'([a-z0-9-]+)':\s*\{\s*load:/gm)].map((m) => m[1]);
  const panelModules = committed.modules.filter((m) => m.kind === 'panel').map((m) => m.id);
  const replacementIds = [...src.matchAll(/replacementLoaders\s*=\s*\{([\s\S]*?)\n\};/g)].flatMap((m) => [...m[1].matchAll(/^\s*'([a-z0-9-]+)':\s*\{\s*load:/gm)].map((x) => x[1]));
  const baseKeys = keys.filter((k) => !replacementIds.includes(k));
  assert.deepEqual([...baseKeys].sort(), [...panelModules].sort(), 'loader map and registry panel modules must match 1:1');
  assert.ok(!/import\(\s*['"]https?:/.test(src), 'remote loaders are forbidden (CSP local-only)');
  const picks = [...src.matchAll(/pick:\s*\[([^\]]+)\]/g)];
  assert.equal(picks.length, keys.length, 'every loader declares picked exports');
  // Overrides may only reference registered replacement loaders, and only panel modules.
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/app/module-overrides.json'), 'utf8'));
  for (const [id, ov] of Object.entries(overrides.overrides)) {
    const mod = committed.modules.find((m) => m.id === id);
    assert.ok(mod, 'override targets unknown module: ' + id);
    if (ov.replacement != null) {
      assert.equal(mod.kind, 'panel', 'replacement only supported for panels: ' + id);
      assert.ok(replacementIds.includes(ov.replacement), 'replacement not registered: ' + ov.replacement);
    }
  }
  for (const m of committed.modules) {
    if (m.replacement != null) assert.ok(replacementIds.includes(m.replacement), 'registry replacement not registered: ' + m.id);
  }
});

test('module ids are unique and matrix M01–M23 is fully covered', () => {
  const ids = committed.modules.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate module id');
  const refs = new Set(committed.modules.map((m) => m.matrixRef));
  for (let i = 1; i <= 23; i++) {
    const ref = 'M' + String(i).padStart(2, '0');
    assert.ok(refs.has(ref), 'matrix row not covered: ' + ref);
  }
  assert.equal(committed.summary.moduleCount, committed.modules.length);
  assert.equal(committed.summary.domainCount, committed.modules.filter((m) => m.kind === 'domain').length);
  assert.equal(committed.summary.viewCount, committed.views.length);
});

test('initial state: every module enabled, no replacement active, transactions kernel not replaceable', () => {
  for (const m of committed.modules) {
    assert.equal(m.enabled, true, 'module disabled at baseline: ' + m.id);
    assert.equal(m.replacement, null, 'replacement active at baseline: ' + m.id);
    assert.ok(m.replacementOptions.selfWritten && m.replacementOptions.softwareIntegration, 'replacement options missing: ' + m.id);
  }
  const kernel = committed.modules.find((m) => m.id === 'mech-transactions');
  assert.equal(kernel.replaceable, false);
  const preload = committed.modules.find((m) => m.id === 'entry-preload');
  assert.equal(preload.replaceable, false, 'generated preload must not be independently replaceable');
});

test('negative: tampered registry fails freshness and bad matrixRef fails schema', () => {
  const tampered = JSON.parse(JSON.stringify(committed));
  tampered.modules[0].impactScope = 'hand-edited';
  assert.notDeepEqual(withoutTimestamp(tampered), withoutTimestamp(generateRegistry()), 'tamper must be detected');
  const bad = JSON.parse(JSON.stringify(committed));
  bad.modules[0].matrixRef = 'X99';
  assert.equal(validate(bad), false, 'invalid matrixRef must be rejected');
  const missingOptions = JSON.parse(JSON.stringify(committed));
  delete missingOptions.modules[0].replacementOptions;
  assert.equal(validate(missingOptions), false, 'missing replacementOptions must be rejected');
});