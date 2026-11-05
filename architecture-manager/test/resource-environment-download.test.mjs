// D-171 + D-172 (registered 2026-10-28, qoder-cn onboarding session).
//
// D-171: the resource-environment download route was API-only (settings.wheelhouse)
// with no product entry, and a failed download told the user to "fix the download
// connection" they could not configure anywhere.
// D-172: pip ran under one fixed 1200s wall clock with no progress awareness, so a
// slow route (measured 24 KB/s, ~100 MB of wheels) was killed while it was still
// downloading; a retry rebuilt the venv from scratch.
//
// The spec pieces are pure and testable here. The timeout behaviour lives in
// src/runtime/resource_env.py, so it is driven through the real interpreter with
// a fake slow command -- no network, no venv.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runtimeFile } from '../src/core/runtime-path.mjs';
import { RESOURCE_DOWNLOAD_SPEC_KEYS, resourceEnvironmentSpec, specDiffersOnlyInDownloadSource } from '../src/domains/platforms/resource-environment.mjs';

const PYTHON = '<local-user-path>';

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `resource-download-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const base = root => ({
  workspaceRoot: root, platformId: 'doubao', directory: join(root, 'doubao/runtime/manager-resources/one'),
  backup: join(root, 'inbox/backup/doubao/manager-resources/one'), packages: { numpy: '2.1.0' }, profiles: ['portable-resource-python'],
  requirementsDigest: 'd'.repeat(64), python: PYTHON
});

test('D-171: the spec carries the configured download route, and nothing invented', t => {
  const root = scratch(t, 'spec');
  mkdirSync(join(root, 'doubao', 'wheels'), { recursive: true });
  const plain = resourceEnvironmentSpec(base(root));
  assert.equal(plain.wheelhouse, undefined, 'no wheelhouse means no --no-index, pip keeps its default index');
  assert.equal(plain.indexUrl, undefined);
  const mirrored = resourceEnvironmentSpec({ ...base(root), download: { indexUrl: ' https://pypi.tuna.tsinghua.edu.cn/simple ' } });
  assert.equal(mirrored.indexUrl, 'https://pypi.tuna.tsinghua.edu.cn/simple', 'the value is trimmed, never rewritten');
  const offline = resourceEnvironmentSpec({ ...base(root), wheelhouse: 'doubao/wheels' });
  assert.ok(offline.wheelhouse.endsWith('doubao\\wheels') || offline.wheelhouse.endsWith('doubao/wheels'), `wheelhouse must resolve inside the platform: ${offline.wheelhouse}`);
  assert.equal(offline.indexUrl, undefined);
  // A path outside the platform directory stays refused rather than trusted.
  assert.throws(() => resourceEnvironmentSpec({ ...base(root), wheelhouse: 'tool/wf-runner' }), /PLATFORM_CONFIGURATION_PATH_MISMATCH/);
  // Numeric knobs arrive as integers only when they are real positive numbers.
  const patient = resourceEnvironmentSpec({ ...base(root), download: { indexUrl: 'https://example.invalid/simple', trustedHost: 'example.invalid', idleTimeoutSeconds: '1200.9', maxSeconds: 7200, retries: 0, socketTimeoutSeconds: 'abc' } });
  assert.equal(patient.trustedHost, 'example.invalid');
  assert.equal(patient.idleTimeoutSeconds, 1200);
  assert.equal(patient.maxSeconds, 7200);
  assert.equal(patient.retries, undefined, '0 retries means "not configured", not "never retry"');
  assert.equal(patient.socketTimeoutSeconds, undefined, 'unparseable numbers are dropped, never guessed');
});

test('D-171: only the download route may change between two attempts', t => {
  const root = scratch(t, 'retry');
  mkdirSync(join(root, 'doubao', 'wheels'), { recursive: true });
  const first = resourceEnvironmentSpec(base(root));
  const mirror = resourceEnvironmentSpec({ ...base(root), download: { indexUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple' } });
  const wheelhouse = resourceEnvironmentSpec({ ...base(root), wheelhouse: 'doubao/wheels' });
  const patience = resourceEnvironmentSpec({ ...base(root), download: { idleTimeoutSeconds: 1800 } });
  assert.equal(specDiffersOnlyInDownloadSource(first, mirror), true);
  assert.equal(specDiffersOnlyInDownloadSource(first, wheelhouse), true);
  assert.equal(specDiffersOnlyInDownloadSource(mirror, patience), true);
  // Anything else is a real drift and must stay refused.
  assert.equal(specDiffersOnlyInDownloadSource(first, { ...first, packages: { numpy: '2.2.0' } }), false);
  assert.equal(specDiffersOnlyInDownloadSource(first, { ...first, python: 'C:/other/python.exe' }), false);
  assert.equal(specDiffersOnlyInDownloadSource(first, { ...first, requirementsDigest: 'e'.repeat(64) }), false);
  assert.deepEqual(
    RESOURCE_DOWNLOAD_SPEC_KEYS,
    ['wheelhouse', 'indexUrl', 'trustedHost', 'socketTimeoutSeconds', 'retries', 'idleTimeoutSeconds', 'maxSeconds'],
    'the retry whitelist is part of the contract: adding a key here needs a test'
  );
});

// ---- python side (D-172) -------------------------------------------------

const DRIVER = `
import json, os, sys, threading, time
sys.path.insert(0, sys.argv[1])
import resource_env
mode = sys.argv[2]
def slow(lines, seconds):
    code = 'import time\\nfor i in range(%d):\\n print(i, flush=True)\\n time.sleep(%d)' % (lines, seconds)
    return [sys.executable, '-B', '-c', code]
def silent(seconds):
    return [sys.executable, '-B', '-c', 'import time\\ntime.sleep(%d)' % seconds]
if mode == 'progress':
    # 6 lines one second apart, idle limit 5s: still progressing, must finish.
    out = resource_env.stream(slow(6, 1), '测试阶段', {'idleTimeoutSeconds': 5})
    print(json.dumps({'result': 'completed', 'lines': out.count(chr(10)) + 1}))
elif mode == 'stall':
    # 120s of silence with a 3s idle limit: must be killed, not waited out.
    started = time.time()
    try:
        resource_env.stream(silent(120), '测试阶段', {'idleTimeoutSeconds': 3})
        print(json.dumps({'result': 'no-timeout'}))
    except RuntimeError as error:
        print(json.dumps({'result': str(error), 'afterSeconds': round(time.time() - started)}))
elif mode == 'bytes':
    watch = sys.argv[3]
    os.makedirs(watch, exist_ok=True)
    def grow():
        with open(os.path.join(watch, 'blob.bin'), 'wb') as handle:
            for _ in range(8):
                handle.write(b'x' * (1024 * 1024)); handle.flush(); time.sleep(1)
    threading.Thread(target=grow, daemon=True).start()
    resource_env.stream(slow(8, 1), '测试阶段', {'idleTimeoutSeconds': 5}, watch=[watch])
    print(json.dumps({'result': 'completed'}))
elif mode == 'options':
    print(json.dumps(resource_env.index_options(json.loads(sys.argv[3]))))
elif mode == 'transport':
    print(json.dumps(resource_env.transport_options(json.loads(sys.argv[3]))))
`;

function runPython(t, mode, extra = [], timeout = 60000) {
  const root = scratch(t, mode);
  const driver = join(root, 'driver.py');
  writeFileSync(driver, DRIVER, 'utf8');
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-B', driver, dirname(runtimeFile('resource_env.py')), mode, ...extra], {
      timeout, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
    }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
}

const lastJson = stdout => JSON.parse(String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1));

test('D-172: a slow but progressing download is never killed by the clock', async t => {
  let result;
  try {
    result = await runPython(t, 'progress');
  } catch (error) {
    if (/ENOENT|EBUSY|spawn/.test(error.message)) { t.skip('interpreter not spawnable here; run in a user terminal for the authoritative pass'); return; }
    throw error;
  }
  assert.deepEqual(lastJson(result.stdout), { result: 'completed', lines: 6 });
});

test('D-172: real inactivity ends the run with a named timeout, and quickly', async t => {
  let result;
  try {
    result = await runPython(t, 'stall');
  } catch (error) {
    if (/ENOENT|EBUSY|spawn/.test(error.message)) { t.skip('interpreter not spawnable here; run in a user terminal for the authoritative pass'); return; }
    throw error;
  }
  const value = lastJson(result.stdout);
  assert.match(value.result, /^RESOURCE_ENVIRONMENT_IDLE_TIMEOUT:测试阶段:3s$/, `unexpected outcome: ${JSON.stringify(value)}`);
  assert.ok(value.afterSeconds < 60, `a stalled run must not be waited out: ${value.afterSeconds}s`);
});

test('D-172: progress events carry downloaded bytes and an observed rate', async t => {
  const watch = mkdtempSync(join(tmpdir(), 'resource-download-watch-'));
  t.after(() => rmSync(watch, { recursive: true, force: true }));
  let result;
  try {
    result = await runPython(t, 'bytes', [watch]);
  } catch (error) {
    if (/ENOENT|EBUSY|spawn/.test(error.message)) { t.skip('interpreter not spawnable here; run in a user terminal for the authoritative pass'); return; }
    throw error;
  }
  assert.deepEqual(lastJson(result.stdout), { result: 'completed' });
  const events = String(result.stdout).trim().split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(row => row && row.phase === '测试阶段');
  assert.ok(events.length >= 1, 'a long run must emit progress events');
  const grow = events.filter(row => row.downloadedBytes > 0);
  assert.ok(grow.length >= 1, `progress must report bytes: ${JSON.stringify(events)}`);
  for (const row of events) {
    assert.ok(Number.isFinite(row.rateBytesPerSecond), `rate missing: ${JSON.stringify(row)}`);
    assert.ok(Number.isFinite(row.idleSeconds) && Number.isFinite(row.elapsedSeconds), `clock missing: ${JSON.stringify(row)}`);
  }
});

test('D-171: pip options follow the configured route (mirror, offline wheelhouse, or both)', async t => {
  // mode is the python branch; the scratch label only has to be unique.
  const call = async (mode, spec) => {
    try {
      return lastJson((await runPython(t, mode, [JSON.stringify(spec)])).stdout);
    } catch (error) {
      if (/ENOENT|EBUSY|spawn/.test(error.message)) { t.skip('interpreter not spawnable here; run in a user terminal for the authoritative pass'); return null; }
      throw error;
    }
  };
  const empty = await call('options', {});
  if (empty === null) return;
  assert.deepEqual(empty, [], 'no configuration means pip defaults, no invented mirror');
  assert.deepEqual(await call('options', { wheelhouse: 'C:/wheels' }), ['--find-links', 'C:/wheels', '--no-index'], 'a wheelhouse alone installs offline');
  assert.deepEqual(await call('options', { indexUrl: 'https://mirror.invalid/simple' }), ['--index-url', 'https://mirror.invalid/simple']);
  assert.deepEqual(await call('options', { indexUrl: 'https://mirror.invalid/simple', wheelhouse: 'C:/wheels' }), ['--index-url', 'https://mirror.invalid/simple', '--find-links', 'C:/wheels'], 'with a mirror the index stays usable');
  assert.deepEqual(await call('options', { indexUrl: 'https://mirror.invalid/simple', trustedHosts: ['mirror.invalid'] }), ['--index-url', 'https://mirror.invalid/simple', '--trusted-host', 'mirror.invalid']);
  const transport = await call('transport', { retries: 20, socketTimeoutSeconds: 120 });
  assert.deepEqual(transport, ['--timeout', '120', '--retries', '20']);
  assert.deepEqual(await call('transport', {}), ['--timeout', '60', '--retries', '10'], 'the defaults are patience, not one short shot');
});
