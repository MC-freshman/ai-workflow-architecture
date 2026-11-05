import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {childEnv,freeLocalPort} from '../src/core/child-env.mjs';

test('childEnv strips host-injected vendor variables and keeps the rest',()=>{
  const base={PATH:'C:\\Windows',SYSTEMROOT:'C:\\Windows',TEMP:'C:\\Temp',CODEBUDDY_SESSION_ID:'s-1',CODEBUDDY_MCP_CONFIG:'{"mcpServers":{}}',SERVER__PORT:'16279',SERVER__HOST:'127.0.0.1',CLAUDE_PROJECT_DIR:'/p',WB_SOMETHING:'x',HOME:'<local-user-path>'};
  const env=childEnv(base,{CODEBUDDY_CONFIG_DIR:'C:\\isolated-home'});
  assert.equal(env.PATH,'C:\\Windows');
  assert.equal(env.SYSTEMROOT,'C:\\Windows');
  assert.equal(env.HOME,'<local-user-path>');
  // Host-injected set is gone...
  for(const key of ['CODEBUDDY_SESSION_ID','CODEBUDDY_MCP_CONFIG','SERVER__PORT','SERVER__HOST','CLAUDE_PROJECT_DIR','WB_SOMETHING'])assert.equal(key in env,false,`${key} must be stripped`);
  // ...while the caller's own intentional CODEBUDDY_* overrides survive.
  assert.equal(env.CODEBUDDY_CONFIG_DIR,'C:\\isolated-home');
});

test('childEnv drops undefined values and never mutates the base',()=>{
  const base={A:'1',B:undefined};
  const env=childEnv(base);
  assert.deepEqual(env,{A:'1'});
  assert.deepEqual(Object.keys(base),['A','B']);
});

test('freeLocalPort returns a port that can immediately be bound',async()=>{
  const port=await freeLocalPort();
  assert.equal(typeof port,'number');
  assert.ok(port>0&&port<65536);
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise((resolve)=>server.close(resolve));
});
