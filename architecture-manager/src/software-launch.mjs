import {runScopedProcess as execFileSync} from './infrastructure/process-scope.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
// Connector-client launch (3.5.0 P5). The manager never dispatches software
// itself: it relays one JSON request to the platform's own connector exactly
// the way the engine does, and surfaces whatever the connector answers
// (INTERACTIVE_REQUIRED / CAPABILITY_UNAVAILABLE / drift) without rewording.
// allowGuiLaunch stays the gateway's own gate, not the manager's.
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isRegisteredPlatform } from './core/platforms.mjs';
import { defaultAuditRoot, targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { runnerConfig } from './software-publish.mjs';
import { makeId, output, requirePlan, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';

export function buildSoftwareConnectorLaunchPlan({ workspaceRoot, platformId, softwareId, now = new Date().toISOString() }) {
  if (!isRegisteredPlatform(platformId, workspaceRoot)) throw new Error('INVALID_PLATFORM');
  if (typeof softwareId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(softwareId)) throw new Error('INVALID_SOFTWARE_ID');
  const root = resolve(workspaceRoot);
  const connector = runnerConfig(root, platformId);
  const bodies = connector.value.bodies || {};
  if (!bodies[softwareId]) throw new Error('SOFTWARE_NOT_DECLARED');
  if (!existsSync(connector.gatewayPath)) throw new Error('SOFTWARE_CONNECTOR_ENTRY_MISSING');
  const interpreter = connector.value.interpreters?.['.py'] || 'python';
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `software-launch-${softwareId}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'software-launch',
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: {
      platformId,
      softwareId,
      bodyPath: bodies[softwareId],
      connectorPath: connector.gatewayPath,
      gatewayConfigPath: connector.path,
      interpreter,
      allowGuiLaunch: connector.value.allowGuiLaunch === true
    },
    steps: [{
      operation: 'relay-launch-request',
      connectorPath: connector.gatewayPath,
      gatewayConfigPath: connector.path,
      interpreter,
      request: { schema: 'ai-software-session/v1', kind: 'request', operation: 'open', softwareId, sessionKey: 'manager-software', holder: 'manager-ui', profile: 'administrator', timeoutSeconds: 60, consented: true }
    }],
    verification: ['the connector answer is relayed verbatim', 'the manager never claims a launch the connector did not report'],
    payload: { gatewaySha256: sha256(readFileSync(connector.path)), connectorSha256: sha256(readFileSync(connector.gatewayPath)) }
  };
}

export function applySoftwareLaunch({ plan }, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() } = {}) {
  requirePlan(plan);
  if (plan?.kind !== 'software-launch') throw new Error('INVALID_TRANSACTION_PLAN');
  const expected = buildSoftwareConnectorLaunchPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, softwareId: plan.target.softwareId, now: plan.generatedAt });
  if (JSON.stringify(plan.target) !== JSON.stringify(expected.target) || JSON.stringify(plan.steps) !== JSON.stringify(expected.steps) || JSON.stringify(plan.payload) !== JSON.stringify(expected.payload)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const target = plan.target;
  const step = plan.steps[0];
  const id = makeId(plan, now);
  const context = { actor, auditRoot, now };
  const checkpoint = saveCheckpoint(auditRoot, id, readFileSync(target.gatewayConfigPath, 'utf8'));
  const directory = targetPath(plan.workspaceRoot, `${target.platformId}/runtime/tmp/manager-launch`);
  mkdirSync(directory, { recursive: true });
  const requestConfig = join(directory, `${id}.json`);
  const gateway = parseJsonText(readFileSync(target.gatewayConfigPath, 'utf8'));
  // This copy grants only the exact confirmed session request; the base policy remains unchanged.
  writeFileSync(requestConfig, JSON.stringify({ ...gateway, allowGuiLaunch: true }), { flag: 'wx' });
  let stdout;
  try {
    stdout = execFileSync(step.interpreter, ['-B', step.connectorPath, '--config', requestConfig], {
      input: JSON.stringify({ ...step.request, requestId: id }),
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      shell: false
    });
  } catch (error) {
    writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: 'failed', target: `${target.platformId}/${target.softwareId}`, error: String(error.stderr || error.message).slice(0, 400), now });
    throw new Error('SOFTWARE_CONNECTOR_FAILED');
  } finally {
    rmSync(requestConfig, { force: true });
  }
  let reply;
  try {
    reply = parseJsonText(stdout);
  } catch {
    writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: 'failed', target: `${target.platformId}/${target.softwareId}`, error: 'connector output was not valid JSON', now });
    throw new Error('SOFTWARE_CONNECTOR_INVALID');
  }
  const connectorStatus = reply?.state || reply?.result?.status || reply?.error?.code || reply?.status || 'relayed';
  const responsePath = join(directory, `${plan.planId}.response.json`);
  const responseText = JSON.stringify(reply);
  writeFileSync(responsePath, responseText);
  const event = writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: reply?.ok === false ? 'blocked' : 'applied', target: `${target.platformId}/${target.softwareId}`, connectorStatus, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, writePerformed: false, now });
  return { ...output(event), connectorReply: reply, connectorStatus, evidencePath: responsePath, evidenceSha256: sha256(responseText), writePerformed: true };
}

export function verifySoftwareLaunch(plan) {
  const path = targetPath(plan.workspaceRoot, `${plan.target.platformId}/runtime/tmp/manager-launch/${plan.planId}.response.json`);
  if (!existsSync(path)) return { ok: false, writePerformed: false };
  const reply = parseJsonText(readFileSync(path, 'utf8'));
  return { ok: reply.ok === true, connectorStatus: reply.state || reply.result?.status || reply.error?.code, writePerformed: false };
}
