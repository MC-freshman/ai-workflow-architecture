import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {bridgeCompatibility,bridgeFiles,normaliseRunner} from '../src/domains/platforms/bridge-compatibility.mjs';

test('legacy bridge conflict follows the actual configuration reference and refuses an unknown authority',t=>{
  const root=mkdtempSync(join(tmpdir(),'bridge-compat-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,value)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value));};
  put('alpha/bridge.json',{platform:'alpha',runner:{version:'0.13.0'},custom:'canonical'});
  put('alpha/bridge/bridge.json',{platform:'alpha',runner:{version:'0.12.0'},custom:'legacy'});
  const selected=bridgeCompatibility(root,'alpha',{bridge:join(root,'alpha/bridge.json')});assert.equal(selected.conflicted,true);assert.equal(selected.value.custom,'canonical');
  const old=bridgeCompatibility(root,'alpha',{bridge:join(root,'alpha/bridge/bridge.json')});assert.equal(old.value.custom,'legacy');
  assert.throws(()=>bridgeCompatibility(root,'alpha',{}),/PLATFORM_BRIDGE_AUTHORITY_REQUIRED/);
  assert.throws(()=>bridgeCompatibility(root,'alpha',{bridge:join(root,'alpha/bridge/unknown.json')}),/PLATFORM_BRIDGE_REFERENCE_UNKNOWN/);
  const files=bridgeFiles(root,'alpha',selected.value,{bridge:join(root,'alpha/bridge.json')});assert.equal(files.length,2);assert.equal(files[0].content,files[1].content);
});

test('only identifiable legacy string expansion is removed; legitimate numeric custom data remains',()=>{
  const value={...'E:/ai/tool/wf-runner',enabled:true,python:'keep',custom:17};assert.deepEqual(normaliseRunner(value),{enabled:true,python:'keep',custom:17});
  assert.deepEqual(normaliseRunner({'0':17,'1':18,custom:'preserve'}),{'0':17,'1':18,custom:'preserve'});
  assert.deepEqual(normaliseRunner({'0':'a','1':'b',enabled:true}),{'0':'a','1':'b',enabled:true});
  assert.deepEqual(normaliseRunner('E:/ai/tool/wf-runner'),{});
});
