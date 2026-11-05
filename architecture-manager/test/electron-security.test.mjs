import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CONTENT_SECURITY_POLICY, isApplicationNavigation, secureSession, secureWindow } from '../src/electron/security-policy.mjs';
import { createOperationRouter } from '../src/electron/ipc-router.mjs';

test('window prevents external, sibling file, redirect and popup navigation', () => {
  const entry = process.platform === 'win32' ? 'E:\\fixture\\dist\\index.html' : '/fixture/dist/index.html';
  const own = pathToFileURL(entry).href;
  assert.equal(isApplicationNavigation(own + '#resources', entry), true);
  const handlers = new Map();
  let open;
  secureWindow({setWindowOpenHandler: handler => {open = handler;}, on: (event, handler) => handlers.set(event, handler)}, entry);
  for (const value of ['https://example.com/', 'javascript:alert(1)', own.replace('index.html','other.html'), own + '?changed=1']) {
    for (const eventName of ['will-navigate', 'will-redirect']) {
      let denied = false;
      handlers.get(eventName)({preventDefault: () => {denied = true;}}, value);
      assert.equal(denied, true, `${eventName}: ${value}`);
    }
  }
  assert.deepEqual(open({url: own}), {action: 'deny'});
});

test('session denies browser permissions and preserves headers when adding CSP', () => {
  let permission, headers;
  secureSession({setPermissionRequestHandler: handler => {permission = handler;},
    webRequest: {onHeadersReceived: handler => {headers = handler;}}});
  permission(null, 'camera', allowed => assert.equal(allowed, false));
  headers({responseHeaders: {'X-Test': ['retained']}}, result => {
    assert.deepEqual(result.responseHeaders['X-Test'], ['retained']);
    assert.deepEqual(result.responseHeaders['Content-Security-Policy'], [CONTENT_SECURITY_POLICY]);
  });
});

test('IPC router keeps document arguments, task metadata and progress in the owned lifecycle', async () => {
  const handlers = new Map(), calls = [], messages = [];
  let tracked = 0;
  const register = createOperationRouter({ipcMain: {handle: (name, handler) => handlers.set(name, handler)},
    lifecycle: {track: async operation => {tracked++; return operation();}}, rememberWorkspace: () => {},
    runTask: async input => {calls.push(input); input.onProgress({state: 'settled'}); return {ok: true};}});
  register('document:read', () => {throw Error('INLINE_DOMAIN_EXECUTION');});
  const input = {workspaceRoot: 'fixture-root', relativePath: 'versions/example.md', platformId: 'fixture'};
  const result = await handlers.get('document:read')({sender: {send: (...args) => messages.push(args)}}, input,
    {__managerTaskContext: true, jobId: 'one', workspaceSession: 'session'});
  assert.deepEqual(result, {ok: true}); assert.equal(tracked, 1);
  assert.equal(calls[0].method, 'readDocument');
  assert.deepEqual(calls[0].args, [input.workspaceRoot, input.relativePath]);
  assert.equal(calls[0].jobId, 'one'); assert.equal(calls[0].workspaceSession, 'session');
  assert.deepEqual(messages, [['transaction:progress', {state: 'settled'}]]);
});
