import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {seedRuntimeReleases} from './support/resources.mjs';
import {buildOnboardingConfigPlan,applyOnboardingConfig,readOnboardingConfig} from '../src/domains/onboarding/onboarding-config.mjs';
import {buildOnboardingClientPlan,applyOnboardingClient,probeOnboardingClient} from '../src/domains/onboarding/onboarding-client.mjs';
import {buildOnboardingAttestationPlan,applyOnboardingAttestation,verifyOnboardingAttestation} from '../src/domains/onboarding/onboarding-attestation.mjs';
import {sha256} from '../src/core/hash.mjs';

const python=process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python';
test('the probe candidate drops stale false gates without changing live capability bytes',()=>{
  const script=`import importlib.util,json\nspec=importlib.util.spec_from_file_location('probe',${JSON.stringify(fileURLToPath(new URL('../src/runtime/capability_probe.py',import.meta.url)))})\np=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)\nlive={'checks':{'runner-protocol-prepare':False,'other-failure':False,'already-proved':True,'not-a-boolean':1},'descriptor':{'actions':{'prompt':{'supported':False}}}}\nbefore=json.dumps(live,sort_keys=True)\ncandidate=p.probe_candidate(live,'unit-probe-evidence')\nassert before==json.dumps(live,sort_keys=True)\nassert candidate['checks']=={'already-proved':True,'manager-jail-probed':True}\nassert candidate['descriptor']['actions']['prompt']['supported'] is True\nprint(json.dumps({'liveUnchanged':True,'candidateChecks':candidate['checks']}))`;
  const result=JSON.parse(execFileSync(python,['-B','-c',script],{encoding:'utf8',windowsHide:true}));assert(result.liveUnchanged);
});

test('attestation clears only proven legacy names and a current real client receipt; drift restores the gap',async t=>{
  const root=fs.mkdtempSync(join(tmpdir(),'onboarding-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(path,value)=>{fs.mkdirSync(dirname(join(root,path)),{recursive:true});fs.writeFileSync(join(root,path),JSON.stringify(value,null,2)+'\n');};
  seedRuntimeReleases(root);for(const [repo,key] of [['tool','workflows'],['agent','agents'],['software','software']])put(repo+'/registry.json',{[key]:[]});
  const platformId='evidence-client',input={workspaceRoot:root,platformId},auditRoot=join(root,'audit');
  const executable=execFileSync(python,['-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim();
  applyOnboardingConfig(buildOnboardingConfigPlan({...input,confirmed:true,fields:{pythonExecutable:executable}}),{auditRoot});
  applyOnboardingClient(buildOnboardingClientPlan(input),{auditRoot});const receipt=await probeOnboardingClient(input);assert.equal(receipt.status,'passed');
  const snapshot=readOnboardingConfig(input),path=platformId+'/bridge/capabilities.json',live=JSON.parse(fs.readFileSync(join(root,path)));
  live.checks={'runner-protocol-prepare':false,'unrelated-failure':false};live.unverified={'runner-protocol-prepare':'old','unknown-gap':'keep'};
  live.declaredAbsent={'sealed-script-environment':'not proved','peer-dispatch':'not proved','software-face':'not proved','mcp-tool-surface':'old'};put(path,live);
  const relative=platformId+'/runtime/maintenance/manager-onboarding/capabilities/fixture/probe.json',evidencePath=join(root,relative);
  // This unit fixture tests registration; it is never a production platform attestation.
  put(relative,{platformId,configSha256:sha256(fs.readFileSync(join(root,snapshot.configPath))),checks:{'prompt-stage-claim':true,peerDispatch:false,'software-call':false,'script-environment-isolation-jail':false},prompt:{prepareOk:true,stopOk:true},software:[]});
  const plan=buildOnboardingAttestationPlan({...input,evidencePath});applyOnboardingAttestation(plan,{auditRoot});assert(verifyOnboardingAttestation(plan).ok);
  const saved=JSON.parse(fs.readFileSync(join(root,path)));assert.equal(saved.checks['runner-protocol-prepare'],true);assert.equal(saved.checks['unrelated-failure'],false);assert(!Object.hasOwn(saved.unverified,'runner-protocol-prepare'));assert(saved.unverified['unknown-gap']);
  assert(!Object.hasOwn(saved.declaredAbsent,'mcp-tool-surface'));for(const key of ['sealed-script-environment','peer-dispatch','software-face'])assert(saved.declaredAbsent[key]);assert(saved.resolvedLegacyGaps['mcp-tool-surface'].evidenceSha256);
  saved.declaredAbsent['mcp-tool-surface']='must be retested';put(path,saved);const adapterPath=platformId+'/bridge/client-adapter.json',adapter=JSON.parse(fs.readFileSync(join(root,adapterPath)));adapter.userComment='changed since the receipt';put(adapterPath,adapter);
  const rejectedEvidence=buildOnboardingAttestationPlan({...input,evidencePath});const updated=JSON.parse(rejectedEvidence.payload.files.find(row=>row.path===path).content);assert.equal(updated.declaredAbsent['mcp-tool-surface'],'must be retested');
});
