import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseNativeEvents,validateNativeAiEvents,probeNativeClientWithAi} from '../src/domains/platforms/native-ai-probe.mjs';

test('native AI proof requires one genuine paired tool-use/result, never final model JSON or an ack',async()=>{
 const expected={challenge:'fresh',platformId:'p',configSha256:'c',versionsSha256:'v',releases:Object.fromEntries(['tool','agent','software'].map(repo=>[repo,{id:repo,version:'1.0.0',hashManifestSha256:repo}]))};
 const receipt={...expected,schema:'architecture-client-receipt/v1',businessRunExecuted:false,registriesRead:{tool:1,agent:1,software:1},releases:Object.fromEntries(Object.entries(expected.releases).map(([repo,pin])=>[repo,{...pin,repository:repo,readOnly:true,businessRunExecuted:false,manifestRead:true,filesRead:2}]))};
 const use={type:'assistant',message:{content:[{type:'tool_use',id:'call1',name:'mcp__architecture__architecture_verify',input:{challenge:'fresh',platformId:'p'}}]}};
 const result={type:'user',message:{content:[{type:'tool_result',tool_use_id:'call1',content:JSON.stringify(receipt)}]}};
 const events=[use,result];assert.equal(validateNativeAiEvents(events,expected).registriesRead.software,1);
 assert.throws(()=>validateNativeAiEvents([{type:'assistant',message:{content:[{type:'text',text:JSON.stringify(receipt)}]}}],expected),/TRACE_REQUIRED/);
 assert.throws(()=>validateNativeAiEvents([use,use,result],expected),/TRACE_REQUIRED/);
 assert.throws(()=>validateNativeAiEvents([use,{...result,message:{content:[{...result.message.content[0],tool_use_id:'other'}]}}],expected),/TRACE_REQUIRED/);
 assert.throws(()=>validateNativeAiEvents(events,{...expected,challenge:'replayed'}),/TRACE_REQUIRED/);
 assert.throws(()=>validateNativeAiEvents([use,{...result,message:{content:[{...result.message.content[0],content:'{"received":true}'}]}}],expected),/MISMATCH/);
 assert.deepEqual(parseNativeEvents('noise\n'+JSON.stringify(use)),[use]);
 await assert.rejects(()=>probeNativeClientWithAi({workspaceRoot:'unused',platformId:'unused'}),/CONSENT_REQUIRED/);
});

test('native auth bridge waits for credential success and never exports auth tokens',t=>{
 const root=fs.mkdtempSync(join(tmpdir(),'native-auth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const python=process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python',vendor=join(root,'vendor.py');
 fs.writeFileSync(vendor,`import json,sys,os,time\nauthenticated=False\nfor line in sys.stdin:\n r=json.loads(line)\n if str(r.get('request_id','')).startswith('initialize'): print(json.dumps({'type':'control_response','response':{'request_id':r['request_id'],'response':{}}}),flush=True)\n elif r.get('request_id')=='auth':\n  print(json.dumps({'type':'control_response','response':{'request_id':'auth','response':{'accepted':True}}}),flush=True)\n  print(json.dumps({'type':'control_request','request_id':'auth-callback','request':{'subtype':'auth_result_callback','success':True,'userinfo':{'token':'AUTH-TOKEN-MUST-NOT-EXPORT','userId':'fixture-user'}}}),flush=True)\n elif r.get('type')=='control_response':\n  time.sleep(.05)\n  authenticated=True\n  print(json.dumps({'type':'control_response','response':{'request_id':'auth','response':{'success':True}}}),flush=True)\n elif r.get('type')=='user': print(json.dumps({'type':'result','num_turns':1,'result':'user input follows authentication','sameAuthenticatedProcess':authenticated,'credentialRelay':os.environ.get('CODEBUDDY_AUTH_TOKEN')=='AUTH-TOKEN-MUST-NOT-EXPORT'}),flush=True)\n`);
 const executable=execFileSync(python,['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
 const helper=fileURLToPath(new URL('../src/runtime/native_workbuddy.py',import.meta.url));
 const stdout=execFileSync(executable,['-B',helper],{input:JSON.stringify({argv:[executable,'-B',vendor],cwd:root,prompt:'readonly'}),encoding:'utf8',windowsHide:true,timeout:15000});
 assert(!stdout.includes('AUTH-TOKEN-MUST-NOT-EXPORT'));const events=parseNativeEvents(stdout);assert.equal(events[0].type,'native_auth_ready');assert.equal(events[0].sameNativeProcess,true);assert.equal(events[0].credentialRelay,false);assert.equal(events[1].type,'native_model_request');assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).sameAuthenticatedProcess,true);assert.equal(events.at(-1).credentialRelay,false);
});
