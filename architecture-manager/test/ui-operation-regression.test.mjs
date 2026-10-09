import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseSync} from 'vite';
import declarations from '../src/app/operations.json' with {type:'json'};
import * as queries from '../src/app/query-api.mjs';
import {operationRegistrar} from '../src/electron/operation-registry.mjs';

function callback(file,name,context) {
  const url=new URL(file,import.meta.url),source=readFileSync(url,'utf8');
  let selected;
  const visit=node=>{
    if(!node || typeof node!=='object') return;
    if(node.type==='VariableDeclarator' && node.id.name===name) selected=node.init;
    for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(visit); else if(value && typeof value==='object') visit(value);
  };
  visit(parseSync(url.pathname,source).program);
  assert.ok(selected, name);
  return vm.runInNewContext('('+source.slice(selected.start,selected.end)+')',context);
}

test('actual release and document callbacks pass the selected workspace to IPC',async()=>{
  const calls=[],messages=[];
  const context={workspace:'fixture-workspace',platformId:'selected-client',content:'Read supplied material.',adopt:false,runnerWorkflow:'fixture-workflow',repository:'tool',resourceId:'demo',targetVersion:'1.1.0',upgradeFrom:'',definitionOverride:'',markKind:'workflow',markId:'demo',supersededBy:'replacement',deprecationNote:'',selectedDocument:{path:'versions/demo.md'},setError:()=>{},setReferences:()=>{},setPlanPreview:()=>{},setPlanPayload:()=>{},setDiff:()=>{},setMessage:message=>messages.push(message),friendlyError:error=>error.message};
  context.api=new Proxy({}, {get:(_target,method)=>async input=>{calls.push({method,input});return {target:{destination:'destination',description:'description'},steps:[{fileCount:1}],references:[],scanned:1,payload:{afterText:'{}',changes:[]},sha256:'baseline',empty:true};}});
  for(const name of ['previewRelease','showReferences','previewMark']) await callback('../src/renderer/panels/releases.jsx',name,context)();
  await callback('../src/renderer/panels/documents.jsx','showDiff',context)();
  assert.deepEqual(calls.map(c=>c.method),['previewReleasePlan','listResourceReferences','readRegistryBaseline','previewRegistryPlan','documentDiff']);
  assert.ok(calls.every(c=>c.input.workspaceRoot===context.workspace));
  assert.equal(calls[0].input.platformId,'selected-client');assert.equal(calls[0].input.content,context.content);
  assert.ok(messages.every(message=>!message.includes('ReferenceError') && !message.includes('被拒绝') && !message.includes('失败')));
});

test('a single operation declaration controls IPC and generated standalone preload',()=>{
  const registered=[];
  const register=operationRegistrar({handle:channel=>registered.push(channel)});
  for(const op of Object.values(declarations.operations)) register(op.channel,()=>{});
  assert.equal(new Set(registered).size,Object.keys(declarations.operations).length);
  assert.throws(()=>register('unknown:execute',()=>{}),/IPC_OPERATION_UNDECLARED/);
  assert.throws(()=>register(registered[0],()=>{}),/IPC_OPERATION_UNDECLARED/);
  const source=readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8');
  assert.deepEqual([...source.matchAll(/invoke\("([^"]+)"/g)].map(m=>m[1]).sort(),registered.sort());
  assert.equal([...source.matchAll(/require\(/g)].length,1,'sandbox preload may only require electron');
  for(const name of ['healthSoftware','runOnboardingPipeline','detectRuntime']) assert.equal(queries[name],undefined,name);
});
