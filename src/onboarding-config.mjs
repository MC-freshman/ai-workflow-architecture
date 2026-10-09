import {platformPath} from './core/platform-path.mjs';
import {bridgeCompatibility,normaliseRunner} from './domains/platforms/bridge-compatibility.mjs';
import {reconcileHostManifest} from './domains/platforms/host-manifest.mjs';
import {providerTemplateStatus} from './domains/platforms/provider-templates.mjs';
import {gatewayBinding,assertGatewaySelection} from './domains/software/gateway-binding.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
// Configuration plans for an existing or new platform. All generated paths are
// derived from the selected workspace; platform-specific state never becomes shared code.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './core/hash.mjs';
import { targetPath, defaultAuditRoot } from './core/paths.mjs';
import { validPlatformId } from './core/platforms.mjs';
import { assertPublishedVersion } from './plans.mjs';
import {recommendedCertificationPair,recommendedMatrixVersion} from './domains/certification/releases.mjs';
import {onboardingResumePreview} from './domains/platforms/onboarding-resume.mjs';
import { atomicWrite, makeId, output, requirePlan, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';

const stringify = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (path, fallback = {}) => existsSync(path) ? parseJsonText(readFileSync(path, 'utf8')) : fallback;
const SECRET = /password|passwd|secret|token|api[_-]?key|private[_-]?key/i;

export function assertConfigurationReferences(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'contextWindowTokens' && SECRET.test(key) && typeof item === 'string' && item && !item.startsWith('reference:') && !item.startsWith('${')) throw new Error(`RAW_SECRET_NOT_ALLOWED:${key}`);
    if (item && typeof item === 'object') assertConfigurationReferences(item);
  }
}

function context(workspaceRoot, platformId) {
  const root = resolve(workspaceRoot);
  if (!validPlatformId(platformId)) throw new Error('INVALID_PLATFORM_ID');
  targetPath(root, platformId);
  const configPath = [`${platformId}/bridge/runner-config.json`, `${platformId}/bridge/${platformId}-config.json`].find((path) => existsSync(targetPath(root, path))) || `${platformId}/bridge/${platformId}-config.json`;
  const config=read(targetPath(root,configPath));
  return { root, platformId, configPath, config, bridge: bridgeCompatibility(root,platformId,config).value, capabilities: read(targetPath(root, `${platformId}/bridge/capabilities.json`)) };
}

function release(root, repository, id, requested) {
  const pointerPath = targetPath(root, `${repository}/${id}/current.json`);
  const version = requested || read(pointerPath).version;
  assertPublishedVersion(root, repository, id, version);
  const path = targetPath(root, `${repository}/${id}/versions/${version}`);
  const manifest = read(join(path, 'manifest.json'));
  if (manifest.id !== id || manifest.version !== version) throw new Error('RELEASE_IDENTITY_MISMATCH');
  return { id, version, path, manifestSha256: sha256(readFileSync(join(path, 'manifest.json'))), hashManifestSha256: sha256(readFileSync(join(path, 'SHA256SUMS'))) };
}

export function readOnboardingConfig({ workspaceRoot, platformId }) {
  const ctx = context(workspaceRoot, platformId);
  const versions = Object.fromEntries(['wf-runner', 'runtime-contracts', 'repo-lint'].map((id) => [id, release(ctx.root, 'tool', id)]));
  const client = read(targetPath(ctx.root, `${platformId}/bridge/client-adapter.json`));
  const automatic = read(targetPath(ctx.root, `${platformId}/runtime/maintenance/manager-onboarding/automatic.json`), null);
  const pendingAutomatic = automatic && automatic.status !== 'complete' && automatic.inputs && sha256(stringify(automatic.inputs)) === automatic.inputsSha256 ? { status: automatic.status, stoppedAt: automatic.stoppedAt, inputs: automatic.inputs, pending:automatic.pending || [],pendingSoftware:automatic.pendingSoftware || [] } : null;
  const binding=gatewayBinding(ctx.root,platformId,ctx.config),gateway=binding.value;
  return { platformId, providerTemplates:providerTemplateStatus(ctx.root,platformId), backendFields:ctx.config.executionBackend && existsSync(platformPath(ctx.root,platformId,ctx.config.executionBackend))?(()=>{const b=read(platformPath(ctx.root,platformId,ctx.config.executionBackend));return {distro:b.distro || '',guestInterpreter:b.interpreter || '/usr/bin/python3',wslExecutable:b.wslExecutable || ''};})():{}, exists: existsSync(join(ctx.root, platformId)), configPath: ctx.configPath, config: ctx.config, versions, client, pendingAutomatic, gatewayBinding:{path:binding.path,recovered:binding.recovered,alternatives:binding.alternatives,selectionRequired:binding.selectionRequired},registeredBodies:gateway.bodies || {},registeredInterpreterAliases:gateway.interpreterAliases || {},resumePreview:onboardingResumePreview(ctx.root,platformId),performanceRecommendation:recommendedCertificationPair(ctx.root),fields: {
    displayName: ctx.bridge.displayName || platformId,
    pythonExecutable: ctx.config.interpreters?.['.py'] || ctx.bridge.runner?.python || '',
    environmentManifest: ctx.config.environmentManifest || '', scriptEnvironment: ctx.config.scriptEnvironment || '', executionBackend: ctx.config.executionBackend || (existsSync(join(ctx.root, platformId, 'bridge/backends/manager-sealed.json')) ? join(ctx.root, platformId, 'bridge/backends/manager-sealed.json') : ''),
    peerDispatcherModule: ctx.config.peerDispatcherModule || '', peerContentRoot: ctx.config.peerContentRoot || '',
    softwareGateway: ctx.config.softwareGateway?.replaceAll('\\', '/').includes('/_connector/versions/') ? ctx.config.softwareGateway : join(release(ctx.root, 'software', '_connector').path, 'connector.py'), softwareEnvironment: ctx.config.softwareEnvironment || '',
    clientKind: client.kind || 'cli', clientExecutable: client.executable || '', clientArgs: client.args || [],
    probeTool: client.probeTool || '', probeArguments: client.probeArguments || {},
    gitAuthorName: ctx.config.commitIdentity?.name || '', gitAuthorEmail: ctx.config.commitIdentity?.email || '',
    contextWindowTokens:ctx.config.contextWindowTokens ?? '',contextWindowSource:ctx.config.contextWindowSource || '',resourceEnvironmentManifest:ctx.config.resourceEnvironmentManifest || '',
    runnerVersion: ctx.config.runner?.split(/[\\/]/).at(-1) || null, contractsVersion: ctx.config.contracts?.split(/[\\/]/).at(-1) || null, scannerVersion: ctx.config.scannerRelease?.split(/[\\/]/).at(-1) || null,matrixVersion:ctx.config.invocationMatrixRelease?.split(/[\\/]/).at(-1) || null
  }, writePerformed: false };
}

function ownPath(root,platformId,path) {return path?platformPath(root,platformId,path):null;}

export function buildOnboardingConfigPlan({ workspaceRoot, platformId, fields = {}, confirmed = false, now = new Date().toISOString() }) {
  const ctx = context(workspaceRoot, platformId);
  const { root } = ctx;
  const creating = !existsSync(join(root, platformId));
  if (creating && confirmed !== true) throw new Error('PLATFORM_SCAFFOLD_CONFIRMATION_REQUIRED');
  assertConfigurationReferences(fields);
  const runner = release(root, 'tool', 'wf-runner', fields.runnerVersion);
  const contracts = release(root, 'tool', 'runtime-contracts', fields.contractsVersion);
  const scanner = release(root, 'tool', 'repo-lint', fields.scannerVersion);
  const scannerPin=read(join(runner.path,'manifest.json')).dependencies?.workflows?.['repo-lint'];
  // The engine manifest records the generation that engine was tested with; a platform pin is a
  // moving adoption target, and the two ends are not changed by the same action. So a mismatch is a
  // named warning carried into the plan and the records, never a refusal. The declared checker still
  // wins for the pair, because the engine's own declaration is the authority the runner enforces at
  // resolve time; the requested version is reported rather than silently obeyed.
  const pairingWarnings=[];
  let scannerReleasePath=scanner.path,scannerVersion=scanner.version;
  if(scannerPin && scannerPin!==scanner.version) {
    const aligned=release(root,'tool','repo-lint',scannerPin);
    pairingWarnings.push(`VERSION_PAIR_MISMATCH: requested checker ${scanner.version} differs from the checker the selected engine declares (${scannerPin}); the declared pairing was applied and the request is recorded`);
    scannerReleasePath=aligned.path;scannerVersion=aligned.version;
  }
  if (!existsSync(join(runner.path, 'cli.py')) || !existsSync(join(contracts.path, 'contracts/runtime/validate_contracts.py')) || !existsSync(join(scanner.path, 'scripts/repo_lint.py'))) throw new Error('ONBOARDING_RELEASE_ENTRY_MISSING');
  const config = { ...ctx.config, platform: platformId, platformRoot: join(root, platformId), toolRoot: join(root, 'tool'), agentRoot: join(root, 'agent'), softwareRoot: join(root, 'software'), runsRoot: join(root, platformId, 'runtime/runs'), runner: runner.path, contracts: contracts.path, scannerRelease: scannerReleasePath, bridge: join(root, platformId, 'bridge.json'), capabilities: join(root, platformId, 'bridge/capabilities.json'), softwareRuntimeRoot: join(root, platformId, 'runtime/software'), projectWriteRoots: ctx.config.projectWriteRoots || [join(root, platformId, 'workspaces')], inputRoots: ctx.config.inputRoots || [join(root, platformId, 'workspaces')] };
  const supportsSmoke=read(join(runner.path,'manifest.json')).interface?.['x-invocationSmoke']==='ai-invocation-smoke/v1';
  const matrixVersion=fields.matrixVersion || (supportsSmoke?recommendedMatrixVersion(root):null);
  if(matrixVersion) {
    const judge=release(root,'tool','architecture-ops',matrixVersion);
    if(supportsSmoke && read(join(judge.path,'manifest.json')).interface?.invocationSmoke!=='ai-invocation-smoke/v1') throw Error('VERSION_PAIR_MISMATCH');
    config.invocationMatrixRelease=judge.path;
  } else if(supportsSmoke) throw Error('VERSION_PAIR_MISMATCH');
  delete config.pendingKeys;
  if('contextWindowTokens' in fields && fields.contextWindowTokens!=='') {
    const tokens=Number(fields.contextWindowTokens);if(!Number.isSafeInteger(tokens) || tokens<=0)throw Error('CONTEXT_WINDOW_REQUIRED');
    config.contextWindowTokens=tokens;config.contextWindowSource=fields.contextWindowSource || config.contextWindowSource || 'user-declared';
  }
  if (fields.gitAuthorName || fields.gitAuthorEmail) config.commitIdentity = { name: fields.gitAuthorName || '', email: fields.gitAuthorEmail || '' };
  for (const key of ['environmentManifest', 'scriptEnvironment', 'executionBackend', 'peerDispatcherModule', 'peerContentRoot', 'softwareEnvironment','resourceEnvironmentManifest']) {
    if (key in fields) {
      const path = ownPath(root, platformId, fields[key]);
      if (path) config[key] = path; else delete config[key];
    }
  }
  const python = fields.pythonExecutable || config.interpreters?.['.py'] || ctx.bridge.runner?.python;
  const hostManifest=reconcileHostManifest(root,platformId,config,python);
  if(hostManifest.path)config.hostEnvironmentManifest=hostManifest.path;
  if (python) config.interpreters = { ...config.interpreters, '.py': python };
  if (config.executionBackend) config.scriptEnvironmentRungs = [{ execPath: 'kernel-sandbox', executionBackend: config.executionBackend, ...(config.scriptEnvironment ? { scriptEnvironment: config.scriptEnvironment } : {}), requiresSealedEnvironment: true }];
  else if ('executionBackend' in fields) config.scriptEnvironmentRungs = [];
  if ('softwareGateway' in fields && fields.softwareGateway) {
    const gateway = resolve(fields.softwareGateway);
    const allowed = targetPath(root, 'software/_connector/versions');
    if (!gateway.startsWith(`${allowed}\\`) && !gateway.startsWith(`${allowed}/`)) throw new Error('SOFTWARE_CONNECTOR_NOT_CONFIGURED');
    if (!existsSync(gateway)) throw new Error('SOFTWARE_CONNECTOR_ENTRY_MISSING');
    config.softwareGateway = gateway;
  } else if (!config.softwareGateway) config.softwareGateway = join(release(root, 'software', '_connector').path, 'connector.py');
  const gatewayRegistration=assertGatewaySelection(gatewayBinding(root,platformId,config));
  config.softwareGatewayConfig = gatewayRegistration.path;
  ownPath(root, platformId, config.softwareGatewayConfig);
  const bridge = { ...ctx.bridge, schema: 'ai-platform-bridge/v1.1', platform: platformId, displayName: fields.displayName || ctx.bridge.displayName || platformId, shared: { ...ctx.bridge.shared, toolRegistry: join(root, 'tool/registry.json'), agentRegistry: join(root, 'agent/registry.json'), softwareRegistry: join(root, 'software/registry.json'), architecturePrompt: join(root, 'AI_ARCHITECTURE_SYSTEM_PROMPT.md'), readOnly: true }, runtimeRoot: join(root, platformId, 'runtime'), modes: ['workflow', 'agent-workflow'], defaults: { ...ctx.bridge.defaults, workflowVersions: { ...ctx.bridge.defaults?.workflowVersions, 'repo-lint': scannerVersion } }, runner: { ...normaliseRunner(ctx.bridge.runner), enabled: true, config: join(root, ctx.configPath), release: runner.path, ...(python ? { python } : {}) } };
  const capabilities = Object.keys(ctx.capabilities).length ? ctx.capabilities : { schema: 'ai-platform-capabilities/v1', platform: platformId, checks: {}, permissionAdapters: [], profiles: {}, descriptor: { schema: 'ai-platform-descriptor/v2', platformId, protocols: ['ai-run-protocol/v1.1', 'ai-run-protocol/v1.2', 'ai-run-protocol/v1.3'], operations: ['prepare', 'next', 'submit', 'status', 'stop'], actions: {}, profiles: {}, enforcement: 'mediated', recovery: ['replay'] }, declaredAbsent: {}, unverified: {}, gapPlan: {} };
  bridge.runner.version = runner.version;
  if (!['cli', 'mcp-stdio', 'manual-native'].includes(fields.clientKind || 'cli')) throw new Error('CLIENT_ADAPTER_UNSUPPORTED');
  const oldClient = read(targetPath(root, `${platformId}/bridge/client-adapter.json`));
  const client = { ...oldClient, schema: 'architecture-manager-client/v1', platformId, kind: fields.clientKind || oldClient.kind || 'cli', executable: fields.clientExecutable || oldClient.executable || '', args: fields.clientArgs || oldClient.args || [], probeTool: fields.probeTool || oldClient.probeTool || '', probeArguments: fields.probeArguments || {}, nativeVerified: false };
  if (client.kind !== oldClient.kind || client.executable !== oldClient.executable || JSON.stringify(client.args) !== JSON.stringify(oldClient.args)) { delete client.preset; delete client.installedClient; delete client.server; }
  if (!Array.isArray(client.args) || client.args.some((value) => typeof value !== 'string')) throw new Error('CLIENT_ARGUMENTS_INVALID');
  const proposed = [...hostManifest.files,
    { path: `${platformId}/bridge.json`, content: stringify(bridge) },
    { path: ctx.configPath, content: stringify(config) },
    { path: `${platformId}/bridge/capabilities.json`, content: stringify(capabilities) },
    { path: `${platformId}/bridge/client-adapter.json`, content: stringify(client) }
  ];
  if (existsSync(targetPath(root, `${platformId}/bridge/bridge.json`))) proposed.push({ path: `${platformId}/bridge/bridge.json`, content: stringify(bridge) });
  if (!existsSync(config.softwareGatewayConfig) || gatewayRegistration.recovered.length) proposed.push({ path: gatewayRegistration.relativePath, content: stringify({ schema: 'ai-software-gateway-config/v1', platformId, platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform, softwareRoot: join(root, 'software'), lockRoot: join(root, platformId, 'runtime/software/locks'), evidenceRoot: join(root, platformId, 'runtime/software/evidence'), bodies: {}, interpreters: python ? { '.py': python } : {},...gatewayRegistration.value }) });
  if (!existsSync(join(root, platformId, 'bridge/platform.md'))) proposed.push({ path: `${platformId}/bridge/platform.md`, content: `# ${bridge.displayName}\n\n平台 ID：${platformId}。管理台创建配置；接入状态以本平台的环境、能力、矩阵与客户端回环证据为准。\n` });
  const files = proposed.map((file) => {
    assertConfigurationReferences(file.path.endsWith('.json') ? parseJsonText(file.content) : {});
    const target = targetPath(root, file.path);
    return { ...file, beforeSha256: existsSync(target) ? sha256(readFileSync(target)) : null, newSha256: sha256(file.content) };
  });
  const plan = { schema: 'architecture-manager-plan/v1', kind: 'platform-configuration', planId: `onboard-config-${platformId}-${randomUUID()}`, workspaceRoot: root, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, creating, userAuthorized: !creating || confirmed, inputs: fields, versions: { runner, contracts, scanner }, pairing: { declaredByEngine: scannerPin || null, requested: scanner.version, applied: scannerVersion, mismatch: pairingWarnings.length > 0 } }, steps: files.map((file) => ({ operation: file.beforeSha256 === null ? 'create-config' : 'replace-config', target: file.path, oldSha256: file.beforeSha256, newSha256: file.newSha256 })), payload: { files }, hostManifest:{previousPath:hostManifest.previousPath || null,path:hostManifest.path || null,scope:hostManifest.scope || null},recoveredBindings:gatewayRegistration.recovered,warnings: pairingWarnings, verification: ['validate the exact generated targets and baselines', 'preserve unrelated existing fields', 'read back every applied file; declarations alone are not certification'] };
  return plan;
}

export function applyOnboardingConfig(plan, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), failAfterFiles = null } = {}) {
  requirePlan(plan);
  for (const file of plan.payload?.files || []) {
    const target = targetPath(plan.workspaceRoot, file.path);
    const actual = existsSync(target) ? sha256(readFileSync(target)) : null;
    if (actual !== file.beforeSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  }
  const rebuilt = buildOnboardingConfigPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, fields: plan.target.inputs, confirmed: plan.target.userAuthorized, now: plan.generatedAt });
  if (JSON.stringify(rebuilt.payload) !== JSON.stringify(plan.payload) || JSON.stringify(rebuilt.target.versions) !== JSON.stringify(plan.target.versions)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const id = makeId(plan, now);
  const before = plan.payload.files.map((file) => ({ ...file, before: file.beforeSha256 === null ? null : readFileSync(targetPath(plan.workspaceRoot, file.path), 'utf8') }));
  const checkpoint = saveCheckpoint(auditRoot, id, stringify({ schema: 'onboarding-checkpoint/v1', workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, files: before }));
  const written = [];
  try {
    for (const file of before) {
      const target = targetPath(plan.workspaceRoot, file.path);
      mkdirSync(dirname(target), { recursive: true });
      atomicWrite(target, file.content, id); written.push(file);
      if (failAfterFiles === written.length) throw new Error('SIMULATED_INTERRUPT');
    }
    const verification = verifyOnboardingConfig(plan);
    if (!verification.ok) throw new Error('ONBOARDING_READBACK_FAILED');
    return output(writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: plan.kind, status: 'applied', target: plan.target.platformId, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, newSha256: sha256(stringify(plan.steps)), writePerformed: true }), checkpoint.path);
  } catch (error) {
    for (const file of written.reverse()) {
      const target = targetPath(plan.workspaceRoot, file.path);
      if (existsSync(target) && sha256(readFileSync(target)) === file.newSha256) {
        if (file.before === null) unlinkSync(target); else atomicWrite(target, file.before, id);
      }
    }
    writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: plan.kind, status: 'failed-restored', target: plan.target.platformId, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, error: String(error.message) });
    throw error;
  }
}

export function verifyOnboardingConfig(plan) {
  requirePlan(plan);
  const files = (plan.payload?.files || []).map((file) => {
    const path = targetPath(plan.workspaceRoot, file.path);
    return { path: file.path, ok: existsSync(path) && sha256(readFileSync(path)) === file.newSha256 };
  });
  return { schema: 'architecture-manager-verification/v1', ok: files.length > 0 && files.every((file) => file.ok), files, writePerformed: false };
}
