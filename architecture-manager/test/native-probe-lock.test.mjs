import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireNativeProbeLock} from '../src/core/native-probe-lock.mjs';

const lockIn=(name)=>join(fs.mkdtempSync(join(tmpdir(),'arch-lock-')),name);

test('the lock serializes live attempts and releases byte-for-byte',()=>{
  const path=lockIn('probe.lock');
  const release=acquireNativeProbeLock(path,'a1');
  assert.throws(()=>acquireNativeProbeLock(path,'a2'),/NATIVE_PROBE_ALREADY_RUNNING/);
  release();
  const again=acquireNativeProbeLock(path,'a3');
  assert.equal(JSON.parse(fs.readFileSync(path,'utf8')).attemptId,'a3');
  again();
  assert.equal(fs.existsSync(path),false);
});

test('a stale holder with a dead pid is broken, an expired ttl is broken',()=>{
  const path=lockIn('probe.lock');
  fs.writeFileSync(path,JSON.stringify({attemptId:'dead',pid:999999999,startedAt:new Date().toISOString()}));
  const release=acquireNativeProbeLock(path,'fresh');
  assert.equal(JSON.parse(fs.readFileSync(path,'utf8')).attemptId,'fresh');
  release();
  fs.writeFileSync(path,JSON.stringify({attemptId:'old',pid:process.pid,startedAt:new Date(Date.now()-20*60*1000).toISOString()}));
  const second=acquireNativeProbeLock(path,'newer',1000);
  assert.equal(JSON.parse(fs.readFileSync(path,'utf8')).attemptId,'newer');
  second();
});

test('release never removes a lock it does not own',()=>{
  const path=lockIn('probe.lock');
  const release=acquireNativeProbeLock(path,'mine');
  fs.writeFileSync(path,JSON.stringify({attemptId:'someone-else',pid:process.pid,startedAt:new Date().toISOString()}));
  release();
  assert.equal(JSON.parse(fs.readFileSync(path,'utf8')).attemptId,'someone-else');
});
