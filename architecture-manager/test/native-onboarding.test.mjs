import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {clearProvenLegacyGaps} from '../src/domains/platforms/capability-evidence.mjs';
import {nativeProfile,ownNativePath,discoverNativeBodies} from '../src/domains/platforms/native-profile.mjs';
import {validateNativeReceipt,nativeClientStatus} from '../src/domains/platforms/native-client.mjs';
import {discoverOnboardingRuntime} from '../src/domains/platforms/runtime-discovery.mjs';
import {parseJsonc} from '../src/core/jsonc.mjs';
import {nativeAttemptBlocksProof} from '../src/domains/platforms/native-attempt.mjs';
import {seedRuntimeReleases} from './support/resources.mjs';
import {buildOnboardingConfigPlan,applyOnboardingConfig} from '../src/domains/onboarding/onboarding-config.mjs';

function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'native-onboarding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const put=(path,value)=>{fs.mkdirSync(dirname(join(root,path)),{recursive:true});fs.writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value));};return {root,put,id:'native-client'};}
test('new failed or pending native verification invalidates an older success without deleting its evidence',()=>{
 const proof={checkedAt:'2026-10-07T10:00:00Z'};
 assert.equal(nativeAttemptBlocksProof({status:'failed',checkedAt:'2026-10-08T10:00:00Z'},proof),true);
 assert.equal(nativeAttemptBlocksProof({status:'pending',checkedAt:'2026-10-08T10:00:00Z'},proof),true);
 assert.equal(nativeAttemptBlocksProof({status:'passed',checkedAt:'2026-10-08T10:00:00Z'},proof),false);
 assert.equal(nativeAttemptBlocksProof({status:'failed',checkedAt:'2026-10-06T10:00:00Z'},proof),false);
});
test('native JSONC reader preserves URL/comment-shaped strings and rejects unclosed comments',()=>{
 const value=parseJsonc('{/* comment */"url":"https://localhost/a//b", "quoted":"/* keep */", "array":[1,], // comment\n}');assert.equal(value.url,'https://localhost/a//b');assert.equal(value.quoted,'/* keep */');assert.deepEqual(value.array,[1]);assert.throws(()=>parseJsonc('{/* unfinished'),/INVALID/);
});
test('proved permissions remove the precise old absence, stronger and unproved declarations survive',()=>{
 const key='permission-triple:platform-runtime-write-shared-read-only/deny/isolated-python',stronger='permission-triple:all/allow/all';
 const state={declaredAbsent:{[key]:'old',[stronger]:'must keep',peerDispatch:'old'},unverified:{[key]:'old'}};
 clearProvenLegacyGaps(state,{proof:{checks:{'script-environment-isolation-jail':false}},now:'first'});assert(state.declaredAbsent[key]);
 clearProvenLegacyGaps(state,{proof:{checks:{'script-environment-isolation-jail':true}},evidencePath:'actual-proof',evidenceSha256:'digest',now:'second'});assert(!state.declaredAbsent[key]);assert(!state.unverified[key]);assert(state.declaredAbsent[stronger]);assert(state.declaredAbsent.peerDispatch);assert.equal(state.resolvedLegacyGaps[key].evidencePath,'actual-proof');
});
test('native body discovery uses interface artifacts and rejects cross-platform paths',t=>{
 const f=fixture(t);f.put(f.id+'/app/Client.exe','body');f.put(f.id+'/app/resources/codex.exe','native-cli');
 assert.equal(nativeProfile(f.root,f.id,join(f.root,f.id,'app/Client.exe')).kind,'codex-app-server');
 f.put(f.id+'/unknown.exe','not a registered interface');assert.equal(nativeProfile(f.root,f.id,join(f.root,f.id,'unknown.exe')).supportsRegistration,false);
 // D-163: a body under another platform's directory is a placement decision, reported with the
 // owning directory and the two ways out instead of a bare path rejection.
 f.put('other/Client.exe','foreign');const crossed=(()=>{try{ownNativePath(f.root,f.id,join(f.root,'other/Client.exe'));}catch(error){return error;}return null;})();
 assert.ok(crossed);assert.match(crossed.message,/NATIVE_BODY_OUTSIDE_PLATFORM/);assert.match(crossed.message,/owner=other/);assert.match(crossed.message,/path=other\/Client\.exe/);
 assert.equal(nativeClientStatus(f.root,f.id).nativeVendorClientVerified,false);
});
test('native discovery sees a nearby installed program before source directories exhaust the scan budget',t=>{
 const f=fixture(t);for(let n=0;n<160;n++)f.put(f.id+'/aaa-source/branch-'+n+'/nested/readme.txt','source');f.put(f.id+'/installed/DeepSeek Harness.exe','body');
 assert(discoverNativeBodies(f.root,f.id).some(path=>path.endsWith('DeepSeek Harness.exe')));
});
test('native receipt refuses facade acknowledgement, replay, software omission and model-turn claims',()=>{
 const pins=Object.fromEntries(['tool','agent','software'].map(repo=>[repo,{id:repo+'-resource',version:'1.0.0',hashManifestSha256:'digest'}]));
 const expected={challenge:'new',platformId:'client',configSha256:'config',versionsSha256:'versions',releases:pins};
 const receipt={...expected,schema:'architecture-client-receipt/v1',businessRunExecuted:false,registriesRead:{tool:2,agent:1,software:3}};
 const tool=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
 const releases=Object.fromEntries(Object.entries(pins).map(([repo,pin])=>[repo,tool({...pin,repository:repo,files:{'manifest.json':'{}'},readOnly:true,businessRunExecuted:false})]));
 const response={receipt:tool(receipt),resources:tool({tool:{},agent:{},software:{}}),releases,transport:'vendor-app-server',modelTurnStarted:false};
 assert.equal(validateNativeReceipt(response,expected).registriesRead.software,3);
 assert.throws(()=>validateNativeReceipt({...response,receipt:tool({received:true})},expected),/MISMATCH/);
 assert.throws(()=>validateNativeReceipt(response,{...expected,challenge:'other'}),/MISMATCH/);
 assert.throws(()=>validateNativeReceipt({...response,resources:tool({tool:{},agent:{}})},expected),/THREE_REPOS/);
 assert.throws(()=>validateNativeReceipt({...response,modelTurnStarted:true},expected),/MISMATCH/);
 assert.throws(()=>validateNativeReceipt({...response,transport:'mcp-stdio'},expected),/MISMATCH/);
});
test('automatic discovery rejects old host/guest versions and selects real compatible facilities',async t=>{
 const f=fixture(t);seedRuntimeReleases(f.root);const executable=execFileSync(process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python',['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
 applyOnboardingConfig(buildOnboardingConfigPlan({workspaceRoot:f.root,platformId:f.id,confirmed:true,fields:{pythonExecutable:executable}}),{auditRoot:join(f.root,'audit')});
 const probe=async()=>({python:{version:[3,12,4]},wslExecutable:'fixture-wsl',distributions:['wrong','right']});
 const result=await discoverOnboardingRuntime({workspaceRoot:f.root,platformId:f.id},{probe,guestRun:async(_path,args)=>({stdout:args.includes('wrong')?'[3,12,1]':'[3,10,12]'})});
 assert.equal(result.backendFields.distro,'right');assert.equal(result.pythonExecutable,executable);assert.equal(result.writePerformed,false);
 const missing=await discoverOnboardingRuntime({workspaceRoot:f.root,platformId:f.id},{probe:async()=>({python:{version:[3,9,13]},distributions:[]})});assert.equal(missing.pythonExecutable,null);assert.equal(missing.backendFields,null);assert.equal(missing.issues.length,2);
});
test('Windows private config backup restores real bytes and never stores plaintext credentials',{skip:process.platform!=='win32'},t=>{
 const f=fixture(t),input=join(f.root,'secret.toml'),backupPath=join(f.root,'backup.json');fs.writeFileSync(input,'token = "fixture-secret-only"');
 const python=process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python',helper=fileURLToPath(new URL('../src/runtime/native_client.py',import.meta.url));
 const invoke=spec=>JSON.parse(execFileSync(python,['-B',helper],{input:JSON.stringify(spec),encoding:'utf8',windowsHide:true}));
 assert.equal(invoke({operation:'backup',configPath:input,backupPath}).backupRestoreVerified,true);assert(!fs.readFileSync(backupPath,'utf8').includes('fixture-secret-only'));assert(!fs.existsSync(backupPath.replace('.json','.restore-drill')));
 fs.writeFileSync(input,'changed');assert.equal(invoke({operation:'restore',backupPath}).ok,true);assert.equal(fs.readFileSync(input,'utf8'),'token = "fixture-secret-only"');
});
