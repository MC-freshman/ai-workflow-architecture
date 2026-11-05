import {parseJson as parseJsonText} from '../../core/json.mjs';
import {managementRuntimePlan,installManagementRuntime} from '../platforms/management-runtime.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join,relative,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { targetPath } from '../../core/paths.mjs';
import { sha256,sha256File } from '../../core/hash.mjs';
import {assertScopedActive} from '../../infrastructure/process-scope.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';
import { collectEntrySkillFiles } from './onboarding-entry-skills.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from '../../transactions/onboarding-files.mjs';
import { atomicWrite } from '../../transactions/kernel.mjs';
import { runOwnedProcess } from '../../core/owned-process.mjs';
import { runtimeFile } from '../../core/runtime-path.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const load = (path) => parseJsonText(readFileSync(path, 'utf8'));
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());

export function buildOnboardingClientPlan({ workspaceRoot, platformId, now = new Date().toISOString() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const python = snapshot.fields.pythonExecutable;
  if (!snapshot.exists || !python || !existsSync(python)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  const base = `${platformId}/bridge/manager-client`;
  const files = ['mcp_service.py', 'cli_client.py','platform_defaults.mjs'].map((name) => ({ path: `${base}/${name}`, content: readFileSync(runtimeFile(name), 'utf8') }));
  const managementRuntime=managementRuntimePlan(workspaceRoot,platformId);
  const service = { executable: python, args: ['-B', targetPath(workspaceRoot, `${base}/mcp_service.py`), targetPath(workspaceRoot, snapshot.configPath)] };
  let descriptor = { schema: 'architecture-manager-client/v1', platformId, kind: 'cli', executable: python, args: ['-B', targetPath(workspaceRoot, `${base}/cli_client.py`), targetPath(workspaceRoot, `${platformId}/bridge/client-adapter.json`)], server: service, preset: 'architecture-json-cli', probeTool: 'architecture_probe', nativeVerified: false, installedClient: true };
  const previous=targetPath(workspaceRoot,`${platformId}/bridge/client-adapter.json`);
  if(existsSync(previous)) {const native=load(previous);if(native.sourceBody){descriptor={...native,server:service};if(extname(native.sourceBody.path)==='.py')descriptor.executable=python;}}
  descriptor.management={executable:managementRuntime.target,executableSha256:managementRuntime.sha256,args:[targetPath(workspaceRoot,`${base}/platform_defaults.mjs`),targetPath(workspaceRoot,snapshot.configPath)],moduleSha256:sha256(files.find(file=>file.path.endsWith('platform_defaults.mjs')).content)};
  files.push({ path: `${platformId}/bridge/client-adapter.json`, content: json(descriptor) }, { path: `${base}/mcp-client-registration.json`, content: json({ mcpServers: { architecture: { command: service.executable, args: service.args } }, notes: 'Import this into a compatible native client. Export is not evidence of native registration.' }) });
  // NP1: lay the wf/wfa entry skills so /wf and /wfa work right after onboarding.
  // Slots already holding a file are never overwritten (codex wfa and the zcode
  // pair are platform-specific); slot-less clients are recorded as unplaced.
  const entrySkills = collectEntrySkillFiles({ workspaceRoot, platformId });
  files.push(...entrySkills.files.map((file) => ({ ...file, entrySkill: true })));
  const planned = plannedFiles(workspaceRoot, files);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-client', planId: `client-${randomUUID()}`, workspaceRoot, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId }, payload: { files: planned,managementRuntime, entrySkills: entrySkills.summary }, steps: [{operation:'安装本平台管理命令运行时并恢复验证',target:managementRuntime.target},...planned.map((file) => ({ operation: file.entrySkill ? 'install-entry-skill' : 'install-client-entry', target: file.path, oldSha256: file.beforeSha256, newSha256: file.newSha256 }))], verification: ['real independent CLI client connects to registered MCP service', 'challenge binds platform config and release seals', 'native vendor registration remains separate','management runtime has an isolated body, backup manifest and real restore verification','entry skills render from templates; existing slot files are kept, never overwritten'] };
}
export function applyOnboardingClient(plan, options) {
  const expected=buildOnboardingClientPlan({workspaceRoot:plan.workspaceRoot,platformId:plan.target.platformId,now:plan.generatedAt});
  if(JSON.stringify(expected.payload)!==JSON.stringify(plan.payload))throw Error('PLAN_PAYLOAD_MISMATCH');
  installManagementRuntime(plan);
  return applyGeneratedFiles(plan,()=>expected,options);
}
export const verifyOnboardingClient = verifyFiles;

export function clientBinding(workspaceRoot, platformId) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const configPath = targetPath(workspaceRoot, snapshot.configPath);
  const pins = Object.fromEntries(['runner', 'contracts', 'scannerRelease'].map((key) => [key, { path: snapshot.config[key], sha256: sha256(readFileSync(join(snapshot.config[key], 'SHA256SUMS'))) }]));
  // Python json.dumps(sort_keys=True) recursively sorts keys; build the same byte stream.
  const ordered = Object.fromEntries(Object.keys(pins).sort().map((key) => [key, { path: pins[key].path, sha256: pins[key].sha256 }]));
  return { platformId, configSha256: sha256(readFileSync(configPath)), versionsSha256: sha256(JSON.stringify(ordered)), adapterSha256: sha256(readFileSync(targetPath(workspaceRoot, `${platformId}/bridge/client-adapter.json`))) };
}

export function validateClientReceipt(value, expected) {
  if (value?.schema !== 'architecture-client-receipt/v1' || value.challenge !== expected.challenge || value.platformId !== expected.platformId || value.configSha256 !== expected.configSha256 || value.versionsSha256 !== expected.versionsSha256 || value.businessRunExecuted !== false) throw new Error('CLIENT_RECEIPT_MISMATCH');
  if (value.client !== (expected.clientIdentity || 'architecture-json-cli-client') || !['mcp-stdio', 'json-cli'].includes(value.transport) || value.service !== 'platform-owned-mcp-facade' || !['tool', 'agent', 'software'].every((name) => Number.isInteger(value.registriesRead?.[name]))) throw new Error('CLIENT_ROUTE_NOT_VERIFIED');
  return true;
}

export async function probeOnboardingClient({ workspaceRoot, platformId }, { registerCancel = () => {}, serviceOnly=false } = {}) {
  let adapter = load(targetPath(workspaceRoot, `${platformId}/bridge/client-adapter.json`));
  if(serviceOnly){if(!adapter.server?.executable)throw Error('NATIVE_SERVICE_REQUIRED');adapter={...adapter,kind:'mcp-stdio',executable:adapter.server.executable,args:adapter.server.args,sourceBody:null,probeTool:'architecture_probe'};}
  if(adapter.sourceBody) {
    const body=targetPath(workspaceRoot,relative(workspaceRoot,adapter.sourceBody.path)),own=relative(targetPath(workspaceRoot,`${platformId}/runtime`),body);
    if(own.startsWith('..') || /^[A-Za-z]:/.test(own) || sha256File(body,{onBlock:assertScopedActive})!==adapter.sourceBody.entrySha256)throw Error('CLIENT_BODY_DRIFT');
  }
  if (adapter.kind === 'manual-native') return { platformId, status: 'waiting-user', issues: ['原生客户端尚未提交可验证回执；请选择已支持的 CLI 入口或导入 MCP 配置后测试。'], nativeVendorClientVerified: false };
  if (!['cli', 'mcp-stdio'].includes(adapter.kind)) throw new Error('CLIENT_ADAPTER_PENDING');
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const expectedClientArgs = ['-B', targetPath(workspaceRoot, `${platformId}/bridge/manager-client/cli_client.py`), targetPath(workspaceRoot, `${platformId}/bridge/client-adapter.json`)];
  const expectedServiceArgs = ['-B', targetPath(workspaceRoot, `${platformId}/bridge/manager-client/mcp_service.py`), targetPath(workspaceRoot, snapshot.configPath)];
  const standard = adapter.preset === 'architecture-json-cli' && adapter.installedClient;
  if (!adapter.executable || !existsSync(adapter.executable)) throw new Error('CLIENT_CONNECTION_FAILED');
  if ([adapter.executable, ...(adapter.args || [])].some((arg) => String(arg).replaceAll('\\', '/').startsWith(snapshot.config.runner.replaceAll('\\', '/')))) throw new Error('CLIENT_ROUTE_NOT_VERIFIED');
  // serviceOnly rewrites adapter.{executable,args} to the SERVER route (line above), so the
  // args expectation must follow: comparing the server route against the client expectations
  // made the onboarding client step impossible to pass in serviceOnly mode (D-154).
  const routeExpectation = serviceOnly ? expectedServiceArgs : expectedClientArgs;
  if (standard && (adapter.executable !== snapshot.fields.pythonExecutable || JSON.stringify(adapter.args) !== JSON.stringify(routeExpectation) || adapter.server?.executable !== snapshot.fields.pythonExecutable || JSON.stringify(adapter.server?.args) !== JSON.stringify(expectedServiceArgs))) throw new Error('CLIENT_ROUTE_NOT_VERIFIED');
  // Revalidate installed source bytes. A direct runner program cannot impersonate the registered client.
  for (const name of standard ? ['cli_client.py', 'mcp_service.py'] : []) {
    if (sha256(readFileSync(targetPath(workspaceRoot, `${platformId}/bridge/manager-client/${name}`))) !== sha256(readFileSync(fileURLToPath(new URL(`../../runtime/${name}`, import.meta.url))))) throw new Error('CLIENT_ENTRY_DRIFT');
  }
  const expected = { ...clientBinding(workspaceRoot, platformId), challenge: randomBytes(32).toString('hex'), clientIdentity: !standard && adapter.kind === 'cli' ? adapter.clientIdentity || 'architecture-json-cli-client' : 'architecture-json-cli-client' };
  const directory = targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding/client-probes/${randomUUID()}`); mkdirSync(directory, { recursive: true });
  let executable = adapter.executable; let args = adapter.args; let request = expected;
  if (adapter.kind === 'mcp-stdio') {
    const transport = join(directory, 'mcp-transport.json');
    atomicWrite(transport, json({ server: { executable, args } }), randomUUID());
    executable = snapshot.fields.pythonExecutable; args = ['-B', runtimeFile('cli_client.py'), transport];
    request = { tool: adapter.probeTool || 'architecture_probe', arguments: { ...adapter.probeArguments, ...expected } };
  }
  const response = await runOwnedProcess({ python: snapshot.fields.pythonExecutable, executable, args, input: json(request), cwd: directory, timeout: 30000, registerCancel });
  if (response.cancelled) throw new Error('ONBOARDING_CANCELLED');
  if (response.exitCode !== 0) throw new Error('CLIENT_CONNECTION_FAILED');
  const receipt = parseJsonText(response.stdout); validateClientReceipt(receipt, expected);
  const fresh = clientBinding(workspaceRoot, platformId);
  if (fresh.configSha256 !== expected.configSha256 || fresh.versionsSha256 !== expected.versionsSha256 || fresh.adapterSha256 !== expected.adapterSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const result = { schema: 'architecture-manager-client-check/v1', status: 'passed', ...expected, receipt, checkedAt: new Date().toISOString(), serviceOnly,nativeVendorClientVerified: false,importedClientVerified:Boolean(adapter.sourceBody && adapter.kind==='cli' && adapter.sourceBody.mode==='json-cli'),bodyEntrySha256:adapter.sourceBody?.entrySha256 || null, writePerformed: true };
  const evidencePath = join(directory, `client-${randomUUID()}.json`);
  atomicWrite(evidencePath, json(result), randomUUID());
  atomicWrite(targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding/client-latest.json`), json(result), randomUUID()); return { ...result, evidencePath };
}
