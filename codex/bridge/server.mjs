import {maybeRunner, runnerTools} from './runner_bridge.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

const ROOT = process.env.AI_ROOT || 'E:\\ai';
const AGENT_ROOT = process.env.AI_AGENT_ROOT || path.join(ROOT, 'agent');
const TOOL_ROOT = process.env.AI_TOOL_ROOT || path.join(ROOT, 'tool');
const RUNTIME_ROOT = process.env.AI_RUNTIME_ROOT || path.join(ROOT, 'codex', 'runtime');
const PLATFORM = process.env.AI_PLATFORM || 'codex';
const BRIDGE_CONFIG = process.env.AI_BRIDGE_CONFIG || path.join(ROOT, 'codex', 'bridge', 'bridge.json');
const AGENT_REGISTRY = process.env.AI_AGENT_REGISTRY || path.join(AGENT_ROOT, 'registry.json');
const TOOL_REGISTRY = process.env.AI_TOOL_REGISTRY || path.join(TOOL_ROOT, 'registry.json');

const SUPPORTED_AGENT_SCHEMAS = new Set(['ai-agent/v1', 'ai-agent/v2']);
const SUPPORTED_WORKFLOW_SCHEMAS = new Set(['ai-workflow/v1', 'ai-workflow/v2', 'ai-workflow/v2.1']);
let bridgeWriteQueue = Promise.resolve();

const tools = [
  ...runnerTools,
  {
    name: 'ai_list_agents',
    description: 'List enabled shared Agent releases without modifying the shared repository.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'ai_list_workflows',
    description: 'List enabled shared workflow releases without modifying the shared repository.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'ai_get_agent_release',
    description: 'Resolve one Agent version, verify its SHA256SUMS, and return its prompt and lock.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agentId: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 }
      },
      required: ['agentId']
    }
  },
  {
    name: 'ai_get_workflow_release',
    description: 'Resolve one workflow version, verify its SHA256SUMS, and return its execution plan.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workflowId: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 }
      },
      required: ['workflowId']
    }
  },
  {
    name: 'ai_run_workflow',
    description: 'Prepare any registered workflow through the pinned Codex runner. Input is either task parameters or {parameters,inputSources}.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workflowId: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        input: { type: 'object' }
      },
      required: ['workflowId']
    }
  },
  {
    name: 'ai_run_agent',
    description: 'Prepare any registered Agent through the pinned Codex runner; its main workflow and dependencies come only from tool-lock.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agentId: { type: 'string', minLength: 1 },
        agentVersion: { type: 'string', minLength: 1 },
        input: { type: 'object' }
      },
      required: ['agentId']
    }
  },
  {
    name: 'ai_set_platform_default',
    description: 'Atomically set a Codex-only default version for one workflow or Agent after registry and SHA256 verification. Existing runs and shared current pointers are unchanged.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: ['workflow', 'agent'] },
        id: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 }
      },
      required: ['kind', 'id', 'version']
    }
  },
  {
    name: 'ai_get_run',
    description: 'Read a Codex run-lock created by this bridge.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { runId: { type: 'string', minLength: 1 } },
      required: ['runId']
    }
  }
];

function assertId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${name} must be a simple registry id or version`);
  }
  return value;
}

function asPath(...parts) {
  return path.resolve(...parts);
}

function assertInside(candidate, root) {
  const child = asPath(candidate);
  const parent = asPath(root);
  const relative = path.relative(parent, child);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Resolved path escapes the allowed platform or shared repository root');
  }
  return child;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
}

async function verifyRelease(releaseDir) {
  const sumsPath = path.join(releaseDir, 'SHA256SUMS');
  const text = await fs.readFile(sumsPath, 'utf8');
  const checked = [];
  const mismatches = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) throw new Error(`Invalid SHA256SUMS line in ${sumsPath}`);
    const expected = match[1].toLowerCase();
    const relative = match[2].trim();
    const file = assertInside(path.join(releaseDir, relative), releaseDir);
    const actual = await sha256(file);
    checked.push(relative);
    if (actual !== expected) mismatches.push({ file: relative, expected, actual });
  }
  if (mismatches.length) throw new Error(`SHA256 verification failed: ${JSON.stringify(mismatches)}`);
  return { verified: true, files: checked };
}

async function loadBridgeConfig() {
  try { return await readJson(BRIDGE_CONFIG); } catch { return {}; }
}

async function loadRegistry(kind) {
  const file = kind === 'agent' ? AGENT_REGISTRY : TOOL_REGISTRY;
  return readJson(file);
}

function isSupportedAgent(manifest) {
  return SUPPORTED_AGENT_SCHEMAS.has(manifest?.schema);
}

function isSupportedWorkflow(manifest) {
  return SUPPORTED_WORKFLOW_SCHEMAS.has(manifest?.schema);
}

async function resolveRelease(kind, id, requestedVersion) {
  assertId(id, `${kind}Id`);
  const registry = await loadRegistry(kind);
  const entry = (kind === 'agent' ? registry.agents : registry.workflows)
    ?.find(item => item && item.id === id && item.enabled !== false);
  if (!entry) throw new Error(`Enabled ${kind} is not registered: ${id}`);
  const root = kind === 'agent' ? AGENT_ROOT : TOOL_ROOT;
  const base = assertInside(path.join(root, id), root);
  let version = requestedVersion;
  if (!version) {
    const key = kind === 'agent' ? 'agentVersions' : 'workflowVersions';
    const defaults = (await loadBridgeConfig()).defaults?.[key] || {};
    version = defaults[id];
  }
  if (!version) {
    const pointer = await readJson(assertInside(path.join(base, 'current.json'), base));
    if (pointer.id !== id) throw new Error(`Pointer id mismatch for ${id}`);
    version = pointer.version;
  }
  assertId(version, 'version');
  const releaseDir = assertInside(path.join(base, 'versions', version), base);
  const manifest = await readJson(assertInside(path.join(releaseDir, 'manifest.json'), releaseDir));
  const integrity = await verifyRelease(releaseDir);
  return { kind, id, version, releaseDir, manifest, integrity };
}

async function resolveSkill(id, requestedVersion) {
  assertId(id, 'skillId');
  const registry = await loadRegistry('tool');
  const catalogs = registry.skills || [];
  let catalogEntry = null;
  for (const catalog of catalogs) {
    if (catalog?.enabled === false) continue;
    const catalogFile = assertInside(path.join(TOOL_ROOT, catalog.path), TOOL_ROOT);
    const data = await readJson(catalogFile);
    catalogEntry = (data.skills || []).find(item => item?.id === id);
    if (catalogEntry) break;
  }
  if (!catalogEntry) throw new Error(`Registered skill not found: ${id}`);
  const base = assertInside(path.join(TOOL_ROOT, 'skills', id), TOOL_ROOT);
  let version = requestedVersion;
  if (!version) {
    const pointer = await readJson(assertInside(path.join(base, 'current.json'), base));
    if (pointer.id !== id) throw new Error(`Pointer id mismatch for skill ${id}`);
    version = pointer.version;
  }
  assertId(version, 'version');
  if (catalogEntry.version && catalogEntry.version !== version) {
    throw new Error(`Skill ${id}@${version} is not the registered release (${catalogEntry.version})`);
  }
  const releaseDir = assertInside(path.join(base, 'versions', version), base);
  const manifest = await readJson(assertInside(path.join(releaseDir, 'manifest.json'), releaseDir));
  const integrity = await verifyRelease(releaseDir);
  return { kind: 'skill', id, version, releaseDir, manifest, integrity };
}

async function resolvePack(id, requestedVersion) {
  assertId(id, 'packId');
  const registry = await loadRegistry('tool');
  const entry = (registry.packs || []).find(item => item?.id === id && item.enabled !== false);
  if (!entry) throw new Error(`Enabled pack is not registered: ${id}`);
  const base = assertInside(path.join(TOOL_ROOT, 'packs', id), TOOL_ROOT);
  let version = requestedVersion;
  if (!version) {
    const pointer = await readJson(assertInside(path.join(base, 'current.json'), base));
    if (pointer.id !== id) throw new Error(`Pointer id mismatch for pack ${id}`);
    version = pointer.version;
  }
  assertId(version, 'version');
  const releaseDir = assertInside(path.join(base, 'versions', version), base);
  const manifest = await readJson(assertInside(path.join(releaseDir, 'manifest.json'), releaseDir));
  const integrity = await verifyRelease(releaseDir);
  return { kind: 'pack', id, version, releaseDir, manifest, integrity };
}

function lockEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') {
        const split = item.lastIndexOf('@');
        return split > 0 ? { id: item.slice(0, split), version: item.slice(split + 1) } : { id: item };
      }
      return item && typeof item === 'object' ? { id: item.id, version: item.version } : null;
    }).filter(item => item?.id);
  }
  if (typeof value === 'object') return Object.entries(value).map(([id, version]) => ({ id, version }));
  return [];
}

async function dependencyRecord(release) {
  return {
    kind: release.kind,
    id: release.id,
    version: release.version,
    manifestSha256: await sha256(path.join(release.releaseDir, 'manifest.json'))
  };
}

async function resolveToolLock(lock) {
  const dependencies = [];
  for (const item of lockEntries(lock?.skills)) {
    dependencies.push(await dependencyRecord(await resolveSkill(item.id, item.version)));
  }
  for (const item of lockEntries(lock?.packs)) {
    dependencies.push(await dependencyRecord(await resolvePack(item.id, item.version)));
  }
  for (const item of lockEntries(lock?.workflows)) {
    const workflow = await resolveRelease('workflow', item.id, item.version);
    dependencies.push(await dependencyRecord(workflow));
  }
  return dependencies;
}

function parseList(value) {
  if (!value) return [];
  const match = value.match(/\[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(',').map(item => item.trim()).filter(Boolean);
}

function parseWorkflow(text) {
  const stages = [];
  let stage = null;
  let list = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const stageStart = line.match(/^\s*-\s+id:\s*([^\s#]+)\s*$/);
    if (stageStart) {
      stage = { id: stageStart[1], mode: 'serial', workers: [], dependsOn: [], gates: [] };
      stages.push(stage);
      list = null;
      continue;
    }
    if (!stage) continue;
    const mode = line.match(/^\s+mode:\s*([^\s#]+)\s*$/);
    if (mode) { stage.mode = mode[1]; list = null; continue; }
    const workers = line.match(/^\s+workers:\s*(.*)$/);
    if (workers) {
      stage.workers = parseList(workers[1]);
      list = workers[1].trim() ? null : 'workers';
      continue;
    }
    const depends = line.match(/^\s+dependsOn:\s*(.*)$/);
    if (depends) { stage.dependsOn = parseList(depends[1]); list = null; continue; }
    const gates = line.match(/^\s+gates:\s*(.*)$/);
    if (gates) {
      stage.gates = parseList(gates[1]);
      list = gates[1].trim() ? null : 'gates';
      continue;
    }
    const item = line.match(/^\s+-\s+([^\s#]+)\s*$/);
    if (item && list === 'workers') { stage.workers.push(item[1]); continue; }
    if (item && list === 'gates') { stage.gates.push(item[1]); continue; }
    if (!/^\s{6,}/.test(line)) list = null;
  }
  const outputWorker = text.match(/^outputWorker:\s*([^\s#]+)\s*$/m)?.[1] || null;
  if (!stages.length) throw new Error('Workflow definition has no stages');
  return { stages, outputWorker };
}

async function getPrompt(release) {
  const promptName = release.manifest.prompt;
  if (!promptName) return null;
  return fs.readFile(assertInside(path.join(release.releaseDir, promptName), release.releaseDir), 'utf8');
}

async function getWorkflowPlan(release) {
  const entry = release.manifest.entry;
  const file = assertInside(path.join(release.releaseDir, entry), release.releaseDir);
  const definition = await fs.readFile(file, 'utf8');
  return { definition: parseWorkflow(definition), entry, entryPath: file };
}

async function releaseSummary(release) {
  return {
    kind: release.kind,
    id: release.id,
    version: release.version,
    releaseDir: release.releaseDir,
    schema: release.manifest.schema,
    manifest: release.manifest,
    integrity: release.integrity
  };
}

async function listReleases(kind) {
  const registry = await loadRegistry(kind);
  const entries = kind === 'agent' ? registry.agents : registry.workflows;
  const result = [];
  for (const entry of entries || []) {
    if (entry.enabled === false) continue;
    try {
      const release = await resolveRelease(kind, entry.id);
      result.push({
        id: entry.id,
        version: release.version,
        schema: release.manifest.schema,
        portable: kind === 'agent' ? isSupportedAgent(release.manifest) : isSupportedWorkflow(release.manifest),
        runnable: kind === 'agent' ? isSupportedAgent(release.manifest) : isSupportedWorkflow(release.manifest),
        integrity: release.integrity.verified
      });
    } catch (error) {
      result.push({ id: entry.id, version: null, error: error.message });
    }
  }
  return { platform: PLATFORM, readOnly: true, items: result };
}

async function getAgent(args) {
  const release = await resolveRelease('agent', args.agentId, args.version);
  const prompt = await getPrompt(release);
  return { ...(await releaseSummary(release)), prompt, portable: isSupportedAgent(release.manifest) };
}

async function getWorkflow(args) {
  const release = await resolveRelease('workflow', args.workflowId, args.version);
  const plan = await getWorkflowPlan(release);
  return { ...(await releaseSummary(release)), plan };
}

async function collectWorkflowAgents(workflowRelease, topAgent) {
  const plan = await getWorkflowPlan(workflowRelease);
  const ids = [];
  for (const stage of plan.definition.stages) for (const id of stage.workers) if (!ids.includes(id)) ids.push(id);
  if (topAgent && !ids.includes(topAgent.id)) ids.unshift(topAgent.id);
  const agents = [];
  for (const id of ids) {
    const agent = id === topAgent?.id ? topAgent : await resolveRelease('agent', id);
    if (!isSupportedAgent(agent.manifest)) throw new Error(`Agent ${id}@${agent.version} is not platform-neutral`);
    agents.push({ id: agent.id, version: agent.version, sha256: (await sha256(path.join(agent.releaseDir, 'manifest.json'))), manifest: agent.manifest });
  }
  return { plan, agents };
}

function inputHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');
}

async function writeAtomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

async function prepareRun(mode, args) {
  const input = args.input ?? {};
  let topAgent = null;
  let toolLock = null;
  let workflowArgs;
  if (mode === 'agent-workflow') {
    topAgent = await resolveRelease('agent', args.agentId, args.agentVersion);
    if (!isSupportedAgent(topAgent.manifest)) throw new Error(`Agent ${topAgent.id}@${topAgent.version} is not platform-neutral`);
    const locked = topAgent.manifest.workflows || {};
    toolLock = await readJson(assertInside(path.join(topAgent.releaseDir, topAgent.manifest.toolLock || 'tool-lock.json'), topAgent.releaseDir));
    if (!['ai-tool-lock/v1', 'ai-tool-lock/v2'].includes(toolLock.schema)) {
      throw new Error(`Unsupported tool lock schema for Agent ${topAgent.id}@${topAgent.version}`);
    }
    const lockedWorkflows = lockEntries(toolLock.workflows);
    const workflowId = args.workflowId || lockedWorkflows[0]?.id;
    if (!workflowId) throw new Error(`Agent ${topAgent.id}@${topAgent.version} has no locked workflow`);
    const lockedVersion = lockedWorkflows.find(item => item.id === workflowId)?.version;
    const workflowVersion = args.workflowVersion || lockedVersion;
    if (!workflowVersion || (lockedVersion && workflowVersion !== lockedVersion)) {
      throw new Error(`Agent lock does not permit ${workflowId}@${workflowVersion || 'current'}`);
    }
    if (Array.isArray(locked) && locked.length && !locked.includes(workflowId)) {
      throw new Error(`Workflow ${workflowId} is not listed by the Agent manifest`);
    }
    workflowArgs = { workflowId, version: workflowVersion };
  } else {
    workflowArgs = { workflowId: args.workflowId, version: args.version };
  }
  const workflow = await resolveRelease('workflow', workflowArgs.workflowId, workflowArgs.version);
  if (!isSupportedWorkflow(workflow.manifest)) throw new Error(`Workflow ${workflow.id}@${workflow.version} is not supported`);
  const collected = await collectWorkflowAgents(workflow, topAgent);
  const dependencies = mode === 'agent-workflow'
    ? await resolveToolLock(toolLock)
    : [];
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(5).toString('hex')}`;
  const runDir = assertInside(path.join(RUNTIME_ROOT, 'runs', runId), RUNTIME_ROOT);
  const lock = {
    schema: 'ai-run-lock/v1',
    platform: PLATFORM,
    mode,
    runId,
    status: 'prepared',
    execution: 'model-orchestrated',
    agent: topAgent ? { id: topAgent.id, version: topAgent.version, manifestSha256: await sha256(path.join(topAgent.releaseDir, 'manifest.json')) } : null,
    workflow: { id: workflow.id, version: workflow.version, manifestSha256: await sha256(path.join(workflow.releaseDir, 'manifest.json')) },
    agents: collected.agents,
    dependencies,
    inputSha256: inputHash(input),
    startedAt: new Date().toISOString(),
    source: 'codex-shared-bridge'
  };
  await writeAtomicJson(path.join(runDir, 'run-lock.json'), lock);
  return {
    ...lock,
    runDir,
    plan: collected.plan.definition,
    agentPrompt: topAgent ? await getPrompt(topAgent) : null,
    toolLock: mode === 'agent-workflow' ? toolLock : null,
    note: 'The workflow bundle is declarative; Codex executes its stages using the locked plan.'
  };
}

async function getRun(args) {
  assertId(args.runId, 'runId');
  const file = assertInside(path.join(RUNTIME_ROOT, 'runs', args.runId, 'run-lock.json'), path.join(RUNTIME_ROOT, 'runs'));
  return readJson(file);
}

function serializeBridgeWrite(operation) {
  const next = bridgeWriteQueue.then(operation, operation);
  bridgeWriteQueue = next.catch(() => {});
  return next;
}

async function setPlatformDefault(args) {
  const kind = args.kind;
  if (!['workflow', 'agent'].includes(kind)) throw new Error('kind must be workflow or agent');
  const id = assertId(args.id, 'id');
  const version = assertId(args.version, 'version');
  const release = await resolveRelease(kind, id, version);
  return serializeBridgeWrite(async () => {
    const beforeSha256 = await sha256(BRIDGE_CONFIG);
    const config = await loadBridgeConfig();
    if (config.platform !== PLATFORM) throw new Error('Bridge platform does not match this server');
    const key = kind === 'agent' ? 'agentVersions' : 'workflowVersions';
    config.defaults = config.defaults || {};
    config.defaults.workflowVersions = config.defaults.workflowVersions || {};
    config.defaults.agentVersions = config.defaults.agentVersions || {};
    const previousVersion = config.defaults[key][id] || null;
    config.defaults[key][id] = version;
    await writeAtomicJson(BRIDGE_CONFIG, config);
    const result = {
      platform: PLATFORM,
      kind,
      id,
      previousVersion,
      version,
      releaseManifestSha256: await sha256(path.join(release.releaseDir, 'manifest.json')),
      configBeforeSha256: beforeSha256,
      configAfterSha256: await sha256(BRIDGE_CONFIG),
      scope: 'platform-local',
      effectiveFor: 'future-runs-only',
      sharedCurrentChanged: false
    };
    const receiptName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${id}-${crypto.randomUUID()}.json`;
    const receiptPath = path.join(RUNTIME_ROOT, 'default-switches', receiptName);
    await writeAtomicJson(receiptPath, result);
    return { ...result, receiptPath };
  });
}

async function dispatch(name, args = {}) {
  const routed = await maybeRunner(BRIDGE_CONFIG, name, args);
  if (routed) return routed.value;
  switch (name) {
    case 'ai_list_agents': return listReleases('agent');
    case 'ai_list_workflows': return listReleases('workflow');
    case 'ai_get_agent_release': return getAgent(args);
    case 'ai_get_workflow_release': return getWorkflow(args);
    case 'ai_run_workflow': return prepareRun('workflow', args);
    case 'ai_run_agent': return prepareRun('agent-workflow', args);
    case 'ai_set_platform_default': return setPlatformDefault(args);
    case 'ai_get_run': return getRun(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function success(id, value) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value } };
}

function failure(id, error) {
  return { jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'ping') { send({ jsonrpc: '2.0', id: message.id, result: {} }); return; }
  try {
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      send({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: requested || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ai-shared-bridge', version: '1.2.0' },
        instructions: 'Use /wf <workflow-id> <task> for workflows and /wfa <agent-id> <task> for Agents. Both routes prepare through the same ai-run-protocol/v1.1 runner contract. Agent workflows come only from tool-lock. Platform-local default changes affect future Codex runs only.'
      } });
      return;
    }
    if (message.method === 'tools/list') { send({ jsonrpc: '2.0', id: message.id, result: { tools } }); return; }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      send(success(message.id, await dispatch(name, args)));
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send(failure(message.id, error));
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try { void handle(JSON.parse(line)).catch(error => process.stderr.write(error.message + '\n')); } catch (error) { process.stderr.write(`${error.message}\n`); }
}
