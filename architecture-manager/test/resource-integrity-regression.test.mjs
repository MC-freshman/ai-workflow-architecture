import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {sha256} from '../src/core/hash.mjs';
import {readJson} from '../src/core/json.mjs';
import {assertPublishedVersion,buildResourcePointerPlan} from '../src/plans.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
import {buildIntegrationPlan} from '../src/integration.mjs';
import {buildReleasePlan} from '../src/releases.mjs';
import {validateResourceContent} from '../src/domains/resources/contracts.mjs';
import {resolveRecipeVersion,verifySoftwareRecipe} from '../src/software-publish.mjs';

function fixture(t) {const root=mkdtempSync(join(tmpdir(),'am-resource-regression-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('am-resource-regression-'));rmSync(root,{recursive:true,force:true});});return root;}
function pointerPlan(root) {return buildResourcePointerPlan({workspaceRoot:root,repository:'tool',resourceId:'demo',currentVersion:'1.0.0',targetVersion:'1.1.0',availableVersions:['1.0.0','1.1.0'],baselineSha256:sha256(readFileSync(join(root,'tool/demo/current.json')))});}
test('frozen versions are checked at preview, application and readback',t=>{
  const root=fixture(t);seedPointer(root,'tool','demo','1.0.0');const release=seedRelease(root,'tool','demo','1.1.0');
  const plan=pointerPlan(root),before=readFileSync(join(root,'tool/demo/current.json'),'utf8');
  const original=readFileSync(join(release,'prompt.md'));
  writeFileSync(join(release,'prompt.md'),'changed after seal');
  assert.throws(()=>pointerPlan(root),/RELEASE_HASH_MISMATCH/);
  assert.throws(()=>applyPlan({plan,auditRoot:join(root,'audit')}),/RELEASE_HASH_MISMATCH/);
  assert.equal(readFileSync(join(root,'tool/demo/current.json'),'utf8'),before);
  writeFileSync(join(release,'prompt.md'),original);applyPlan({plan,auditRoot:join(root,'audit')});assert.equal(verifyPlanTarget({plan}).ok,true);
  writeFileSync(join(release,'unlisted.md'),'extra');assert.equal(verifyPlanTarget({plan}).ok,false);
});
test('valid JSON is insufficient for registry editing; structural errors never write',t=>{
  const root=fixture(t);mkdirSync(join(root,'tool'));const file=join(root,'tool/registry.json');const before=JSON.stringify({schema:'ai-tool-registry/v2',version:1,workflows:[]});writeFileSync(file,before);
  const input={workspaceRoot:root,kind:'tool',targetId:'__registry__',mode:'registry',relativePath:'tool/registry.json',baselineSha256:sha256(before)};
  for(const afterText of ['{"unrelated":true}',JSON.stringify({schema:'ai-tool-registry/v2',version:2,workflows:[{id:'bad',enabled:true,current:'../elsewhere/current.json'}]})]) assert.throws(()=>buildIntegrationPlan({...input,afterText}),/REGISTRY_/);
  assert.equal(readFileSync(file,'utf8'),before);
});
test('software next version is semantic and extra files fail recipe verification',t=>{
  const root=fixture(t);for(const version of ['1.9.9','1.10.0']) mkdirSync(join(root,'software/demo/versions',version),{recursive:true});
  assert.equal(resolveRecipeVersion(root,'demo',null),'1.10.1');
  const directory=seedRelease(root,'software','demo','1.10.1');seedPointer(root,'software','demo','1.10.1');
  writeFileSync(join(root,'software/registry.json'),JSON.stringify({software:[{id:'demo'}]}));
  const connector=join(root,'connector.json');writeFileSync(connector,JSON.stringify({bodies:{demo:'fixture-path'}}));
  const plan={kind:'software-recipe-publish',workspaceRoot:root,target:{path:directory,softwareId:'demo',version:'1.10.1',connectorConfigPath:connector,bodyPath:'fixture-path'},payload:{files:{}}};
  assert.equal(verifySoftwareRecipe({plan}).ok,true);
  writeFileSync(join(directory,'unlisted.py'),'# extra');assert.equal(verifySoftwareRecipe({plan}).ok,false);
});
test('wrong templates and upgrade definition identities fail before publication',t=>{
  const root=fixture(t);seedPointer(root,'tool','demo','1.0.0');seedRelease(root,'tool','demo','1.0.0');
  assert.throws(()=>validateResourceContent({repository:'tool',resourceId:'demo',version:'1.1.0',read:()=>JSON.stringify({schema:'ai-tool-manifest/v2',id:'demo',version:'1.1.0'}),has:()=>true}),/RESOURCE_SCHEMA_INVALID/);
  const release=join(root,'tool/demo/versions/1.0.0'),get=name=>readFileSync(join(release,name),'utf8');const manifest=JSON.parse(get('manifest.json'));manifest.version='1.1.0';
  assert.throws(()=>validateResourceContent({repository:'tool',resourceId:'demo',version:'1.1.0',read:name=>name==='manifest.json'?JSON.stringify(manifest):get(name),has:()=>true}),/WORKFLOW_IDENTITY_MISMATCH/);
});
test('BOM JSON and precise dependency pins are handled without changing source bytes',t=>{
  const root=fixture(t),file=join(root,'bom.json');writeFileSync(file,'\uFEFF{"ok":true}');const before=sha256(readFileSync(file));assert.equal(readJson(file).ok,true);assert.equal(sha256(readFileSync(file)),before);
  seedRelease(root,'tool','dependency','1.0.0');
  seedRelease(root,'tool','demo','1.0.0',{'manifest.json':{schema:'ai-workflow/v2.1',id:'demo',version:'1.0.0',mode:'pipeline',entry:'workflow.yaml',inputSchema:'schemas/input.json',outputSchema:'schemas/output.json',permissions:{filesystem:'read',network:'deny',process:'deny'},dependencies:{workflows:{dependency:'current'}},integrity:{sha256Manifest:'SHA256SUMS'}}});
  assert.throws(()=>assertPublishedVersion(root,'tool','demo','1.0.0'),/RESOURCE_DEPENDENCY_NOT_PINNED/);
});
