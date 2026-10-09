import {existsSync,readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {targetPath,defaultAuditRoot} from '../../core/paths.mjs';
import {platformPath} from '../../core/platform-path.mjs';
import {sha256} from '../../core/hash.mjs';
import {readJson} from '../../core/json.mjs';
import {atomicWrite,requirePlan,writeAudit,saveCheckpoint} from '../../transactions/kernel.mjs';
import {plannedFiles,applyGeneratedFiles} from '../../transactions/onboarding-files.mjs';
import {restoreOwnedFiles} from '../../transactions/recovery.mjs';
import {startOnboardingJob,requestOnboardingCancellation} from '../../core/onboarding-jobs.mjs';
import {platformConfigPath,privateBindingHashes} from '../certification/binding.mjs';
import {buildAnchorAlignmentPlan} from '../certification/anchor-plans.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {collectResourceRequirements,resourceEnvironmentMatches,prepareResourceEnvironment} from './resource-environment.mjs';
import {buildOnboardingRuntimePlan,applyOnboardingRuntime} from '../../onboarding-runtime.mjs';
import {buildOnboardingGovernancePlan,applyOnboardingGovernance} from '../../onboarding-governance.mjs';
import {runPlatformCheck} from '../../platform-check.mjs';
import {nativeClientStatus,probeNativeClient} from './native-client.mjs';
import {buildGitPlan} from '../../git.mjs';
import {applyGitTransaction} from '../../git-executor.mjs';
import {assertConfigurationReferences} from '../../onboarding-config.mjs';

const encode=value=>JSON.stringify(value,null,2)+'\n';
const digest=value=>sha256(encode(value));
const hashFile=path=>existsSync(path)?sha256(readFileSync(path)):null;
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024}).trim();
const ID=/^[a-z0-9][a-z0-9._-]*$/i;
const cancelled=error=>['ONBOARDING_CANCELLED','TASK_CANCELLED'].includes(error.message);
function current(root,repo,id,files) {
  const path=`${repo}/${id}/current.json`,pointer=readJson(targetPath(root,path));
  validateFrozenResource(root,repo,id,pointer.version);
  files[path]=hashFile(targetPath(root,path));
  return {id,version:pointer.version,path:`${repo}/${id}/versions/${pointer.version}`};
}
export function sharedUpdateTarget(root) {
  const files={},resources=[],registries={};
  for(const repo of ['tool','agent','software']) {
    files[`${repo}/registry.json`]=hashFile(targetPath(root,`${repo}/registry.json`));registries[repo]=readJson(targetPath(root,`${repo}/registry.json`));
    for(const entry of registries[repo][{tool:'workflows',agent:'agents',software:'software'}[repo]] || []) {
      if(entry.enabled===false || entry.deprecated || !ID.test(entry.id))continue;
      const path=`${repo}/${entry.current || entry.id+'/current.json'}`;
      const pointer=readJson(targetPath(root,path));files[path]=hashFile(targetPath(root,path));
      resources.push({repository:repo,id:entry.id,version:pointer.version});
    }
  }
  const axis=(id)=>current(root,'tool',id,files);
  const engine=axis('wf-runner'),checker=axis('repo-lint'),contracts=axis('runtime-contracts'),conformance=axis('platform-conformance');
  let judge=axis('architecture-ops');
  const manifest=readJson(targetPath(root,engine.path+'/manifest.json'));
  if(manifest.dependencies?.workflows?.['repo-lint']!==checker.version)throw Error('VERSION_PAIR_MISMATCH');
  if(manifest.interface?.['x-invocationSmoke']==='ai-invocation-smoke/v1' && readJson(targetPath(root,judge.path+'/manifest.json')).interface?.invocationSmoke!=='ai-invocation-smoke/v1') {
    const path=targetPath(root,'versions/anchor.json');
    const declared=existsSync(path)?readJson(path).judge:null;
    if(!declared || readJson(targetPath(root,declared.path+'/manifest.json')).interface?.invocationSmoke!=='ai-invocation-smoke/v1')throw Error('VERSION_PAIR_MISMATCH');
    validateFrozenResource(root,'tool','architecture-ops',declared.version);files['versions/anchor.json']=hashFile(path);
    judge={id:'architecture-ops',version:declared.version,path:declared.path,resolvedFrom:'workspace-declared-anchor'};
  }
  const connector=current(root,'software','_connector',files),gateway=current(root,'software','_gateway',files);
  const software={connector:connector.version,gateway:gateway.version,recipes:resources.filter(r=>r.repository==='software')};
  const anchor={engine,checker,contracts,judge,conformance,software};
  return {anchor,files,resources,digest:digest({anchor,files,resources})};
}
function assertShared(root,target) {
  for(const [path,hash] of Object.entries(target.files))if(hashFile(targetPath(root,path))!==hash)throw Error('GLOBAL_UPDATE_SHARED_CHANGED');
}
function platformRows(root) {
  return readdirSync(root,{withFileTypes:true}).filter(row=>row.isDirectory() && ID.test(row.name) && existsSync(targetPath(root,row.name+'/bridge.json'))).map(row=>row.name).sort();
}
function platformPlan(root,id,target,settings={}) {
  const bridgePath=`${id}/bridge.json`,configPath=relative(root,platformConfigPath(root,id)).replaceAll('\\','/');
  const config=readJson(targetPath(root,configPath)),bridge=readJson(targetPath(root,bridgePath));
  if(bridge.platform!==id || !config.runner || !existsSync(join(config.runner,'cli.py')) || !config.capabilities)throw Error('PLATFORM_NOT_PREVIOUSLY_CONNECTED');
  assertConfigurationReferences(config);assertConfigurationReferences(bridge);
  const alignment=buildAnchorAlignmentPlan({workspaceRoot:root,platformId:id,targetAnchor:target.anchor});
  const proposed=Object.fromEntries(alignment.payload.files.map(file=>[file.path,JSON.parse(file.content)]));
  const nextConfig=proposed[configPath] || structuredClone(config),nextBridge=proposed[bridgePath] || structuredClone(bridge);
  const retained=settings.retain || [];
  nextBridge.defaults ||= {};
  const overrides=[];
  for(const [repository,key] of [['tool','workflowVersions'],['agent','agentVersions']]) {
    nextBridge.defaults[key]={...nextBridge.defaults[key]};
    for(const [id,value] of Object.entries(nextBridge.defaults[key])) {
      if(repository==='tool' && ['wf-runner','repo-lint','architecture-ops'].includes(id))continue;
      const shared=target.resources.find(row=>row.repository===repository && row.id===id);
      if(!shared)continue;
      const keep=retained.includes(repository+':'+id);overrides.push({repository,id,previous:value,target:keep?value:shared.version,retained:keep});
      if(!keep)delete nextBridge.defaults[key][id];
    }
  }
  const resources=target.resources.map(row=>({...row,version:nextBridge.defaults[row.repository==='agent'?'agentVersions':'workflowVersions']?.[row.id] || row.version}));
  const requirements=collectResourceRequirements(root,resources);
  const window=Number(settings.contextWindowTokens || config.contextWindowTokens);
  const pending=[];
  if(!Number.isSafeInteger(window) || window<=0)pending.push('CONTEXT_WINDOW_REQUIRED');
  else {nextConfig.contextWindowTokens=window;nextConfig.contextWindowSource=settings.contextWindowSource || config.contextWindowSource || 'existing-platform-declaration';}
  const python=settings.pythonExecutable || config.interpreters?.['.py'] || bridge.runner?.python;
  if(!python || !existsSync(python))pending.push('RUNTIME_COMPATIBLE_PYTHON_REQUIRED');
  const basePaths=[bridgePath,configPath];
  const privateBindings=privateBindingHashes(root,id,config);
  for(const profile of requirements.profiles)if(profile!=='portable-resource-python')pending.push('RESOURCE_PROFILE_ADAPTER_REQUIRED:'+profile);
  return {platformId:id,targetDigest:target.digest,configPath,bridgePath,python,nextConfig,nextBridge,requirements,overrides,pending,privateBindings,
    wheelhouse:settings.wheelhouse || null,settings,baseFiles:basePaths.map(path=>({path,beforeSha256:hashFile(targetPath(root,path))})),
    resources,sourceDigest:digest({target:target.digest,privateBindings,config:hashFile(targetPath(root,configPath)),bridge:hashFile(targetPath(root,bridgePath)),settings})};
}
export function buildGlobalUpdatePlan({workspaceRoot,settings={},push=null,resumePlan=null,now=new Date().toISOString()}) {
  if(resumePlan) {
    requirePlan(resumePlan);if(resumePlan.kind!=='platform-global-update' || resumePlan.workspaceRoot!==workspaceRoot)throw Error('INVALID_TRANSACTION_PLAN');
    assertShared(workspaceRoot,resumePlan.payload.shared);
    if(Object.keys(settings).some(id=>digest(settings[id])!==digest(resumePlan.payload.platforms.find(row=>row.platformId===id)?.settings || {})))return buildGlobalUpdatePlan({workspaceRoot,settings,push,now});
    const payload={...resumePlan.payload,push:push===null?resumePlan.payload.push:push===true};return {...resumePlan,payload,target:{...resumePlan.target,payloadSha256:digest(payload)},resuming:true};
  }
  const shared=sharedUpdateTarget(workspaceRoot),platforms=[],skipped=[];
  for(const id of platformRows(workspaceRoot)) {
    try {platforms.push(platformPlan(workspaceRoot,id,shared,settings[id] || {}));}
    catch(error) {skipped.push({platformId:id,reason:error.message});}
  }
  if(!platforms.length)throw Error('GLOBAL_UPDATE_NO_CONNECTED_PLATFORMS');
  const governanceFiles=Object.fromEntries(['AGENTS.md','AI_ARCHITECTURE_SYSTEM_PROMPT.md','HANDOFF.md','versions/平台接入清单.md','versions/更新日志.md','.gitignore'].map(path=>[path,hashFile(targetPath(workspaceRoot,path))]));
  const payload={shared,platforms,skipped,push:push===true,governanceFiles};
  return {schema:'architecture-manager-plan/v1',kind:'platform-global-update',planId:'global-update-'+randomUUID(),workspaceRoot,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,
    target:{platformIds:platforms.map(row=>row.platformId),sharedDigest:shared.digest,payloadSha256:digest(payload),scope:'all-existing-platforms'},payload,
    steps:platforms.map(row=>({operation:'更新三仓接入',target:row.platformId,pending:row.pending,overrides:row.overrides,resourcePackages:row.requirements.packages})),verification:['one confirmation for all existing platforms','independent real evidence and rollback','no changes to shared current or in-flight run locks']};
}
const statePath=(root,id,planId)=>targetPath(root,`${id}/runtime/maintenance/manager-updates/${planId}.json`);
const historyPath=(root,auditRoot)=>join(auditRoot,'global-updates',sha256(root)+'.json');
export function readGlobalUpdateHistory({workspaceRoot,auditRoot=defaultAuditRoot()}) {
  const path=historyPath(workspaceRoot,auditRoot);if(!existsSync(path))return null;
  const history=readJson(path),plan=history.plan;
  if(plan.workspaceRoot!==workspaceRoot)throw Error('PLATFORM_SCOPE_MISMATCH');
  return {plan,result:{status:'recorded',results:plan.payload.platforms.map(row=>{const file=statePath(workspaceRoot,row.platformId,plan.planId);return existsSync(file)?readJson(file):{platformId:row.platformId,status:'not-started'};}),skipped:plan.payload.skipped}};
}
function checkBindings(root,id,result) {
  return ['conformPath','matrixPath'].filter(key=>result?.[key]).map(key=>({path:platformPath(root,id,result[key]),sha256:hashFile(platformPath(root,id,result[key]))}));
}
function evidenceFresh(root,row,state) {
  return state.targetDigest===row.targetDigest && state.requirementsDigest===row.requirements.digest && state.finalBinding===digest(privateBindingHashes(root,row.platformId,readJson(targetPath(root,row.configPath)))) && state.checkBindings?.length===2 && state.checkBindings.every(file=>hashFile(platformPath(root,row.platformId,file.path))===file.sha256);
}
function saveState(root,row,state) {const path=statePath(root,row.platformId,state.planId);mkdirSync(join(path,'..'),{recursive:true});atomicWrite(path,encode(state),randomUUID());return path;}
function commitFiles(root,paths,message,options) {
  if(!paths.length)return {head:git(root,'rev-parse','HEAD'),committedAt:git(root,'show','-s','--format=%cI','HEAD')};
  const staged=git(root,'diff','--cached','--name-only','-z').split('\0').filter(Boolean);
  if(staged.some(path=>!paths.includes(path)))throw Error('GIT_UNRELATED_STAGED_FILES');
  if(git(root,'status','--porcelain','--',...paths))applyGitTransaction({plan:buildGitPlan({workspaceRoot:root,action:'commit',paths,message}),...options});
  return {head:git(root,'rev-parse','HEAD'),committedAt:git(root,'show','-s','--format=%cI','HEAD')};
}
function governanceStatus(root) {
  const raw=execFileSync('git',['-C',root,'status','--porcelain=v1','-z','--untracked-files=all'],{encoding:'utf8',windowsHide:true});
  return raw.split('\0').filter(Boolean).map(row=>row.slice(3)).filter(path=>/^(tool|agent|software|versions|docs-site)\//.test(path) || /^[^/]+\/bridge(?:\/|\.json$)/.test(path) || !path.includes('/') && (path.endsWith('.md') || ['.gitignore','.gitattributes'].includes(path)));
}
function baselineUnchanged(root,row,state) {
  const expected=(state?.activated?state.finalFiles:row.baseFiles).filter(file=>file.path.startsWith(row.platformId+'/'));
  if(expected.some(file=>hashFile(targetPath(root,file.path))!==(state?.activated?file.newSha256:file.beforeSha256)))throw Error('EXTERNAL_CHANGE_DETECTED');
  if(!state?.activated && digest(privateBindingHashes(root,row.platformId,readJson(targetPath(root,row.configPath))))!==digest(row.privateBindings))throw Error('EXTERNAL_CHANGE_DETECTED');
}
async function prepareEnvironments(plan,row,state,control,options) {
  const root=plan.workspaceRoot;
  if(!state.foundation) {
    const manifest=row.nextConfig.environmentManifest && existsSync(platformPath(root,row.platformId,row.nextConfig.environmentManifest))?readJson(row.nextConfig.environmentManifest):{};
    const existingPackages=Object.fromEntries(Object.entries(manifest.packages || {}).map(([name,pin])=>[name.toLowerCase().replace(/[-_.]+/g,'-'),pin]));
    const matches=Object.entries(row.requirements.legacyPackages).every(([name,pin])=>existingPackages[name]===pin);
    if(matches)state.foundation={status:'reused'};
    else {
      state.foundationPlan ||= buildOnboardingRuntimePlan({workspaceRoot:root,platformId:row.platformId,fields:{pythonExecutable:row.python,executionBackend:row.nextConfig.executionBackend},installationId:state.foundationId});
      saveState(root,row,state);
      state.foundation=await applyOnboardingRuntime(state.foundationPlan,{...options,registerCancel:control.registerCancel,activateConfiguration:false});
    }
    saveState(root,row,state);
  }
  control.assertActive();
  if(!state.resource) {
    if(resourceEnvironmentMatches(root,row.platformId,row.nextConfig.resourceEnvironmentManifest,row.requirements))state.resource={status:'reused',manifest:row.nextConfig.resourceEnvironmentManifest};
    else state.resource=await prepareResourceEnvironment({workspaceRoot:root,platformId:row.platformId,python:row.python,requirements:row.requirements,installationId:state.resourceId,wheelhouse:row.wheelhouse},{...options,registerCancel:control.registerCancel});
    saveState(root,row,state);
  }
}
function activationPlan(plan,row,state) {
  const root=plan.workspaceRoot,config=structuredClone(row.nextConfig),bridge=structuredClone(row.nextBridge),files=[];
  if(state.foundation?.preparedFields) {
    const f=state.foundation.preparedFields;config.environmentManifest=f.environmentManifest;config.scriptEnvironment=f.scriptEnvironment;
    config.interpreters={...config.interpreters,'.py':f.pythonExecutable};bridge.runner={...bridge.runner,python:f.pythonExecutable};
    config.scriptEnvironmentRungs=[{execPath:'kernel-sandbox',executionBackend:f.executionBackend,scriptEnvironment:f.scriptEnvironment,requiresSealedEnvironment:true}];
  }
  if(state.resource?.manifest)config.resourceEnvironmentManifest=state.resource.manifest;
  for(const [path,value] of [[row.configPath,config],[row.bridgePath,bridge]])if(hashFile(targetPath(root,path))!==sha256(encode(value)))files.push({path,content:encode(value)});
  if(state.resource?.result) {
    const path=relative(root,platformPath(root,row.platformId,config.capabilities)).replaceAll('\\','/'),caps=readJson(targetPath(root,path));
    caps.profiles ||= {};caps.descriptor ||= {};caps.descriptor.profiles ||= {};caps.declaredAbsent ||= {};
    for(const profile of row.requirements.profiles) {
      const declaration={declared:true,adapters:['verified-resource-environment'],evidencePath:state.resource.result.restoreEvidence,evidenceSha256:state.resource.result.restoreEvidenceSha256};
      caps.profiles[profile]=declaration;caps.descriptor.profiles[profile]=declaration;delete caps.declaredAbsent['profile:'+profile];
    }
    files.push({path,content:encode(caps)});
  }
  const proposed=plannedFiles(root,files);
  return {schema:'architecture-manager-plan/v1',kind:'platform-update-activation',planId:plan.planId+'-'+row.platformId,workspaceRoot:root,generatedAt:plan.generatedAt,applyMode:'confirmation-required',writePerformed:false,target:{platformId:row.platformId},payload:{files:proposed},steps:proposed.map(file=>({operation:'activate-paired-update',target:file.path}))};
}
export async function applyGlobalUpdate(plan,{actor='local-user',auditRoot=defaultAuditRoot(),onProgress=()=>{},services={}}={}) {
  requirePlan(plan);if(plan.kind!=='platform-global-update' || digest(plan.payload)!==plan.target.payloadSha256)throw Error('PLAN_PAYLOAD_MISMATCH');
  const root=plan.workspaceRoot;assertShared(root,plan.payload.shared);
  const control=startOnboardingJob(root,'global-update'),results=[],options={actor,auditRoot,onProgress};
  const history=historyPath(root,auditRoot),previousHistory=existsSync(history)?readJson(history):null;mkdirSync(join(history,'..'),{recursive:true});atomicWrite(history,encode({plan}),randomUUID());
  const governanceHashes=previousHistory?.plan?.planId===plan.planId?previousHistory.governanceHashes || {...plan.payload.governanceFiles}:{...plan.payload.governanceFiles};
  const persistHistory=()=>atomicWrite(history,encode({plan,governanceHashes}),randomUUID());
  const assertGovernance=()=>{for(const [path,hash] of Object.entries(governanceHashes))if(hashFile(targetPath(root,path))!==hash)throw Error('GLOBAL_UPDATE_WORKSPACE_CHANGED');};
  const prepare=services.prepare || prepareEnvironments,check=services.check || runPlatformCheck;
  try {
    for(const row of plan.payload.platforms) {
      control.assertActive();assertShared(root,plan.payload.shared);assertGovernance();
      const path=statePath(root,row.platformId,plan.planId);
      let state=existsSync(path)?readJson(path):{schema:'architecture-manager-platform-update/v1',planId:plan.planId,platformId:row.platformId,sourceDigest:row.sourceDigest,status:'prepared',foundationId:randomUUID(),resourceId:randomUUID()};
      if(state.status==='prepared' && previousHistory?.plan?.planId!==plan.planId) {
        const previousPath=previousHistory?.plan?statePath(root,row.platformId,previousHistory.plan.planId):null;
        const prior=previousPath && existsSync(previousPath)?readJson(previousPath):null;
        if(prior && ['complete','no-change'].includes(prior.status) && evidenceFresh(root,row,prior) && prior.finalFiles.filter(file=>file.path.startsWith(row.platformId+'/')).every(file=>hashFile(targetPath(root,file.path))===file.newSha256) && sha256(encode(row.nextConfig))===hashFile(targetPath(root,row.configPath)) && sha256(encode(row.nextBridge))===hashFile(targetPath(root,row.bridgePath))) {
          state={...prior,planId:plan.planId,sourceDigest:row.sourceDigest,status:'no-change',beforeFiles:[],reusedFrom:prior.planId};saveState(root,row,state);
        }
      }
      if(state.sourceDigest!==row.sourceDigest)throw Error('ONBOARDING_RESUME_DRIFT');
      if(state.status==='restored')throw Error('GLOBAL_UPDATE_ALREADY_RESTORED');
      if(['complete','no-change'].includes(state.status)) {baselineUnchanged(root,row,state);if(!evidenceFresh(root,row,state))throw Error('GLOBAL_UPDATE_EVIDENCE_CHANGED');results.push(state);continue;}
      if(state.status==='validated-awaiting-push' && evidenceFresh(root,row,state)){baselineUnchanged(root,row,state);results.push(state);continue;}
      onProgress({platformId:'global-update',phase:`更新 ${row.platformId}`,completed:results.length,total:plan.payload.platforms.length});
      try {
        baselineUnchanged(root,row,state);
        if(row.pending.length)throw Error(row.pending.join(','));
        if(!state.activated) {
          const verified=collectResourceRequirements(root,row.resources);if(verified.digest!==row.requirements.digest)throw Error('GLOBAL_UPDATE_SHARED_CHANGED');
          state.baseline ||= commitFiles(root,row.baseFiles.map(file=>file.path),`Save ${row.platformId} before three-repository update`,options);
          state.status='preparing-environment';saveState(root,row,state);
          await prepare(plan,row,state,control,{...options,onProgress:progress=>onProgress({...progress,platformId:'global-update',targetPlatformId:row.platformId})});
          control.assertActive();assertShared(root,plan.payload.shared);baselineUnchanged(root,row,state);
          const activation=activationPlan(plan,row,state);
          state.beforeFiles=activation.payload.files.map(file=>({...file,before:existsSync(targetPath(root,file.path))?readFileSync(targetPath(root,file.path),'utf8'):null}));
          state.finalFiles=activation.payload.files;
          const checkpoint=saveCheckpoint(auditRoot,plan.planId+'-'+row.platformId,encode({platformId:row.platformId,files:state.beforeFiles}));state.checkpoint=checkpoint;
          state.status='activating';saveState(root,row,state);
          if(activation.payload.files.length)await applyGeneratedFiles(activation,()=>activation,options);
          state.activated=true;state.activatedAt=new Date().toISOString();saveState(root,row,state);
        }
        control.assertActive();
        state.status='checking';saveState(root,row,state);
        const checked=await check({workspaceRoot:root,platformId:row.platformId,mode:'full',stopOnFloorFailure:true,registerCancel:control.registerCancel,onProgress:progress=>onProgress({...progress,platformId:'global-update',targetPlatformId:row.platformId})});
        control.assertActive();assertShared(root,plan.payload.shared);
        state.check=checked;state.checkBindings=checkBindings(root,row.platformId,checked);state.targetDigest=plan.payload.shared.digest;state.requirementsDigest=row.requirements.digest;
        if(!['callable','complete'].includes(checked.stage) || checked.coverageComplete!==true || checked.issues?.length) {state.status='pending';state.pending=checked.issues?.length?checked.issues:['CAPABILITY_FLOOR_OR_CALL_CHECK_PENDING'];state.git=commitFiles(root,state.finalFiles.map(file=>file.path),'Save pending '+row.platformId+' integration update',options);saveState(root,row,state);results.push(state);continue;}
        let native=services.nativeStatus?services.nativeStatus(root,row.platformId):nativeClientStatus(root,row.platformId);
        if(!services.nativeStatus && !native.nativeVendorClientVerified && native.registered && native.profile?.supportsDirectProbe)native=await probeNativeClient({workspaceRoot:root,platformId:row.platformId},{registerCancel:control.registerCancel});
        control.assertActive();assertShared(root,plan.payload.shared);state.native=native;
        if(!native.nativeVendorClientVerified){state.status='pending';state.pending=['NATIVE_CLIENT_VERIFICATION_REQUIRED'];state.git=commitFiles(root,state.finalFiles.map(file=>file.path),'Save '+row.platformId+' update pending native validation',options);saveState(root,row,state);results.push(state);continue;}
        const governance=services.governance?await services.governance(root,row.platformId):buildOnboardingGovernancePlan({workspaceRoot:root,platformId:row.platformId});
        assertGovernance();
        if(governance?.payload?.files?.length) {
          const before=governance.payload.files.map(file=>({...file,before:existsSync(targetPath(root,file.path))?readFileSync(targetPath(root,file.path),'utf8'):null}));
          await applyOnboardingGovernance(governance,options);
          state.beforeFiles.push(...before);state.finalFiles.push(...governance.payload.files);
          for(const file of governance.payload.files)governanceHashes[file.path]=file.newSha256;
          persistHistory();
        }
        const paths=[...new Set([...row.baseFiles.map(file=>file.path),...state.finalFiles.map(file=>file.path),...(governance?.payload?.files || []).map(file=>file.path)])];
        state.git=commitFiles(root,paths,`Update ${row.platformId} three-repository integration`,options);
        state.finalBinding=digest(privateBindingHashes(root,row.platformId,readJson(targetPath(root,row.configPath))));
        state.status='validated-awaiting-push';saveState(root,row,state);
        results.push(state);
      } catch(error) {
        if(cancelled(error)){state.status='stopped';saveState(root,row,state);throw error;}
        if(error.message==='GLOBAL_UPDATE_SHARED_CHANGED')throw error;
        if(state.status==='activating' && state.beforeFiles) {
          state.recovery=restoreOwnedFiles(state.beforeFiles.map(file=>({target:targetPath(root,file.path),before:file.before,afterSha256:file.newSha256})),plan.planId);
          state.activated=false;
        }
        state.status=state.recovery?.ok?'failed-restored':/EXTERNAL_CHANGE/.test(error.message)?'external-change':'pending';state.error=error.message;
        saveState(root,row,state);results.push(state);
      }
    }
    const ready=results.filter(row=>row.status==='validated-awaiting-push');
    control.assertActive();assertShared(root,plan.payload.shared);assertGovernance();
    if(results.some(row=>row.git) && plan.payload.push) {
      try {
        applyGitTransaction({plan:buildGitPlan({workspaceRoot:root,action:'push'}),...options});
        const head=git(root,'rev-parse','HEAD'),branch=git(root,'branch','--show-current'),remoteHead=git(root,'ls-remote','origin','refs/heads/'+branch).split(/\s+/)[0];
        if(remoteHead!==head)throw Error('GIT_REMOTE_READBACK_FAILED');
        const whitelist=governanceStatus(root);
        for(const state of ready) {
          const timeOrdered=new Date(state.baseline.committedAt)<=new Date(state.activatedAt);
          state.git={...state.git,finalHead:head,remoteHead,remoteEqualsLocal:true,whitelistStatus:whitelist,whitelistStatusEmpty:!whitelist.length,rollbackCommit:state.baseline.head,rollbackCommitPrecedesActivation:timeOrdered};
          state.status=!whitelist.length && timeOrdered?'complete':'validated-awaiting-push';if(state.status!=='complete')state.pending=['GIT_FINAL_READBACK_REQUIRED'];
          saveState(root,plan.payload.platforms.find(row=>row.platformId===state.platformId),state);
        }
      }catch(error) {for(const state of ready){state.pending=['GIT_PUSH_REQUIRED'];state.error=error.message;saveState(root,plan.payload.platforms.find(row=>row.platformId===state.platformId),state);}}
    }
    const report={schema:'architecture-manager-global-update/v1',planId:plan.planId,status:results.every(row=>['complete','no-change'].includes(row.status))?'complete':'pending',results,skipped:plan.payload.skipped,writePerformed:true};
    atomicWrite(history,encode({plan,result:report,governanceHashes}),randomUUID());
    writeAudit({...options,transactionId:plan.planId,plan,action:plan.kind,status:report.status,target:plan.target.platformIds.join(','),writePerformed:true});return report;
  }catch(error) {
    if(cancelled(error))return {schema:'architecture-manager-global-update/v1',planId:plan.planId,status:'stopped',results:plan.payload.platforms.map(row=>{const path=statePath(root,row.platformId,plan.planId);return existsSync(path)?readJson(path):{platformId:row.platformId,status:'not-started'};}),skipped:plan.payload.skipped,writePerformed:true};
    throw error;
  }finally{control.finish();}
}
export function cancelGlobalUpdate({workspaceRoot}) {return requestOnboardingCancellation(workspaceRoot,'global-update');}
export function verifyGlobalUpdate(plan) {
  const results=plan.payload.platforms.map(row=>{const path=statePath(plan.workspaceRoot,row.platformId,plan.planId);return existsSync(path)?readJson(path):{platformId:row.platformId,status:'not-started'};});
  return {ok:results.every(row=>['complete','no-change'].includes(row.status)),results,writePerformed:false};
}
export function buildGlobalUpdateRestorePlan({workspaceRoot,updatePlan}) {
  requirePlan(updatePlan);if(updatePlan.workspaceRoot!==workspaceRoot)throw Error('INVALID_TRANSACTION_PLAN');
  const byPath=new Map();
  for(const row of updatePlan.payload.platforms){const path=statePath(workspaceRoot,row.platformId,updatePlan.planId);if(!existsSync(path))continue;const state=readJson(path);for(const file of state.beforeFiles || [])byPath.set(file.path,{...file,platformId:row.platformId,before:byPath.has(file.path)?byPath.get(file.path).before:file.before});}
  const files=[...byPath.values()];
  return {schema:'architecture-manager-plan/v1',kind:'platform-global-update-restore',planId:'restore-'+randomUUID(),workspaceRoot,generatedAt:new Date().toISOString(),applyMode:'confirmation-required',writePerformed:false,target:{updatePlanId:updatePlan.planId,payloadSha256:digest(files)},payload:{files},steps:files.map(file=>({operation:'恢复旧接入配置',target:file.path}))};
}
export function applyGlobalUpdateRestore(plan,options={}) {
  requirePlan(plan);if(digest(plan.payload.files)!==plan.target.payloadSha256)throw Error('PLAN_PAYLOAD_MISMATCH');
  const restored=restoreOwnedFiles(plan.payload.files.map(file=>({target:file.path.startsWith(file.platformId+'/')?platformPath(plan.workspaceRoot,file.platformId,targetPath(plan.workspaceRoot,file.path)):targetPath(plan.workspaceRoot,file.path),before:file.before,afterSha256:file.newSha256})),plan.planId);
  if(restored.ok && plan.payload.files.length)commitFiles(plan.workspaceRoot,[...new Set(plan.payload.files.map(file=>file.path))],'Restore previous three-repository platform configuration',options);
  if(restored.ok) {
    const history=historyPath(plan.workspaceRoot,options.auditRoot || defaultAuditRoot());
    if(existsSync(history)) {
      const previous=readJson(history);
      if(previous.plan.planId===plan.target.updatePlanId) {
        for(const row of previous.plan.payload.platforms) {
          const path=statePath(plan.workspaceRoot,row.platformId,plan.target.updatePlanId);
          if(existsSync(path)){const state=readJson(path);state.status='restored';state.activated=false;state.restoredAt=new Date().toISOString();saveState(plan.workspaceRoot,row,state);}
        }
        previous.governanceHashes=Object.fromEntries(Object.keys(previous.plan.payload.governanceFiles).map(path=>[path,hashFile(targetPath(plan.workspaceRoot,path))]));
        atomicWrite(history,encode(previous),randomUUID());
      }
    }
  }
  writeAudit({actor:options.actor || 'local-user',auditRoot:options.auditRoot || defaultAuditRoot(),now:new Date().toISOString(),transactionId:plan.planId,plan,action:plan.kind,status:restored.ok?'restored':'external-change',target:plan.target.updatePlanId,writePerformed:restored.ok});return restored;
}
