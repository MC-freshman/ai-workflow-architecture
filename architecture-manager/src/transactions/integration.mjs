import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeRelative, targetPath } from '../core/paths.mjs';
import { sha256 } from '../core/hash.mjs';
import { parseJson } from '../core/json.mjs';
import { buildIntegrationPlan } from '../domains/platforms/integration.mjs';
import { atomicWrite, makeId, output, saveCheckpoint, writeAudit } from './kernel.mjs';
import { prepareRecovery, completeRecovery, resumeRecovery, resumePendingRecoveries } from './recovery-journal.mjs';

export function applyIntegration(plan, afterText, context) {
  const targetRelative = safeRelative(plan.target?.path);
  const target = targetPath(plan.workspaceRoot, targetRelative);
  const recoveryTargets=[target,...plan.steps.filter(step=>['update-runner-bridge-reference','sync-bridge-mirror'].includes(step.operation)).map(step=>targetPath(plan.workspaceRoot,step.target))];
  resumePendingRecoveries({auditRoot:context.auditRoot,workspaceRoot:plan.workspaceRoot,targets:recoveryTargets});
  const step = plan.steps?.[0];
  const expectedOld = step?.oldSha256 ?? null;
  const expectedNew = step?.newSha256;
  if (typeof expectedNew !== 'string') throw new Error('INVALID_TRANSACTION_PLAN');
  const exists = existsSync(target);
  const before = exists ? readFileSync(target, 'utf8') : '';
  const currentSha = exists ? sha256(before) : null;
  const companionStep = plan.kind === 'integration-config' ? plan.steps.find(step=>step.operation==='update-runner-bridge-reference') : null;
  if (companionStep && ![`${plan.target.targetId}/bridge/runner-config.json`, `${plan.target.targetId}/bridge/${plan.target.targetId}-config.json`].includes(companionStep.target)) throw new Error('INVALID_TRANSACTION_PLAN');
  const companion = companionStep ? targetPath(plan.workspaceRoot, safeRelative(companionStep.target)) : null;
  const companionBefore = companion ? readFileSync(companion, 'utf8') : null;
  const companionSha = companion ? sha256(companionBefore) : null;
  const mirrors=(plan.payload?.mirrors || []).map(file=>{
    if(plan.target.kind!=='platform' || file.path!==`${plan.target.targetId}/bridge/bridge.json`)throw Error('INVALID_TRANSACTION_PLAN');
    const target=targetPath(plan.workspaceRoot,file.path),step=plan.steps.find(row=>row.operation==='sync-bridge-mirror' && row.target===file.path),before=readFileSync(target,'utf8');
    if(!step || sha256(file.afterText)!==step.newSha256)throw Error('PLAN_PAYLOAD_MISMATCH');
    return {...file,target,step,before,sha256:sha256(before)};
  });
  if (companion && sha256(plan.payload?.companionAfterText || '') !== companionStep.newSha256) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const id = makeId(plan, context.now);
  if (currentSha === expectedNew && (!companion || companionSha === companionStep.newSha256) && mirrors.every(file=>file.sha256===file.step.newSha256)) return output(writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'already-applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew }));
  if (currentSha !== expectedOld || (companion && companionSha !== companionStep.oldSha256) || mirrors.some(file=>file.sha256!==file.step.oldSha256)) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'blocked-external-change', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  if (typeof afterText !== 'string') throw new Error('INTEGRATION_PAYLOAD_REQUIRED');
  try { parseJson(afterText); } catch { throw new Error('INTEGRATION_JSON_INVALID'); }
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const validated = buildIntegrationPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.kind, targetId: plan.target.targetId, mode: plan.target.mode, relativePath: targetRelative, beforeText: before, afterText, baselineSha256: currentSha });
  if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  if (JSON.stringify(validated.steps) !== JSON.stringify(plan.steps) || JSON.stringify(validated.payload) !== JSON.stringify(plan.payload)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const parent = resolve(target, '..');
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error('INTEGRATION_PARENT_NOT_FOUND');
  const saved = saveCheckpoint(context.auditRoot, id, before);
  const companionSaved = companion ? saveCheckpoint(context.auditRoot, `${id}-runner`, companionBefore) : null;
  for(const file of mirrors)saveCheckpoint(context.auditRoot,`${id}-mirror`,file.before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'interrupted-before-write', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  const recoveryPath=prepareRecovery({auditRoot:context.auditRoot,workspaceRoot:plan.workspaceRoot,transactionId:id,entries:[{target,before:exists?before:null,afterSha256:expectedNew},...(companion?[{target:companion,before:companionBefore,afterSha256:companionStep.newSha256}]:[]),...mirrors.map(file=>({target:file.target,before:file.before,afterSha256:file.step.newSha256}))]});
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    if (companion) {
      atomicWrite(companion, plan.payload.companionAfterText, `${id}-runner`);
      if (sha256(readFileSync(companion, 'utf8')) !== companionStep.newSha256) throw new Error('VERIFY_FAILED');
    }
    for(const file of mirrors){if(sha256(readFileSync(file.target))!==file.sha256)throw Error('EXTERNAL_CHANGE_DETECTED');atomicWrite(file.target,file.afterText,`${id}-mirror`);if(sha256(readFileSync(file.target))!==file.step.newSha256)throw Error('VERIFY_FAILED');}
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    completeRecovery(context.auditRoot,recoveryPath);
    return output(event, saved.path);
  } catch (error) {
    const recovered=resumeRecovery(context.auditRoot,recoveryPath);
    if(!recovered.ok) {writeAudit({...context,transactionId:id,plan,action:plan.kind,status:'failed-external-change',target:targetRelative,checkpointPath:saved.path,error:'RECOVERY_EXTERNAL_CHANGE'});throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:saved.path,recovery:recovered});}
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'recovered-after-failure', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

