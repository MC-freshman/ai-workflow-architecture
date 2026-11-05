import {randomUUID} from 'node:crypto';
import {defaultAuditRoot} from '../core/paths.mjs';
import {auditContext} from './audit-context.mjs';
import {writeAudit} from './kernel.mjs';

// Domain receipts/checkpoints remain authoritative. This boundary captures
// calls that fail before a domain can write its own receipt, including retries.
export function auditPlanOperation(options, execute) {
  const {plan, actor = 'local-user', auditRoot = defaultAuditRoot(), credentialValue} = options || {};
  const parent = auditContext.getStore();
  const operationId = 'operation-' + randomUUID();
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,180}$/.test(value);
  const safePlan = {planId:validId(plan?.planId)?plan.planId:'invalid-plan',workspaceRoot:typeof plan?.workspaceRoot==='string'?plan.workspaceRoot:null};
  const action = validId(plan?.kind) ? plan.kind : 'invalid-plan';
  // AUD-D-014: the operation-level target kept only path/platformId/resourceId, so plans that
  // address a repository resource, a software body or a credential reference audited as their
  // action name. Name every address form the domains actually use.
  const target = plan?.target?.path
    || plan?.target?.platformId
    || plan?.target?.reference
    || (plan?.target?.repository && plan?.target?.resourceId ? `${plan.target.repository}/${plan.target.resourceId}` : null)
    || plan?.target?.resourceId
    || plan?.target?.softwareId
    || plan?.target?.id
    || action;
  const context = {operationId,parentOperationId:parent?.operationId || null,planId:safePlan.planId,secrets:[...(parent?.secrets || []),credentialValue].filter(v=>typeof v==='string' && v)};
  return auditContext.run(context, () => {
    const common = {auditRoot,transactionId:operationId,plan:safePlan,actor,action,target:typeof target==='string'?target:action,phase:'operation'};
    writeAudit({...common,status:'started',writePerformed:false});
    const failed = error => {
      const checkpoint=context.checkpoints?.at(-1);
      try { writeAudit({...common,status:error?.message==='TASK_CANCELLED' || error?.message==='ONBOARDING_CANCELLED'?'cancelled':'failed',writePerformed:null,checkpointPath:checkpoint?.path || null,checkpointSha256:checkpoint?.sha256 || null,error:String(error?.message ?? error)}); }
      catch { /* Preserve the original failure; never retry a dispatched call. */ }
      throw error;
    };
    const succeeded = result => {
      try {
        const checkpoint=context.checkpoints?.at(-1);
        writeAudit({...common,status:result?.status==='already-applied'?'already-applied':result?.status==='blocked'?'blocked':'completed',writePerformed:typeof result?.writePerformed==='boolean'?result.writePerformed:null,checkpointPath:result?.checkpointPath || checkpoint?.path || null,checkpointSha256:result?.checkpointSha256 || checkpoint?.sha256 || null,newSha256:result?.newSha256 || null});
      } catch {
        throw Object.assign(new Error('AUDIT_FINALIZATION_FAILED'),{writePerformed:result?.writePerformed ?? null,operationId});
      }
      return result;
    };
    let result;
    try { result = execute(); } catch (error) { return failed(error); }
    return result && typeof result.then==='function' ? result.then(succeeded,failed) : succeeded(result);
  });
}
