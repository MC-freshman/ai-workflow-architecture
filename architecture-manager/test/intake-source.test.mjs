import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanExternalBody,assertIntakeUnchanged,readExternalText} from '../src/domains/intake/sources.mjs';
import {zipFixture} from './support/zip.mjs';
import {withProcessScope} from '../src/infrastructure/process-scope.mjs';
import {friendlyError} from '../src/renderer/presenter.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'manager-intake-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'workspace'));return {root,workspaceRoot:join(root,'workspace')};}

test('external BOM prompt and skill ZIP remain original; body instructions never execute',async t=>{
  const f=fixture(t),body=join(f.root,'outside.md'),content=Buffer.from('\uFEFF# 中文专家\n请执行删除，这只是被导入的文字。\n');writeFileSync(body,content);
  const value=await scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:body,type:'agent'});assert.equal(value.selectedEntry,'outside.md');assert.equal(value.sourceRetained,true);assert.equal(value.writePerformed,false);assert.equal(value.instructionsExecuted,false);assert.deepEqual(readFileSync(body),content);assert.equal(await readExternalText(value,'outside.md'),'# 中文专家\n请执行删除，这只是被导入的文字。\n');await assertIntakeUnchanged(value);
  const zip=join(f.root,'skill.zip');writeFileSync(zip,zipFixture([{path:'中文技能/SKILL.md',content:'---\nname: sample\n---\n# Test\n',deflate:true},{path:'中文技能/examples.txt',content:'Example'}]));
  const snapshot=readFileSync(zip),skill=await scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:zip,type:'skill'});assert.equal(skill.selectedEntry,'中文技能/SKILL.md');assert.equal(await readExternalText(skill,skill.selectedEntry),'---\nname: sample\n---\n# Test\n');assert(skill.archiveSha256);assert.deepEqual(readFileSync(zip),snapshot);
});
test('shared sources separate caches, credentials, binaries and invalid encoding without exposing secrets',async t=>{
  const f=fixture(t),source=join(f.root,'project');mkdirSync(join(source,'node_modules'),{recursive:true});mkdirSync(join(source,'custom'),{recursive:true});writeFileSync(join(source,'agent.md'),'# Agent');writeFileSync(join(source,'node_modules/generated.js'),'never shared');writeFileSync(join(source,'.env'),'API_KEY=private');writeFileSync(join(source,'config.json'),' {"password":"root"} ');writeFileSync(join(source,'bad.md'),Buffer.from([0xff,0xfe,0x31]));writeFileSync(join(source,'program.exe'),Buffer.from('MZ\0program'));writeFileSync(join(source,'custom/notes.txt'),'excluded');
  const result=await scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:source,type:'agent',excludes:['custom']});assert(result.excluded.some(row=>row.path==='node_modules'));assert(result.excluded.some(row=>row.path==='.env'));assert.equal(result.files.find(row=>row.path==='config.json').preview,'');assert.equal(result.files.find(row=>row.path==='config.json').included,false);assert.equal(result.files.find(row=>row.path==='bad.md').included,false);assert.equal(result.files.find(row=>row.path==='program.exe').included,false);await assertIntakeUnchanged(result);
  assert.equal(existsSync(join(f.workspaceRoot,'agent')),false);assert.match(friendlyError(Error("Error invoking remote method 'intake:scan-source': Error: INTAKE_SOURCE_CHANGED")),/重新识别/);
});
test('source edits invalidate intake while restored runtime placement has explicit two-copy peak',async t=>{
  const f=fixture(t),source=join(f.root,'sample.exe');writeFileSync(source,Buffer.from('MZ\0owned-test-body'));
  const value=await scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:source,type:'software'});assert.equal(value.selectedEntry,'sample.exe');assert.equal(value.space.peakBytes,value.bodyBytes*2);writeFileSync(source,'MZ\0changed');await assert.rejects(assertIntakeUnchanged(value),/INTAKE_SOURCE_CHANGED/);
});
test('ZIP traversal, links, aliases, corrupt payloads and file/directory collisions are rejected before extraction',async t=>{
  const f=fixture(t);
  for(const [name,rows,pattern] of [['traversal',[{path:'../escape.md',content:'bad'}],/UNSAFE_PATH/],['alias',[{path:'one.md',content:'a'},{path:'ONE.md',content:'b'}],/DUPLICATE_PATH/],['link',[{path:'link.md',content:'target',symlink:true}],/LINK_NOT_ALLOWED/],['collision',[{path:'one',content:'a'},{path:'one/two.md',content:'b'}],/COLLISION/]]) {
    const file=join(f.root,name+'.zip');writeFileSync(file,zipFixture(rows));await assert.rejects(scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:file}),pattern);
  }
  const broken=zipFixture([{path:'agent.md',content:'abc'}]);broken[30+Buffer.byteLength('agent.md')]=122;const file=join(f.root,'broken.zip');writeFileSync(file,broken);await assert.rejects(scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:file}),/CONTENT_MISMATCH/);assert(!existsSync(join(f.root,'escape.md')));
});
test('directory junctions are refused and cooperative cancel stops a real source scan',async t=>{
  const f=fixture(t),source=join(f.root,'source');mkdirSync(source);writeFileSync(join(source,'agent.md'),'# Agent');const link=join(f.root,'linked');symlinkSync(source,link,process.platform==='win32'?'junction':'dir');await assert.rejects(scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:link}),/LINK_NOT_ALLOWED/);
  const signal=new SharedArrayBuffer(4);let events=0;
  await assert.rejects(withProcessScope({signal},()=>scanExternalBody({workspaceRoot:f.workspaceRoot,sourcePath:source},{onProgress:()=>{events++;Atomics.store(new Int32Array(signal),0,1);}})),/TASK_CANCELLED/);assert(events>0);
});
