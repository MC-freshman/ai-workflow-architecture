import assert from 'node:assert/strict';
import test from 'node:test';
import {taskClient} from '../src/renderer/shared/task-client.mjs';
test('task wrappers operate on Electron-style frozen preload methods without changing them',async()=>{
  let received;
  const original=Object.freeze({scanWorkspace:async(...args)=>{received=args;return {ok:true};},getAppVersion:async()=>'0.4.2'});
  const client=taskClient(original,'workspace-session');
  assert.deepEqual(await client.scanWorkspace('workspace'),{ok:true});
  assert.equal(received[0],'workspace');assert.equal(received[1].workspaceSession,'workspace-session');
  assert.match(received[1].jobId,/^[0-9a-f-]{36}$/);assert.equal(received[1].__managerTaskContext,true);
  assert.equal(await client.getAppVersion(),'0.4.2');assert.equal(Object.isFrozen(original),true);assert.equal(Object.getOwnPropertyDescriptor(original,'getAppVersion').writable,false);
});
