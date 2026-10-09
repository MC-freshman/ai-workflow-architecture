import {applyPlatformResourceDefault,verifyPlatformResourceDefault} from './domains/platforms/resource-defaults.mjs';
import {applyGlobalUpdate,verifyGlobalUpdate,applyGlobalUpdateRestore} from './domains/platforms/global-update.mjs';
import {auditPlanOperation} from './transactions/operation-audit.mjs';
import {applyAutomaticSoftware,verifyAutomaticSoftware} from './domains/intake/automatic-software.mjs';
import {applyGatewayMigration,verifyGatewayMigration} from './domains/software/gateway-migration.mjs';
import {applyNativeClient,verifyNativeClient} from './domains/platforms/native-client.mjs';
import {applyExistingSoftwareBinding,verifyExistingSoftwareBinding} from './domains/intake/software-binding.mjs';
import {restoreOwnedFiles} from './transactions/recovery.mjs';
import {applyNativeCredential,verifyNativeCredential,applyNativeCredentialProvider,verifyNativeCredentialProvider} from './domains/software/credentials.mjs';
import {applyPlatformBody,verifyPlatformBody} from './domains/intake/platform-body.mjs';
import {applySoftwareCommand,verifySoftwareCommand} from './domains/software/actions.mjs';
import {applyIntakePublication,verifyIntakePublication,revertIntakePublication,assertIntakeRevertPlan,verifyIntakeRevert} from './domains/intake/publication.mjs';
import { validateRegistry } from './domains/resources/registry.mjs';
import { parseJson } from './core/json.mjs';
import { existsSync, readFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { buildRegistryPlan } from './catalog.mjs';
import { buildDefectBookEditPlan } from './defects.mjs';
import { applyGitTransaction, verifyGitTransaction } from './git-executor.mjs';
import { applyRelease, verifyRelease } from './releases.mjs';
import { applySoftwareLaunch, verifySoftwareLaunch } from './software-launch.mjs';
import { applyPlatformScaffold, verifyPlatformScaffold } from './onboarding.mjs';
import { applyOnboardingConfig, verifyOnboardingConfig } from './onboarding-config.mjs';
import { applyAnchorAlignment, applyAnchorMaterialisation, verifyAnchorAlignment, verifyAnchorMaterialisation } from './domains/certification/anchor-plans.mjs';
import { applyOnboardingRuntime, verifyOnboardingRuntime, applyOnboardingBackend, verifyOnboardingBackend } from './onboarding-runtime.mjs';
import { applyOnboardingClient, verifyOnboardingClient } from './onboarding-client.mjs';
import { applyOnboardingProviders, verifyOnboardingProviders } from './onboarding-providers.mjs';
import { applyOnboardingAttestation, verifyOnboardingAttestation } from './onboarding-attestation.mjs';
import { applyOnboardingGovernance, verifyOnboardingGovernance } from './onboarding-governance.mjs';
import { applyOnboardingFinalize, verifyOnboardingFinalize } from './onboarding-finalize.mjs';
import { applyAutomaticOnboarding, verifyAutomaticOnboarding } from './onboarding-auto.mjs';
import { inspectPlatformDirectory } from './inventory.mjs';
import { buildIntegrationPlan } from './integration.mjs';
import { assertPublishedVersion } from './plans.mjs';
import { applySoftwareImport, verifySoftwareImport } from './software-intake.mjs';
import { applySoftwareRecipe, verifySoftwareRecipe } from './software-publish.mjs';
import { revertSoftwareTransaction, verifySoftwareRevert } from './software-recovery.mjs';
import { resolve } from 'node:path';
import { defaultAuditRoot, localViewPath, safeRelative, targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { atomicWrite, makeId, output, requirePlan, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';

export function applyPlan(options) {
  return auditPlanOperation(options, () => applyPlanImplementation(options));
}

function applyPlanImplementation({ plan, afterText = null, credentialValue = null, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), failAfterCheckpoint = false, onProgress = () => {} }) {
  if(plan.kind==='platform-global-update')return applyGlobalUpdate(plan,{actor,auditRoot,onProgress});
  if(plan.kind==='platform-global-update-restore')return applyGlobalUpdateRestore(plan,{actor,auditRoot});
  requirePlan(plan);
  if(plan.kind==='automatic-software-intake')return applyAutomaticSoftware(plan,{actor,auditRoot,onProgress});
  if(plan.kind==='platform-resource-default')return applyPlatformResourceDefault(plan,{actor,auditRoot,now,failAfterCheckpoint});
  if(plan.kind==='platform-native-client')return applyNativeClient(plan,{actor,auditRoot});
  if(plan.kind==='software-binding-migration')return applyGatewayMigration(plan,{actor,auditRoot,now});
  if(plan.kind==='software-binding')return applyExistingSoftwareBinding(plan,{actor,auditRoot,now});
  if(plan.kind==='mcp-credential')return applyNativeCredential(plan,{value:credentialValue,actor,auditRoot});
  if(plan.kind==='mcp-credential-provider')return applyNativeCredentialProvider(plan,{actor,auditRoot});
  if(plan.kind==='platform-body')return applyPlatformBody(plan,{actor,auditRoot,onProgress});
  if(plan.kind==='software-command')return applySoftwareCommand(plan,{actor,auditRoot});
  if(plan.kind==='body-import')return applyIntakePublication(plan,{actor,auditRoot,now,onProgress});
  if(plan.kind==='body-import-revert')return revertIntakePublication(assertIntakeRevertPlan(plan),{actor,auditRoot,now});
  if (plan.kind === 'document-edit') return applyDocument(plan, afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'defect-book-edit') return applyDefectBook(plan, afterText || plan.payload?.afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind?.startsWith('git-')) return applyGitTransaction({ plan, actor, auditRoot, now });
  if (plan.kind === 'release-publish') return applyRelease(plan, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'software-launch') return applySoftwareLaunch({ plan }, { actor, auditRoot, now });
  if (plan.kind === 'platform-scaffold') return applyPlatformScaffold(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-configuration') return applyOnboardingConfig(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-runtime') return applyOnboardingRuntime(plan, { actor, auditRoot, now, onProgress });
  if (plan.kind === 'platform-backend') return applyOnboardingBackend(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-client') return applyOnboardingClient(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-providers') return applyOnboardingProviders(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-attestation') return applyOnboardingAttestation(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-governance') return applyOnboardingGovernance(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-finalize') return applyOnboardingFinalize(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-onboarding') return applyAutomaticOnboarding(plan, { actor, auditRoot, now, onProgress });
  if (plan.kind === 'resource-pointer') return applyPointer(plan, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'platform-view') return applyPlatformView(plan, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'registry-edit') return applyRegistry(plan, afterText || plan.payload?.afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'integration-config' || plan.kind === 'integration-registry') return applyIntegration(plan, afterText || plan.payload?.afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'software-import') return applySoftwareImport({ plan }, { actor, auditRoot, now, failAfterCheckpoint, onProgress });
  if (plan.kind === 'software-recipe-publish') return applySoftwareRecipe({ plan }, { actor, auditRoot, now, failAfterCheckpoint, onProgress });
  if (plan.kind === 'software-revert') return revertSoftwareTransaction({ plan, auditRoot, actor, now });
  if (plan.kind === 'anchor-generation') return applyAnchorMaterialisation(plan, { actor, auditRoot, now });
  if (plan.kind === 'platform-anchor-alignment') return applyAnchorAlignment(plan, { actor, auditRoot, now });
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
}

function applyPlatformView(plan, context) {
  const platformId = plan.target?.platformId;
  const desired = plan.target?.desiredEnabled;
  if (typeof platformId !== 'string' || typeof desired !== 'boolean') throw new Error('INVALID_PLATFORM_STATE');
  const inspected = inspectPlatformDirectory(plan.workspaceRoot, platformId, plan.target.directoryRelative || platformId);
  if (desired && !inspected.validForView) throw new Error('PLATFORM_MARKERS_MISSING');
  const target = localViewPath(plan.workspaceRoot);
  const existed=existsSync(target);
  const before = existed ? readFileSync(target, 'utf8') : JSON.stringify({ schema: 'architecture-manager-view/v1', workspaceRoot: resolve(plan.workspaceRoot), enabled: {} }, null, 2);
  let state;
  try { state = parseJson(before); } catch { throw new Error('LOCAL_VIEW_CORRUPT'); }
  state.enabled = state.enabled && typeof state.enabled === 'object' ? state.enabled : {};
  const current = state.enabled[platformId] !== false;
  const id = makeId(plan, context.now);
  if (current === desired) return output(writeAudit({ ...context, transactionId: id, plan, action: 'platform-view', status: 'already-applied', target: `platform:${platformId}` }));
  if (current !== plan.target.currentEnabled) throw new Error('EXTERNAL_CHANGE_DETECTED');
  state.enabled[platformId] = desired;
  const after = `${JSON.stringify(state, null, 2)}\n`;
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) throw Object.assign(new Error('SIMULATED_INTERRUPT'), { checkpointPath: saved.path });
  try {
    mkdirSync(resolve(target, '..'), { recursive: true });
    atomicWrite(target, after, id);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'platform-view', status: 'applied', target: `platform:${platformId}`, oldSha256: sha256(before), newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before:existed?before:null,afterSha256:sha256(after)}],id);
    const audit=writeAudit({...context,transactionId:id,plan,action:plan.kind,status:recovered.ok?'recovered-after-failure':'failed-external-change',target,checkpointPath:saved.path,error:recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'});
    throw Object.assign(new Error(recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'),{audit,checkpointPath:saved.path,recovery:recovered});
  }
}

function applyRegistry(plan, afterText, context) {
  if (typeof afterText !== 'string') throw new Error('REGISTRY_PAYLOAD_REQUIRED');
  const relativeTarget = safeRelative(plan.target?.path);
  if (!(relativeTarget === 'agent/registry.json' || relativeTarget === 'tool/registry.json')) throw new Error('TRANSACTION_TARGET_NOT_ALLOWED');
  const target = targetPath(plan.workspaceRoot, relativeTarget);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const before = readFileSync(target, 'utf8');
  const expectedOld = plan.steps?.[0]?.oldSha256;
  const expectedNew = plan.steps?.[0]?.newSha256;
  const id = makeId(plan, context.now);
  if (sha256(before) === expectedNew) return output(writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'already-applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew }));
  if (sha256(before) !== expectedOld) throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'blocked-external-change', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' }) });
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const validated = buildRegistryPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.catalogKind, action: plan.target.action, id: plan.target.id, entry: plan.target.entry, baselineSha256: expectedOld });
  if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  parseJson(afterText);
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) throw Object.assign(new Error('SIMULATED_INTERRUPT'), { checkpointPath: saved.path });
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    return output(writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true }), saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before,afterSha256:expectedNew}],id);
    const audit=writeAudit({...context,transactionId:id,plan,action:plan.kind,status:recovered.ok?'recovered-after-failure':'failed-external-change',target:relativeTarget,checkpointPath:saved.path,error:recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'});
    throw Object.assign(new Error(recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'),{audit,checkpointPath:saved.path,recovery:recovered});
  }
}

function applyDocument(plan, afterText, context) {
  if (typeof afterText !== 'string') throw new Error('DOCUMENT_PAYLOAD_REQUIRED');
  const relativeTarget = safeRelative(plan.target?.path);
  const target = targetPath(plan.workspaceRoot, relativeTarget);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const step = plan.steps?.[0];
  const expectedOld = step?.oldSha256;
  const expectedNew = step?.newSha256;
  const before = readFileSync(target, 'utf8');
  const currentSha = sha256(before);
  const id = makeId(plan, context.now);
  if (currentSha === expectedNew) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'already-applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew });
    return output(event);
  }
  if (currentSha !== expectedOld) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'blocked-external-change', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'interrupted-before-write', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before,afterSha256:expectedNew}],id);
    if(!recovered.ok) {writeAudit({...context,transactionId:id,plan,action:plan.kind,status:'failed-external-change',target:relativeTarget,checkpointPath:saved.path,error:'RECOVERY_EXTERNAL_CHANGE'});throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:saved.path,recovery:recovered});}
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'recovered-after-failure', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

function applyDefectBook(plan, afterText, context) {
  const relativeTarget = safeRelative(plan.target?.path);
  if (relativeTarget !== 'versions/缺陷状态簿.json') throw new Error('TRANSACTION_TARGET_NOT_ALLOWED');
  const target = targetPath(plan.workspaceRoot, relativeTarget);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const before = readFileSync(target, 'utf8');
  const expectedOld = plan.steps?.[0]?.oldSha256;
  const expectedNew = plan.steps?.[0]?.newSha256;
  const id = makeId(plan, context.now);
  if (sha256(before) === expectedNew) return output(writeAudit({ ...context, transactionId: id, plan, action: 'defect-book-edit', status: 'already-applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew }));
  if (sha256(before) !== expectedOld) throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: writeAudit({ ...context, transactionId: id, plan, action: 'defect-book-edit', status: 'blocked-external-change', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' }) });
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const validated = buildDefectBookEditPlan({ workspaceRoot: plan.workspaceRoot, operation: plan.target.operation, rowId: plan.target.rowId, newStatus: plan.target.newStatus, row: plan.target.row ?? null, note: plan.target.note ?? null, baselineSha256: sha256(before) });
  if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  parseJson(afterText);
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'defect-book-edit', status: 'interrupted-before-write', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    return output(writeAudit({ ...context, transactionId: id, plan, action: 'defect-book-edit', status: 'applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true }), saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before,afterSha256:expectedNew}],id);
    const audit=writeAudit({...context,transactionId:id,plan,action:plan.kind,status:recovered.ok?'recovered-after-failure':'failed-external-change',target:relativeTarget,checkpointPath:saved.path,error:recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'});
    throw Object.assign(new Error(recovered.ok?error.message:'RECOVERY_EXTERNAL_CHANGE'),{audit,checkpointPath:saved.path,recovery:recovered});
  }
}

function applyPointer(plan, context) {
  const targetRelative = `${plan.target?.repository}/${plan.target?.resourceId}/current.json`;
  const target = targetPath(plan.workspaceRoot, targetRelative);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const step = plan.steps?.[0];
  if (!step?.oldSha256) throw new Error('POINTER_BASELINE_REQUIRED');
  const before = readFileSync(target, 'utf8');
  const parsed = parseJson(before);
  const currentVersion = parsed?.version;
  const expectedOld = plan.target?.currentVersion;
  const expectedNew = plan.target?.targetVersion;
  assertPublishedVersion(plan.workspaceRoot, plan.target?.repository, plan.target?.resourceId, expectedNew);
  const id = makeId(plan, context.now);
  if (currentVersion === expectedNew) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'already-applied', target: targetRelative, oldSha256: step.oldSha256 });
    return output(event);
  }
  if (currentVersion !== expectedOld || sha256(before) !== step.oldSha256) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'blocked-external-change', target: targetRelative, oldSha256: step.oldSha256, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  const next = { ...parsed, version: expectedNew };
  const after = `${JSON.stringify(next, null, 2)}\n`;
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'interrupted-before-write', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, after, id);
    const actual = parseJson(readFileSync(target, 'utf8'));
    if (actual.version !== expectedNew) throw new Error('VERIFY_FAILED');
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'applied', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before,afterSha256:typeof expectedNew==='string' && /^[0-9a-f]{64}$/.test(expectedNew)?expectedNew:sha256(after)}],id);
    if(!recovered.ok) {writeAudit({...context,transactionId:id,plan,action:plan.kind,status:'failed-external-change',target:targetRelative,checkpointPath:saved.path,error:'RECOVERY_EXTERNAL_CHANGE'});throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:saved.path,recovery:recovered});}
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'recovered-after-failure', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

function applyIntegration(plan, afterText, context) {
  const targetRelative = safeRelative(plan.target?.path);
  const target = targetPath(plan.workspaceRoot, targetRelative);
  const step = plan.steps?.[0];
  const expectedOld = step?.oldSha256 ?? null;
  const expectedNew = step?.newSha256;
  if (typeof expectedNew !== 'string') throw new Error('INVALID_TRANSACTION_PLAN');
  const exists = existsSync(target);
  const before = exists ? readFileSync(target, 'utf8') : '';
  const currentSha = exists ? sha256(before) : null;
  const companionStep = plan.kind === 'integration-config' ? plan.steps?.[1] : null;
  if (companionStep && ![`${plan.target.targetId}/bridge/runner-config.json`, `${plan.target.targetId}/bridge/${plan.target.targetId}-config.json`].includes(companionStep.target)) throw new Error('INVALID_TRANSACTION_PLAN');
  const companion = companionStep ? targetPath(plan.workspaceRoot, safeRelative(companionStep.target)) : null;
  const companionBefore = companion ? readFileSync(companion, 'utf8') : null;
  const companionSha = companion ? sha256(companionBefore) : null;
  if (companion && sha256(plan.payload?.companionAfterText || '') !== companionStep.newSha256) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const id = makeId(plan, context.now);
  if (currentSha === expectedNew && (!companion || companionSha === companionStep.newSha256)) return output(writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'already-applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew }));
  if (currentSha !== expectedOld || (companion && companionSha !== companionStep.oldSha256)) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'blocked-external-change', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  if (typeof afterText !== 'string') throw new Error('INTEGRATION_PAYLOAD_REQUIRED');
  try { parseJson(afterText); } catch { throw new Error('INTEGRATION_JSON_INVALID'); }
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const validated = buildIntegrationPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.kind, targetId: plan.target.targetId, mode: plan.target.mode, relativePath: targetRelative, beforeText: before, afterText, baselineSha256: currentSha });
  if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  if (JSON.stringify(validated.steps[1] || null) !== JSON.stringify(companionStep || null) || (validated.payload?.companionAfterText || null) !== (plan.payload?.companionAfterText || null)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const parent = resolve(target, '..');
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error('INTEGRATION_PARENT_NOT_FOUND');
  const saved = saveCheckpoint(context.auditRoot, id, before);
  const companionSaved = companion ? saveCheckpoint(context.auditRoot, `${id}-runner`, companionBefore) : null;
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'interrupted-before-write', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    if (companion) {
      atomicWrite(companion, plan.payload.companionAfterText, `${id}-runner`);
      if (sha256(readFileSync(companion, 'utf8')) !== companionStep.newSha256) throw new Error('VERIFY_FAILED');
    }
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    const recovered=restoreOwnedFiles([{target,before:exists?before:null,afterSha256:expectedNew},...(companion?[{target:companion,before:companionBefore,afterSha256:companionStep.newSha256}]:[])],id);
    if(!recovered.ok) {writeAudit({...context,transactionId:id,plan,action:plan.kind,status:'failed-external-change',target:targetRelative,checkpointPath:saved.path,error:'RECOVERY_EXTERNAL_CHANGE'});throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:saved.path,recovery:recovered});}
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'recovered-after-failure', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

export function verifyPlanTarget({ plan }) {
  if(plan.kind==='platform-global-update')return verifyGlobalUpdate(plan);
  if(plan.kind==='platform-global-update-restore')return {ok:plan.payload.files.every(file=>(existsSync(targetPath(plan.workspaceRoot,file.path))?sha256(readFileSync(targetPath(plan.workspaceRoot,file.path))):null)===(file.before===null?null:sha256(file.before))),writePerformed:false};
  if(plan.kind==='mcp-credential')return verifyNativeCredential(plan);
  if(plan.kind==='mcp-credential-provider')return verifyNativeCredentialProvider(plan);
  if(plan.kind==='software-command')return verifySoftwareCommand(plan);
  if(plan.kind==='platform-body')return verifyPlatformBody(plan);
  requirePlan(plan);
  if(plan.kind==='body-import')return verifyIntakePublication({plan});
  if(plan.kind==='body-import-revert')return verifyIntakeRevert(plan);
  if (plan.kind === 'platform-scaffold') return verifyPlatformScaffold(plan);
  if (plan.kind === 'platform-configuration') return verifyOnboardingConfig(plan);
  if (plan.kind === 'platform-runtime') return verifyOnboardingRuntime(plan);
  if (plan.kind === 'platform-backend') return verifyOnboardingBackend(plan);
  if (plan.kind === 'platform-client') return verifyOnboardingClient(plan);
  if (plan.kind === 'platform-native-client') return verifyNativeClient(plan);
  if (plan.kind === 'platform-providers') return verifyOnboardingProviders(plan);
  if(plan.kind==='software-binding-migration')return verifyGatewayMigration(plan);
  if(plan.kind==='software-binding')return verifyExistingSoftwareBinding(plan);
  if (plan.kind === 'platform-attestation') return verifyOnboardingAttestation(plan);
  if (plan.kind === 'platform-governance') return verifyOnboardingGovernance(plan);
  if (plan.kind === 'platform-finalize') return verifyOnboardingFinalize(plan);
  if (plan.kind === 'platform-onboarding') return verifyAutomaticOnboarding(plan);
  if (plan.kind?.startsWith('git-')) return verifyGitTransaction({ plan });
  if (plan.kind === 'release-publish') return verifyRelease({ plan });
  if (plan.kind === 'software-launch') return verifySoftwareLaunch(plan);
  if (plan.kind === 'software-import') return verifySoftwareImport({ plan });
  if (plan.kind === 'software-recipe-publish') return verifySoftwareRecipe({ plan });
  if (plan.kind === 'software-revert') return verifySoftwareRevert({ plan });
  if (plan.kind === 'anchor-generation') return verifyAnchorMaterialisation(plan);
  if (plan.kind === 'platform-anchor-alignment') return verifyAnchorAlignment(plan);
  if (plan.kind === 'document-edit') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const content = readFileSync(target, 'utf8');
    const actual = sha256(content);
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  if (plan.kind === 'defect-book-edit') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const actual = sha256(readFileSync(target, 'utf8'));
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  if (plan.kind === 'resource-pointer') {
    const targetRelative = `${plan.target.repository}/${plan.target.resourceId}/current.json`;
    const target = targetPath(plan.workspaceRoot, targetRelative);
    const current = parseJson(readFileSync(target, 'utf8'));
    let valid=true;try {assertPublishedVersion(plan.workspaceRoot,plan.target.repository,plan.target.resourceId,plan.target.targetVersion);} catch {valid=false;}
    return { schema: 'architecture-manager-verification/v1', ok: valid && current.version === plan.target.targetVersion, target: targetRelative, actualVersion: current.version, expectedVersion: plan.target.targetVersion, writePerformed: false };
  }
  if(plan.kind==='platform-resource-default')return verifyPlatformResourceDefault(plan);
  if(plan.kind==='automatic-software-intake')return verifyAutomaticSoftware(plan);
  if (plan.kind === 'platform-view') {
    const path = localViewPath(plan.workspaceRoot);
    const state = existsSync(path) ? parseJson(readFileSync(path, 'utf8')) : { enabled: {} };
    const actual = state.enabled?.[plan.target.platformId] !== false;
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.target.desiredEnabled, target: `platform:${plan.target.platformId}`, actualEnabled: actual, expectedEnabled: plan.target.desiredEnabled, writePerformed: false };
  }
  if (plan.kind === 'registry-edit') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const actual = sha256(readFileSync(target, 'utf8'));
    const companionStep = plan.steps?.[1];
    const companionSha = companionStep ? sha256(readFileSync(targetPath(plan.workspaceRoot, companionStep.target), 'utf8')) : null;
    let valid=true;try {validateRegistry(plan.workspaceRoot,plan.target.path.split('/')[0],readFileSync(target,'utf8'),{validateReleases:plan.target.action==='add'||plan.target.action==='enable',onlyIds:new Set([plan.target.id])});} catch {valid=false;}
    return { schema: 'architecture-manager-verification/v1', ok: valid && actual === plan.steps[0].newSha256 && (!companionStep || companionSha === companionStep.newSha256), target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, companionSha256: companionSha, writePerformed: false };
  }
  if (plan.kind === 'integration-config' || plan.kind === 'integration-registry') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const actual = sha256(readFileSync(target, 'utf8'));
    let valid=true;
    if(plan.kind==='integration-registry') try {validateRegistry(plan.workspaceRoot,plan.target.kind,readFileSync(target,'utf8'));} catch {valid=false;}
    return { schema: 'architecture-manager-verification/v1', ok: valid && actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
}
