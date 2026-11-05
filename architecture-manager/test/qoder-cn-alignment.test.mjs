import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {discoverNativeBodies,ownNativePath,workspaceMcpEdition} from '../src/domains/platforms/native-profile.mjs';
import {FORMAL_TOP_LEVEL_DIRECTORIES} from '../src/domains/resources/inventory.mjs';
import {PLATFORM_IDS,allPlatformIds} from '../src/core/platforms.mjs';

const thrown=(fn)=>{try{fn();}catch(error){return error;}throw Error('expected the call to throw');};
function workspace(t){
  const root=mkdtempSync(join(tmpdir(),'manager-qoder-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,value='x')=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),value);};
  for(const id of ['qoder-cn','qoder'])put(`${id}/bridge.json`,JSON.stringify({schema:'ai-platform-bridge/v1.1',platform:id,shared:{readOnly:true}}));
  return {root,put};
}

test('native body discovery sees the CN executable, which carries a space in its name',(t)=>{
  const {root,put}=workspace(t);
  put('qoder-cn/Qoder CN/Qoder CN.exe');
  put('qoder/Qoder.exe');
  put('qoder-cn/notes.txt');
  const bodies=discoverNativeBodies(root,'qoder-cn').map(path=>path.slice(root.length).replaceAll('\\','/'));
  assert.deepEqual(bodies.sort(),['/qoder-cn/Qoder CN/Qoder CN.exe'],'only this platform directory is scanned');
  assert.deepEqual(discoverNativeBodies(root,'qoder').map(path=>path.slice(root.length).replaceAll('\\','/')),['/qoder/Qoder.exe']);
});
test('the CN package name maps to the Qoder vendor with a named edition; other names are untouched',()=>{
  assert.deepEqual(workspaceMcpEdition('qoder-cn'),{vendor:'Qoder',edition:'CN',label:'Qoder CN 原生工作区 MCP 配置'});
  assert.deepEqual(workspaceMcpEdition('qoder'),{vendor:'Qoder',edition:null,label:'Qoder 原生工作区 MCP 配置'});
  assert.equal(workspaceMcpEdition('@zcode/desktop').vendor,'ZCode');
  assert.equal(workspaceMcpEdition('something-else'),null,'an unknown metadata name is an interface gap, never a guess');
});
test('a body owned by another platform directory is refused with a readable way out, not a bare path error',(t)=>{
  const {root,put}=workspace(t);
  put('qoder/Qoder.exe');
  const error=thrown(()=>ownNativePath(root,'qoder-cn',join(root,'qoder/Qoder.exe')));
  assert.match(error.message,/^NATIVE_BODY_OUTSIDE_PLATFORM:/);
  assert.match(error.message,/path=qoder\/Qoder\.exe/);
  assert.match(error.message,/owner=qoder/);
  assert.match(error.message,/qoder-cn 平台目录/);
  assert.match(error.message,/外部本体例外/);
  assert.equal(ownNativePath(root,'qoder-cn',join(root,'qoder-cn/Qoder CN/Qoder CN.exe')),resolve(join(root,'qoder-cn/Qoder CN/Qoder CN.exe')));
  assert.match(thrown(()=>ownNativePath(root,'qoder-cn',join(root,'qoder-cn'))).message,/^NATIVE_CLIENT_PLATFORM_PATH_REQUIRED/,'the platform directory itself is still not a body');
  assert.match(thrown(()=>ownNativePath(root,'qoder-cn',join(root,'outside/Qoder.exe'))).message,/^NATIVE_BODY_OUTSIDE_PLATFORM:/,'any other top-level directory of this workspace is an owner-mismatch, not a path error');
});
test('the formal top-level list matches the registered platforms in both directions (D-165)',(t)=>{
  const {root}=workspace(t);
  for(const id of PLATFORM_IDS)assert.ok(FORMAL_TOP_LEVEL_DIRECTORIES.includes(id),`${id} is a formal platform`);
  assert.ok(FORMAL_TOP_LEVEL_DIRECTORIES.includes('qoder-cn'),'the registered CN platform is a formal directory');
  assert.ok(!FORMAL_TOP_LEVEL_DIRECTORIES.includes('ai学习笔记'),'a directory that never existed at top level is not formal');
  assert.deepEqual(allPlatformIds(root).filter(id=>!FORMAL_TOP_LEVEL_DIRECTORIES.includes(id)),[],'every registered platform of a workspace is covered');
  // Live workspace: the constant is the manager's reading of the governance text, so a directory
  // that no longer exists or a platform that was never added must fail here, not in the UI.
  const live=process.env.ARCHITECTURE_MANAGER_TEST_WORKSPACE || resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  for(const id of allPlatformIds(live))assert.ok(FORMAL_TOP_LEVEL_DIRECTORIES.includes(id),`${id} is registered in ${live} but missing from the formal list`);
  for(const name of FORMAL_TOP_LEVEL_DIRECTORIES)assert.ok(fs.existsSync(join(live,name)),`${name} is listed as formal but does not exist in ${live}`);
});
