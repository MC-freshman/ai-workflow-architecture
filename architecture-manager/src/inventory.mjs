import {parseJson as parseJsonText} from './core/json.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { listSoftware } from './software.mjs';
import { softwareConnectorStatus } from './software-publish.mjs';
import { inspectPlatformConnection } from './platform-check.mjs';
import { latestStableVersion, sortVersions } from './core/versions.mjs';
import { localViewPath } from './core/paths.mjs';
import { inspectGit } from './git.mjs';
import { documentKind, EXTRA_DOCUMENTS, UPDATE_LOG_PATH } from './documents.mjs';

export const FORMAL_TOP_LEVEL_DIRECTORIES = [
  '.workbuddy',
  '.zcode',
  'agent',
  'ai学习笔记',
  'architecture-manager',
  'codex',
  'docs-site',
  'doubao',
  'dsh',
  'inbox',
  'qoder',
  'software',
  'tool',
  'versions',
  'workbuddy',
  'zcode'
];

export { PLATFORM_IDS } from './core/platforms.mjs';
import { PLATFORM_IDS, allPlatformIds, isRegisteredPlatform } from './core/platforms.mjs';
export const SHARED_REPOSITORIES = ['tool', 'agent', 'software'];

function asPosixPath(value) {
  return value.split(sep).join('/');
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('workspace root must be a non-empty path');
  }
  const candidate = resolve(root);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`workspace root is not an existing directory: ${candidate}`);
  }
  return realpathSync(candidate);
}

function relativePath(root, target) {
  return asPosixPath(relative(root, target));
}

function readLocalView(root) {
  const path = localViewPath(root);
  const parsed = safeReadJson(path);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return { path, enabled: {} };
  const enabled = parsed.value.enabled && typeof parsed.value.enabled === 'object' ? parsed.value.enabled : {};
  return { path, enabled };
}

function safeReadJson(filePath) {
  try {
    return { ok: true, value: parseJsonText(readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function readCurrentPointer(root, filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = safeReadJson(filePath);
  const result = {
    path: relativePath(root, filePath),
    valid: parsed.ok,
    id: parsed.ok && typeof parsed.value?.id === 'string' ? parsed.value.id : null,
    version: parsed.ok && typeof parsed.value?.version === 'string' ? parsed.value.version : null,
    sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    error: parsed.ok ? null : parsed.error
  };
  if (parsed.ok && typeof parsed.value?.version !== 'string') {
    result.valid = false;
    result.error = 'current.json has no string version';
  }
  return result;
}

function listReleasePointers(root, repository) {
  const repositoryRoot = join(root, repository);
  if (!existsSync(repositoryRoot) || !statSync(repositoryRoot).isDirectory()) {
    return { repository, exists: false, pointers: [], errors: [`missing repository: ${repository}`] };
  }
  const pointers = [];
  const errors = [];
  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const currentPath = join(repositoryRoot, entry.name, 'current.json');
    if (!existsSync(currentPath)) continue;
    const pointer = readCurrentPointer(root, currentPath);
    const versionsRoot = join(repositoryRoot, entry.name, 'versions');
    const availableVersions = existsSync(versionsRoot) && statSync(versionsRoot).isDirectory()
      ? readdirSync(versionsRoot, { withFileTypes: true })
          .filter((versionEntry) => versionEntry.isDirectory())
          .map((versionEntry) => versionEntry.name)
          .sort(sortVersions)
      : [];
    pointers.push({ ...pointer, resourceId: entry.name, availableVersions, latestStableVersion: latestStableVersion(availableVersions) });
  }
  return { repository, exists: true, pointers, errors };
}

export function inspectPlatformDirectory(workspaceRoot, platformId, directoryRelative = platformId) {
  const root = normalizeRoot(workspaceRoot);
  if (typeof platformId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(platformId)) throw new Error('INVALID_PLATFORM_ID');
  const selected = resolve(root, directoryRelative);
  const candidate = existsSync(selected) ? realpathSync(selected) : selected;
  const rel = relative(root, candidate);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('PLATFORM_PATH_OUTSIDE_WORKSPACE');
  if (!isRegisteredPlatform(platformId, root) || resolve(root, platformId) !== candidate) throw new Error('PLATFORM_DIRECTORY_MISMATCH');
  const directoryExists = existsSync(candidate) && statSync(candidate).isDirectory();
  const canonical = join(candidate, 'bridge.json');
  const legacy = join(candidate, 'bridge', 'bridge.json');
  const canonicalExists = directoryExists && existsSync(canonical) && lstatSync(canonical).isFile();
  const legacyExists = directoryExists && existsSync(legacy) && lstatSync(legacy).isFile();
  const bridge = canonicalExists ? asPosixPath(join(rel, 'bridge.json')) : legacyExists ? asPosixPath(join(rel, 'bridge', 'bridge.json')) : null;
  const bridgeConflict = canonicalExists && legacyExists && !readFileSync(canonical).equals(readFileSync(legacy));
  const chapter = join(candidate, 'bridge', 'platform.md');
  const markers = [
    { path: bridge || asPosixPath(join(rel, 'bridge.json')), label: 'bridge.json', exists: Boolean(bridge) },
    { path: asPosixPath(join(rel, 'bridge', 'platform.md')), label: 'platform chapter', exists: directoryExists && existsSync(chapter) && statSync(chapter).isFile() }
  ];
  const status = !directoryExists ? 'missing-directory' : bridgeConflict ? 'bridge-conflict' : bridge ? 'ready' : 'missing-bridge-marker';
  return {
    id: platformId,
    directoryRelative: asPosixPath(rel),
    directoryPath: candidate,
    directoryExists,
    bridge,
    bridgeLocation: canonicalExists ? 'root' : legacyExists ? 'legacy' : 'missing',
    bridgeConflict,
    legacyBridge: legacyExists ? asPosixPath(join(rel, 'bridge', 'bridge.json')) : null,
    markers,
    status,
    validForView: directoryExists && Boolean(bridge)
  };
}

function summarizeDocument(root, path) {
  const absolute = resolve(root, path);
  const content = readFileSync(absolute, 'utf8');
  const checklist = [...content.matchAll(/^\s*-\s+\[([ xX])\]/gm)];
  const done = checklist.filter((match) => match[1].toLowerCase() === 'x').length;
  const pItems = [...content.replace(/\*\*/g, '').matchAll(/^\s*(?:\|\s*|#{1,6}\s*)?(P\d+[A-Za-z]?)(?=[：: \t|])/gmi)].map((match) => match[1].toUpperCase());
  return {
    path,
    kind: documentKind(path),
    bytes: Buffer.byteLength(content, 'utf8'),
    checklistTotal: checklist.length,
    checklistDone: done,
    pItems: [...new Set(pItems)],
    completionPercent: checklist.length ? Math.round((done / checklist.length) * 100) : null
  };
}

export function refreshPlatformInventory({ workspaceRoot, platformId }) {
  const root = normalizeRoot(workspaceRoot);
  const inspected = inspectPlatformDirectory(root, platformId);
  const localView = readLocalView(root);
  return { ...inspected, connection: inspectPlatformConnection({workspaceRoot:root,platformId}), softwareConnector: softwareConnectorStatus(root,platformId), enabled:localView.enabled[platformId] !== false };
}

export function scanWorkspace(workspaceRoot, { includeGit = false } = {}) {
  const root = normalizeRoot(workspaceRoot);
  const topLevel = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const errors = [];
  const shared = SHARED_REPOSITORIES.map((repository) => listReleasePointers(root, repository));
  for (const item of shared) errors.push(...item.errors);
  const localView = readLocalView(root);
  const platforms = allPlatformIds(root).map((id) => {
    return refreshPlatformInventory({ workspaceRoot:root, platformId:id });
  });
  const versionsRoot = join(root, 'versions');
  const architectureDocuments = existsSync(versionsRoot)
    ? readdirSync(versionsRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => relativePath(root, join(versionsRoot, entry.name)))
        .sort()
    : [];
  architectureDocuments.push(...EXTRA_DOCUMENTS.filter((path) => existsSync(join(root, path))));
  const runtimeDocsRoot = join(root, 'docs-site', 'docs', 'runtime');
  if (existsSync(runtimeDocsRoot) && statSync(runtimeDocsRoot).isDirectory()) {
    architectureDocuments.push(...readdirSync(runtimeDocsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => relativePath(root, join(runtimeDocsRoot, entry.name))));
  }
  const uniqueArchitectureDocuments = [...new Set(architectureDocuments)].sort((left, right) =>
    left === UPDATE_LOG_PATH ? -1 : right === UPDATE_LOG_PATH ? 1 : left.localeCompare(right));
  const documentSummaries = uniqueArchitectureDocuments.map((path) => summarizeDocument(root, path));
  const agents = [];
  const skills = [];
  const agentRegistryPath = join(root, 'agent', 'registry.json');
  const toolRegistryPath = join(root, 'tool', 'registry.json');
  const agentRegistry = safeReadJson(agentRegistryPath);
  const toolRegistry = safeReadJson(toolRegistryPath);
  if (agentRegistry.ok && Array.isArray(agentRegistry.value?.agents)) agents.push(...agentRegistry.value.agents.map((entry) => {
    const pointer = safeReadJson(join(root, 'agent', entry.id, 'current.json'));
    return { ...entry, registryVersion: entry.version || null, currentVersion: pointer.ok ? pointer.value?.version || null : null };
  }));
  if (toolRegistry.ok && Array.isArray(toolRegistry.value?.skills)) skills.push(...toolRegistry.value.skills);

  return {
    schema: 'architecture-manager-inventory/v2',
    scannedAt: new Date().toISOString(),
    workspaceRoot: root,
    formalTopLevelDirectories: FORMAL_TOP_LEVEL_DIRECTORIES,
    observedTopLevelDirectories: topLevel,
    sharedRepositories: shared,
    software: listSoftware(root),
    platforms,
    localView: { path: localView.path, enabled: localView.enabled },
    agents,
    skills,
    catalogRegistries: {
      agent: { path: 'agent/registry.json', sha256: existsSync(agentRegistryPath) ? createHash('sha256').update(readFileSync(agentRegistryPath, 'utf8'), 'utf8').digest('hex') : null },
      skill: { path: 'tool/registry.json', sha256: existsSync(toolRegistryPath) ? createHash('sha256').update(readFileSync(toolRegistryPath, 'utf8'), 'utf8').digest('hex') : null }
    },
    architectureDocuments: uniqueArchitectureDocuments,
    documentSummaries,
    git: includeGit ? inspectGit(root) : null,
    errors,
    writePerformed: false
  };
}

export function assertWithinRoot(root, target) {
  const normalizedRoot = normalizeRoot(root);
  const candidate = resolve(target);
  const rel = relative(normalizedRoot, candidate);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return true;
  throw new Error(`path is outside workspace root: ${candidate}`);
}
