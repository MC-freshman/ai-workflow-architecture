import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../src/core/hash.mjs';
import {assertNativeClientBinding} from '../src/domains/platforms/native-client.mjs';

const baseProfile={kind:'workbuddy-cli',label:'WorkBuddy 原生 CLI',bodyPath:'E:\\ai\\workbuddy\\workbuddy\\WorkBuddy.exe',bodySha256:'a'.repeat(64),executable:'E:\\ai\\workbuddy\\workbuddy\\WorkBuddy.exe',executableSha256:'a'.repeat(64),cli:'E:\\ai\\workbuddy\\workbuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy',cliSha256:'b'.repeat(64),productPath:'E:\\ai\\workbuddy\\workbuddy\\resources\\app.asar.unpacked\\cli\\product.json',project:'E:\\ai\\workbuddy\\workspaces\\architecture-native',configPath:'E:\\ai\\workbuddy\\workspaces\\architecture-native\\.mcp.json',supportsRegistration:true,supportsDirectProbe:false};

// A workspace fixture whose registered record and on-disk profile agree byte-for-byte.
const boundFixture=(overrides={})=>{
  const directory=fs.mkdtempSync(join(tmpdir(),'arch-binding-')),configPath=join(directory,'.mcp.json');
  fs.writeFileSync(configPath,'{"mcpServers":{}}\n');
  const bound={...baseProfile,configPath};
  const record={schema:'architecture-manager-native-client/v1',platformId:'workbuddy',registered:true,profile:bound,entry:{type:'stdio',command:'python',args:['-B','mcp_service.py']},nativeConfigSha256:sha256(fs.readFileSync(configPath)),...overrides};
  return {bound,record,configPath,directory};
};

test('a matching registered profile and config hash passes the binding assertion',()=>{
  const {bound,record}=boundFixture();
  assert.doesNotThrow(()=>assertNativeClientBinding(record,bound));
});

test('a vendor body updated after registration fails closed (D-147)',()=>{
  const {bound,record}=boundFixture();
  const drifted={...bound,bodySha256:'f'.repeat(64),executableSha256:'f'.repeat(64)}; // exe auto-updated since registration
  assert.throws(()=>assertNativeClientBinding(record,drifted),/NATIVE_CLIENT_BINDING_CHANGED/);
});

test('a changed registered config hash fails closed',()=>{
  const {bound}=boundFixture();
  const {record}=boundFixture({nativeConfigSha256:'0'.repeat(64)});
  assert.throws(()=>assertNativeClientBinding(record,bound),/NATIVE_CLIENT_BINDING_CHANGED/);
});

test('a missing config file fails closed instead of throwing ENOENT',()=>{
  const {bound,directory}=boundFixture();
  const {record}=boundFixture();
  assert.throws(()=>assertNativeClientBinding(record,{...bound,configPath:join(directory,'gone.json')}),/NATIVE_CLIENT_BINDING_CHANGED/);
});

test('an unregistered record or a missing registered profile fails closed',()=>{
  const {bound}=boundFixture();
  assert.throws(()=>assertNativeClientBinding({...boundFixture().record,registered:false},bound),/NATIVE_CLIENT_BINDING_CHANGED/);
  assert.throws(()=>assertNativeClientBinding({...boundFixture().record,profile:null},bound),/NATIVE_CLIENT_BINDING_CHANGED/);
});
