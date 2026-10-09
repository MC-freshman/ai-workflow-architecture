// Anchored generation: one machine-readable table of the versions this workspace intends to use,
// with the reason each rejected candidate was rejected. Nothing here writes: compute is pure,
// materialisation goes through a confirmation-required plan, alignment goes through the existing
// onboarding configuration transaction.
//
// Why this exists: the workspace carries the same version fact in four places (shared current
// pointer, platform bridge defaults, platform scannerRelease, engine manifest declaration) and no
// component reconciles them. The anchor names one generation explicitly so every platform can be
// aligned to it instead of each session re-deriving a pair by hand.
import {existsSync,readdirSync} from 'node:fs';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {sha256} from '../../core/hash.mjs';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {compareStableVersions} from '../../core/versions.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';

export const ANCHOR_RELATIVE_PATH='versions/anchor.json';
export const ANCHOR_SCHEMA='ai-architecture-anchor/v1';
const SEMVER=/^\d+\.\d+\.\d+$/;
const STAGING_LABELS=new Set(['candidate','draft','unpublished']);

// Platform configurations store absolute paths (that is what the engine reads), while a workspace
// relative path is what every write goes through. Reads therefore accept both. Containment differs
// by key: software keys must stay inside the platform directory, while the shared toolchain keys
// (runner / contracts / scannerRelease / invocationMatrixRelease) point into the shared repository.
function resolveInside(root,prefix,value) {
  if(typeof value!=='string' || !value.trim()) return null;
  const full=isAbsolute(value)?resolve(value):targetPath(root,value);
  const owned=resolve(root,...prefix);
  if(full!==owned && !full.startsWith(owned+sep)) throw new Error('CONFIGURATION_PATH_MISMATCH');
  return full;
}
const platformPath=(root,platformId,value)=>resolveInside(root,[platformId],value);
const workspacePath=(root,value)=>resolveInside(root,[],value);

export function anchorContent(anchor) {
  const {generatedAt,...rest}=anchor;
  return `${JSON.stringify(rest,null,2)}\n`;
}

// A refusal carries the same rejection ledger the successful anchor would have carried, so a caller
// (or a test) can name why every candidate lost instead of only learning that none survived.
export function anchorRefusal(message,rejected) {
  const error=new Error(message);
  error.rejected=rejected;
  return error;
}

export function anchorDigest(anchor) { return sha256(anchorContent(anchor)); }

function versionsOf(root,repository,id,prefix='') {
  const base=targetPath(root,`${repository}/${prefix}${id}/versions`);
  if(!existsSync(base)) return [];
  return readdirSync(base).filter((version)=>SEMVER.test(version)).sort(compareStableVersions).reverse();
}

function stagedRelease(root,repository,id,version,prefix='') {
  const source=join(targetPath(root,`${repository}/${prefix}${id}/versions`),version,'SOURCE.json');
  if(!existsSync(source)) return false;
  const document=readJson(source);
  return STAGING_LABELS.has(document.releaseStatus) && !document.publishedAt && !document.releasedAt;
}
export function readAnchorState({workspaceRoot}) {
  const path=targetPath(workspaceRoot,ANCHOR_RELATIVE_PATH);
  if(!existsSync(path)) return {exists:false,path:ANCHOR_RELATIVE_PATH,anchor:null,digest:null,matchesComputed:null};
  const anchor=readJson(path),digest=anchorDigest(anchor);
  let matchesComputed=null;
  try { matchesComputed=digest===anchorDigest(computeAnchor({workspaceRoot,now:anchor.generatedAt || new Date().toISOString()})); } catch { matchesComputed=false; }
  return {exists:true,path:ANCHOR_RELATIVE_PATH,anchor,digest,matchesComputed};
}

// Selection rule per axis (the same rule the manager states elsewhere: a recommended combination
// comes from frozen manifests and their pairing, never from string-sorting "latest"):
//   engine  : newest frozen wf-runner that carries the one-process invocation interface and
//             declares exactly one repo-lint dependency (that declaration IS the checker axis);
//   checker : the engine's declared repo-lint (so the pair is exact by construction);
//   judge   : newest frozen architecture-ops carrying the matching invocation smoke interface;
//   contracts / conformance / software : the shared current pointer, which records the intended
//             default and was already adjudicated; a released-but-not-adopted candidate is not
//             silently promoted here.
export function computeAnchor({workspaceRoot,now=new Date().toISOString()}) {
  const root=targetPath(workspaceRoot,'.');
  const rejected=[];
  const engineCandidates=versionsOf(root,'tool','wf-runner');
  const engineFacts=engineCandidates.map((version)=>{
    const fact={version,manifest:null,staged:false,reason:null,declared:null};
    try {
      if(stagedRelease(root,'tool','wf-runner',version)) { fact.reason='STAGING_RELEASE_LABEL'; return fact; }
      fact.manifest=readJson(join(targetPath(root,'tool/wf-runner/versions'),version,'manifest.json'));
      if(fact.manifest.interface?.['x-invocationSmoke']!=='ai-invocation-smoke/v1') fact.reason='NO_INVOCATION_SMOKE_INTERFACE';
      else {
        const declared=fact.manifest.dependencies?.workflows?.['repo-lint'];
        if(typeof declared!=='string' || !SEMVER.test(declared)) fact.reason='CHECKER_DEPENDENCY_NOT_PINNED';
        else {
          fact.declared=declared;
          // The engine's own validation walks into its declared dependencies, so a checker that is
          // absent shows up as a generic "engine not frozen". Judge the checker on its own first and
          // let that verdict name the real cause; the ledger exists to be actionable.
          let checkerFailure=null;
          try { validateFrozenResource(root,'tool','repo-lint',declared); } catch (error) { checkerFailure=error.message; }
          try { validateFrozenResource(root,'tool','wf-runner',version); }
          catch (error) {
            fact.reason=checkerFailure
              ? `DECLARED_CHECKER_UNAVAILABLE:${declared}:${checkerFailure}`
              : `NOT_FROZEN:${error.message}`;
            return fact;
          }
          if(checkerFailure) fact.reason=`DECLARED_CHECKER_UNAVAILABLE:${declared}:${checkerFailure}`;
        }
      }
    } catch (error) { fact.reason=`UNREADABLE:${error.message}`; }
    return fact;
  });
  const chosenEngine=engineFacts.find((fact)=>fact.reason===null) || null;
  for(const fact of engineFacts) {
    if(fact===chosenEngine) continue;
    rejected.push({axis:'engine',version:fact.version,reason:fact.reason || 'ORDERED_BELOW_SELECTED'});
  }
  if(!chosenEngine) throw anchorRefusal('ANCHOR_ENGINE_UNAVAILABLE',rejected);
  const engine={id:'wf-runner',version:chosenEngine.version,path:`tool/wf-runner/versions/${chosenEngine.version}`,declares:{'repo-lint':chosenEngine.declared},selectedBecause:'newest frozen engine carrying the invocation smoke interface, with its declared checker present and frozen'};
  const checker={id:'repo-lint',version:chosenEngine.declared,path:`tool/repo-lint/versions/${chosenEngine.declared}`,selectedBecause:'exact pairing: the checker the selected engine declares'};

  const judgeCandidates=versionsOf(root,'tool','architecture-ops');
  const judgeFacts=judgeCandidates.map((version)=>{
    const fact={version,reason:null};
    try {
      if(stagedRelease(root,'tool','architecture-ops',version)) { fact.reason='STAGING_RELEASE_LABEL'; return fact; }
      const frozen=validateFrozenResource(root,'tool','architecture-ops',version);
      if(frozen.manifest.interface?.invocationSmoke!=='ai-invocation-smoke/v1') fact.reason='NO_MATRIX_SMOKE_INTERFACE';
    } catch (error) { fact.reason=`NOT_FROZEN:${error.message}`; }
    return fact;
  });
  const chosenJudge=judgeFacts.find((fact)=>fact.reason===null) || null;
  for(const fact of judgeFacts) {
    if(fact===chosenJudge) continue;
    rejected.push({axis:'judge',version:fact.version,reason:fact.reason || 'ORDERED_BELOW_SELECTED'});
  }
  if(!chosenJudge) throw anchorRefusal('ANCHOR_JUDGE_UNAVAILABLE',rejected);
  const judge={id:'architecture-ops',version:chosenJudge.version,path:`tool/architecture-ops/versions/${chosenJudge.version}`,selectedBecause:'newest frozen judge carrying the matrix invocation smoke interface'};

  const fromPointer=(axis,repository,id,note)=>{
    const pointerPath=targetPath(root,`${repository}/${id}/current.json`);
    if(!existsSync(pointerPath)) throw anchorRefusal(`ANCHOR_${axis.toUpperCase()}_POINTER_MISSING`,rejected);
    const version=readJson(pointerPath).version;
    try { validateFrozenResource(root,repository,id,version); }
    catch (error) { rejected.push({axis,version,reason:`POINTER_TARGET_NOT_FROZEN:${error.message}`}); throw anchorRefusal(`ANCHOR_${axis.toUpperCase()}_UNAVAILABLE`,rejected); }
    return {id,version,path:`${repository}/${id}/versions/${version}`,selectedBecause:note};
  };
  const contracts=fromPointer('contracts','tool','runtime-contracts','shared current pointer: the package generation the workspace declares as default');
  const conformance=fromPointer('conformance','tool','platform-conformance','shared current pointer: the capability-floor judge the workspace declares as default');

  // The software axis records the shared pointers. Each platform still installs its own bytes, so
  // the anchor can only state which recipe generation is intended, never that a body exists.
  const softwarePointerRows=[];
  const softwareBase=targetPath(root,'software');
  if(existsSync(softwareBase)) {
    for(const entry of readdirSync(softwareBase,{withFileTypes:true}).filter((row)=>row.isDirectory())) {
      const pointer=join(softwareBase,entry.name,'current.json');
      if(!existsSync(pointer)) continue;
      const version=readJson(pointer).version;
      softwarePointerRows.push({id:entry.name,version,path:`software/${entry.name}/versions/${version}`});
    }
    softwarePointerRows.sort((left,right)=>left.id.localeCompare(right.id));
  }
  return {
    schema:ANCHOR_SCHEMA,
    generatedAt:now,
    source:{kind:'derived-from-workspace-pointers-and-frozen-manifests',workspaceRoot:root},
    engine,checker,judge,contracts,conformance,
    software:{connector:softwarePointerRows.find((row)=>row.id==='_connector')?.version || null,gateway:softwarePointerRows.find((row)=>row.id==='_gateway')?.version || null,recipes:softwarePointerRows.filter((row)=>!row.id.startsWith('_'))},
    selectionRule:'engine: newest frozen wf-runner with the invocation smoke interface whose declared checker is present and frozen; checker: that declared version (exact pair); judge: newest frozen architecture-ops with the matrix smoke interface; contracts/conformance/software: shared current pointers. Released-but-unadopted candidates are never auto-promoted.',
    rejected
  };
}

export function anchorPairFacts(anchor) {
  return {
    runnerVersion:anchor.engine.version,
    runnerPath:anchor.engine.path,
    contractsVersion:anchor.contracts.version,
    scannerVersion:anchor.checker.version,
    matrixVersion:anchor.judge.version,
    declaredByEngine:anchor.engine.declares?.['repo-lint'] || null,
    pairConsistent:anchor.engine.declares?.['repo-lint']===anchor.checker.version
  };
}

// What a platform currently declares, compared against the anchor. Read-only.
export function anchorAlignment({workspaceRoot,platformId}) {
  const root=targetPath(workspaceRoot,'.');
  const state=readAnchorState({workspaceRoot:root});
  // Nothing was compared, so this must never read as "aligned": an empty difference list means
  // "no findings" only when a comparison actually happened.
  if(!state.exists) return {platformId,anchor:null,materialised:false,compared:false,aligned:false,differences:[],warnings:[],warning:['ANCHOR_NOT_MATERIALISED'],writePerformed:false};
  const anchor=state.anchor;
  const configCandidates=[`${platformId}/bridge/runner-config.json`,`${platformId}/bridge/${platformId}-config.json`];
  const configRelative=configCandidates.find((path)=>existsSync(targetPath(root,path)));
  const config=configRelative?readJson(targetPath(root,configRelative)):{};
  const bridgeRelative=[`${platformId}/bridge.json`,`${platformId}/bridge/bridge.json`].find((path)=>existsSync(targetPath(root,path)));
  const bridge=bridgeRelative?readJson(targetPath(root,bridgeRelative)):{};
  const declined=(value)=>typeof value==='string' && value ? value.replaceAll('\\','/').split('/').pop() : null;
  const softwareConfigPath=platformPath(root,platformId,config.softwareGatewayConfig);
  const softwareConfig=softwareConfigPath && existsSync(softwareConfigPath)?readJson(softwareConfigPath):null;
  const differences=[];
  const note=(key,current,expected)=>{ if(current!==expected) differences.push({key,current:current ?? null,expected}); };
  note('config.runner',declined(config.runner),anchor.engine.version);
  note('config.contracts',declined(config.contracts),anchor.contracts.version);
  note('config.scannerRelease',declined(config.scannerRelease),anchor.checker.version);
  note('config.invocationMatrixRelease',declined(config.invocationMatrixRelease),anchor.judge.version);
  note('bridge.runner.version',bridge.runner?.version ?? null,anchor.engine.version);
  note('bridge.defaults.repo-lint',bridge.defaults?.workflowVersions?.['repo-lint'] ?? null,anchor.checker.version);
  const runnerDirectory=workspacePath(root,config.runner);
  const runnerManifestPath=runnerDirectory?join(runnerDirectory,'manifest.json'):null;
  const declaredByEngine=runnerManifestPath && existsSync(runnerManifestPath) ? readJson(runnerManifestPath).dependencies?.workflows?.['repo-lint'] ?? null : null;
  const warnings=[];
  if(declined(config.scannerRelease) && declaredByEngine && declined(config.scannerRelease)!==declaredByEngine) {
    // The manager's preflight used to refuse this combination outright. It is a named warning now:
    // the engine declares the generation it was tested with, while the platform pin is a moving
    // adoption target, and the two ends are not changed by the same action.
    warnings.push(`VERSION_PAIR_MISMATCH: platform scannerRelease ${declined(config.scannerRelease)} differs from the pinned engine's declared repo-lint ${declaredByEngine}`);
  }
  const bodyRows=softwareConfig && typeof softwareConfig.bodies==='object' && softwareConfig.bodies ? Object.entries(softwareConfig.bodies) : [];
  return {
    platformId,anchorDigest:state.digest,materialised:true,compared:true,aligned:differences.length===0,
    configPath:configRelative,declaredByEngine,differences,warnings,
    software:{declaredKeys:['softwareRoot','softwareRuntimeRoot','softwareGateway','softwareGatewayConfig','softwareEnvironment','softwareProfiles','softwareConsentGrants'].filter((key)=>key in config),bodies:bodyRows.map(([id,bodyPath])=>({id,bodyPath:typeof bodyPath==='string'?bodyPath:null})),gateway:declined(config.softwareGateway)},
    writePerformed:false
  };
}
