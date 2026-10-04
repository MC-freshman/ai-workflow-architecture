import assert from 'node:assert/strict';
import test from 'node:test';
import {requestCoordinator,scopedContext} from '../src/renderer/shared/request-coordinator.mjs';
import {taskClient} from '../src/renderer/shared/task-client.mjs';
import {convertFields} from '../src/renderer/shared/schema-fields.mjs';
import {createCommands} from '../src/renderer/features/documents/commands.mjs';
import {readFileSync} from 'node:fs';
test('late document result cannot overwrite a newer selection or a different workspace',async()=>{
  const control=requestCoordinator('first'),effects=[],pending=[];
  const context={workspace:'selected-root',setSelectedDocument:value=>effects.push(value.path),setDocumentDraft:()=>{},setSensitiveConfirmed:()=>{},setMessage:()=>{},friendlyError:error=>error.message,api:{readDocument:input=>new Promise(resolve=>pending.push(()=>resolve({path:input.relativePath,content:input.relativePath})))}};
  const commands=createCommands(),first=commands.openDocument(scopedContext(context,control.begin('document')),'old.md'),second=commands.openDocument(scopedContext(context,control.begin('document')),'new.md');pending[1]();await second;pending[0]();await first;assert.deepEqual(effects,['new.md']);
  const third=commands.openDocument(scopedContext(context,control.begin('document')),'other-workspace.md');control.updateSession('second');pending[2]();await third;assert.deepEqual(effects,['new.md']);
});
test('IPC client rejects stale asynchronous results and does not dispatch from an expired workspace',async()=>{
  let live=true,resolveReply,called=0;const api=taskClient({scanExternalBody:()=>{called++;return new Promise(resolve=>{resolveReply=resolve;});}},'session',()=>live);const result=api.scanExternalBody({workspaceRoot:'selected-root'});live=false;resolveReply({source:'old'});await assert.rejects(result,/STALE_TASK_RESULT/);assert.throws(()=>api.scanExternalBody({}),/STALE_TASK_RESULT/);assert.equal(called,1);
});
test('nested native parameters convert numbers, booleans, arrays and local references without handwritten JSON',()=>{
  const schema={type:'object',properties:{value:{$ref:'#/$defs/point'},choices:{type:'array',items:{type:'integer'}},enabled:{type:'boolean'}},$defs:{point:{type:'object',properties:{x:{type:'number'},label:{enum:['a','b']}}}}};assert.deepEqual(convertFields(schema,{value:{x:'1.5',label:'a'},choices:['2','3'],enabled:'false'}),{value:{x:1.5,label:'a'},choices:[2,3],enabled:false});assert.throws(()=>convertFields({type:'integer'},'1.2'),/SOFTWARE_ARGUMENT_INVALID/);
});
test('App composes the controller and workspace surface; commands and feature state are separate modules',()=>{
  const source=readFileSync(new URL('../src/renderer/App.jsx',import.meta.url),'utf8');assert(source.split('\n').length<15);assert(!source.includes('api.applyPlan'));for(const domain of ['documents','git','resources','software','integration'])assert(readFileSync(new URL(`../src/renderer/features/${domain}/state.mjs`,import.meta.url),'utf8').includes('useScopedState'));
});
