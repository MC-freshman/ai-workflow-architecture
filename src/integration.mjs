import { validateRegistry } from './domains/resources/registry.mjs';
import { parseJson as parseJsonText } from './core/json.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { sha256 } from './core/hash.mjs';
import { join, relative, resolve, sep } from 'node:path';

const RESOURCE_KINDS = new Set(['tool', 'agent', 'software']);
import { isRegisteredPlatform } from './core/platforms.mjs';
import { buildResourcePointerPlan } from './plans.mjs';
import {bridgeCompatibility} from './domains/platforms/bridge-compatibility.mjs';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECRET_KEYS = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)/i;


function rootPath(workspaceRoot) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('WORKSPACE_NOT_FOUND');
  return root;
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_INTEGRATION_TARGET');
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('INTEGRATION_TARGET_OUTSIDE_WORKSPACE');
  return normalized;
}

function pathFor(root, relativePath) {
  const safe = safeRelative(relativePath);
  const target = resolve(root, safe);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || /^[A-Za-z]:/i.test(rel)) throw new Error('INTEGRATION_TARGET_OUTSIDE_WORKSPACE');
  return target;
}

function assertId(id, code = 'INVALID_INTEGRATION_ID') {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(code);
}

function readText(root, path) {
  const target = pathFor(root, path);
  if (!existsSync(target)) return { path, exists: false, content: '', sha256: null };
  if (!statSync(target).isFile()) throw new Error('INTEGRATION_TARGET_NOT_FILE');
  const content = readFileSync(target, 'utf8');
  return { path, exists: true, content, sha256: sha256(content) };
}

function platformCandidates(root, platformId) {
  assertId(platformId, 'INVALID_PLATFORM_ID');
  if (!isRegisteredPlatform(platformId, root)) throw new Error('UNKNOWN_PLATFORM_ID');
  const platformRoot = join(root, platformId);
  if (!existsSync(platformRoot) || !statSync(platformRoot).isDirectory()) return [];
  return [`${platformId}/bridge.json`];
}

function resourceCandidates(root, kind, id) {
  assertId(id, 'INVALID_RESOURCE_ID');
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_SHARED_REPOSITORY');
  const current = `${kind}/${id}/current.json`;
  const registry = `${kind}/registry.json`;
  return [current, registry].filter((path) => existsSync(pathFor(root, path)));
}

function targetPathFor(root, kind, targetId, path) {
  if (kind === 'platform') {
    const candidates = platformCandidates(root, targetId);
    const selected = path ? safeRelative(path) : candidates[0];
    if (!selected || !candidates.includes(selected)) throw new Error('PLATFORM_CONFIG_TARGET_NOT_ALLOWED');
    return selected;
  }
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_INTEGRATION_KIND');
  if (targetId === '__registry__') {
    const registry = `${kind}/registry.json`;
    if (path && safeRelative(path) !== registry) throw new Error('RESOURCE_TARGET_NOT_ALLOWED');
    if (!existsSync(pathFor(root, registry))) throw new Error('RESOURCE_REGISTRY_NOT_FOUND');
    return registry;
  }
  assertId(targetId, 'INVALID_RESOURCE_ID');
  const selected = path ? safeRelative(path) : `${kind}/${targetId}/current.json`;
  const expectedCurrent = `${kind}/${targetId}/current.json`;
  const expectedRegistry = `${kind}/registry.json`;
  if (selected !== expectedCurrent && selected !== expectedRegistry) throw new Error('RESOURCE_TARGET_NOT_ALLOWED');
  if (selected === expectedCurrent && !existsSync(pathFor(root, selected))) throw new Error('RESOURCE_CURRENT_NOT_FOUND');
  if (selected === expectedRegistry && !existsSync(pathFor(root, selected))) throw new Error('RESOURCE_REGISTRY_NOT_FOUND');
  return selected;
}

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) && typeof item === 'string' && item.trim() && !item.startsWith('reference:') && !item.startsWith('${')) throw new Error(`RAW_SECRET_NOT_ALLOWED:${path}.${key}`);
    assertNoSecrets(item, `${path}.${key}`);
  }
}

function parseJson(text) {
  if (typeof text !== 'string') throw new Error('INTEGRATION_JSON_REQUIRED');
  let parsed;
  try { parsed = parseJsonText(text); } catch { throw new Error('INTEGRATION_JSON_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INTEGRATION_JSON_OBJECT_REQUIRED');
  assertNoSecrets(parsed);
  return parsed;
}

function basePlan(kind, root, now) {
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `integration-${kind}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: `integration-${kind}`,
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    steps: [],
    verification: [
      're-read target baseline hash immediately before apply',
      'write through a checkpoint and atomic replacement',
      're-read the target and verify the new hash after apply'
    ]
  };
}

export function listIntegrationTargets({ workspaceRoot, kind, targetId }) {
  const root = rootPath(workspaceRoot);
  if (kind === 'platform') return { schema: 'architecture-manager-integration-targets/v1', kind, targetId, paths: platformCandidates(root, targetId), writePerformed: false };
  if (RESOURCE_KINDS.has(kind)) {
    const paths = targetId === '__registry__' ? resourceCandidates(root, kind, 'missing-id').filter((path) => path === `${kind}/registry.json`) : resourceCandidates(root, kind, targetId);
    return { schema: 'architecture-manager-integration-targets/v1', kind, targetId, paths, writePerformed: false };
  }
  throw new Error('INVALID_INTEGRATION_KIND');
}

export function readIntegrationTarget({ workspaceRoot, kind, targetId, relativePath = null }) {
  const root = rootPath(workspaceRoot);
  const path = targetPathFor(root, kind, targetId, relativePath);
  const data = readText(root, path);
  let parsed = null;
  if (data.exists) {
    try { parsed = parseJsonText(data.content); } catch { parsed = null; }
  }
  let migrationSource = null;
  if (kind === 'platform' && !data.exists) {
    const legacy = readText(root, `${targetId}/bridge/bridge.json`);
    if (legacy.exists) migrationSource = legacy;
  }
  return { schema: 'architecture-manager-integration-target/v1', kind, targetId, path, ...data, parsed, migrationSource, writePerformed: false };
}

export function suggestPlatformBridge({ workspaceRoot, platformId }) {
  const root = rootPath(workspaceRoot);
  const paths = platformCandidates(root, platformId);
  if (!paths.length) throw new Error('PLATFORM_DIRECTORY_NOT_FOUND');
  const canonical = readText(root, paths[0]);
  const legacy = readText(root, `${platformId}/bridge/bridge.json`);
  if (canonical.exists && legacy.exists && canonical.content !== legacy.content) {
    const configPath=[`${platformId}/bridge/runner-config.json`,`${platformId}/bridge/${platformId}-config.json`].find(path=>existsSync(pathFor(root,path)));
    const binding=bridgeCompatibility(root,platformId,configPath?parseJson(readText(root,configPath).content):{});
    return {platformId,path:paths[0],source:binding.authority,afterText:readText(root,binding.authority).content,nextStep:'review-migration',writePerformed:false};
  }
  if (canonical.exists) return { platformId, path: paths[0], source: 'canonical', afterText: canonical.content, nextStep: 'verify', writePerformed: false };
  if (legacy.exists) {
    const parsed = parseJson(legacy.content);
    if (parsed.platform !== platformId) throw new Error('PLATFORM_ID_MISMATCH');
    return { platformId, path: paths[0], source: 'legacy', afterText: legacy.content, nextStep: 'review-migration', writePerformed: false };
  }
  const configCandidates = [`${platformId}/bridge/runner-config.json`, `${platformId}/bridge/${platformId}-config.json`];
  const configPath = configCandidates.find((candidate) => existsSync(pathFor(root, candidate)));
  const draft = {
    schema: 'ai-platform-bridge/v1',
    platform: platformId,
    shared: {
      agentRegistry: join(root, 'agent', 'registry.json'),
      toolRegistry: join(root, 'tool', 'registry.json'),
      architecturePrompt: join(root, 'AI_ARCHITECTURE_SYSTEM_PROMPT.md'),
      readOnly: true
    },
    runtimeRoot: join(root, platformId, 'runtime'),
    modes: ['workflow', 'agent-workflow']
  };
  if (configPath) {
    const config = parseJson(readText(root, configPath).content);
    if (config.platform !== platformId) throw new Error('PLATFORM_CONFIG_ID_MISMATCH');
    const version = typeof config.runner === 'string' ? config.runner.replaceAll('\\', '/').match(/\/versions\/(\d+\.\d+\.\d+)/)?.[1] : null;
    draft.runner = { enabled: true, ...(version ? { version } : {}), config: pathFor(root, configPath) };
  }
  return { platformId, path: paths[0], source: 'generated', afterText: `${JSON.stringify(draft, null, 2)}\n`, nextStep: configPath ? 'verify' : 'adapter-required', writePerformed: false };
}

export function buildIntegrationPlan({ workspaceRoot, kind, targetId, mode = 'config', relativePath = null, beforeText = null, afterText = null, baselineSha256 = null, currentVersion = null, targetVersion = null, availableVersions = [], now = new Date().toISOString() }) {
  const root = rootPath(workspaceRoot);
  if (kind === 'platform') {
    if (mode !== 'config') throw new Error('PLATFORM_CONFIG_ONLY');
    const path = targetPathFor(root, kind, targetId, relativePath);
    const current = readText(root, path);
    const legacy = readText(root, `${targetId}/bridge/bridge.json`);
    const configCandidates=[`${targetId}/bridge/runner-config.json`,`${targetId}/bridge/${targetId}-config.json`];
    const configPath=configCandidates.find(candidate=>existsSync(pathFor(root,candidate)));
    const binding=(current.exists || legacy.exists)?bridgeCompatibility(root,targetId,configPath?parseJson(readText(root,configPath).content):{}):null;
    const before = beforeText ?? current.content;
    if (current.sha256 !== (baselineSha256 ?? current.sha256) || current.content !== before) throw new Error('INTEGRATION_BASELINE_MISMATCH');
    const next = parseJson(afterText);
    if (next.platform !== targetId) throw new Error('PLATFORM_ID_MISMATCH');
    if (!['ai-platform-bridge/v1', 'ai-platform-bridge/v1.1'].includes(next.schema) || !next.shared || next.shared.readOnly !== true || typeof next.shared.agentRegistry !== 'string' || typeof next.shared.toolRegistry !== 'string' || typeof next.shared.architecturePrompt !== 'string' || typeof next.runtimeRoot !== 'string' || !Array.isArray(next.modes)) throw new Error('PLATFORM_BRIDGE_INCOMPLETE');
    if (before === afterText && (!legacy.exists || legacy.content===afterText)) throw new Error('NO_INTEGRATION_CHANGE');
    const plan = basePlan('config', root, now);
    plan.target = { kind, targetId, mode, path };
    plan.steps.push({ operation: 'replace-platform-config', target: path, oldSha256: current.sha256, newSha256: sha256(afterText), oldExists: current.exists, checkpoint: true });
    plan.payload = { afterText };
    if (configPath) {
      const configBefore = readText(root, configPath);
      const config = parseJson(configBefore.content);
      if (config.platform !== targetId) throw new Error('PLATFORM_CONFIG_ID_MISMATCH');
      const currentRef = typeof config.bridge === 'string' ? resolve(config.bridge) : null;
      const canonicalPath = pathFor(root, path);
      const legacyPath = pathFor(root, `${targetId}/bridge/bridge.json`);
      if (currentRef && currentRef !== canonicalPath && currentRef !== legacyPath) throw new Error('PLATFORM_BRIDGE_REFERENCE_UNKNOWN');
      if (currentRef !== canonicalPath) {
        const companionAfterText = `${JSON.stringify({ ...config, bridge: canonicalPath }, null, 2)}\n`;
        plan.steps.push({ operation: 'update-runner-bridge-reference', target: configPath, oldSha256: configBefore.sha256, newSha256: sha256(companionAfterText), checkpoint: true });
        plan.payload.companionAfterText = companionAfterText;
        plan.verification.push('verify the client runner points to the canonical bridge');
      }
    }
    plan.payload.compatibility=binding?{authority:binding.authority,conflicted:binding.conflicted}:null;
    plan.payload.mirrors=(binding?.mirrors || []).map(path=>({path,afterText}));
    for(const mirror of plan.payload.mirrors)plan.steps.push({operation:'sync-bridge-mirror',target:mirror.path,oldSha256:readText(root,mirror.path).sha256,newSha256:sha256(afterText),checkpoint:true});
    return plan;
  }
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_INTEGRATION_KIND');
  const path = targetPathFor(root, kind, targetId, relativePath);
  const current = readText(root, path);
  if (mode === 'pointer') {
    if (!path.endsWith('/current.json')) throw new Error('POINTER_TARGET_REQUIRED');
    const pointer = parseJsonText(current.content);
    const actualVersion = pointer?.version;
    if (baselineSha256 !== current.sha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
    return buildResourcePointerPlan({ workspaceRoot: root, repository: kind, resourceId: targetId, currentVersion: actualVersion, targetVersion, availableVersions, baselineSha256: current.sha256, now });
  }
  if (mode !== 'registry') throw new Error('RESOURCE_MODE_REQUIRED');
  if (!path.endsWith('/registry.json')) throw new Error('REGISTRY_TARGET_REQUIRED');
  if (current.sha256 !== baselineSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  validateRegistry(root,kind,afterText);
  if (current.content === afterText) throw new Error('NO_INTEGRATION_CHANGE');
  const plan = basePlan('registry', root, now);
  plan.target = { kind, targetId, mode, path };
  plan.steps.push({ operation: 'replace-resource-registry', target: path, oldSha256: current.sha256, newSha256: sha256(afterText), checkpoint: true });
  plan.payload = { afterText };
  return plan;
}

