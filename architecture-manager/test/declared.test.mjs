import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {declaredVersion,declaredDefaults,declarationTargets,resolvedCellVersion} from '../src/domains/certification/declared.mjs';
import {buildMatrixArgs} from '../src/platform-check.mjs';

function seedPlatform(root,platformId,{workflowVersions={},agentVersions=null}={}) {
  mkdirSync(join(root,platformId,'bridge'),{recursive:true});
  const defaults={workflowVersions};
  if(agentVersions) defaults.agentVersions=agentVersions;
  writeFileSync(join(root,platformId,'bridge.json'),JSON.stringify({schema:'ai-platform-bridge/v1.1',platform:platformId,defaults},null,2)+'\n');
}

test('a declared version is read from either a bare version or a release path',()=>{
  assert.equal(declaredVersion('0.6.5'),'0.6.5');
  assert.equal(declaredVersion('E:\\ai\\tool\\repo-lint\\versions\\0.6.5'),'0.6.5');
  assert.equal(declaredVersion('E:/ai/tool/repo-lint/versions/0.6.5'),'0.6.5');
  assert.equal(declaredVersion(''),null);
  assert.equal(declaredVersion(null),null);
  assert.equal(declaredVersion('not-a-version'),null);
  assert.equal(declaredVersion('E:/ai/tool/repo-lint/versions/current'),null,'a moving pointer is not an exact version');
});

test('only the cells whose version the platform declares are overridden',(t)=>{
  const root=mkdtempSync(join(tmpdir(),'declared-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedPlatform(root,'one-client',{workflowVersions:{'repo-lint':'E:/ai/tool/repo-lint/versions/0.6.5','novel-writer':'2.1.1'},agentVersions:{'novel-writer':'4.0.1'}});
  const defaults=declaredDefaults({workspaceRoot:root,platformId:'one-client'});
  assert.deepEqual(defaults.workflow,{'repo-lint':'0.6.5','novel-writer':'2.1.1'});
  assert.deepEqual(defaults.agent,{'novel-writer':'4.0.1'});
  // A cell with no declaration is left alone: the matrix keeps the shared pointer for it.
  assert.deepEqual(declarationTargets({workspaceRoot:root,platformId:'one-client',keys:['workflow:repo-lint','workflow:expert-task','agent:novel-writer']}),
    ['agent:novel-writer@4.0.1','workflow:repo-lint@0.6.5']);
  assert.deepEqual(declarationTargets({workspaceRoot:root,platformId:'one-client',keys:['workflow:expert-task']}),[]);
  assert.equal(resolvedCellVersion({workspaceRoot:root,platformId:'one-client',kind:'workflow',id:'repo-lint',pointerVersion:'0.6.3'}),'0.6.5');
  assert.equal(resolvedCellVersion({workspaceRoot:root,platformId:'one-client',kind:'workflow',id:'expert-task',pointerVersion:'1.1.0'}),'1.1.0');
});

test('a platform without a bridge declaration overrides nothing',(t)=>{
  const root=mkdtempSync(join(tmpdir(),'declared-none-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'bare-client'),{recursive:true});
  assert.deepEqual(declaredDefaults({workspaceRoot:root,platformId:'bare-client'}),{workflow:{},agent:{}});
  assert.deepEqual(declarationTargets({workspaceRoot:root,platformId:'bare-client',keys:['workflow:repo-lint']}),[]);
  assert.equal(resolvedCellVersion({workspaceRoot:root,platformId:'bare-client',kind:'workflow',id:'repo-lint',pointerVersion:'0.6.3'}),'0.6.3');
});

// The judge command line is the contract that broke: the matrix used the shared pointer for a cell
// whose platform declares another version. This asserts the command actually carries the override.
function matrixArgsFor(root,platformId,{selection,only=null}={}) {
  return buildMatrixArgs({configPath:join(root,platformId,'bridge','runner-config.json'),out:join(root,platformId,'runtime','manager-check','fixture'),matrixPath:join(root,platformId,'runtime','manager-check','fixture','matrix.json'),matrix:'E:/ai/tool/architecture-ops/versions/1.5.2/architecture_ops/invocation_matrix.py',exceptionsPath:null,selection,only,platformId,workspaceRoot:root});
}

test('the judge command line carries the platform declaration instead of the shared pointer',(t)=>{
  const root=mkdtempSync(join(tmpdir(),'declared-args-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  seedPlatform(root,'dsh-like',{workflowVersions:{'repo-lint':'E:/ai/tool/repo-lint/versions/0.6.5'}});
  const full={kind:'full',selected:['workflow:repo-lint','workflow:expert-task','agent:novel-writer']};
  const args=matrixArgsFor(root,'dsh-like',{selection:full});
  const at=args.indexOf('--targets');
  assert.notEqual(at,-1,'the judge must be told which version the platform uses');
  assert.equal(args[at+1],'workflow:repo-lint@0.6.5','only declared cells are overridden, at the declared version');
  assert.equal(args.includes('--only'),false,'a full matrix is not narrowed');

  const narrowed={kind:'smoke',selected:['workflow:repo-lint']};
  const narrowedArgs=matrixArgsFor(root,'dsh-like',{selection:narrowed,only:'workflow:repo-lint'});
  assert.deepEqual(narrowedArgs.slice(narrowedArgs.indexOf('--only'),narrowedArgs.indexOf('--only')+2),['--only','workflow:repo-lint']);
  assert.deepEqual(narrowedArgs.slice(narrowedArgs.indexOf('--targets'),narrowedArgs.indexOf('--targets')+2),['--targets','workflow:repo-lint@0.6.5']);

  seedPlatform(root,'legacy-like',{workflowVersions:{}});
  const legacyArgs=matrixArgsFor(root,'legacy-like',{selection:full});
  assert.equal(legacyArgs.includes('--targets'),false,'a platform that declares nothing keeps the shared default unchanged');
});
