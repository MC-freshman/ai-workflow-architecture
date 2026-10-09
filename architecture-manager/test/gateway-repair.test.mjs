import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {join,dirname,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {gatewayBinding,assertGatewaySelection} from '../src/domains/software/gateway-binding.mjs';
import {buildGatewayMigrationPlan,applyGatewayMigration,verifyGatewayMigration} from '../src/domains/software/gateway-migration.mjs';
import {readOnboardingConfig,buildOnboardingConfigPlan,applyOnboardingConfig} from '../src/onboarding-config.mjs';
import {buildOnboardingProvidersPlan,applyOnboardingProviders} from '../src/onboarding-providers.mjs';
import {platformPath} from '../src/core/platform-path.mjs';
import {reconcileAutomaticJournal,invalidateRuntimePlan,inputInvalidations} from '../src/domains/platforms/onboarding-resume.mjs';
import {seedRuntimeReleases} from './support/resources.mjs';
import {applyPlan,verifyPlanTarget} from '../src/transactions.mjs';
import {applyGeneratedFiles} from '../src/transactions/onboarding-files.mjs';
function fixture(t){const root=fs.mkdtempSync(join(tmpdir(),'gateway-repair-')),id='local-client',auditRoot=join(root,'audit'),put=(p,v)=>{fs.mkdirSync(dirname(join(root,p)),{recursive:true});fs.writeFileSync(join(root,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};t.after(()=>fs.rmSync(root,{recursive:true,force:true}));seedRuntimeReleases(root);put('software/registry.json',{software:[{id:'app-one'},{id:'app-two'}]});for(const repo of ['tool','agent'])put(repo+'/registry.json',{});applyOnboardingConfig(buildOnboardingConfigPlan({workspaceRoot:root,platformId:id,confirmed:true,fields:{pythonExecutable:process.execPath}}),{auditRoot});const current=id+'/bridge/software-gateway-config.json',legacy=id+'/bridge/software-gateway.json',input={workspaceRoot:root,platformId:id};return {root,id,auditRoot,put,current,legacy,input};}
test('active gateway stays authoritative after Python changes; malformed historic file never blocks reads',t=>{
 const f=fixture(t);f.put(f.current,{interpreters:{'.py':process.execPath},bodies:{'app-one':process.execPath}});f.put(f.legacy,{interpreters:{'.py':'obsolete-python.exe'},bodies:{'app-one':'old.exe','app-two':process.execPath}});
 const bridgePath=join(f.root,f.id,'bridge.json'),bridge=JSON.parse(fs.readFileSync(bridgePath));bridge.runner.python='obsolete-bridge-python';f.put(f.id+'/bridge.json',bridge);
 const snap=readOnboardingConfig(f.input);assert.equal(snap.fields.pythonExecutable,process.execPath);assert.equal(snap.registeredBodies['app-one'],process.execPath);assert(!snap.registeredBodies['app-two']);assert(snap.gatewayBinding.alternatives[0].conflicts.includes('interpreters:.py'));assert(!snap.gatewayBinding.selectionRequired);assert.doesNotThrow(()=>buildOnboardingProvidersPlan(f.input));
 f.put(f.legacy,'{broken');assert.doesNotThrow(()=>readOnboardingConfig(f.input));assert(readOnboardingConfig(f.input).gatewayBinding.alternatives[0].error);
});
test('explicit migration is executable, preserves source, checks both baselines and rolls back interrupted writes',t=>{
 const f=fixture(t);f.put(f.current,{interpreters:{'.py':process.execPath},bodies:{'app-one':process.execPath}});f.put(f.legacy,{interpreters:{'.py':'legacy-python'},bodies:{'app-two':process.execPath}});const old=fs.readFileSync(join(f.root,f.legacy),'utf8'),before=fs.readFileSync(join(f.root,f.current),'utf8');
 assert.throws(()=>buildGatewayMigrationPlan({...f.input,sourcePath:f.legacy}),/SELECTION_REQUIRED/);const plan=buildGatewayMigrationPlan({...f.input,sourcePath:f.legacy,conflictChoice:'active'});
 assert.throws(()=>applyGeneratedFiles({...plan,target:{...plan.target,platformId:'other-client'}},()=>plan,{auditRoot:f.auditRoot}),/PLAN_PAYLOAD_MISMATCH/);
 assert.throws(()=>applyGatewayMigration(plan,{auditRoot:f.auditRoot,failAfterFiles:2}),/SIMULATED_INTERRUPT/);assert.equal(fs.readFileSync(join(f.root,f.current),'utf8'),before);assert.equal(fs.readFileSync(join(f.root,f.legacy),'utf8'),old);
 applyPlan({plan,auditRoot:f.auditRoot});assert(verifyPlanTarget({plan}).ok);assert.equal(readOnboardingConfig(f.input).registeredBodies['app-two'],process.execPath);assert.equal(gatewayBinding(f.root,f.id,readOnboardingConfig(f.input).config).value.interpreters['.py'],process.execPath);
 const sourcePlan=buildGatewayMigrationPlan({...f.input,sourcePath:f.legacy,conflictChoice:'source'});f.put(f.legacy,{interpreters:{'.py':'changed'}});assert.throws(()=>applyGatewayMigration(sourcePlan,{auditRoot:f.auditRoot}),/PAYLOAD_MISMATCH/);assert(verifyGatewayMigration(plan).ok);assert(fs.existsSync(join(f.auditRoot,'events.jsonl')));
});
test('unselected conflicting gateways are readable but configuration writes require explicit source choice',t=>{
 const f=fixture(t),snap=readOnboardingConfig(f.input),config={...snap.config};delete config.softwareGatewayConfig;f.put(snap.configPath,config);f.put(f.current,{interpreters:{'.py':'current'}});f.put(f.legacy,{interpreters:{'.py':'old'}});
 assert(readOnboardingConfig(f.input).gatewayBinding.selectionRequired);assert.throws(()=>buildOnboardingProvidersPlan(f.input),/SELECTION_REQUIRED/);assert.throws(()=>assertGatewaySelection(gatewayBinding(f.root,f.id,config)),/SELECTION_REQUIRED/);
 applyGatewayMigration(buildGatewayMigrationPlan({...f.input,sourcePath:f.legacy,conflictChoice:'active'}),{auditRoot:f.auditRoot});assert(!readOnboardingConfig(f.input).gatewayBinding.selectionRequired);
});
test('clearing one body and interpreter alias removes only that binding; provider refresh never restores old file values',t=>{
 const f=fixture(t);f.put(f.current,{bodies:{'app-one':process.execPath,'app-two':process.execPath},interpreterAliases:{PPython:process.execPath,other:process.execPath}});f.put(f.legacy,{bodies:{'app-one':'old.exe'}});
 applyOnboardingProviders(buildOnboardingProvidersPlan({...f.input,bodies:{'app-one':''},interpreterAliases:{PPython:''}}),{auditRoot:f.auditRoot});const snap=readOnboardingConfig(f.input);assert(!snap.registeredBodies['app-one']);assert(snap.registeredBodies['app-two']);assert(!snap.registeredInterpreterAliases.PPython);assert(snap.registeredInterpreterAliases.other);assert(fs.existsSync(process.execPath));assert.doesNotThrow(()=>buildOnboardingProvidersPlan(f.input));
});
test('private relative paths use selected workspace and reject other platforms, sibling roots and junction escapes',t=>{
 const f=fixture(t);f.put(f.id+'/bridge/private.json',{});assert.equal(platformPath(f.root,f.id,f.id+'/bridge/private.json'),resolve(f.root,f.id,'bridge/private.json'));assert.throws(()=>platformPath(f.root,f.id,'other-client/bridge/private.json'),/PATH_MISMATCH/);assert.throws(()=>platformPath(f.root,f.id,resolve(f.root,'../other-root',f.id,'bridge/x.json')),/PATH_MISMATCH/);
 const outside=fs.mkdtempSync(join(tmpdir(),'gateway-external-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,join(f.root,f.id,'bridge/junction'),'junction');assert.throws(()=>platformPath(f.root,f.id,f.id+'/bridge/junction/new.json'),/OUTSIDE_WORKSPACE/);assert.throws(()=>gatewayBinding(f.root,f.id,{softwareGatewayConfig:join(f.root,f.id,'bridge/junction/gateway.json')}),/OUTSIDE_WORKSPACE/);
});
test('reconcile invalidates stale runtime installation plan with preserved history; unrelated software changes retain it',()=>{
 const original={target:{installationId:'old',python:'old-python'}},journal={steps:[{step:'environment',status:'passed'},{step:'providers',status:'passed'}],finalTargets:{},runtimePlan:original};reconcileAutomaticJournal(journal,{invalidatedSteps:['environment','providers'],changes:[]});assert(!journal.runtimePlan);assert.deepEqual(journal.previousRuntimePlans[0].plan,original);
 const software={steps:[],runtimePlan:original,inputs:{fields:{pythonExecutable:'same'},bodies:{one:'old'}}};invalidateRuntimePlan(software,inputInvalidations(software,{fields:{pythonExecutable:'same'},bodies:{one:'new'}},{}));assert(software.runtimePlan);
});
