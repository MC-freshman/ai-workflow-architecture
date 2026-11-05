import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {join} from 'node:path';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRuntimeReleases,seedRelease,seedPointer} from './support/resources.mjs';
import {nativeProfile} from '../src/domains/platforms/native-profile.mjs';
import {runtimeFile} from '../src/core/runtime-path.mjs';
import {sha256File} from '../src/core/hash.mjs';
import {classifyNativeAiFailure,collectNativeModelIds,nativeAttemptPolicy,nativeModelPin,probeNativeClientWithAi} from '../src/domains/platforms/native-ai-probe.mjs';

const TOOL='mcp__architecture__architecture_verify';
const PLATFORM='native-demo';
const thrown=(fn)=>{try{fn();}catch(error){return error;}throw Error('expected the call to throw');};
const rejected=async(fn)=>{try{return await fn();}catch(error){return error;}throw Error('expected the call to reject');};

test('the retry policy is validated before anything else happens',async()=>{
  assert.deepEqual(nativeAttemptPolicy(),{maxModelAttempts:3,retryDelaySeconds:2});
  assert.deepEqual(nativeAttemptPolicy({maxModelAttempts:1,retryDelaySeconds:0}),{maxModelAttempts:1,retryDelaySeconds:0});
  for(const bad of [{maxModelAttempts:0},{maxModelAttempts:6},{maxModelAttempts:1.5},{retryDelaySeconds:-1},{retryDelaySeconds:31},{retryDelaySeconds:'soon'}])assert.match(thrown(()=>nativeAttemptPolicy(bad)).message,/^NATIVE_ATTEMPT_POLICY_INVALID:/);
  assert.match((await rejected(()=>probeNativeClientWithAi({workspaceRoot:'unused',platformId:'unused',aiConsent:true,maxModelAttempts:9}))).message,/NATIVE_ATTEMPT_POLICY_INVALID/);
});
test('model pinning names one model, records the vendor gap and refuses a mid-attempt switch',()=>{
  assert.deepEqual(collectNativeModelIds([{type:'assistant',message:{model:'model-a'}},{type:'assistant',message:{model:'model-a'}}]),['model-a']);
  assert.deepEqual(collectNativeModelIds([{type:'assistant',message:{model:'model-a'}},{type:'result',model:'model-b'}]),['model-a','model-b']);
  assert.deepEqual(nativeModelPin([{type:'result',num_turns:1}]),{modelIds:[],model:null,modelObserved:false});
  assert.deepEqual(nativeModelPin([{type:'assistant',message:{model:'model-a'}}]),{modelIds:['model-a'],model:'model-a',modelObserved:true});
});
test('a model that prints the tool arguments is an echo, not a refusal',()=>{
  const expected={challenge:'0123456789abcdef',platformId:PLATFORM};
  const echo=[{type:'assistant',message:{content:[{type:'text',text:`I will call ${TOOL} with ${JSON.stringify({challenge:expected.challenge,platformId:PLATFORM})}`}]}}];
  assert.deepEqual(classifyNativeAiFailure(echo,expected).form,'prompt-echo');
  assert.equal(classifyNativeAiFailure(echo,expected).retryable,true);
  assert.deepEqual(classifyNativeAiFailure([{type:'assistant',message:{content:[{type:'text',text:'I cannot run tools in this session.'}]}}],expected).form,'refusal');
  assert.equal(classifyNativeAiFailure([{type:'assistant',message:{content:[{type:'text',text:'cannot help'}]}}],expected).retryable,false);
  assert.deepEqual(classifyNativeAiFailure([{type:'assistant',message:{content:[{type:'tool_use',id:'c1',name:TOOL,input:{}}]}}],expected).form,'trace-invalid');
});

// A registered WorkBuddy CLI profile built entirely from fixture files; the vendor CLI is
// replaced by an injected transport, so no child process and no model ever runs.
function nativeFixture(t){
  const root=mkdtempSync(join(tmpdir(),'manager-native-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  seedRuntimeReleases(root);
  for(const repo of ['tool','agent','software']){
    const id=`fixture-${repo}`;
    seedPointer(root,repo,id,'1.0.0');seedRelease(root,repo,id,'1.0.0');
    put(`${repo}/registry.json`,{[repo==='tool'?'workflows':repo==='agent'?'agents':'software']:[{id,current:`${id}/current.json`,enabled:true}]});
  }
  const servicePath=runtimeFile('mcp_service.py'),configPath=join(root,`${PLATFORM}/bridge/${PLATFORM}-config.json`);
  const service={executable:'fixture-python.exe',args:['-B',servicePath,configPath]};
  put(`${PLATFORM}/bridge/${PLATFORM}-config.json`,{schema:'ai-platform-config/v1',platformId:PLATFORM,runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3')});
  put(`${PLATFORM}/bridge/client-adapter.json`,{schema:'architecture-manager-client/v1',platformId:PLATFORM,kind:'cli',executable:service.executable,args:[],server:service});
  put(`${PLATFORM}/vendor/WorkBuddy.exe`,'fixture vendor body; never launched');
  put(`${PLATFORM}/vendor/resources/app.asar.unpacked/cli/product.json`,{productName:'WorkBuddy',name:'WorkBuddy'});
  put(`${PLATFORM}/vendor/resources/app.asar.unpacked/cli/bin/codebuddy`,'fixture cli entry; never launched');
  const profile=nativeProfile(root,PLATFORM,join(root,`${PLATFORM}/vendor/WorkBuddy.exe`));
  assert.equal(profile.kind,'workbuddy-cli');
  put(`${PLATFORM}/workspaces/architecture-native/.mcp.json`,{mcpServers:{architecture:{command:service.executable,args:service.args}}});
  put(`${PLATFORM}/bridge/native-client.json`,{registered:true,profile,nativeConfigSha256:sha256File(profile.configPath)});
  return {root,servicePath,profile};
}
function transportFor(root,build){
  return async()=>{
    const expected=JSON.parse(readFileSync(join(root,`${PLATFORM}/runtime/maintenance/manager-native/ai-attempt-1/challenge.json`),'utf8'));
    const events=build(expected);
    return {stdout:events.map(event=>JSON.stringify(event)).join('\n')+'\n',exitCode:0,cancelled:false,timedOut:false};
  };
}
const useEvent=(expected,model,index)=>({type:'assistant',message:{model,content:[{type:'tool_use',id:`call${index}`,name:TOOL,input:{challenge:expected.challenge,platformId:expected.platformId}}]}});
const receiptFor=(expected)=>({schema:'architecture-client-receipt/v1',challenge:expected.challenge,platformId:expected.platformId,configSha256:expected.configSha256,versionsSha256:expected.versionsSha256,businessRunExecuted:false,registriesRead:{tool:1,agent:1,software:1},releases:Object.fromEntries(Object.entries(expected.releases).map(([repo,pin])=>[repo,{...pin,repository:repo,readOnly:true,businessRunExecuted:false,manifestRead:true,filesRead:2}]))});

test('a verified attempt names its model and carries the retry policy into the attestation',async(t)=>{
  const f=nativeFixture(t);
  const result=await probeNativeClientWithAi({workspaceRoot:f.root,platformId:PLATFORM,aiConsent:true,attemptId:'attempt-1',maxModelAttempts:2,retryDelaySeconds:0},{launch:transportFor(f.root,(expected)=>[{type:'native_auth_ready'},{type:'native_model_request',modelRequestSubmitted:true},useEvent(expected,'claude-fixture',1),{type:'user',message:{content:[{type:'tool_result',tool_use_id:'call1',content:JSON.stringify(receiptFor(expected))}]}},{type:'result',num_turns:1,is_error:false}])});
  assert.equal(result.status,'native-read-verified');
  assert.equal(result.model,'claude-fixture');
  assert.equal(result.modelObserved,true);
  assert.equal(result.maxModelAttempts,2);
  assert.equal(result.retryDelaySeconds,0);
  assert.equal(result.modelAttempts,1);
  const marker=JSON.parse(readFileSync(join(f.root,`${PLATFORM}/runtime/maintenance/manager-native/ai-attempt-1/attempt.json`),'utf8'));
  assert.equal(marker.maxModelAttempts,2);
  assert.equal(marker.model,'claude-fixture');
});
test('a model that echoes the tool arguments is reported as retryable, not as a failed check',async(t)=>{
  const f=nativeFixture(t);
  const error=await rejected(()=>probeNativeClientWithAi({workspaceRoot:f.root,platformId:PLATFORM,aiConsent:true,attemptId:'attempt-1'},{launch:transportFor(f.root,(expected)=>[{type:'native_auth_ready'},{type:'native_model_request',modelRequestSubmitted:true},{type:'assistant',message:{model:'claude-weak',content:[{type:'text',text:`Sure: ${TOOL}(${JSON.stringify({challenge:expected.challenge,platformId:expected.platformId})})`}]}},{type:'result',num_turns:1,is_error:false}])}));
  assert.match(error.message,/^NATIVE_AI_PROMPT_ECHOED:/);
  assert.doesNotMatch(error.message,/TOOL_TRACE_REQUIRED/);
  const failed=JSON.parse(readFileSync(join(f.root,`${PLATFORM}/runtime/maintenance/manager-native/ai-attempt-1/failed.json`),'utf8'));
  assert.equal(failed.form,'prompt-echo');
  assert.equal(failed.retryable,true);
  assert.equal(failed.model,'claude-weak');
  assert.equal(failed.maxModelAttempts,3,'the default budget is recorded even when the attempt fails');
});
test('two models inside one attempt cannot be pinned and the attempt is refused',async(t)=>{
  const f=nativeFixture(t);
  const error=await rejected(()=>probeNativeClientWithAi({workspaceRoot:f.root,platformId:PLATFORM,aiConsent:true,attemptId:'attempt-1'},{launch:transportFor(f.root,(expected)=>[{type:'native_auth_ready'},{type:'native_model_request',modelRequestSubmitted:true},useEvent(expected,'claude-first',1),{type:'assistant',message:{model:'claude-second',content:[{type:'text',text:'retrying'}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'call1',content:JSON.stringify(receiptFor(expected))}]}},{type:'result',num_turns:2,is_error:false}])}));
  assert.match(error.message,/^NATIVE_AI_MODEL_DRIFT:/);
  assert.match(error.message,/claude-first,claude-second/);
});
