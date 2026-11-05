// native-client-session proof channel. This module writes to the vendor client's
// user-level MCP config (default ~/.qoder/mcp.json), so every case below passes
// an EXPLICIT temporary configDir -- none of them may touch the real home.
// The module is still un-wired (no src import yet, 2026-10-15); these cases are
// the guard rails that must hold before it is called from a production path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sessionTranscriptEvents,
  writeSessionProbeConfig,
  restoreSessionProbeConfig,
  restoreNativeClientSessionConfig,
  finalizeNativeClientSessionProof
} from '../src/domains/platforms/native-client-session.mjs';
import { sha256 } from '../src/core/hash.mjs';

const SERVICE = { executable: 'python', args: ['-B', 'mcp_service.py', 'config.json'] };

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `native-session-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}

test('sessionTranscriptEvents keeps only assistant/user turns and honours the session filter', () => {
  const text = [
    JSON.stringify({ type: 'assistant', sessionId: 's1', text: 'a' }),
    'not json at all',
    JSON.stringify({ type: 'user', sessionId: 's1', text: 'b' }),
    JSON.stringify({ type: 'system', sessionId: 's1', text: 'c' }),
    JSON.stringify({ type: 'assistant', sessionId: 's2', text: 'd' }),
    ''
  ].join('\n');
  const all = sessionTranscriptEvents(text);
  assert.equal(all.length, 3, 'malformed lines and non-turn types must be dropped');
  assert.deepEqual(all.map((event) => event.type), ['assistant', 'user', 'assistant']);
  const scoped = sessionTranscriptEvents(text, 's1');
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every((event) => event.sessionId === 's1'));
  assert.equal(sessionTranscriptEvents(text, 'missing').length, 0);
});

test('writeSessionProbeConfig registers the channel on a fresh config and restore removes it again', (t) => {
  const configPath = join(scratch(t, 'fresh'), 'mcp.json');
  const written = writeSessionProbeConfig({ configPath, service: SERVICE, probeFile: 'challenge.json', attemptId: 'a1' });
  assert.equal(written.before, null, 'a fresh config has no previous bytes');
  assert.equal(written.beforeSha256, null);
  const document = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(document.mcpServers.architecture.command, SERVICE.executable);
  assert.ok(document.mcpServers.architecture.args.includes('--native-probe-file'), 'probe file must be appended');
  assert.equal(document.mcpServers.architecture.disabled, false);
  // atomicWrite must not leave its temporary file behind.
  assert.equal(existsSync(`${configPath}.architecture-manager-a1.tmp`), false);
  const restored = restoreSessionProbeConfig({ configPath, before: written.before, beforeSha256: written.beforeSha256, attemptId: 'a1' });
  const after = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(after.mcpServers.architecture, undefined, 'the temporary channel must not survive');
  assert.equal(typeof restored, 'string');
});

test('writeSessionProbeConfig keeps existing servers and restore returns the exact original bytes', (t) => {
  const configPath = join(scratch(t, 'existing'), 'mcp.json');
  const original = '{\n  // keep this comment\n  "other": true,\n  "mcpServers": { "custom": { "command": "node", "args": ["x"] } }\n}\n';
  writeFileSync(configPath, original);
  const written = writeSessionProbeConfig({ configPath, service: SERVICE, probeFile: 'challenge.json', attemptId: 'a2' });
  assert.equal(written.before, original);
  const document = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(document.mcpServers.custom, { command: 'node', args: ['x'] }, 'unrelated servers must survive');
  assert.ok(document.mcpServers.architecture);
  const restored = restoreSessionProbeConfig({ configPath, before: written.before, beforeSha256: written.beforeSha256, attemptId: 'a2' });
  assert.equal(readFileSync(configPath, 'utf8'), original, 'restore must be byte-exact, not a re-serialisation');
  assert.equal(restored, written.beforeSha256);
});

test('writeSessionProbeConfig refuses a name conflict unless replacement is explicitly allowed', (t) => {
  const configPath = join(scratch(t, 'conflict'), 'mcp.json');
  writeSessionProbeConfig({ configPath, service: SERVICE, probeFile: 'first.json', attemptId: 'a3' });
  assert.throws(
    () => writeSessionProbeConfig({ configPath, service: SERVICE, probeFile: 'second.json', attemptId: 'a3' }),
    /NATIVE_SERVER_NAME_CONFLICT/,
    'silently clobbering an existing channel would break the other client'
  );
  const replaced = writeSessionProbeConfig({ configPath, service: SERVICE, probeFile: 'second.json', attemptId: 'a3', allowReplace: true });
  assert.ok(replaced.afterSha256);
  const document = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.ok(document.mcpServers.architecture.args.includes('second.json'));
});

test('restoreSessionProbeConfig fails closed when the restored bytes do not match', (t) => {
  const configPath = join(scratch(t, 'tamper'), 'mcp.json');
  writeFileSync(configPath, '{"mcpServers":{}}');
  assert.throws(
    () => restoreSessionProbeConfig({ configPath, before: '{"mcpServers":{}}', beforeSha256: sha256('something else entirely'), attemptId: 'a4' }),
    /NATIVE_CLIENT_SESSION_CONFIG_RESTORE_FAILED/,
    'a restore that did not reproduce the old bytes must be reported, never assumed'
  );
});

// Guard rails: the attempt id is validated before any workspace file is read,
// so these hold without a full registered-client fixture.
test('a malformed attempt id fails closed before touching the workspace', (t) => {
  const root = scratch(t, 'attempt-id');
  for (const bad of ['bad id', '../escape', '', 'a/b', 'x'.repeat(81)]) {
    assert.throws(() => restoreNativeClientSessionConfig({ workspaceRoot: root, platformId: 'p', attemptId: bad }), /INVALID_ATTEMPT_ID/, String(bad));
    assert.throws(
      () => finalizeNativeClientSessionProof({ workspaceRoot: root, platformId: 'p', attemptId: bad, transcriptPath: 'x', sessionId: 's', aiConsent: true }),
      /INVALID_ATTEMPT_ID/,
      String(bad)
    );
  }
});

test('a platform without a supported registered session client is refused, not assumed', (t) => {
  const root = scratch(t, 'unsupported');
  const state = 'p/bridge/native-client.json';
  put(root, state, { registered: false });
  assert.throws(() => restoreNativeClientSessionConfig({ workspaceRoot: root, platformId: 'p', attemptId: 'a1' }), /NATIVE_CLIENT_SESSION_PROOF_UNSUPPORTED/);
  // Registered, but not a Qoder workspace-mcp profile: still unsupported.
  put(root, state, { registered: true, profile: { kind: 'codex-app-server', vendor: 'Codex', bodyPath: 'body.exe' } });
  assert.throws(() => restoreNativeClientSessionConfig({ workspaceRoot: root, platformId: 'p', attemptId: 'a1' }), /NATIVE_CLIENT_SESSION_PROOF_UNSUPPORTED/);
});
