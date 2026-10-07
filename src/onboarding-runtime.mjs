import {platformPath} from './core/platform-path.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readOnboardingConfig, buildOnboardingConfigPlan, applyOnboardingConfig } from './onboarding-config.mjs';
import { targetPath, defaultAuditRoot } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { atomicWrite, requirePlan, saveCheckpoint, writeAudit, makeId } from './transactions/kernel.mjs';
import { plannedFiles, applyGeneratedFiles, verifyFiles } from './transactions/onboarding-files.mjs';
import { runtimeFile } from './core/runtime-path.mjs';
import { runOwnedProcess } from './core/owned-process.mjs';

const run = promisify(execFile);
const helper = runtimeFile('provision.py');
const json = (data) => `${JSON.stringify(data, null, 2)}\n`;
const load = (path) => parseJsonText(readFileSync(path, 'utf8'));

export function buildOnboardingBackendPlan({ workspaceRoot, platformId, fields = {}, now = new Date().toISOString() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  if (!snapshot.exists) throw new Error('ONBOARDING_CONFIGURATION_REQUIRED');
  const root = resolve(workspaceRoot);
  if (!fields.wslExecutable || !existsSync(fields.wslExecutable) || !fields.distro || !/^\/[A-Za-z0-9_./-]+$/.test(fields.guestInterpreter || '')) throw new Error('RUNTIME_BACKEND_REQUIRED');
  const drives = new Set([root, fields.wslExecutable].map((p) => resolve(p).slice(0, 1).toLowerCase()));
  const backend = { schema: 'wf-runner-execution-backend/v1', kind: 'wsl2', wslExecutable: fields.wslExecutable, distro: fields.distro, interpreter: fields.guestInterpreter, pathMap: [...drives].map((d) => ({ windows: `${d.toUpperCase()}:/`, linux: `/mnt/${d}/` })), sharedReadOnlyBinds: ['tool', 'agent', 'software'].map((name) => ({ windows: join(root, name), name })), verifyTimeoutSeconds: 300 };
  const path = `${platformId}/bridge/backends/manager-sealed.json`;
  const files = plannedFiles(root, [{ path, content: json(backend) }]);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-backend', planId: `backend-${randomUUID()}`, workspaceRoot: root, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, fields }, steps: files.map((f) => ({ operation: 'write-backend', target: f.path, oldSha256: f.beforeSha256, newSha256: f.newSha256 })), payload: { files }, verification: ['explicit selected system facility', 'three read-only shared roots', 'no capability declaration before real probes'] };
}
export function applyOnboardingBackend(plan, options) { return applyGeneratedFiles(plan, () => buildOnboardingBackendPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, fields: plan.target.fields, now: plan.generatedAt }), options); }
export const verifyOnboardingBackend = verifyFiles;

// Dependencies come from current release locks, not platform names or copied environments.
export function runtimeRequirements(root) {
  const packages = new Map(); const sources = [];
  for (const repo of ['tool', 'agent', 'software']) {
    const registry = load(targetPath(root, `${repo}/registry.json`));
    for (const entries of Object.values(registry)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry.id) continue;
        const pointer = targetPath(root, `${repo}/${entry.current || `${entry.id}/current.json`}`);
        if (!existsSync(pointer)) continue;
        const version = load(pointer).version;
        const release = targetPath(root, `${repo}/${entry.id}/versions/${version}`);
        if (!existsSync(join(release, 'manifest.json'))) continue;
        const lock = load(join(release, 'manifest.json')).runtime?.environmentLock;
        if (!lock) continue;
        const path = targetPath(root, `${repo}/${entry.id}/versions/${version}/${lock}`);
        sources.push({ path, sha256: sha256(readFileSync(path)) });
        for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
          const text = line.split('#')[0].trim(); if (!text) continue;
          const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9.+-]+)$/.exec(text);
          if (!match) throw new Error('RUNTIME_REQUIREMENT_NOT_PINNED');
          const name = match[1].toLowerCase().replaceAll('_', '-');
          if (packages.has(name) && packages.get(name) !== match[2]) throw new Error(`RUNTIME_DEPENDENCY_CONFLICT:${name}`);
          packages.set(name, match[2]);
        }
      }
    }
  }
  return { requirements: [...packages].sort().map(([name, version]) => `${name}==${version}`), sources };
}

export async function detectRuntime({ pythonExecutable = '', wslExecutable = '' } = {}) {
  const result = { python: null, distributions: [], issues: [], writePerformed: false };
  if (pythonExecutable) {
    try { result.python = parseJsonText((await run(pythonExecutable, ['-B', '-c', 'import sys,json;print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))'], { windowsHide: true, timeout: 15000 })).stdout); }
    catch { result.issues.push('选中的 Python 无法运行，请重新选择解释器。'); }
  }
  const wsl = wslExecutable || (process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32/wsl.exe') : '');
  if (wsl && existsSync(wsl)) {
    try {
      const value = await run(wsl, ['--list', '--quiet'], { windowsHide: true, timeout: 15000, encoding: 'buffer' });
      const text = value.stdout.includes(0) ? value.stdout.toString('utf16le') : value.stdout.toString('utf8');
      result.distributions = text.replaceAll('\0', '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); result.wslExecutable = wsl;
    } catch { result.issues.push('WSL 未就绪，可选择已有后端或安装系统组件后重试。'); }
  }
  return result;
}

export function buildOnboardingRuntimePlan({ workspaceRoot, platformId, fields = {}, now = new Date().toISOString(), installationId = randomUUID() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId }); const root = resolve(workspaceRoot);
  if (!snapshot.exists || !snapshot.config.platform) throw new Error('ONBOARDING_CONFIGURATION_REQUIRED');
  if (!/^[a-f0-9-]{36}$/.test(installationId)) throw new Error('INVALID_INSTALLATION_ID');
  const python = fields.pythonExecutable || snapshot.fields.pythonExecutable;
  if (!python || !existsSync(python)) throw new Error('RUNTIME_PYTHON_REQUIRED');
  const selectedBackend = fields.executionBackend || snapshot.fields.executionBackend;
  const backendPath = selectedBackend?platformPath(root,platformId,selectedBackend):null;
  if (!backendPath || !existsSync(backendPath)) throw new Error('RUNTIME_BACKEND_REQUIRED');
  const backend = load(backendPath);
  if (backend.kind !== 'wsl2' || !backend.distro || !backend.interpreter || !backend.wslExecutable) throw new Error('RUNTIME_SEALED_BACKEND_REQUIRED');
  if (!Array.isArray(backend.pathMap) || !backend.sharedReadOnlyBinds?.some((b) => resolve(b.windows) === join(root, 'software'))) throw new Error('RUNTIME_BACKEND_THREE_ROOTS_REQUIRED');
  const installRoot = `${platformId}/runtime/manager-environments/${installationId}`;
  targetPath(root, installRoot);
  const backupRoot = `inbox/backup/${platformId}/manager-environments/${installationId}`;
  targetPath(root, backupRoot);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-runtime', planId: `runtime-${installationId}`, generatedAt: now, workspaceRoot: root, applyMode: 'confirmation-required', writePerformed: false,
    target: { platformId, installationId, python, backendPath, backendSha256: sha256(readFileSync(backendPath)), configPath: snapshot.configPath, configSha256: sha256(readFileSync(targetPath(root, snapshot.configPath))), installRoot, backupRoot },
    steps: [{ operation: 'prepare-private-environments', target: installRoot }, { operation: 'verify-real-environment', target: `${installRoot}/script-environment.json` }, { operation: 'backup-and-restore-drill', target: backupRoot }, { operation: 'activate-configuration', target: snapshot.configPath }],
    payload: { backend, ...runtimeRequirements(root), helperSha256: sha256(readFileSync(helper)), supportingHelpers: Object.fromEntries(['guest_controller.py', 'restore_env.py'].map((name) => [name, sha256(readFileSync(runtimeFile(name)))])) }, verification: ['exact pinned requirements', 'target platform only', 'full environment verification', 'isolated restored copy hash and execution'] };
}

export async function applyOnboardingRuntime(plan, { onProgress = () => {}, registerCancel = () => {}, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() } = {}) {
  requirePlan(plan);
  const rebuilt = buildOnboardingRuntimePlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, fields: { pythonExecutable: plan.target.python, executionBackend: plan.target.backendPath }, now: plan.generatedAt, installationId: plan.target.installationId });
  if (JSON.stringify(rebuilt.target) !== JSON.stringify(plan.target) || JSON.stringify(rebuilt.payload) !== JSON.stringify(plan.payload)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const base = targetPath(plan.workspaceRoot, plan.target.installRoot);
  if (existsSync(base)) {
    const previous = join(base, 'provision.json');
    if (!existsSync(previous) || load(previous).configSha256 !== plan.target.configSha256 || existsSync(join(base, 'activation.json'))) throw new Error('RUNTIME_INSTALLATION_ALREADY_EXISTS');
  }
  const transactionId = makeId(plan, now);
  const checkpoint = saveCheckpoint(auditRoot, transactionId, json({ plan, activationPerformed: false }));
  mkdirSync(base, { recursive: true });
  const specification = { ...plan.target, ...plan.payload, workspaceRoot: plan.workspaceRoot, runner: readOnboardingConfig({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId }).config.runner };
  const spec = join(base, 'provision.json'); atomicWrite(spec, json(specification), transactionId);
  onProgress({ phase: '准备平台环境', platformId: plan.target.platformId, completed: 0, total: 4 });
  try {
    let outputLines = '';
    const processResult = await runOwnedProcess({ python: plan.target.python, args: ['-B', helper, spec], cwd: base, timeout: 1800000, registerCancel, env: { ...process.env, PIP_CACHE_DIR: join(base, 'pip-cache'), TEMP: base, TMP: base }, onOutput: (chunk) => {
      outputLines += chunk;
      const lines = outputLines.split('\n'); outputLines = lines.pop();
      for (const line of lines) { try { const progress = parseJsonText(line); if (typeof progress.phase === 'string') onProgress({ platformId: plan.target.platformId, phase: progress.phase }); } catch { /* Program output is not an instruction. */ } }
    } });
    if (processResult.cancelled) throw new Error('ONBOARDING_CANCELLED');
    if (processResult.exitCode !== 0) throw new Error('RUNTIME_PREPARATION_FAILED');
    const result = load(join(base, 'result.json'));
    if (!result.ok || !result.restoreVerified || !result.environmentVerified) throw new Error('RUNTIME_VERIFICATION_FAILED');
    onProgress({ phase: '激活已验证环境', completed: 3, total: 4 });
    const activation = buildOnboardingConfigPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, fields: { ...readOnboardingConfig({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId }).fields, pythonExecutable: result.hostPython, environmentManifest: join(base, 'script-environment.json'), scriptEnvironment: join(base, 'sealed'), executionBackend: plan.target.backendPath } });
    const applied = applyOnboardingConfig(activation, { actor, auditRoot, now });
    atomicWrite(join(base, 'activation.json'), json({ plan: activation, transaction: applied }), transactionId);
    const event = writeAudit({ actor, auditRoot, now, transactionId, plan, action: plan.kind, status: 'applied', target: plan.target.installRoot, checkpointPath: checkpoint.path, checkpointSha256: checkpoint.sha256, newSha256: sha256(readFileSync(join(base, 'result.json'))), writePerformed: true });
    onProgress({ phase: '环境与恢复已通过', completed: 4, total: 4 });
    return { ...event, checkpointPath: checkpoint.path, result };
  } catch (error) {
    writeAudit({ actor, auditRoot, now, transactionId, plan, action: plan.kind, status: 'failed-not-activated', target: plan.target.installRoot, checkpointPath: checkpoint.path, error: String(error.message).slice(0, 200) });
    if (error.message === 'ONBOARDING_CANCELLED') throw error;
    const failure = join(base, 'failure.json');
    const reason = existsSync(failure) ? load(failure).reason : String(error.message).slice(0, 300);
    throw new Error(`RUNTIME_PREPARATION_FAILED:${reason}`);
  }
}

export function verifyOnboardingRuntime(plan) {
  const base = targetPath(plan.workspaceRoot, plan.target.installRoot);
  if (!existsSync(join(base, 'result.json')) || !existsSync(join(base, 'activation.json'))) return { ok: false, writePerformed: false };
  const result = load(join(base, 'result.json')); const activation = load(join(base, 'activation.json'));
  return { ok: result.ok === true && result.restoreVerified === true && activation.plan.payload.files.every((f) => sha256(readFileSync(targetPath(plan.workspaceRoot, f.path))) === f.newSha256), result, writePerformed: false };
}
