import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGitPlan } from './git.mjs';
import { applyGitTransaction } from './git-executor.mjs';
import { onboardingGitPaths } from './onboarding-governance.mjs';
import { markOnboardingRecorded, readOnboardingState } from './onboarding-state.mjs';
import { requirePlan } from './transactions/kernel.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { defaultAuditRoot } from './core/paths.mjs';
import { saveCheckpoint, writeAudit, makeId } from './transactions/kernel.mjs';

export function buildOnboardingFinalizePlan({ workspaceRoot, platformId, identity = null, allowPending=false, now = new Date().toISOString() }) {
  const state = readOnboardingState({ workspaceRoot, platformId });
  identity ||= readOnboardingConfig({workspaceRoot,platformId}).config.commitIdentity || null;
  if (state.status !== 'verified-awaiting-governance-git' && !(allowPending && state.status==='configured-pending')) throw new Error('ONBOARDING_NOT_VERIFIED');
  const paths = onboardingGitPaths(workspaceRoot, platformId);
  const gitPlan = buildGitPlan({ workspaceRoot, action: 'commit', paths, message: `Register ${platformId} via graphical onboarding`, now });
  const requiresCommit = !!execFileSync('git', ['-C',workspaceRoot,'status','--porcelain','--',...paths],{encoding:'utf8',windowsHide:true}).trim();
  if (requiresCommit && (identity?.name || identity?.email)) {
    if (typeof identity.name !== 'string' || !identity.name.trim() || /[\r\n\0]/.test(identity.name) || typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) throw new Error('GIT_IDENTITY_REQUIRED');
    gitPlan.steps[0].identity = { name: identity.name.trim(), email: identity.email.trim() };
  } else if (requiresCommit) {
    const configured = ['user.name', 'user.email'].every((key) => { try { return execFileSync('git', ['-C',workspaceRoot,'config','--get',key],{encoding:'utf8',windowsHide:true}).trim(); } catch { return false; } });
    if (!configured) throw new Error('GIT_IDENTITY_REQUIRED');
  }
  return { ...gitPlan, kind: 'platform-finalize', planId: `finalize-${randomUUID()}`, target: { ...gitPlan.target, platformId, identity, requiresCommit, allowPending }, payload: { gitPlan }, verification: ['only the listed governance and platform config texts are committed', 'already committed targets require real readback, not an empty commit', allowPending?'configuration-only commit never closes pending onboarding':'real Git readback closes onboarding', 'never force push'] };
}

export function applyOnboardingFinalize(plan, options) {
  requirePlan(plan);
  const expected = buildOnboardingFinalizePlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, identity: plan.target.identity, allowPending:plan.target.allowPending, now: plan.generatedAt });
  if (JSON.stringify(expected.payload) !== JSON.stringify(plan.payload)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const staged = execFileSync('git', ['-C', plan.workspaceRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
  if (staged.some((path) => !expected.payload.gitPlan.target.paths.includes(path))) throw new Error('GIT_UNRELATED_STAGED_FILES');
  let transaction;
  if (expected.target.requiresCommit) transaction = applyGitTransaction({ plan: expected.payload.gitPlan, ...options });
  else {
    const auditRoot = options?.auditRoot || defaultAuditRoot();
    const now = options?.now || new Date().toISOString(); const id=makeId(plan,now);
    const checkpoint=saveCheckpoint(auditRoot,id,JSON.stringify({platformId:plan.target.platformId,workspaceRoot:plan.workspaceRoot,head:expected.target.headBefore,previousState:readOnboardingState({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId})}));
    transaction=writeAudit({actor:options?.actor || 'local-user',auditRoot,now,transactionId:id,plan,action:plan.kind,status:'already-committed',target:plan.target.platformId,checkpointPath:checkpoint.path,checkpointSha256:checkpoint.sha256,writePerformed:true});
  }
  const state = markOnboardingRecorded({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, allowPending:plan.target.allowPending });
  return { ...transaction, onboarding: state };
}
export function verifyOnboardingFinalize(plan) { const state=readOnboardingState({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId});return {ok:plan.target.allowPending?state.status==='configured-pending' && state.git?.configurationStatusClean===true:state.status==='complete',architectureComplete:state.status==='complete',writePerformed:false}; }
