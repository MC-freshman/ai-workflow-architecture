// P5 (2026-10-28): the architecture gained real script execution -- a workflow
// stage with `action: script` now really runs under the platform's declared
// isolation ladder (kernel-sandbox / sealed host / host-controlled) instead of
// staying prompt-only. Three things have to hold before `wf` / `wfa` can be used
// without surprises:
//   1 a script stage changes what the platform must prove, so an older
//     certification cannot be silently reused;
//   2 the ladder configuration travels into that proof, and only into the cells
//     that actually carry a script seam;
//   3 the rendered entry skills produce a command that is safe to paste: a
//     resolved interpreter, no leftover placeholders, and byte-code writing
//     switched off so a published release tree is never poisoned with
//     __pycache__ (D-46 class, hit for real on 2026-10-28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { certificationFixture } from './support/certification.mjs';
import { seedRelease } from './support/resources.mjs';
import { certificationSnapshot } from '../src/domains/certification/fingerprints.mjs';
import { renderEntrySkills } from '../src/domains/onboarding/onboarding-entry-skills.mjs';

const RUNGS = [
  { rung: 'kernel-sandbox', execPath: 'kernel-sandbox', executionBackend: 'sealed', scriptEnvironment: 'env-a' },
  { rung: 'host-controlled', execPath: 'host-controlled', executionBackend: 'host', scriptEnvironment: 'env-b' }
];
const CELLS = { workflow: 'workflow:expert-task', agent: 'agent:profile-task', software: 'software:demo-cli' };

const snapshotWith = (f, config) => certificationSnapshot(f.root, f.id, config);

function withScriptStage(f) {
  // The stage shape is copied from the real 1.2.0 pilot (tool/expert-task): a
  // script stage carries `script` (not scriptRef), an idle worker and its own
  // output schema.
  seedRelease(f.root, 'tool', 'expert-task', '1.0.0', {
    'workflow.yaml': {
      schema: 'ai-workflow-definition/v2', id: 'expert-task', version: '1.0.0', mode: 'pipeline', maxParallel: 1,
      stages: [
        { id: 'INTAKE', action: 'prompt', worker: 'expert', promptRef: 'prompt.md#stage:INTAKE', dependsOn: [] },
        { id: 'AUDIT', action: 'script', worker: 'none', dependsOn: ['INTAKE'], script: 'scripts/audit_deliverables.py', outputs: 'schemas/audit.schema.json' }
      ]
    },
    'scripts/audit_deliverables.py': 'print("audit")\n',
    'schemas/audit.schema.json': { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false }
  });
}

test('a script stage changes what the platform has to prove, so old evidence cannot be reused', (t) => {
  const f = certificationFixture(t);
  const before = f.snapshot();
  assert.ok(!before.cells[CELLS.workflow].actions.includes('script'), 'the seeded fixture is prompt-only');
  withScriptStage(f);
  const after = f.snapshot();
  assert.ok(after.cells[CELLS.workflow].actions.includes('script'), 'the AUDIT stage must appear in the certified actions');
  assert.notEqual(after.cells[CELLS.workflow].resourceSha256, before.cells[CELLS.workflow].resourceSha256,
    'the resource closure moved, so the run differences are visible');
  assert.notEqual(after.cells[CELLS.workflow].configurationSha256, before.cells[CELLS.workflow].configurationSha256,
    'adopting script execution invalidates the previous attestation on purpose');
});

test('the isolation ladder travels into the proof, and only into cells that carry a script seam', (t) => {
  const f = certificationFixture(t);
  withScriptStage(f);
  // Everything an artifact guard reads has to live inside the workspace, so the
  // ladder files are really written under the fixture root.
  f.put(`${f.id}/bridge/backends/manager-sealed.json`, { schema: 'wf-runner-execution-backend/v1', kind: 'sealed' });
  f.put(`${f.id}/runtime/manager-environments/env/manifest.json`, { schema: 'ai-environment-manifest/v1', packages: {} });
  f.put(`${f.id}/runtime/py-env/host/Scripts/python.exe`, 'fake');
  const ladder = {
    ...f.config,
    executionBackend: join(f.root, f.id, 'bridge/backends/manager-sealed.json'),
    environmentManifest: join(f.root, f.id, 'runtime/manager-environments/env/manifest.json'),
    scriptEnvironment: join(f.root, f.id, 'runtime/manager-environments/env'),
    interpreters: { '.py': join(f.root, f.id, 'runtime/py-env/host/Scripts/python.exe') }
  };
  const withoutRungs = snapshotWith(f, ladder);
  const withRungs = snapshotWith(f, { ...ladder, scriptEnvironmentRungs: RUNGS });
  assert.ok(withoutRungs.cells[CELLS.workflow].actions.includes('script'), 'the fixture really carries the AUDIT stage');
  assert.notEqual(withRungs.cells[CELLS.workflow].configurationSha256, withoutRungs.cells[CELLS.workflow].configurationSha256,
    'a config carrying only the legacy single key must not look identical to one declaring the ladder');
  // Scoped, not global: a cell with neither a script action nor a python-family
  // profile must not follow the ladder.
  assert.equal(withRungs.cells[CELLS.software].configurationSha256, withoutRungs.cells[CELLS.software].configurationSha256,
    'the ladder must not smear across cells that cannot execute scripts');
  // The agent fixture declares python>=3.8, so it is the other script seam and
  // does follow the ladder.
  assert.notEqual(withRungs.cells[CELLS.agent].configurationSha256, withoutRungs.cells[CELLS.agent].configurationSha256);
});

// wf / wfa are the two entry points a user actually types. Everything they run
// has to be resolved at render time: an unresolved placeholder or a missing -B
// is exactly how a published release tree ends up poisoned with __pycache__.
test('the rendered wf and wfa commands are safe to run: resolved, pinned to no bytecode, no placeholders left', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'executor-entry-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = 'local-client';
  const python = 'C:/platform/venv/Scripts/python.exe';
  const put = (file, value) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  put(`${id}/bridge/${id}-config.json`, { interpreters: { '.py': python } });
  const rendered = renderEntrySkills({ workspaceRoot: root, platformId: id });
  assert.equal(rendered.entries.length, 2);
  for (const entry of rendered.entries) {
    assert.deepEqual(entry.issues, [], `${entry.skill} must render without gaps`);
    assert.ok(!entry.content.includes('{{'), `${entry.skill} still carries an unresolved placeholder`);
    if (entry.skill === 'wfa') {
      // wfa deliberately delegates the executable part back to the /wf clauses
      // instead of repeating them, so it only has to point at them explicitly.
      assert.ok(entry.content.includes('/wf'), 'wfa must point at the /wf protocol instead of inventing its own');
      continue;
    }
    assert.ok(entry.content.includes(python), 'wf must name the interpreter it was rendered against');
    assert.ok(entry.content.includes('-B'), 'wf must switch byte-code writing off (D-46: __pycache__ poisons published trees)');
    assert.ok(entry.content.includes('PYTHONDONTWRITEBYTECODE=1'), 'wf must also set the environment guard');
    assert.ok(entry.content.includes('PYTHONUTF8=1'), 'wf must pin UTF-8 IO so Chinese paths survive');
  }
});
