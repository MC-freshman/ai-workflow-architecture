// Plans that turn the anchored generation into files. Two write scopes only:
//   * versions/anchor.json  — the anchor itself (materialisation);
//   * <platform>/bridge.json + <platform>/bridge/<id>-config.json — the platform version pins.
// Everything else in a platform configuration is preserved verbatim, and each plan refuses to apply
// unless its own input hash and a byte baseline match, so a plan prepared against another state
// cannot be applied to this one.
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,join,relative} from 'node:path';
import {platformConfigPath} from './binding.mjs';
import {sha256} from '../../core/hash.mjs';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {createAnchorPlan,replaceConfigPlan} from '../../plans.mjs';
import {requirePlan,atomicWrite,saveCheckpoint,makeId,writeAudit,output} from '../../transactions/kernel.mjs';
import {defaultAuditRoot} from '../../core/paths.mjs';
import {ANCHOR_RELATIVE_PATH,anchorAlignment,anchorContent,anchorDigest,computeAnchor,readAnchorState} from './anchor.mjs';

const stringify=(value)=>`${JSON.stringify(value,null,2)}\n`;

// The anchor is written only when it differs from what the workspace already records: regenerating
// with a new timestamp is not a change, and a no-change plan must never touch a file.
export function buildAnchorMaterialisationPlan({workspaceRoot,now=new Date().toISOString()}) {
  const root=targetPath(workspaceRoot,'.');
  const anchor=computeAnchor({workspaceRoot:root,now});
  const digest=anchorDigest(anchor);
  const current=readAnchorState({workspaceRoot:root});
  if(current.exists && current.digest===digest) return {schema:'architecture-manager-plan/v1',kind:'anchor-generation',planId:`anchor-noop-${randomUUID()}`,workspaceRoot:root,generatedAt:now,applyMode:'confirmation-required',writePerformed:false,target:{anchorDigest:digest,noChange:true},payload:{files:[],anchor},steps:[],verification:['anchor already matches this workspace'],changed:false};
  const path=targetPath(root,ANCHOR_RELATIVE_PATH);
  const content=anchorContent(anchor);
  const plan=createAnchorPlan({workspaceRoot:root,digest,relativePath:ANCHOR_RELATIVE_PATH,path,content,beforeSha256:existsSync(path)?sha256(readFileSync(path)):null,now});
  plan.payload={files:[{path:ANCHOR_RELATIVE_PATH,content,beforeSha256:existsSync(path)?sha256(readFileSync(path)):null,newSha256:sha256(content)}],anchor,rejected:anchor.rejected};
  plan.changed=true;
  return plan;
}

export function applyAnchorMaterialisation(plan,{actor='local-user',auditRoot=defaultAuditRoot(),now=new Date().toISOString()}={}) {
  requirePlan(plan);
  if(plan.target?.noChange) return output({schema:'architecture-manager-transaction/v1',status:'no-change',planId:plan.planId,writePerformed:false},null);
  const rebuilt=buildAnchorMaterialisationPlan({workspaceRoot:plan.workspaceRoot,now:plan.generatedAt});
  if(anchorDigest(rebuilt.payload.anchor)!==anchorDigest(plan.payload.anchor)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const file=plan.payload.files[0];
  const target=targetPath(plan.workspaceRoot,file.path);
  const actual=existsSync(target)?sha256(readFileSync(target)):null;
  // Re-applying a plan whose bytes are already on disk is an answer, not a conflict: the baseline is
  // only wrong when the file is neither what the plan expected nor what the plan wanted.
  if(actual===file.newSha256) return output({schema:'architecture-manager-transaction/v1',status:'already-applied',planId:plan.planId,transactionId:makeId(plan,now),target:plan.target.anchorDigest,writePerformed:false},null);
  if(actual!==file.beforeSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const previous=actual===null?null:readFileSync(target,'utf8');
  const id=makeId(plan,now);
  const checkpoint=saveCheckpoint(auditRoot,id,stringify({schema:'anchor-checkpoint/v1',workspaceRoot:plan.workspaceRoot,files:[{path:file.path,before:previous}]}));
  try {
    mkdirSync(dirname(target),{recursive:true});
    atomicWrite(target,file.content,id);
    const verification=verifyAnchorMaterialisation(plan);
    if(!verification.ok) throw new Error('ANCHOR_READBACK_FAILED');
    return output(writeAudit({actor,auditRoot,now,transactionId:id,plan,action:plan.kind,status:'applied',target:plan.target.anchorDigest,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,newSha256:sha256(file.content),writePerformed:true}),checkpoint.path);
  } catch (error) {
    if(existsSync(target) && sha256(readFileSync(target))===file.newSha256) {
      if(previous===null) atomicWrite(target,'',id); else atomicWrite(target,previous,id);
    }
    writeAudit({actor,auditRoot,now,transactionId:id,plan,action:plan.kind,status:'failed-restored',target:plan.target.anchorDigest,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,error:String(error.message)});
    throw error;
  }
}

export function verifyAnchorMaterialisation(plan) {
  requirePlan(plan);
  const files=(plan.payload?.files || []).map((file)=>{
    const path=targetPath(plan.workspaceRoot,file.path);
    return {path:file.path,ok:existsSync(path) && sha256(readFileSync(path))===file.newSha256};
  });
  return {schema:'architecture-manager-verification/v1',ok:files.length>0 && files.every((file)=>file.ok),files,writePerformed:false};
}

// Align a platform's version pins to the anchor. Only the keys that name a version are planned;
// every other key, and every other file, stays untouched.
export function buildAnchorAlignmentPlan({workspaceRoot,platformId,now=new Date().toISOString(),targetAnchor=null}) {
  const root=targetPath(workspaceRoot,'.');
  const state=targetAnchor?{exists:true,anchor:targetAnchor,digest:anchorDigest(targetAnchor)}:readAnchorState({workspaceRoot:root});
  if(!state.exists) throw new Error('ANCHOR_NOT_MATERIALISED');
  const anchor=state.anchor;
  const alignment=targetAnchor?{configPath:relative(root,platformConfigPath(root,platformId)).replaceAll('\\','/'),warnings:[]}:anchorAlignment({workspaceRoot:root,platformId});
  const configRelative=alignment.configPath || `${platformId}/bridge/${platformId}-config.json`;
  const bridgeRelative=[`${platformId}/bridge.json`,`${platformId}/bridge/bridge.json`].find((path)=>existsSync(targetPath(root,path))) || `${platformId}/bridge.json`;
  const configPath=targetPath(root,configRelative),bridgePath=targetPath(root,bridgeRelative);
  const config=existsSync(configPath)?readJson(configPath):{};
  const bridge=existsSync(bridgePath)?readJson(bridgePath):{};
  const declined=(value)=>typeof value==='string' && value ? value.replaceAll('\\','/').split('/').pop() : null;
  const warnings=[...alignment.warnings];
  const notes=[];

  // Paths are written in the platform-absolute form the engine reads, exactly as onboarding does.
  const nextConfig={...config};
  nextConfig.platform ??= platformId;
  nextConfig.platformRoot ??= join(root,platformId);
  nextConfig.toolRoot ??= join(root,'tool');
  nextConfig.agentRoot ??= join(root,'agent');
  nextConfig.softwareRoot ??= join(root,'software');
  nextConfig.runsRoot ??= join(root,platformId,'runtime/runs');
  nextConfig.bridge=join(root,bridgeRelative);
  nextConfig.runner=join(root,anchor.engine.path);
  nextConfig.contracts=join(root,anchor.contracts.path);
  nextConfig.scannerRelease=join(root,anchor.checker.path);
  nextConfig.invocationMatrixRelease=join(root,anchor.judge.path);

  const connectorEntry=join(root,`software/_connector/versions/${anchor.software.connector || ''}/connector.py`);
  if(anchor.software.connector && existsSync(connectorEntry)) {
    nextConfig.softwareRoot=join(root,'software');
    nextConfig.softwareRuntimeRoot ??= join(root,platformId,'runtime/software');
    nextConfig.softwareGateway=connectorEntry;
  } else {
    notes.push('SOFTWARE_CONNECTOR_ENTRY_MISSING: the anchor names a connector release that is not on disk, so no software gateway key was planned');
  }
  nextConfig.softwareGatewayConfig ??= join(root,platformId,'bridge/software-gateway-config.json');

  const nextBridge={...bridge};
  nextBridge.schema ??= 'ai-platform-bridge/v1.1';
  nextBridge.platform ??= platformId;
  nextBridge.displayName ??= bridge.displayName || platformId;
  nextBridge.shared={...bridge.shared,toolRegistry:join(root,'tool/registry.json'),agentRegistry:join(root,'agent/registry.json'),softwareRegistry:join(root,'software/registry.json'),architecturePrompt:join(root,'AI_ARCHITECTURE_SYSTEM_PROMPT.md'),readOnly:true};
  nextBridge.runtimeRoot ??= join(root,platformId,'runtime');
  nextBridge.modes ??= ['workflow','agent-workflow'];
  nextBridge.defaults={...bridge.defaults,workflowVersions:{...(bridge.defaults?.workflowVersions || {}),'repo-lint':anchor.checker.version}};
  nextBridge.runner={...bridge.runner,enabled:bridge.runner?.enabled ?? true,config:join(root,configRelative),release:join(root,anchor.engine.path)};
  nextBridge.runner.version=anchor.engine.version;

  const files=[];
  const add=(relative,content)=>{
    const target=targetPath(root,relative);
    const before=existsSync(target)?sha256(readFileSync(target)):null;
    const next=sha256(content);
    if(before!==next) files.push({path:relative,content,beforeSha256:before,newSha256:next});
  };
  add(configRelative,stringify(nextConfig));
  add(bridgeRelative,stringify(nextBridge));

  const plan=replaceConfigPlan({workspaceRoot:root,platformId,anchorDigest:state.digest,files,now});
  plan.payload={files,anchor,alignment,warnings,notes,targetIsExplicit:Boolean(targetAnchor)};
  plan.changed=files.length>0;
  plan.target.before=Object.fromEntries(files.map((file)=>[file.path,file.beforeSha256]));
  plan.target.after=Object.fromEntries(files.map((file)=>[file.path,file.newSha256]));
  plan.target.declaredBefore={runner:declined(config.runner),contracts:declined(config.contracts),scannerRelease:declined(config.scannerRelease),invocationMatrixRelease:declined(config.invocationMatrixRelease),bridgeDefault:bridge.defaults?.workflowVersions?.['repo-lint'] ?? null};
  plan.target.declaredAfter={runner:anchor.engine.version,contracts:anchor.contracts.version,scannerRelease:anchor.checker.version,invocationMatrixRelease:anchor.judge.version,bridgeDefault:anchor.checker.version};
  plan.verification=[...plan.verification,'no key outside runner/contracts/scannerRelease/invocationMatrixRelease/software* and the bridge version defaults is changed'];
  return plan;
}

export function verifyAnchorAlignment(plan) {
  requirePlan(plan);
  const files=(plan.payload?.files || []).map((file)=>{
    const path=targetPath(plan.workspaceRoot,file.path);
    return {path:file.path,ok:existsSync(path) && sha256(readFileSync(path))===file.newSha256};
  });
  if(!files.every((file)=>file.ok)) return {schema:'architecture-manager-verification/v1',ok:false,files,writePerformed:false};
  // The decisive read-back is not the file hash but the resolved comparison: after the write, the
  // platform must line up with the anchor on every key the anchor names.
  if(plan.payload.targetIsExplicit) {
    const config=readJson(platformConfigPath(plan.workspaceRoot,plan.target.platformId)),anchor=plan.payload.anchor;
    const differences=['runner','contracts','scannerRelease','invocationMatrixRelease'].filter((key)=>config[key]!==join(plan.workspaceRoot,anchor[{runner:'engine',contracts:'contracts',scannerRelease:'checker',invocationMatrixRelease:'judge'}[key]].path));
    return {schema:'architecture-manager-verification/v1',ok:files.length>0 && !differences.length,files,differences,writePerformed:false};
  }
  const alignment=anchorAlignment({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId});
  return {schema:'architecture-manager-verification/v1',ok:files.length>0 && alignment.differences.length===0,files,alignment,differences:alignment.differences,warnings:alignment.warnings,writePerformed:false};
}

export function applyAnchorAlignment(plan,{actor='local-user',auditRoot=defaultAuditRoot(),now=new Date().toISOString(),failAfterFiles=null}={}) {
  requirePlan(plan);
  const rebuilt=buildAnchorAlignmentPlan({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId,now:plan.generatedAt,targetAnchor:plan.payload.targetIsExplicit?plan.payload.anchor:null});
  if(sha256(stringify(rebuilt.payload.files))!==sha256(stringify(plan.payload.files))) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const before=plan.payload.files.map((file)=>{
    const target=targetPath(plan.workspaceRoot,file.path);
    const actual=existsSync(target)?sha256(readFileSync(target)):null;
    // Same rule as the anchor file: bytes that already equal the plan's target are idempotent, and
    // anything else than the recorded baseline is a conflict.
    if(actual!==file.beforeSha256 && actual!==file.newSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
    return {...file,before:actual===null?null:readFileSync(target,'utf8'),alreadyTarget:actual===file.newSha256};
  });
  if(before.every((file)=>file.alreadyTarget)) return output({schema:'architecture-manager-transaction/v1',status:'already-applied',planId:plan.planId,transactionId:makeId(plan,now),target:plan.target.platformId,writePerformed:false},null);
  const id=makeId(plan,now);
  const checkpoint=saveCheckpoint(auditRoot,id,stringify({schema:'anchor-alignment-checkpoint/v1',workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId,files:before.map(({path,before:content})=>({path,before:content}))}));
  const written=[];
  try {
    for(const file of before) {
      const target=targetPath(plan.workspaceRoot,file.path);
      mkdirSync(dirname(target),{recursive:true});
      atomicWrite(target,file.content,id);
      written.push(file);
      if(failAfterFiles===written.length) throw new Error('SIMULATED_INTERRUPT');
    }
    const verification=verifyAnchorAlignment(plan);
    if(!verification.ok) throw new Error('ANCHOR_ALIGNMENT_READBACK_FAILED');
    return output(writeAudit({actor,auditRoot,now,transactionId:id,plan,action:plan.kind,status:'applied',target:plan.target.platformId,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,newSha256:sha256(stringify(plan.target.after)),writePerformed:true}),checkpoint.path);
  } catch (error) {
    for(const file of written.reverse()) {
      const target=targetPath(plan.workspaceRoot,file.path);
      if(existsSync(target) && sha256(readFileSync(target))===file.newSha256) atomicWrite(target,file.before ?? '',id);
    }
    writeAudit({actor,auditRoot,now,transactionId:id,plan,action:plan.kind,status:'failed-restored',target:plan.target.platformId,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,error:String(error.message)});
    throw error;
  }
}
