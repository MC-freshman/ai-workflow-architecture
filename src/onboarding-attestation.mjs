import {parseJson as parseJsonText} from './core/json.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from './transactions/onboarding-files.mjs';
import { runtimeFile } from './core/runtime-path.mjs';
import { runOwnedProcess } from './core/owned-process.mjs';
const run = promisify(execFile);
const json = (data) => `${JSON.stringify(data, null, 2)}\n`;
const load = (path) => parseJsonText(readFileSync(path, 'utf8'));

export async function probeOnboardingCapabilities({ workspaceRoot, platformId }, { onProgress = () => {}, registerCancel = () => {} } = {}) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const directory = targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding/capabilities/${randomUUID()}`); mkdirSync(directory, { recursive: true });
  const output = join(directory, 'probe.json'); onProgress({ platformId, phase: '验证隔离、调用、委派与软件边界' });
  const process = await runOwnedProcess({ python: snapshot.fields.pythonExecutable, args: ['-B', runtimeFile('capability_probe.py'), targetPath(workspaceRoot, snapshot.configPath), output], cwd: directory, timeout: 1800000, registerCancel });
  if (process.cancelled) throw new Error('ONBOARDING_CANCELLED');
  if (process.exitCode !== 0 || !existsSync(output)) throw new Error('ONBOARDING_CAPABILITY_PROBE_FAILED');
  return { ...load(output), evidencePath: output, evidenceSha256: sha256(readFileSync(output)), writePerformed: true };
}

export function buildOnboardingAttestationPlan({ workspaceRoot, platformId, evidencePath, now = new Date().toISOString() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const prefix = targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding/capabilities`) + '\\';
  if (!evidencePath?.startsWith(prefix)) throw new Error('PLATFORM_CONFIGURATION_PATH_MISMATCH');
  const proof = load(evidencePath);
  if (proof.platformId !== platformId || proof.configSha256 !== sha256(readFileSync(targetPath(workspaceRoot, snapshot.configPath)))) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const path = `${platformId}/bridge/capabilities.json`; const capabilities = load(targetPath(workspaceRoot, path));
  capabilities.checks = { ...capabilities.checks }; capabilities.descriptor ||= { schema: 'ai-platform-descriptor/v2', platformId, protocols: ['ai-run-protocol/v1.1', 'ai-run-protocol/v1.2', 'ai-run-protocol/v1.3'], operations: ['prepare', 'next', 'submit', 'status', 'stop'], recovery: ['replay'], actions: {}, profiles: {} };
  capabilities.descriptor.actions ||= {}; capabilities.descriptor.profiles ||= {}; capabilities.declaredAbsent ||= {}; capabilities.gapPlan ||= {};
  for (const [action, key] of [['prompt', 'prompt-stage-claim'], ['script', 'script-environment-isolation-jail'], ['peer', 'peerDispatch'], ['software-call', 'software-call']]) {
    if (proof.checks[key] === true) { capabilities.checks[key] = true; capabilities.descriptor.actions[action] = { supported: true, enforcement: action === 'script' ? 'kernel' : 'mediated', evidencePath, evidenceSha256: sha256(readFileSync(evidencePath)) }; delete capabilities.declaredAbsent[`action:${action}`]; }
    else capabilities.gapPlan[`action:${action}`] = { path: '回到接入向导修复运行环境或 provider 后重新运行能力探针', costMinutes: 30 };
  }
  // Reaching this point means the probe ran a real prepare/claim/stop, so those two legacy checks now
  // hold evidence; any other stale false stays as it is and keeps the platform gated.
  const legacyProof = { 'runner-protocol-prepare': proof.prompt?.prepareOk === true, 'terminal-stop-with-evidence': proof.prompt?.stopOk === true };
  for (const [key, proven] of Object.entries(legacyProof)) if (capabilities.checks[key] === false && proven) capabilities.checks[key] = true;
  if (proof.checks['administrator-consent-denied']) { capabilities.descriptor.profiles.administrator = { declared: true, adapters: ['per-call-connector-consent'], evidencePath, elevatedDuringProbe: false }; delete capabilities.declaredAbsent['profile:administrator']; }
  if (proof.jail?.checks?.renderer === true) {
    capabilities.profiles ||= {};
    capabilities.profiles.renderer = { adapters: ['matplotlib-adapter-first'], requires: ['matplotlib'], evidencePath, evidenceSha256: sha256(readFileSync(evidencePath)) };
    capabilities.descriptor.profiles.renderer = { declared: true, adapters: ['matplotlib-adapter-first'], evidencePath };
    delete capabilities.declaredAbsent['profile:renderer'];
  }
  if (proof.checks['script-environment-isolation-jail']) {
    const triples = [{ filesystem: 'project-scoped', network: 'deny', process: 'allowlisted-only' }, { filesystem: 'platform-runtime-write-shared-read-only', network: 'deny', process: 'isolated-python' }, { filesystem: 'shared-read-only-platform-report-write', network: 'deny', process: 'none' }];
    capabilities.permissionAdapters = [...(capabilities.permissionAdapters || []).filter((a) => !triples.some((b) => a.filesystem === b.filesystem && a.network === b.network && a.process === b.process)), ...triples.map((triple) => ({ ...triple, evidence: `Target-platform jail probe ${evidencePath} sha256=${sha256(readFileSync(evidencePath))}` }))];
    capabilities.descriptor.profiles['python>=3.8'] = { declared: true, adapters: ['verified-platform-python'], evidencePath };
    const environment = load(snapshot.config.environmentManifest);
    for (const name of Object.keys(environment.packages || {})) delete capabilities.declaredAbsent[`python-package:${name}`];
  }
  for (const row of proof.software || []) if (!row.dispatchable) capabilities.gapPlan[`software:${row.softwareId}`] = { path: '在软件中心绑定正确版本本体并完成配方快照，回到向导重试', costMinutes: 20 };
  const environmentPath = `${platformId}/runtime/software/software-environment.json`;
  const previousEnvironment = existsSync(targetPath(workspaceRoot, environmentPath)) ? load(targetPath(workspaceRoot, environmentPath)) : { schema: 'ai-software-environment/v1', platformId, bodies: {} };
  const softwareEnvironment = { ...previousEnvironment, bodies: { ...previousEnvironment.bodies } };
  for (const row of proof.software || []) if (row.bodyDigest === 'ok') softwareEnvironment.bodies[row.softwareId] = { ...softwareEnvironment.bodies[row.softwareId], digestStatus: 'ok', evidencePath, evidenceSha256: sha256(readFileSync(evidencePath)), softwareVersion: row.softwareVersion };
  const files = plannedFiles(workspaceRoot, [{ path, content: json(capabilities) }, { path: environmentPath, content: json(softwareEnvironment) }]);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-attestation', planId: `attestation-${randomUUID()}`, workspaceRoot, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, evidencePath, evidenceSha256: sha256(readFileSync(evidencePath)) }, payload: { files }, steps: files.map((file) => ({ operation: 'activate-probed-capabilities', target: file.path, oldSha256: file.beforeSha256, newSha256: file.newSha256 })), verification: ['only true probe results change capability declarations', 'evidence belongs to target config', 'floor is independently calculated by shared conform'] };
}
export function applyOnboardingAttestation(plan, options) { return applyGeneratedFiles(plan, () => { if (sha256(readFileSync(plan.target.evidencePath)) !== plan.target.evidenceSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH'); return buildOnboardingAttestationPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, evidencePath: plan.target.evidencePath, now: plan.generatedAt }); }, options); }
export const verifyOnboardingAttestation = verifyFiles;
