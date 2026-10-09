import {connectorHealth} from './domains/software/health.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { runnerConfig } from './software-publish.mjs';

const SOFTWARE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function readJson(filePath) {
  try {
    return parseJsonText(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function rel(root, target) {
  return relative(root, target).split(sep).join('/');
}

function snapshotFrozen(snapshot) {
  return snapshot?.frozen === true || snapshot?.capabilitySnapshot?.frozen === true;
}

function readSoftware(root, softwareId) {
  const softwareRoot = join(root, 'software', softwareId);
  const pointerPath = join(softwareRoot, 'current.json');
  const pointer = readJson(pointerPath);
  if (!pointer || typeof pointer.version !== 'string') return null;
  const versionRoot = join(softwareRoot, 'versions', pointer.version);
  const manifest = readJson(join(versionRoot, 'manifest.json'));
  const recipe = readJson(join(versionRoot, 'recipes', 'windows.json'));
  const snapshot = readJson(join(versionRoot, 'capabilities.snapshot.json'));
  const connector = readJson(join(versionRoot, 'connector.json'));
  const install = recipe?.install || {};
  const bodyPath = typeof install.detectedPath === 'string' ? install.detectedPath : null;
  const endpoint = manifest?.transport?.baseUrl || recipe?.launch?.endpoint || null;
  const healthCapability = manifest?.capabilities?.find((capability) => capability.name === 'version' || capability.name === 'mcpListTools') || null;
  return {
    id: softwareId,
    version: pointer.version,
    availableVersions: Array.isArray(pointer.available) ? pointer.available : [],
    displayName: manifest?.displayName || softwareId,
    upstreamVersion: manifest?.upstreamVersion || recipe?.acquire?.version || null,
    kind: manifest?.kind || null,
    transport: manifest?.transport?.protocol || manifest?.kind || null,
    bodyPath,
    bodyExists: bodyPath ? existsSync(bodyPath) : null,
    endpoint,
    snapshotFrozen: snapshotFrozen(snapshot),
    hasConnectorDeclaration: Boolean(connector),
    healthCapability: healthCapability?.name || null,
    versionRoot: rel(root, versionRoot),
    manifestPath: rel(root, join(versionRoot, 'manifest.json')),
    recipePath: existsSync(join(versionRoot, 'recipes', 'windows.json')) ? rel(root, join(versionRoot, 'recipes', 'windows.json')) : null,
    entrypoint: recipe?.launch?.entrypoint || recipe?.launch?.startup?.command || null,
    manualSteps: Array.isArray(recipe?.launch?.postStartupManualSteps) ? recipe.launch.postStartupManualSteps : [],
    versionCall: Array.isArray(recipe?.verify?.versionCall) ? recipe.verify.versionCall : null
  };
}

export function listSoftware(root) {
  const softwareRoot = join(root, 'software');
  if (!existsSync(softwareRoot) || !statSync(softwareRoot).isDirectory()) return [];
  return readdirSync(softwareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SOFTWARE_ID.test(entry.name))
    .map((entry) => readSoftware(root, entry.name))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveToken(token, software) {
  const installPath = software.bodyPath;
  if (!installPath) throw new Error('SOFTWARE_BODY_PATH_UNDECLARED');
  if (token === '${softwareRoot}') return installPath;
  if (token.startsWith('${softwareRoot}/') || token.startsWith('${softwareRoot}\\')) return join(installPath, token.slice('${softwareRoot}'.length + 1));
  if (token === '${pythonPath}') return software.pythonPath;
  return token;
}

function resolveVersionCall(software, recipe) {
  if (!Array.isArray(software.versionCall) || software.versionCall.length === 0) return null;
  const install = recipe?.install || {};
  const expanded = software.versionCall.map((token) => {
    if (token === '${pythonPath}/python.exe' || token === '${pythonPath}\\python.exe') return join(install.pythonPath || '', 'python.exe');
    if (token === '${softwareRoot}' || token.startsWith('${softwareRoot}/') || token.startsWith('${softwareRoot}\\')) return resolveToken(token, software);
    return token;
  });
  let executable = expanded[0];
  let args = expanded.slice(1);
  if (!executable.includes('\\') && !executable.includes('/')) {
    const localCandidate = join(software.bodyPath || '', executable);
    if (existsSync(localCandidate)) executable = localCandidate;
  }
  const bodyPath = software.bodyPath;
  if (args[0] && !args[0].startsWith('-') && bodyPath && !args[0].includes('\\') && !args[0].includes('/')) args[0] = join(bodyPath, args[0]);
  return { executable, args, cwd: bodyPath || undefined };
}

export async function healthSoftware(root,softwareId,platformId,options={}) {
  if(typeof softwareId!=='string' || !SOFTWARE_ID.test(softwareId)) throw Error('INVALID_SOFTWARE_ID');
  const software=readSoftware(root,softwareId);if(!software) throw Error('SOFTWARE_NOT_REGISTERED');
  return {...software,...await connectorHealth(root,softwareId,platformId,options)};
}

export function buildSoftwareLaunchPlan({ workspaceRoot, softwareId, platformId = null, mode = 'health', now = new Date().toISOString() }) {
  if (typeof softwareId !== 'string' || !SOFTWARE_ID.test(softwareId)) throw new Error('INVALID_SOFTWARE_ID');
  const software = readSoftware(workspaceRoot, softwareId);
  if (!software) throw new Error('SOFTWARE_NOT_REGISTERED');
  if (platformId) { software.bodyPath = runnerConfig(resolve(workspaceRoot), platformId).value.bodies[softwareId] || null; software.bodyExists = software.bodyPath ? existsSync(software.bodyPath) : false; }
  const plan = {
    schema: 'architecture-manager-plan/v1',
    planId: `software-${mode}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'software-action',
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { softwareId, platformId, version: software.version, mode, bodyPath: software.bodyPath, endpoint: software.endpoint },
    steps: [],
    verification: ['re-read current pointer and recipe before dispatch', 'record provider, version, request and response hashes']
  };
  if (mode === 'health') {
    plan.steps.push({ operation: 'health-check', transport: software.transport, sideEffects: 'none', dispatch: 'provider-only' });
  } else if (mode === 'launch') {
    const interactive = software.kind === 'mcp-http' || software.kind === 'desktop-session' || software.manualSteps.length > 0;
    plan.steps.push({ operation: 'launch-requirements', transport: software.transport, sideEffects: interactive ? 'interactive' : 'local-process', dispatch: 'unavailable', status: 'INTERACTIVE_REQUIRED' });
    plan.verification.push('no launch executor is registered in the manager; do not report a started process');
  } else if (mode === 'open-location') {
    if (!software.bodyPath) throw new Error('SOFTWARE_BODY_PATH_UNDECLARED');
    if (existsSync(software.bodyPath) && statSync(software.bodyPath).isFile()) plan.target.bodyPath = dirname(software.bodyPath);
    plan.steps.push({ operation: 'open-software-location', path: plan.target.bodyPath, sideEffects: 'opens-system-file-manager', consentRequired: true, dispatch: 'electron-shell' });
    plan.verification.push('path must exist and remain the recipe-declared software body path');
  } else {
    throw new Error('INVALID_SOFTWARE_MODE');
  }
  return plan;
}
