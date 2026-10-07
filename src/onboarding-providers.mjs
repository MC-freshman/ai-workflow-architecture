import {gatewayBinding} from './domains/software/gateway-binding.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readOnboardingConfig, assertConfigurationReferences } from './onboarding-config.mjs';
import { targetPath } from './core/paths.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from './transactions/onboarding-files.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function buildOnboardingProvidersPlan({ workspaceRoot, platformId, bodies = {}, interpreterAliases = {}, now = new Date().toISOString() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId }); const root = snapshot.config.platformRoot;
  if (!snapshot.exists || !snapshot.config.platform) throw new Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const python = snapshot.fields.pythonExecutable;
  if (!python || !existsSync(python)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  const registered = parseJsonText(readFileSync(targetPath(workspaceRoot, 'software/registry.json'), 'utf8')).software || [];
  for (const [id, path] of Object.entries(bodies)) {
    if (!registered.some((item) => item.id === id) || typeof path !== 'string' || !existsSync(path)) throw new Error('SOFTWARE_BODY_PATH_NOT_FOUND');
  }
  for (const path of Object.values(interpreterAliases)) if (!existsSync(path)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  const providerPath = `${platformId}/bridge/manager-providers/platform_provider.py`;
  const providerRoot = targetPath(workspaceRoot, `${platformId}/runtime/software/provider-state`);
  const command = (operation) => [python, '-B', targetPath(workspaceRoot, providerPath), operation, providerRoot];
  const binding=gatewayBinding(workspaceRoot,platformId,snapshot.config),gatewayPath=binding.relativePath,oldGateway=binding.value;
  const gateway = { ...oldGateway, softwareRoot: snapshot.config.softwareRoot, lockRoot: targetPath(workspaceRoot, `${platformId}/runtime/software/locks`), evidenceRoot: targetPath(workspaceRoot, `${platformId}/runtime/software/evidence`), bodies: { ...oldGateway.bodies, ...bodies }, interpreterAliases: { ...oldGateway.interpreterAliases, ...interpreterAliases }, interpreters: { ...oldGateway.interpreters, '.py': python }, credentialProvider: command('credential'), sessionLaunch: command('launch'), sessionLiveness: command('liveness'), sessionTerminate: command('terminate'), credentialWorkspace: targetPath(workspaceRoot, `${platformId}/runtime/software/credentials`), allowGuiLaunch: false, projectWriteRoots: snapshot.config.projectWriteRoots, artifactRoots: [targetPath(workspaceRoot, `${platformId}/runtime/software`)], softwareProfiles: { ...oldGateway.softwareProfiles, 'readonly-version': { filesystem: ['none', 'read'], network: ['none'], credentials: ['none'] }, administrator: { filesystem: ['none', 'read', 'system'], network: ['none'], credentials: ['none'], consentPolicy: 'per-call-user-confirmation' } } };
  gateway.platformId = platformId;
  gateway.platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
  const config = { ...snapshot.config, softwareGatewayConfig: targetPath(workspaceRoot, gatewayPath), softwareEnvironment: snapshot.config.softwareEnvironment || targetPath(workspaceRoot, `${platformId}/runtime/software/software-environment.json`), peerDispatcherModule: targetPath(workspaceRoot, `${platformId}/bridge/manager-providers/peer_dispatcher.py`), peerContentRoot: snapshot.config.peerContentRoot || targetPath(workspaceRoot, `${platformId}/runtime/peer-content`) };
  const files = ['platform_provider.py', 'peer_dispatcher.py'].map((name) => ({ path: `${platformId}/bridge/manager-providers/${name}`, content: readFileSync(fileURLToPath(new URL(`./runtime/${name}`, import.meta.url)), 'utf8') }));
  files.push({ path: snapshot.configPath, content: json(config) }, { path: gatewayPath, content: json(gateway) }, { path: `${platformId}/bridge/manager-providers/dispatcher-config.json`, content: json({ runnerConfig: targetPath(workspaceRoot, snapshot.configPath) }) });
  files.forEach((file) => { if (file.path.endsWith('.json')) assertConfigurationReferences(parseJsonText(file.content)); });
  const planned = plannedFiles(workspaceRoot, files);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-providers', planId: `providers-${randomUUID()}`, workspaceRoot, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, bodies, interpreterAliases }, payload: { files: planned }, steps: planned.map((file) => ({ operation: 'bind-platform-provider', target: file.path, oldSha256: file.beforeSha256, newSha256: file.newSha256 })), recoveredBindings:binding.recovered,verification: ['credential references only; values use Windows Credential Manager', 'no permanent GUI or administrator grant', 'software health and peer dispatch require separate live probes'] };
}
export function applyOnboardingProviders(plan, options) { return applyGeneratedFiles(plan, () => buildOnboardingProvidersPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, bodies: plan.target.bodies, interpreterAliases: plan.target.interpreterAliases, now: plan.generatedAt }), options); }
export const verifyOnboardingProviders = verifyFiles;
