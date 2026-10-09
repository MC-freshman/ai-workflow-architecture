import {platformPath} from './core/platform-path.mjs';
import {runScopedProcess as execFileSync} from './infrastructure/process-scope.mjs';
import {restoreOwnedFiles,removeOwnedDirectory} from './transactions/recovery.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { compareStableVersions } from './core/versions.mjs';
import { verifyFrozenDirectory } from './domains/resources/integrity.mjs';
import { validateFrozenResource } from './domains/resources/versions.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { inside, readJson } from './core/json.mjs';
import { makeId, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';

import { isRegisteredPlatform } from './core/platforms.mjs';
const SOFTWARE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const FLAGS = new Set(['--version', '-V', '-v']);
const sha = sha256;
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
export function resolveRecipeVersion(root, softwareId, releaseVersion) {
  if (releaseVersion != null) {
    if (typeof releaseVersion !== 'string' || !SEMVER.test(releaseVersion)) throw new Error('RELEASE_SEMVER_INVALID');
    return releaseVersion;
  }
  const versionsDir = join(root, 'software', softwareId, 'versions');
  if (!existsSync(versionsDir)) return '1.0.0';
  const versions = readdirSync(versionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && SEMVER.test(entry.name)).map((entry) => entry.name).sort(compareStableVersions);
  if (versions.length === 0) return '1.0.0';
  const [major, minor, patch] = versions.at(-1).split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function runnerConfig(root, platformId) {
  const candidates = [join(root, platformId, 'bridge', 'runner-config.json'), join(root, platformId, 'bridge', `${platformId}-config.json`)];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('SOFTWARE_CONNECTOR_NOT_CONFIGURED');
  const value = readJson(path);
  const gateway = String(value.softwareGateway || '').replaceAll('\\', '/');
  if (!gateway.includes('/software/_connector/versions/')) throw new Error('SOFTWARE_CONNECTOR_NOT_CONFIGURED');
  if(!value.softwareGatewayConfig)throw Error('SOFTWARE_CONNECTOR_CONFIG_MISSING');
  const gatewayConfigPath = platformPath(root,platformId,value.softwareGatewayConfig);
  if (!inside(join(root, platformId, 'bridge'), gatewayConfigPath) || !existsSync(gatewayConfigPath)) throw new Error('SOFTWARE_CONNECTOR_CONFIG_MISSING');
  const gatewayConfig = readJson(gatewayConfigPath);
  if (!gatewayConfig.bodies || typeof gatewayConfig.bodies !== 'object') throw new Error('SOFTWARE_CONNECTOR_CONFIG_INVALID');
  const gatewayPath = resolve(gateway);
  if (!inside(join(root, 'software', '_connector', 'versions'), gatewayPath)) throw new Error('SOFTWARE_CONNECTOR_NOT_CONFIGURED');
  return { path: gatewayConfigPath, gatewayPath, runnerPath: path, text: readFileSync(gatewayConfigPath, 'utf8'), value: gatewayConfig };
}
export function softwareConnectorStatus(root, platformId) {
  try {
    const connector = runnerConfig(root, platformId);
    return { ready: true, gatewayPath: connector.gatewayPath, configPath: connector.path, bodies: connector.value.bodies || {} };
  } catch (error) {
    return { ready: false, reason: String(error?.message || error) };
  }
}
function latestBackup(root, platformId, softwareId) {
  const parent = join(root, 'inbox', 'backup', platformId, softwareId);
  if (!existsSync(parent)) throw new Error('SOFTWARE_BACKUP_NOT_FOUND');
  const names = readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const path = names.length ? join(parent, names.at(-1), 'MANIFEST.json') : null;
  if (!path || !existsSync(path)) throw new Error('SOFTWARE_BACKUP_NOT_FOUND');
  const manifest = readJson(path);
  if (manifest.restoreDrill?.performed !== true) throw new Error('SOFTWARE_BACKUP_NOT_RESTORED');
  return manifest;
}
function importedBody(root, platformId, softwareId, bodyName) {
  const manifest = latestBackup(root, platformId, softwareId);
  const target = join(root, platformId, 'runtime', 'software', softwareId);
  if (resolve(manifest.target) !== target) throw new Error('SOFTWARE_BACKUP_TARGET_MISMATCH');
  const rows = manifest.files;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('SOFTWARE_BACKUP_INVALID');
  for (const row of rows) {
    const file = resolve(target, row.path);
    if (!inside(target, file) || !existsSync(file) || sha(readFileSync(file)) !== row.sha256) throw new Error('SOFTWARE_BODY_CHANGED');
  }
  const row = rows.find((item) => item.path === bodyName);
  if (!row || !bodyName.toLowerCase().endsWith('.exe')) throw new Error('SOFTWARE_CLI_ENTRY_REQUIRED');
  return { target, rows, body: join(target, bodyName), manifest };
}
function probe(body, flag, version) {
  let output;
  try { output = execFileSync(body, [flag], { cwd: dirname(body), encoding: 'utf8', timeout: 15000, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`SOFTWARE_VERSION_PROBE_FAILED:${String(error.stderr || error.message).slice(0, 200)}`); }
  const clipped = String(output).trim().slice(0, 2000);
  if (!clipped || !clipped.includes(version)) throw new Error('SOFTWARE_VERSION_UNVERIFIED');
  return clipped;
}

export function listSoftwareIntakes({ workspaceRoot, platformId }) {
  const root = resolve(workspaceRoot);
  if (!isRegisteredPlatform(platformId, root)) throw new Error('UNKNOWN_PLATFORM_ID');
  const base = join(root, platformId, 'runtime', 'software');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && SOFTWARE_ID.test(entry.name)).map((entry) => {
    try {
      const imported = latestBackup(root, platformId, entry.name);
      return { id: entry.name, files: imported.files.map((row) => row.path), intakeKind: imported.intakeKind, restored: true };
    } catch { return { id: entry.name, files: [], restored: false }; }
  });
}

function releaseFiles({ softwareId, displayName, upstreamVersion, license, version, bodyName, bodyRows, flag, probeOutput, now }) {
  const basenameEntry = basename(bodyName);
  const emptyInput = { type: 'object', additionalProperties: false, properties: {} };
  const versionOutput = { type: 'object', properties: { rawOutput: { type: 'string' } } };
  const capability = { name: 'version', nativeName: `${basenameEntry} ${flag}`, inputSchemaRef: 'schemas/empty.input.json', outputSchemaRef: 'schemas/version.output.json', sideEffects: 'none', permissionRequests: { filesystem: 'read', network: 'none', process: 'self', credentials: 'none' }, consent: 'auto', idempotent: true, safeForSelftest: true, invocation: { executable: basenameEntry, baseArgv: [flag], argMapping: [], outputCapture: 'stdout', outputFormat: 'text', timeout: 15, successExitCodes: [0] } };
  const manifest = { schema: 'ai-software/v1', id: softwareId, version, displayName, upstreamVersion, kind: 'cli-wrapper', transport: { command: `\${softwareRoot}/${basenameEntry}`, argsStyle: 'declarative-argv' }, capabilities: [capability], concurrency: { instanceMode: 'per-run', poolSize: null, exclusiveResources: [], whenBusy: 'reject-retryable' }, platformSupport: { windows: 'supported', linux: 'untested', macos: 'untested' }, requiredProfiles: [], snapshot: 'capabilities.snapshot.json', integrity: { sha256Manifest: 'SHA256SUMS' }, docs: 'README.md' };
  const snapshot = { schema: 'ai-software-capability-snapshot/v1', softwareId, softwareVersion: version, upstreamVersion, generatedAt: now, generationMethod: `live ${flag} inquiry; stdout sha256 ${sha(probeOutput)}`, capabilities: [{ name: 'version', nativeName: capability.nativeName, sideEffects: 'none', consent: 'auto', idempotent: true, safeForSelftest: true, inputSchemaRef: capability.inputSchemaRef, outputSchemaRef: capability.outputSchemaRef }], frozen: true };
  const recipe = { schema: 'ai-software-recipe/v1', platform: 'windows', softwareId, softwareVersion: version, acquire: { kind: 'local-install', source: 'user-selected download; body stored per platform', version: upstreamVersion, license, redistributable: false }, install: { location: `\${platformRuntime}/software/${softwareId}`, detectedPath: null }, launch: { kind: 'cli-wrapper', entrypoint: basenameEntry, notes: 'Only the read-only version capability is declared by this initial recipe.' }, verify: { versionCall: [`\${softwareRoot}/${basenameEntry}`, flag], expectedVersionOutput: probeOutput.split(/\r?\n/)[0].slice(0, 200), selftestRef: '../selftest/readonly.json', files: bodyRows.map((row) => ({ path: row.path, sha256: row.sha256 })) } };
  const selftest = { schema: 'ai-software-selftest/v1', mode: 'readonly', checks: [{ id: 'version', capability: 'version', arguments: {}, expectedExitCode: 0, expectedOutputContains: upstreamVersion, timeout: 15 }, { id: 'files-present', kind: 'file-integrity', files: bodyRows.map((row) => row.path) }] };
  const source = { schema: 'ai-software-source/v1', releaseStatus: 'published', publisher: 'Architecture Manager', publishedAt: now, sourceKind: 'user-selected portable CLI in platform runtime; full backup and restore drill performed', upstreamVersion, version, probeSha256: sha(probeOutput), limitation: 'Only version capability is published; other operations require a separately declared and verified adapter.' };
  const files = { 'manifest.json': json(manifest), 'capabilities.snapshot.json': json(snapshot), 'recipes/windows.json': json(recipe), 'schemas/empty.input.json': json(emptyInput), 'schemas/version.output.json': json(versionOutput), 'selftest/readonly.json': json(selftest), 'SOURCE.json': json(source), 'README.md': `# ${displayName}\n\nThis initial recipe exposes only a verified read-only version inquiry. The program body is stored in each platform runtime, never in the shared software repository. Other operations require a separate adapter and capability review.\n` };
  files.SHA256SUMS = Object.keys(files).sort().map((name) => `${sha(files[name])}  ${name}`).join('\n') + '\n';
  return files;
}

export function buildSoftwareRecipePlan({ workspaceRoot, platformId, softwareId, bodyName, displayName, upstreamVersion, license, versionFlag = '--version', releaseVersion = null, now = new Date().toISOString() }, { probeVersion = probe } = {}) {
  const root = resolve(workspaceRoot);
  if (!isRegisteredPlatform(platformId, root) || !SOFTWARE_ID.test(softwareId) || typeof upstreamVersion !== 'string' || !upstreamVersion.trim() || upstreamVersion.length > 80 || /[\r\n]/.test(upstreamVersion) || !FLAGS.has(versionFlag) || typeof displayName !== 'string' || !displayName.trim() || typeof license !== 'string' || !license.trim()) throw new Error('INVALID_SOFTWARE_RECIPE_INPUT');
  const version = resolveRecipeVersion(root, softwareId, releaseVersion);
  const imported = importedBody(root, platformId, softwareId, bodyName);
  if (imported.manifest.intakeKind === 'installer') throw new Error('INSTALLER_NOT_INSTALLED');
  const connector = runnerConfig(root, platformId);
  const upgrade = existsSync(join(root, 'software', softwareId));
  if (!upgrade && connector.value.bodies[softwareId]) throw new Error('SOFTWARE_BODY_ALREADY_BOUND');
  const release = join(root, 'software', softwareId, 'versions', version);
  if (existsSync(release)) throw new Error('SOFTWARE_ALREADY_REGISTERED');
  const registryPath = join(root, 'software', 'registry.json');
  const registryText = readFileSync(registryPath, 'utf8');
  const registry = parseJsonText(registryText);
  if (!upgrade && registry.software?.some((item) => item.id === softwareId)) throw new Error('SOFTWARE_ALREADY_REGISTERED');
  const probeOutput = probeVersion(imported.body, versionFlag, upstreamVersion);
  const files = releaseFiles({ softwareId, displayName: displayName.trim(), upstreamVersion, license: license.trim(), version, bodyName, bodyRows: imported.rows, flag: versionFlag, probeOutput, now });
  const nextRegistry = upgrade ? null : json({ ...registry, version: registry.version + 1, software: [...registry.software, { id: softwareId, current: `${softwareId}/current.json`, enabled: true, kind: 'cli-wrapper', invocable: false, transports: [] }] });
  const pointerPath = join(root, 'software', softwareId, 'current.json');
  const previousPointer = upgrade && existsSync(pointerPath) ? readJson(pointerPath) : null;
  const available = previousPointer?.available ? [...new Set([...previousPointer.available, version])] : [version];
  const pointer = json({ schema: 'ai-software-pointer/v1', id: softwareId, version, available, hashManifest: 'SHA256SUMS' });
  const nextConnector = upgrade ? null : json({ ...connector.value, bodies: { ...connector.value.bodies, [softwareId]: imported.body } });
  return { schema: 'architecture-manager-plan/v1', planId: `software-recipe-${softwareId}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`, kind: 'software-recipe-publish', workspaceRoot: root, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, softwareId, bodyName, displayName: displayName.trim(), upstreamVersion, license: license.trim(), versionFlag, version, path: release, connectorConfigPath: connector.path, bodyPath: imported.body, upgrade }, steps: [{ operation: 'publish-immutable-recipe', target: release, files: Object.keys(files).length }, upgrade ? { operation: 'update-current-pointer', target: pointerPath } : { operation: 'create-current-and-register', target: registryPath }, ...(upgrade ? [] : [{ operation: 'bind-platform-connector', target: connector.path }])], verification: ['re-probe body and compare hash before publish', 'verify every release file against SHA256SUMS', 'verify pointer, registry and connector body binding'], baseline: { bodySha256: sha(readFileSync(imported.body)), probeSha256: sha(probeOutput), registrySha256: sha(registryText), connectorSha256: sha(connector.text), pointerSha256: previousPointer ? sha(readFileSync(pointerPath, 'utf8')) : null }, payload: { files, pointer, registry: nextRegistry, connector: nextConnector } };
}

function atomicText(path, content, suffix) {
  const tmp = `${path}.${suffix}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: 'wx' });
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

function checkPublished(root, target, connector) {
  const result = { connectorDispatchable: false, singleCellReached: false, issues: [] };
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
  try {
    if (!existsSync(connector.gatewayPath)) throw new Error('连接器入口不存在');
    const request = { schema: 'ai-software-admin/v1', kind: 'request', operation: 'software.health', softwareId: target.softwareId };
    const stdout = execFileSync('python', ['-B', connector.gatewayPath, '--config', connector.path], { input: JSON.stringify(request), cwd: dirname(connector.path), env, encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const response = parseJsonText(stdout);
    const row = response?.result?.software?.find((item) => item.softwareId === target.softwareId);
    result.connectorDispatchable = response.ok === true && row?.dispatchable === true;
    if (!result.connectorDispatchable) result.issues.push(`连接器未确认可调用：${JSON.stringify(row?.blocking || response?.error || '无有效健康结果').slice(0, 500)}`);
  } catch (error) { result.issues.push(`连接器健康检查失败：${String(error.stderr || error.message).slice(0, 500)}`); }
  try {
    const pointer = readJson(join(root, 'tool', 'platform-conformance', 'current.json'));
    const script = join(root, 'tool', 'platform-conformance', 'versions', pointer.version, 'conformance', 'conform.py');
    if (!existsSync(script)) throw new Error('单格检查入口不存在');
    const out = join(root, target.platformId, 'runtime', 'manager-check');
    mkdirSync(out, { recursive: true });
    const reportPath = join(out, `software-${target.softwareId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    execFileSync('python', ['-B', script, '--config', connector.runnerPath, '--only', target.softwareId, '--out', reportPath], { cwd: out, env, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const report = readJson(reportPath);
    result.singleCellReached = report.floorReached === true;
    result.conformDigest = report.conformDigest || null;
    result.conformPath = reportPath;
    result.conformCounts = report.counts || null;
    if (!result.singleCellReached) result.issues.push(`单格检查未通过：${JSON.stringify(report.counts || {})}`);
  } catch (error) { result.issues.push(`单格检查失败：${String(error.stderr || error.message).slice(0, 500)}`); }
  return result;
}

export function applySoftwareRecipe({ plan }, { probeVersion = probe, verifyPublished = checkPublished, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), onProgress = () => {}, failAfterCheckpoint = false } = {}) {
  if (plan?.kind !== 'software-recipe-publish') throw new Error('INVALID_SOFTWARE_RECIPE_PLAN');
  const { workspaceRoot: root, target, baseline, payload } = plan;
  if (!isRegisteredPlatform(target.platformId, root) || !SOFTWARE_ID.test(target.softwareId) || !FLAGS.has(target.versionFlag) || !SEMVER.test(target.version) || target.path !== join(root, 'software', target.softwareId, 'versions', target.version)) throw new Error('INVALID_SOFTWARE_RECIPE_PLAN');
  const imported = importedBody(root, target.platformId, target.softwareId, target.bodyName);
  if (imported.body !== target.bodyPath || sha(readFileSync(imported.body)) !== baseline.bodySha256) throw new Error('SOFTWARE_BODY_CHANGED');
  const probeOutput = probeVersion(imported.body, target.versionFlag, target.upstreamVersion);
  if (sha(probeOutput) !== baseline.probeSha256) throw new Error('SOFTWARE_VERSION_PROBE_CHANGED');
  const registryPath = join(root, 'software', 'registry.json');
  const oldRegistry = readFileSync(registryPath, 'utf8');
  const connector = runnerConfig(root, target.platformId);
  if (connector.path !== target.connectorConfigPath) throw new Error('SOFTWARE_CONNECTOR_CHANGED');
  const oldConnector = connector.text;
  if (sha(oldRegistry) !== baseline.registrySha256 || sha(oldConnector) !== baseline.connectorSha256) throw new Error('EXTERNAL_CHANGE_DETECTED');
  const registry = parseJsonText(oldRegistry);
  const expectedRegistry = payload.registry === null ? null : json({ ...registry, version: registry.version + 1, software: [...registry.software, { id: target.softwareId, current: `${target.softwareId}/current.json`, enabled: true, kind: 'cli-wrapper', invocable: false, transports: [] }] });
  const pointerPath = join(root, 'software', target.softwareId, 'current.json');
  const oldPointerText = existsSync(pointerPath) ? readFileSync(pointerPath, 'utf8') : null;
  if ((baseline.pointerSha256 ?? null) !== (oldPointerText ? sha(oldPointerText) : null)) throw new Error('EXTERNAL_CHANGE_DETECTED');
  const previousPointer = oldPointerText ? parseJsonText(oldPointerText) : null;
  const available = previousPointer?.available ? [...new Set([...previousPointer.available, target.version])] : [target.version];
  const expectedPointer = json({ schema: 'ai-software-pointer/v1', id: target.softwareId, version: target.version, available, hashManifest: 'SHA256SUMS' });
  const expectedConnector = payload.connector === null ? null : json({ ...connector.value, bodies: { ...connector.value.bodies, [target.softwareId]: imported.body } });
  if ((payload.registry ?? null) !== expectedRegistry || payload.pointer !== expectedPointer || (payload.connector ?? null) !== expectedConnector) throw new Error('PLAN_PAYLOAD_MISMATCH');
  if (existsSync(target.path)) throw new Error('SOFTWARE_ALREADY_REGISTERED');
  const expected = releaseFiles({ softwareId: target.softwareId, displayName: target.displayName, upstreamVersion: target.upstreamVersion, license: target.license, version: target.version, bodyName: target.bodyName, bodyRows: imported.rows, flag: target.versionFlag, probeOutput, now: plan.generatedAt });
  if (JSON.stringify(expected) !== JSON.stringify(payload.files)) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const transactionId = makeId(plan, now);
  const checkpoint = saveCheckpoint(auditRoot, transactionId, json({ schema: 'architecture-manager-software-publish-checkpoint/v1', softwareId: target.softwareId, platformId: target.platformId, bodyPath: target.bodyPath, registryPath, oldRegistry, connectorPath: target.connectorConfigPath, oldConnector, pointerPath: join(root, 'software', target.softwareId, 'current.json'), oldPointerText, releasePath: target.path, releaseSumsSha256: sha(payload.files.SHA256SUMS), createdNewRelease: true }));
  if (failAfterCheckpoint) {
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-recipe-publish', status: 'interrupted-before-write', target: target.path, checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, error: 'SIMULATED_INTERRUPT', now });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit, checkpointPath: checkpoint.path });
  }
  const platformRuntime = join(root, target.platformId, 'runtime');
  mkdirSync(platformRuntime, { recursive: true });
  const stage = mkdtempSync(join(platformRuntime, '.software-release-stage-'));
  const releaseParent = dirname(target.path);
  let registryWritten = false;
  let connectorWritten = false;
  let pointerWritten = false;
  let releaseCreated = false;
  try {
    for (const [index, [name, content]] of Object.entries(payload.files).entries()) {
      const file = join(stage, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, { flag: 'wx' });
      onProgress({ stage: 'release-files', path: name, filesDone: index + 1, filesTotal: Object.keys(payload.files).length });
    }
    verifyFrozenDirectory(stage);
    for (const [name, content] of Object.entries(payload.files)) if (sha(readFileSync(join(stage, name))) !== sha(content)) throw new Error('SOFTWARE_RELEASE_HASH_MISMATCH');
    mkdirSync(releaseParent, { recursive: true });
    renameSync(stage, target.path);
    releaseCreated = true;
    atomicText(pointerPath, payload.pointer, plan.planId);
    pointerWritten = true;
    if (payload.registry !== null) {
      atomicText(registryPath, payload.registry, plan.planId);
      registryWritten = true;
    }
    if (payload.connector !== null) {
      atomicText(target.connectorConfigPath, payload.connector, plan.planId);
      connectorWritten = true;
    }
    const verification = verifySoftwareRecipe({ plan });
    if (!verification.ok) throw new Error('SOFTWARE_PUBLISH_VERIFY_FAILED');
    let check;
    try { check = verifyPublished(root, target, connector); }
    catch (error) { check = { connectorDispatchable: false, singleCellReached: false, issues: [`发布后检查失败：${String(error.message).slice(0, 500)}`] }; }
    const status = check.connectorDispatchable && check.singleCellReached ? 'published-version-only' : 'published-pending-verification';
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-recipe-publish', status, target: target.path, newSha256: sha(payload.files.SHA256SUMS), checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, writePerformed: true, now });
    return { ...verification, status, check, writePerformed: true, audit, checkpointPath: checkpoint.path, transactionId };
  } catch (error) {
    const recovered=restoreOwnedFiles([...(connectorWritten?[{target:target.connectorConfigPath,before:oldConnector,afterSha256:sha(payload.connector)}]:[]),...(registryWritten?[{target:registryPath,before:oldRegistry,afterSha256:sha(payload.registry)}]:[]),...(pointerWritten?[{target:pointerPath,before:oldPointerText || null,afterSha256:sha(payload.pointer)}]:[])],transactionId);
    if(!recovered.ok) {writeAudit({auditRoot,transactionId,plan,actor,action:plan.kind,status:'failed-external-change',target:target.path,checkpointPath:checkpoint.path,error:'RECOVERY_EXTERNAL_CHANGE',now});throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:checkpoint.path,recovery:recovered});}
    if (releaseCreated && existsSync(target.path)) {
      const removed=removeOwnedDirectory(target.path,new Map(Object.entries(payload.files).map(([name,bytes])=>[name,sha(bytes)])));
      if(!removed.ok) throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{checkpointPath:checkpoint.path,recovery:removed});
      for (const emptyParent of [releaseParent, dirname(releaseParent)]) {
        try { rmdirSync(emptyParent); } catch { /* Preserve a nonempty directory. */ }
      }
    }
    const audit = writeAudit({ auditRoot, transactionId, plan, actor, action: 'software-recipe-publish', status: 'recovered-after-failure', target: target.path, checkpointSha256: checkpoint.sha256, checkpointPath: checkpoint.path, error: String(error?.message || error), now });
    throw Object.assign(error, { audit, checkpointPath: checkpoint.path });
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}

export function verifySoftwareRecipe({ plan }) {
  if (plan?.kind !== 'software-recipe-publish') throw new Error('INVALID_SOFTWARE_RECIPE_PLAN');
  const { workspaceRoot: root, target, payload } = plan;
  try {
    validateFrozenResource(root,'software',target.softwareId,target.version);
    for (const [name, content] of Object.entries(payload.files)) if (sha(readFileSync(join(target.path, name))) !== sha(content)) throw new Error('RELEASE_MISMATCH');
    const pointer = readJson(join(root, 'software', target.softwareId, 'current.json'));
    const registry = readJson(join(root, 'software', 'registry.json'));
    const connector = readJson(target.connectorConfigPath);
    return { ok: pointer.version === target.version && registry.software.some((row) => row.id === target.softwareId) && connector.bodies?.[target.softwareId] === target.bodyPath, target: target.path, writePerformed: false };
  } catch { return { ok: false, target: target.path, writePerformed: false }; }
}
