import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {seedPointer,seedRelease} from './support/resources.mjs';
import {auditWorkspace} from '../src/domains/audit/workspace.mjs';
import {sha256File} from '../src/core/hash.mjs';

function fixture(t){
  const root=fs.mkdtempSync(join(tmpdir(),'workspace-audit-'));
  t.after(()=>{assert(resolve(root).startsWith(join(tmpdir(),'workspace-audit-')));fs.rmSync(root,{recursive:true,force:true});});
  const rows=[['tool','workflows','flow','ai-tool-registry/v2'],['agent','agents','expert','ai-agent-registry/v2'],['software','software','fixture','ai-software-registry/v1']];
  for(const [repository,section,id,schema] of rows){
    seedRelease(root,repository,id,'1.0.0');seedPointer(root,repository,id,'1.0.0');
    fs.writeFileSync(join(root,repository,'registry.json'),JSON.stringify({schema,version:1,[section]:[{id,enabled:true,current:`${id}/current.json`}]}));
  }
  return root;
}
function snapshot(root){
  const visit=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(join(directory,e.name)):[[join(directory,e.name),sha256File(join(directory,e.name))]]);
  return visit(root);
}
test('workspace audit checks registered releases without executing bodies or changing bytes',t=>{
  const root=fixture(t),before=snapshot(root),report=auditWorkspace({workspaceRoot:root});
  assert.equal(report.ok,true);assert.equal(report.productionCalls,false);assert.equal(report.readOnly,true);assert.equal(report.summary.validatedReleases,3);
  assert.deepEqual(snapshot(root),before);assert.equal(auditWorkspace({workspaceRoot:root}).digest,report.digest);
});
test('corrupted release and missing pointer are reported while the other repository still gets checked',t=>{
  const root=fixture(t);fs.appendFileSync(join(root,'tool/flow/versions/1.0.0/prompt.md'),'tamper');fs.rmSync(join(root,'agent/expert/current.json'));
  const before=snapshot(root),report=auditWorkspace({workspaceRoot:root});
  assert.equal(report.ok,false);assert(report.results.some(row=>row.error==='RELEASE_HASH_MISMATCH'));assert(report.results.some(row=>row.error==='REGISTRY_POINTER_MISSING'));
  assert(report.results.some(row=>row.target==='software/software:fixture'&&row.releaseChecked));assert.deepEqual(snapshot(root),before);
});
test('validly sealed dependency locks are audited recursively and disabled releases are not relabeled verified',t=>{
  const root=fixture(t);
  seedRelease(root,'agent','expert','1.0.0',{'tool-lock.json':{schema:'ai-tool-lock/v2',workflows:{missing:'1.0.0'}}});
  const registry=join(root,'software/registry.json'),data=JSON.parse(fs.readFileSync(registry));data.software[0].enabled=false;fs.writeFileSync(registry,JSON.stringify(data));
  const report=auditWorkspace({workspaceRoot:root});assert.equal(report.ok,false);assert(report.results.some(row=>row.target==='agent/agents:expert'&&row.error==='TARGET_VERSION_NOT_FROZEN'));
  assert.equal(report.results.find(row=>row.target==='software/software:fixture').releaseChecked,false);
});
