import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools } from '../src/lib/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DATE = '2026-11-06';
const SOFTWARE_ID = 'vmware-workstation';
const VERSION = '1.0.0';
const UPSTREAM_VERSION = '17.5.2';

const NATIVE_NAMES = {
  vmrun_list: 'vmrun -T ws list',
  vmrun_inventory: 'filesystem scan of VMWARE_VMX_ROOTS + vmrun -T ws list',
  vmrun_status: 'read .vmx + vmrun -T ws list',
  vmrun_start: 'vmrun -T ws start <vmx> [gui|nogui]',
  vmrun_stop: 'vmrun -T ws stop <vmx> [soft|hard]',
  vmrun_reset: 'vmrun -T ws reset <vmx> [soft|hard]',
  vmrun_suspend: 'vmrun -T ws suspend <vmx> [soft|hard]',
  vmrun_pause: 'vmrun -T ws pause <vmx>',
  vmrun_unpause: 'vmrun -T ws unpause <vmx>',
  vmrun_guest_ip: 'vmrun -T ws getGuestIPAddress <vmx> [-wait]',
  vmrun_run: 'vmrun -T ws -gu ... -gp ... runProgramInGuest <vmx> [flags] <program> [args...]',
  vmrun_ps: 'vmrun -T ws -gu ... -gp ... listProcessesInGuest <vmx>',
  vmrun_kill: 'vmrun -T ws -gu ... -gp ... killProcessInGuest <vmx> <pid>',
  vmrun_file_exists: 'vmrun -T ws -gu ... -gp ... fileExistsInGuest <vmx> <guest path>',
  vmrun_copy_to: 'vmrun -T ws -gu ... -gp ... CopyFileFromHostToGuest <vmx> <host path> <guest path>',
  vmrun_copy_from: 'vmrun -T ws -gu ... -gp ... CopyFileFromGuestToHost <vmx> <guest path> <host path>',
  vmrun_clone: 'vmrun -T ws clone <vmx> <dest vmx> full|linked [-snapshot=<name>]',
  vmrun_host_networks: 'vmrun -T ws listHostNetworks',
  vmrun_portforward_list: 'vmrun -T ws listPortForwardings <network>',
  vmrun_portforward_set: 'vmrun -T ws setPortForwarding <network> <protocol> <hostPort> <guestIp> <guestPort> [description]',
  vmrun_portforward_delete: 'vmrun -T ws deletePortForwarding <network> <protocol> <hostPort>'
};

const GUEST_TOOLS = new Set([
  'vmrun_run',
  'vmrun_ps',
  'vmrun_kill',
  'vmrun_file_exists',
  'vmrun_copy_to',
  'vmrun_copy_from'
]);

const COPY_TOOLS = new Set(['vmrun_copy_to', 'vmrun_copy_from']);
const READ_PATH_TOOLS = new Set(['vmrun_list', 'vmrun_inventory', 'vmrun_status', 'vmrun_host_networks', 'vmrun_portforward_list']);
const HOST_CONFIG_TOOLS = new Set(['vmrun_portforward_set', 'vmrun_portforward_delete']);

const RESULT_OUTPUT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'vmrun tool result',
  type: 'object',
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    vmPath: { type: 'string' },
    mode: { type: ['string', 'null'] },
    total: { type: ['integer', 'null'] },
    vms: { type: 'array' },
    count: { type: 'integer' },
    running: { type: ['boolean', 'null'] },
    runningKnown: { type: 'boolean' },
    ip: { type: ['string', 'null'] },
    exists: { type: 'boolean' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    raw: { type: 'string' },
    argv: { type: 'array', items: { type: 'string' } },
    exitCode: { type: ['integer', 'null'] }
  },
  additionalProperties: true
};

function writeJson(relativePath, value) {
  const target = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function permissionsFor(tool) {
  return {
    filesystem: COPY_TOOLS.has(tool.name)
      ? 'workspace'
      : HOST_CONFIG_TOOLS.has(tool.name)
        ? 'system'
        : READ_PATH_TOOLS.has(tool.name)
          ? 'read'
          : 'none',
    network: 'loopback',
    process: 'children',
    credentials: GUEST_TOOLS.has(tool.name) ? 'reference:vmware-guest' : 'none'
  };
}

function capabilityFor(tool) {
  return {
    name: tool.name,
    nativeName: NATIVE_NAMES[tool.name],
    inputSchemaRef: `schemas/${tool.inputSchemaFile}`,
    outputSchemaRef: 'schemas/result.output.json',
    sideEffects: tool.sideEffects,
    permissionRequests: permissionsFor(tool),
    consent: tool.consent,
    idempotent: tool.idempotent,
    safeForSelftest: tool.safeForSelftest,
    invocation: {
      transport: 'mcp-stdio',
      endpoint: 'src/server.mjs',
      mcpMethod: 'tools/call',
      toolNameParam: 'params.name',
      argumentsParam: 'params.arguments',
      frozenToolName: tool.name,
      timeout: Math.ceil(tool.timeout / 1000),
      notes: 'The MCP server maps this capability to a fixed vmrun argv; no passthrough or shell is used.'
    }
  };
}

const manifest = {
  schema: 'ai-software/v1',
  id: SOFTWARE_ID,
  version: VERSION,
  displayName: 'VMware Workstation Pro (vmrun MCP)',
  upstreamVersion: UPSTREAM_VERSION,
  kind: 'mcp-stdio',
  transport: {
    protocol: 'mcp-stdio',
    command: 'node',
    args: ['src/server.mjs'],
    cwd: '.',
    protocolVersion: '2025-06-18',
    capabilityAttestation: 'server-tools-list',
    runtime: 'node>=20',
    notes:
      'Zero-dependency stdio JSON-RPC. The release directory is the working directory; VMWARE_VMX_ROOTS and VMWARE_VMRUN are supplied by the platform config, never hardcoded in this manifest.'
  },
  capabilities: tools.map(capabilityFor),
  concurrency: {
    instanceMode: 'singleton',
    poolSize: null,
    exclusiveResources: ['vmware-workstation-host'],
    whenBusy: 'reject-retryable',
    notes:
      'vmrun talks to one Workstation host. The gateway keeps one slot per host; direct MCP clients that start two servers are outside this lock and are not claimed to be arbitrated.'
  },
  platformSupport: {
    windows: 'supported',
    linux: 'untested',
    macos: 'untested'
  },
  requiredProfiles: [],
  snapshot: 'capabilities.snapshot.json',
  integrity: {
    sha256Manifest: 'SHA256SUMS'
  },
  docs: 'README.md'
};

const snapshot = {
  schema: 'ai-software-capability-snapshot/v1',
  softwareId: SOFTWARE_ID,
  softwareVersion: VERSION,
  upstreamVersion: UPSTREAM_VERSION,
  generatedAt: RELEASE_DATE,
  generationMethod:
    'Tool surface frozen from the server tools/list (21 tools). Live read-only probe on 2026-11-06: vmrun 1.17.0 usage (no arguments), vmrun -T ws list (1 running VM), listHostNetworks (3 networks), getGuestIPAddress (kali 192.168.1.128). Destructive and guest-auth paths were not executed; their argv builders and confirm/credential gates are covered by tests.',
  upstreamHelpSource: 'vmrun (no arguments) usage output, vmrun 1.17.0 build-23775571',
  capabilities: tools.map((tool) => ({
    name: tool.name,
    nativeName: NATIVE_NAMES[tool.name],
    sideEffects: tool.sideEffects,
    consent: tool.consent,
    idempotent: tool.idempotent,
    safeForSelftest: tool.safeForSelftest,
    inputSchemaRef: `schemas/${tool.inputSchemaFile}`,
    outputSchemaRef: 'schemas/result.output.json',
    argvSummary: NATIVE_NAMES[tool.name]
  })),
  frozen: true
};

const seenSchemas = new Map();
for (const tool of tools) {
  const existing = seenSchemas.get(tool.inputSchemaFile);
  if (existing && JSON.stringify(existing) !== JSON.stringify(tool.inputSchema)) {
    throw new Error(`schema conflict for shared file ${tool.inputSchemaFile}`);
  }
  seenSchemas.set(tool.inputSchemaFile, tool.inputSchema);
}

for (const [file, value] of seenSchemas) {
  writeJson(`schemas/${file}`, value);
}
writeJson('schemas/result.output.json', RESULT_OUTPUT_SCHEMA);
writeJson('manifest.json', manifest);
writeJson('capabilities.snapshot.json', snapshot);

console.log(
  JSON.stringify(
    {
      ok: true,
      schemas: seenSchemas.size + 1,
      capabilities: tools.length,
      manifest: 'manifest.json',
      snapshot: 'capabilities.snapshot.json'
    },
    null,
    2
  )
);
