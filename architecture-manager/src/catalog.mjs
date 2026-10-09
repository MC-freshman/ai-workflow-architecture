import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { sha256 } from './core/hash.mjs';
import {readJson as readJsonFile,parseJson} from './core/json.mjs';
import {targetPath} from './core/paths.mjs';
import {validateRegistry} from './domains/resources/registry.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function readJson(path) {
  try { return readJsonFile(path); } catch { return null; }
}

function safeWorkspacePath(root, relativePath) {
  return targetPath(root,relative(resolve(root),resolve(root,relativePath)));
}

function toRelative(root, target) {
  return relative(root, target).split(sep).join('/');
}

function registryInfo(kind) {
  if (kind === 'agent') return { relativePath: 'agent/registry.json', key: 'agents', base: 'agent' };
  if (kind === 'skill') return { relativePath: 'tool/registry.json', key: 'skills', base: 'tool' };
  if (kind === 'workflow') return { relativePath: 'tool/registry.json', key: 'workflows', base: 'tool' };
  throw new Error('INVALID_CATALOG_KIND');
}

export function readCatalogEntry({ workspaceRoot, kind, id }) {
  if (!ID.test(String(id || ''))) throw new Error('INVALID_CATALOG_ID');
  const root = resolve(workspaceRoot);
  const info = registryInfo(kind);
  const registryPath = safeWorkspacePath(root, info.relativePath);
  const registry = readJson(registryPath);
  const entry = registry?.[info.key]?.find((item) => item.id === id);
  if (!entry) throw new Error('CATALOG_ENTRY_NOT_FOUND');
  if (kind === 'agent') {
    const currentRef = entry.current || `${id}/current.json`;
    const currentPath = safeWorkspacePath(root, currentRef.startsWith('agent/') ? currentRef : `agent/${currentRef}`);
    const current = readJson(currentPath);
    const version = current?.version || entry.version;
    const versionRoot = safeWorkspacePath(root, `agent/${id}/versions/${version}`);
    const manifestPath = join(versionRoot, 'manifest.json');
    const manifest = readJson(manifestPath);
    const promptPath = safeWorkspacePath(versionRoot, manifest?.prompt || 'prompt.md');
    return {
      kind, id, entry,
      registryPath: info.relativePath,
      currentPath: toRelative(root, currentPath),
      manifestPath: existsSync(manifestPath) ? toRelative(root, manifestPath) : null,
      promptPath: existsSync(promptPath) ? toRelative(root, promptPath) : null,
      current,
      manifest,
      prompt: existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : null,
      writePerformed: false
    };
  }
  const catalogRelative = entry.path.startsWith('tool/') ? entry.path : `tool/${entry.path}`;
  const catalogPath = safeWorkspacePath(root, catalogRelative);
  const catalog = readJson(catalogPath);
  return {
    kind, id, entry,
    registryPath: info.relativePath,
    catalogPath: catalogRelative,
    catalog,
    catalogText: existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : null,
    skillCount: Array.isArray(catalog?.skills) ? catalog.skills.length : 0,
    writePerformed: false
  };
}

export function readSkillContent({ workspaceRoot, catalogId, id, version }) {
  const detail = readCatalogEntry({ workspaceRoot, kind: 'skill', id: catalogId });
  const skill = detail.catalog?.skills?.find((item) => item.id === id && item.version === version);
  if (!skill || !ID.test(id) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('CATALOG_ENTRY_NOT_FOUND');
  const release = safeWorkspacePath(workspaceRoot, `tool/skills/${id}/versions/${version}`);
  const manifest = readJson(join(release, 'manifest.json'));
  const path = safeWorkspacePath(release, manifest?.entry || 'SKILL.md');
  return { id, version, path: toRelative(workspaceRoot, path), content: readFileSync(path, 'utf8'), manifest, writePerformed: false };
}

export function inspectRegistration({ workspaceRoot, kind, selectedPath }) {
  const path = safeWorkspacePath(workspaceRoot, selectedPath);
  if (kind === 'agent') {
    if (!statSync(path).isDirectory()) throw new Error('CATALOG_CURRENT_NOT_FOUND');
    const pointer = readJson(join(path, 'current.json'));
    const id = pointer?.id;
    if (!ID.test(id || '') || path !== safeWorkspacePath(workspaceRoot, `agent/${id}`)) throw new Error('INVALID_CATALOG_ID');
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pointer.version || '')) throw new Error('INVALID_CURRENT_VERSION');
    const manifest = readJson(safeWorkspacePath(path, `versions/${pointer.version}/manifest.json`));
    if (manifest?.id !== id || manifest.version !== pointer.version) throw new Error('CATALOG_MANIFEST_MISMATCH');
    return { id, entry: { current: `${id}/current.json`, version: pointer.version } };
  }
  if (kind !== 'skill') throw new Error('INVALID_CATALOG_KIND');
  const rel = toRelative(join(workspaceRoot, 'tool'), path);
  const data = readJson(path);
  if (!/^_registry\/skills-[\w.-]+\.json$/.test(rel) || !Array.isArray(data?.skills)) throw new Error('SKILL_CATALOG_PATH_REQUIRED');
  return { id: rel.split('/').pop().replace(/\.json$/, ''), entry: { path: rel } };
}

function requireUnreferenced(root, kind, id, entry) {
  const ids = kind === 'skill'
    ? [id, ...(readJson(safeWorkspacePath(root, `tool/${entry.path}`))?.skills || []).map((item) => item.id)]
    : [id];
  const referenceKeys = kind === 'agent' ? new Set(['agent', 'agents', 'agentId', 'worker', 'workers', 'outputWorker', 'delegateAgent', 'subagent']) : new Set(['skill', 'skills', 'skillId', 'skillIds']);
  const named = (value) => ids.some((target) => value === target || value.startsWith(`${kind}:${target}@`) || value === `${kind}:${target}`);
  function hasStructuredReference(node, key = '') {
    if (typeof node === 'string') return referenceKeys.has(key) && named(node);
    if (Array.isArray(node)) return node.some((item) => hasStructuredReference(item, key));
    if (!node || typeof node !== 'object') return false;
    if (referenceKeys.has(key) && Object.keys(node).some(named)) return true;
    return Object.entries(node).some(([next, value]) => hasStructuredReference(value, next));
  }
  function mentionsReference(path) {
    const text = readFileSync(path, 'utf8');
    try { return hasStructuredReference(parseJson(text)); }
    catch {
      return text.split(/\r?\n/).some((line) => {
        const match = /^\s*(?:-\s*)?([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
        if (!match || !referenceKeys.has(match[1])) return false;
        return match[2].replace(/[\[\],]/g, ' ').split(/\s+/).some((token) => named(token.replace(/^['"]|['"]$/g, '')));
      });
    }
  }
  const hits = [];
  for (const [repo, key, names] of [['agent', 'agents', ['manifest.json', 'tool-lock.json']], ['tool', 'workflows', ['manifest.json', 'workflow.yaml']]]) {
    const registry = readJson(join(root, repo, 'registry.json'));
    for (const resource of registry?.[key] || []) {
      if (!resource?.id || resource.enabled === false || resource.deprecated === true) continue;
      if (kind === 'agent' && repo === 'agent' && resource.id === id) continue;
      const current = readJson(join(root, repo, resource.id, 'current.json'));
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(current?.version || '')) continue;
      const release = safeWorkspacePath(root, `${repo}/${resource.id}/versions/${current.version}`);
      for (const name of names) {
        const path = join(release, name);
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        if (mentionsReference(path)) hits.push(toRelative(root, path));
      }
    }
  }
  if (hits.length) throw new Error(`RESOURCE_REFERENCED: ${hits.join(', ')}`);
}

export function buildRegistryPlan({ workspaceRoot, kind, action, id, baselineSha256, entry = {}, now = new Date().toISOString() }) {
  const root = resolve(workspaceRoot);
  const info = registryInfo(kind);
  const registryPath = safeWorkspacePath(root, info.relativePath);
  if (!existsSync(registryPath)) throw new Error('CATALOG_REGISTRY_NOT_FOUND');
  const before = readFileSync(registryPath, 'utf8');
  const actualSha = sha256(before);
  if (typeof baselineSha256 !== 'string' || baselineSha256 !== actualSha) throw new Error('CATALOG_BASELINE_MISMATCH');
  const registry = parseJson(before);
  const items = Array.isArray(registry[info.key]) ? [...registry[info.key]] : [];
  const index = items.findIndex((item) => item.id === id);
  let nextItems;
  let description;
  if (action === 'add') {
    if (!ID.test(String(id || '')) || index >= 0) throw new Error('CATALOG_ENTRY_ALREADY_EXISTS');
    if (kind === 'agent') {
      const inspected = inspectRegistration({ workspaceRoot: root, kind, selectedPath: `agent/${id}` });
      nextItems = [...items, { id, ...inspected.entry, enabled: true }];
    } else {
      const catalogPath = typeof entry.path === 'string' ? entry.path : '';
      if (!catalogPath.startsWith('_registry/') || !catalogPath.endsWith('.json')) throw new Error('SKILL_CATALOG_PATH_REQUIRED');
      inspectRegistration({ workspaceRoot: root, kind, selectedPath: `tool/${catalogPath}` });
      nextItems = [...items, { id, path: catalogPath, kind: 'skill-catalog', enabled: true, invocable: false }];
    }
    description = `添加 ${kind} ${id}`;
  } else if (action === 'remove') {
    if (index < 0) throw new Error('CATALOG_ENTRY_NOT_FOUND');
    requireUnreferenced(root, kind, id, items[index]);
    nextItems = items.filter((item) => item.id !== id);
    description = `从 registry 移除 ${kind} ${id}（不删除已发布目录）`;
  } else if (action === 'mark') {
    if (index < 0) throw new Error('CATALOG_ENTRY_NOT_FOUND');
    const supersededBy = typeof entry.supersededBy === 'string' && entry.supersededBy.trim() !== '' ? entry.supersededBy : null;
    if (!supersededBy) throw new Error('CATALOG_SUPERSEDED_BY_REQUIRED');
    const deprecationNote = typeof entry.deprecationNote === 'string' ? entry.deprecationNote : null;
    nextItems = items.map((item) => item.id === id ? { ...item, deprecated: true, supersededBy, ...(deprecationNote ? { deprecationNote } : {}) } : item);
    description = `标记 ${kind} ${id} 为 deprecated（supersededBy=${supersededBy}）；不改 enabled，已钉版的 run 仍可解析`;
  } else if (action === 'enable' || action === 'disable') {
    if (index < 0) throw new Error('CATALOG_ENTRY_NOT_FOUND');
    if (action === 'disable') requireUnreferenced(root, kind, id, items[index]);
    nextItems = items.map((item) => item.id === id ? { ...item, enabled: action === 'enable' } : item);
    description = `${action === 'enable' ? '启用' : '停用'} ${kind} ${id}`;
  } else {
    throw new Error('INVALID_CATALOG_ACTION');
  }
  const afterObject = { ...registry, ...(Number.isInteger(registry.version) ? { version: registry.version + 1 } : {}), [info.key]: nextItems };
  const after = `${JSON.stringify(afterObject, null, 2)}\n`;
  validateRegistry(root,info.base,after,{validateReleases:action==='add'||action==='enable',onlyIds:new Set([id])});
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `registry-${kind}-${action}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'registry-edit',
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { path: info.relativePath, catalogKind: kind, action, id, description, entry },
    steps: [{ operation: 'replace-registry-json', target: info.relativePath, oldSha256: actualSha, newSha256: sha256(after), checkpoint: true }],
    verification: ['re-read registry baseline before apply', 'preserve checkpoint for rollback', 're-scan full catalog after apply'],
    payload: { afterText: after }
  };
}
