import {onboardingReadback} from './domains/platforms/onboarding-readback.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './transactions/kernel.mjs';
import { targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { clientBinding, probeOnboardingClient } from './onboarding-client.mjs';
import { inspectPlatformConnection, runPlatformCheck } from './platform-check.mjs';
import { execFileSync } from 'node:child_process';
import { onboardingGitPaths } from './onboarding-governance.mjs';
import { requestOnboardingCancellation } from './core/onboarding-jobs.mjs';
import { pendingFirstMatrix, mergeFirstMatrix } from './onboarding-recovery.mjs';
import {environmentBinding} from './domains/certification/binding.mjs';
export {environmentBinding} from './domains/certification/binding.mjs';

const active = new Map();
const keyOf = (root, id) => `${resolve(root).toLowerCase()}:${id}`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function pathOf(root, id) { return targetPath(root, `${id}/runtime/maintenance/manager-onboarding/state.json`); }
export function readOnboardingState({ workspaceRoot, platformId }) {
  readOnboardingConfig({ workspaceRoot, platformId });
  const path = pathOf(workspaceRoot, platformId);
  if (!existsSync(path)) return { schema: 'architecture-manager-onboarding/v1', platformId, status: 'not-started', steps: [], writePerformed: false };
  const state = parseJsonText(readFileSync(path, 'utf8'));
  if (state.status === 'running' && !active.has(keyOf(workspaceRoot, platformId))) state.status = 'interrupted';
  return { ...state,readback:onboardingReadback(workspaceRoot,platformId,state), writePerformed: false };
}
export function savePendingOnboarding({workspaceRoot,platformId,pending,pendingSoftware,steps}) {
  const previous=readOnboardingState({workspaceRoot,platformId});
  const state={...previous,...clientBinding(workspaceRoot,platformId),schema:'architecture-manager-onboarding/v1',platformId,status:'configured-pending',error:null,stoppedAt:null,currentStep:'pending',architectureComplete:false,pending,pendingSoftware,preparationSteps:steps,environmentBindingSha256:environmentBinding(workspaceRoot,platformId),updatedAt:new Date().toISOString()};
  save(workspaceRoot,platformId,state);return state;
}
function save(root, id, value) { const path = pathOf(root, id); mkdirSync(join(path, '..'), { recursive: true });const stored={...value};delete stored.readback; atomicWrite(path, json(stored), randomUUID()); }

export function cancelOnboarding({ workspaceRoot, platformId }) {
  const automaticCancelled = requestOnboardingCancellation(workspaceRoot, platformId);
  const record = active.get(keyOf(workspaceRoot, platformId));
  if (!record) return { status: automaticCancelled ? 'cancellation-requested' : 'not-running', writePerformed: false };
  record.cancelled = true;
  record.cancel?.();
  return { status: 'cancellation-requested', writePerformed: false };
}

export function cancelAllOnboardingChecks() {
  for (const job of active.values()) { job.cancelled = true; job.cancel?.(); }
}

// The preamble is shared by the ordinary check run and the post-alignment run: both must refuse a
// configuration that changed while a record was running, and both must reuse the same execution when
// nothing they depend on moved.
function certifyPreamble({ workspaceRoot, platformId, only }) {
  const key = keyOf(workspaceRoot, platformId);
  if (active.has(key)) throw new Error('ONBOARDING_ALREADY_RUNNING');
  const precheck = inspectPlatformConnection({ workspaceRoot, platformId });
  if (!['configured', 'callable', 'complete', 'check-failed', 'check-cancelled'].includes(precheck.stage)) throw new Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const binding = clientBinding(workspaceRoot, platformId);
  const previous = readOnboardingState({ workspaceRoot, platformId });
  const firstCertification = readFirstCertification(previous, workspaceRoot, platformId);
  const recovery = !only && !firstCertification ? pendingFirstMatrix(previous,workspaceRoot,platformId,binding,environmentBinding(workspaceRoot,platformId)) : null;
  if (previous.configSha256 && previous.configSha256 !== binding.configSha256 && ['running', 'interrupted'].includes(previous.status)) throw new Error('ONBOARDING_RESUME_DRIFT');
  const reusable = previous.configSha256 === binding.configSha256 && previous.versionsSha256 === binding.versionsSha256 && previous.adapterSha256 === binding.adapterSha256 && previous.environmentBindingSha256 === environmentBinding(workspaceRoot, platformId);
  const state = { schema: 'architecture-manager-onboarding/v1', platformId, executionId: reusable ? previous.executionId : randomUUID(), ...binding, status: 'running', startedAt: reusable ? previous.startedAt : new Date().toISOString(), steps: reusable ? (previous.steps || []).filter((step) => step.status === 'passed' && step.step === 'client-tool-loop') : [], stoppedAt: null, writePerformed: true };
  state.environmentBindingSha256 = environmentBinding(workspaceRoot, platformId);
  state.firstCertification = firstCertification;
  state.pendingMatrixRecovery = recovery;
  const job = { cancelled: false, cancel: null }; active.set(key, job); save(workspaceRoot, platformId, state);
  return { key, binding, firstCertification, recovery, job, state };
}

export async function executeOnboardingChecks({ workspaceRoot, platformId, only = null }, { onProgress = () => {}, check = runPlatformCheck, clientProbe = probeOnboardingClient } = {}) {
  const { key, binding, firstCertification, recovery, job, state } = certifyPreamble({ workspaceRoot, platformId, only });
  const step = async (name, operation, passed) => {
    if (job.cancelled) throw new Error('ONBOARDING_CANCELLED');
    const prior = state.steps.find((item) => item.step === name && item.status === 'passed');
    if (prior?.evidencePath && existsSync(prior.evidencePath) && sha256(readFileSync(prior.evidencePath)) === prior.evidenceSha256) { onProgress({ platformId, phase: name, reused: true }); return prior.result; }
    state.currentStep = name; save(workspaceRoot, platformId, state); onProgress({ platformId, phase: name, reused: false });
    const result = await operation();
    if (job.cancelled) throw new Error('ONBOARDING_CANCELLED');
    const fresh = clientBinding(workspaceRoot, platformId);
    if (JSON.stringify(fresh) !== JSON.stringify(binding) || environmentBinding(workspaceRoot, platformId) !== state.environmentBindingSha256) throw new Error('ONBOARDING_RESUME_DRIFT');
    const valid = passed(result);
    state.steps.push({ step: name, status: valid ? 'passed' : 'failed', result, evidencePath: result.evidencePath || null, evidenceSha256: result.evidencePath && existsSync(result.evidencePath) ? sha256(readFileSync(result.evidencePath)) : null }); save(workspaceRoot, platformId, state);
    if (!valid) { state.stoppedAt = name; throw new Error('ONBOARDING_CHECK_FAILED'); }
    return result;
  };
  try {
    // This check is selected against the target config. Patches use only affected cells after initial certification.
    const checked = await step(only ? 'affected-cells' : 'conform-and-first-matrix', async () => {
      if(recovery) onProgress({platformId,phase:`复验首次矩阵失败格：${recovery.only}`,reused:false});
      const result=await check({ workspaceRoot, platformId, mode: only || recovery ? 'quick' : 'full', only:only || recovery?.only, stopOnFloorFailure: true, onProgress, registerCancel: (cancel) => { job.cancel = cancel; } });
      return recovery && !result.coverageComplete ? mergeFirstMatrix(recovery,result,workspaceRoot,platformId) : result;
    }, (result) => result.issues?.length === 0 && result.counts?.fail === 0 && !result.counts?.needsInput);
    if (checked.coverageComplete || (!only && !firstCertification)) { state.firstCertification = readFirstCertification({ ...state, firstCertification:null,steps: [{ status: 'passed', step: 'conform-and-first-matrix', result: checked }] }, workspaceRoot, platformId); state.pendingMatrixRecovery = null; }
    await step('client-tool-loop', () => clientProbe({ workspaceRoot, platformId }, { registerCancel: (cancel) => { job.cancel = cancel; } }), (result) => result.status === 'passed');
    state.status = 'verified-awaiting-governance-git'; state.currentStep = 'governance-git';
  } catch (error) {
    state.status = job.cancelled ? 'cancelled' : 'failed'; state.error = String(error.message); state.stoppedAt ||= state.currentStep;
  } finally { active.delete(key); state.updatedAt = new Date().toISOString(); save(workspaceRoot, platformId, state); }
  return state;
}

// After a platform is aligned to the anchor, the platform must re-certify itself against its new
// configuration. This runs the same certification step with the same certification gate, but never
// asserts a client loop: aligning a version does not re-verify a vendor client, and claiming it did
// would be a claim this run did not earn. When a previous certification is still stored, the record
// stays verified; otherwise it waits for the ordinary pipeline to finish the remaining steps.
export async function executePostAlignmentChecks({ workspaceRoot, platformId, anchorDigestSha256 = null }, { onProgress = () => {}, check = runPlatformCheck } = {}) {
  const { key, binding, firstCertification, recovery, job, state } = certifyPreamble({ workspaceRoot, platformId, only: null });
  state.anchorDigestSha256 = anchorDigestSha256;
  const step = async (name, operation, passed) => {
    if (job.cancelled) throw new Error('ONBOARDING_CANCELLED');
    state.currentStep = name; save(workspaceRoot, platformId, state); onProgress({ platformId, phase: name, reused: false });
    const result = await operation();
    if (job.cancelled) throw new Error('ONBOARDING_CANCELLED');
    const fresh = clientBinding(workspaceRoot, platformId);
    if (fresh.configSha256 !== state.configSha256) throw new Error('ONBOARDING_RESUME_DRIFT');
    const valid = passed(result);
    state.steps.push({ step: name, status: valid ? 'passed' : 'failed', result, evidencePath: result.evidencePath || null, evidenceSha256: result.evidencePath && existsSync(result.evidencePath) ? sha256(readFileSync(result.evidencePath)) : null });
    save(workspaceRoot, platformId, state);
    if (!valid) { state.stoppedAt = name; throw new Error('ONBOARDING_CHECK_FAILED'); }
    return result;
  };
  try {
    const checked = await step('post-alignment-check', async () => {
      const result = await check({ workspaceRoot, platformId, mode: 'quick', only: null, stopOnFloorFailure: true, onProgress, registerCancel: (cancel) => { job.cancel = cancel; } });
      if (recovery && !result.coverageComplete) return mergeFirstMatrix(recovery, result, workspaceRoot, platformId);
      return result;
    }, (result) => result.issues?.length === 0 && result.counts?.fail === 0 && !result.counts?.needsInput);
    if (checked.coverageComplete) {
      state.firstCertification = readFirstCertification({ ...state, firstCertification: null, steps: [{ status: 'passed', step: 'conform-and-first-matrix', result: checked }] }, workspaceRoot, platformId);
      state.pendingMatrixRecovery = null;
    }
    state.status = firstCertification ? 'verified-awaiting-governance-git' : 'configured-pending';
  } catch (error) {
    state.status = job.cancelled ? 'cancelled' : 'failed'; state.error = String(error.message); state.stoppedAt ||= state.currentStep;
  } finally { active.delete(key); state.updatedAt = new Date().toISOString(); save(workspaceRoot, platformId, state); }
  return state;
}

function readFirstCertification(previous, root, id) {
  const validPath = (path) => path && path.replaceAll('\\', '/').toLowerCase().startsWith(targetPath(root, `${id}/runtime/manager-check`).replaceAll('\\', '/').toLowerCase() + '/') && existsSync(path);
  if (previous.firstCertification) {
    const proof = previous.firstCertification;
    if (['matrix', 'conform'].every((name) => validPath(proof[`${name}Path`]) && sha256(readFileSync(proof[`${name}Path`])) === proof[`${name}Sha256`])) return proof;
    return null;
  }
  const old = previous.steps?.find((step) => step.step === 'conform-and-first-matrix' && step.status === 'passed')?.result;
  if (!old || old.platformId !== id || !validPath(old.matrixPath) || !validPath(old.conformPath)) return null;
  const matrix = parseJsonText(readFileSync(old.matrixPath, 'utf8')); const floor = parseJsonText(readFileSync(old.conformPath, 'utf8'));
  if (!matrix.rows?.length || matrix.rows.some((row) => ['FAIL', 'NEEDS-INPUT'].includes(row.status)) || !floor.floorReached || matrix.summary?.PASS !== old.counts.pass) return null;
  return { versionsSha256: previous.versionsSha256, checkedAt: old.checkedAt, configSha256: old.configSha256, matrixPath: old.matrixPath, matrixSha256: sha256(readFileSync(old.matrixPath)), conformPath: old.conformPath, conformSha256: sha256(readFileSync(old.conformPath)), counts: old.counts, migratedFromStoredStep: !old.evidencePath || old.evidencePath.endsWith('latest.json') };
}

export function markOnboardingRecorded({ workspaceRoot, platformId, gitReadback, allowPending=false }) {
  const state = readOnboardingState({ workspaceRoot, platformId }); const binding = clientBinding(workspaceRoot, platformId);
  const paths = onboardingGitPaths(workspaceRoot, platformId);
  const git = (args) => execFileSync('git', ['-C', workspaceRoot, ...args], { encoding: 'utf8', windowsHide: true, shell: false }).trim();
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--', ...paths]);
  if(allowPending && state.status==='configured-pending') {
    if(status || !head || state.configSha256!==binding.configSha256 || state.versionsSha256!==binding.versionsSha256 || state.adapterSha256!==binding.adapterSha256 || state.environmentBindingSha256!==environmentBinding(workspaceRoot,platformId))throw Error('ONBOARDING_NOT_VERIFIED');
    for(const path of paths)git(['ls-files','--error-unmatch','--',path]);state.git={head,configurationStatusClean:true,recordedAt:new Date().toISOString(),paths,scope:'configuration-only'};save(workspaceRoot,platformId,state);return state;
  }
  if (state.status !== 'verified-awaiting-governance-git' || state.configSha256 !== binding.configSha256 || state.versionsSha256 !== binding.versionsSha256 || state.adapterSha256 !== binding.adapterSha256 || state.environmentBindingSha256 !== environmentBinding(workspaceRoot, platformId) || !state.firstCertification || status || !head) throw new Error('ONBOARDING_NOT_VERIFIED');
  for (const path of paths) { git(['ls-files', '--error-unmatch', '--', path]); }
  gitReadback = { head, configurationStatusClean: true, recordedAt: new Date().toISOString(), paths };
  state.status = 'complete'; state.git = gitReadback; state.completedAt = new Date().toISOString(); save(workspaceRoot, platformId, state); return state;
}
