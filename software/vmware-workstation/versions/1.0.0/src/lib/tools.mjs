import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.mjs';
import {
  assertConfirm,
  assertMutable,
  assertNewPathInside,
  assertVmPath,
  assertWorkspacePath
} from './policy.mjs';
import { assertVmrunOk, runVmrun, vmrunFailure } from './vmrun.mjs';
import { readVmx } from './vmfile.mjs';
import { scanInventory } from './inventory.mjs';

const SCHEMA_DIALECT = 'http://json-schema.org/draft-07/schema#';

function schema(title, properties = {}, required = []) {
  return {
    $schema: SCHEMA_DIALECT,
    title,
    type: 'object',
    additionalProperties: false,
    properties,
    required
  };
}

const vmPathProperty = {
  type: 'string',
  description: 'Absolute path to a .vmx file inside VMWARE_VMX_ROOTS'
};

const confirmProperty = {
  type: 'boolean',
  description: 'Must be true; the server refuses the call before spawning vmrun when it is missing'
};

const emptyInput = schema('No arguments', {}, []);
const vmPathInput = schema('VM path', { vmPath: vmPathProperty }, ['vmPath']);
const guestCopyInput = schema(
  'Copy between host and guest',
  {
    vmPath: vmPathProperty,
    hostPath: { type: 'string', description: 'Host path inside VMWARE_WORKSPACE_ROOT' },
    guestPath: { type: 'string', description: 'Path inside the guest' },
    confirm: confirmProperty
  },
  ['vmPath', 'hostPath', 'guestPath', 'confirm']
);

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError('INVALID_ARGUMENT', `${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(args, key) {
  if (args[key] === undefined || args[key] === null) return null;
  return requireString(args, key);
}

function requireInt(args, key, min, max) {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ToolError('INVALID_ARGUMENT', `${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function requireEnum(args, key, values, fallback) {
  const value = args[key] ?? fallback;
  if (!values.includes(value)) {
    throw new ToolError('INVALID_ARGUMENT', `${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

function parseRunningList(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const totalLine = lines.find((line) => /^Total running VMs:/i.test(line));
  const total = totalLine ? Number(totalLine.split(':')[1].trim()) : null;
  const vms = lines
    .filter((line) => !/^Total running VMs:/i.test(line))
    .map((line) => line.replace(/^"|"$/g, ''));
  return { total, vms };
}

function parseHostNetworks(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const totalLine = lines.find((line) => /^Total host networks:/i.test(line));
  const total = totalLine ? Number(totalLine.split(':')[1].trim()) : null;
  const rows = [];
  for (const line of lines) {
    if (/^Total host networks:/i.test(line) || /^INDEX\s+/i.test(line)) continue;
    const columns = line.split(/\s+/);
    if (columns.length >= 6) {
      rows.push({
        index: columns[0],
        name: columns[1],
        type: columns[2],
        dhcp: columns[3],
        subnet: columns[4],
        mask: columns[5]
      });
    }
  }
  return { total, rows };
}

async function listRunning(config) {
  const result = assertVmrunOk(await runVmrun(config, 'list', []), 'vmrun list');
  return { ...parseRunningList(result.stdout), raw: result.stdout.trim() };
}

async function power(config, command, args, mode) {
  assertMutable(config, `vmrun ${command}`);
  const vmPath = assertVmPath(config, args.vmPath);
  const argv = mode ? [vmPath, mode] : [vmPath];
  const result = assertVmrunOk(await runVmrun(config, command, argv), `vmrun ${command}`);
  return {
    ok: true,
    action: command,
    vmPath,
    mode: mode ?? null,
    stdout: result.stdout.trim(),
    argv: result.argv
  };
}

function guestPreflight(config) {
  if (!config.guestUser || !config.guestPassword) {
    throw new ToolError(
      'CREDENTIALS_REQUIRED',
      'guest operation needs VMWARE_GUEST_USER and VMWARE_GUEST_PASSWORD or VMWARE_GUEST_PASSWORD_FILE'
    );
  }
}

function validatePortforward(args) {
  const network = requireString(args, 'network');
  const protocol = requireEnum(args, 'protocol', ['tcp', 'udp']);
  const hostPort = requireInt(args, 'hostPort', 1, 65535);
  return { network, protocol, hostPort };
}

export function buildCloneArgv(vmPath, destVmx, type, snapshotName) {
  const argv = [vmPath, destVmx, type];
  if (snapshotName) argv.push(`-snapshot=${snapshotName}`);
  return argv;
}

export const tools = [
  {
    name: 'vmrun_list',
    title: 'List running VMs',
    description: 'Run `vmrun -T ws list` and return the paths of running virtual machines. Read-only.',
    inputSchema: emptyInput,
    inputSchemaFile: 'empty.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: true,
    timeout: 30000,
    async handler(args, { config }) {
      return { ok: true, ...(await listRunning(config)) };
    }
  },
  {
    name: 'vmrun_inventory',
    title: 'List registered VMs',
    description:
      'Scan VMWARE_VMX_ROOTS for .vmx files and return their configured name, guest OS, memory and running state. Read-only.',
    inputSchema: schema(
      'Inventory options',
      {
        includeRunning: {
          type: 'boolean',
          default: true,
          description: 'Ask vmrun for running VMs so each entry can carry a running flag'
        }
      },
      []
    ),
    inputSchemaFile: 'vmrun_inventory.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: true,
    timeout: 60000,
    async handler(args, { config }) {
      const includeRunning = args.includeRunning !== false;
      let running = null;
      const warnings = [];
      if (includeRunning && config.vmrunPath && fs.existsSync(config.vmrunPath)) {
        try {
          const result = await runVmrun(config, 'list', []);
          if (result.ok) running = parseRunningList(result.stdout).vms;
          else warnings.push(`vmrun list failed (exit ${result.exitCode}); running is unknown`);
        } catch (error) {
          warnings.push(`vmrun list unavailable: ${error.code || error.message}; running is unknown`);
        }
      }
      const inventory = scanInventory(config, running);
      return {
        ok: true,
        ...inventory,
        warnings: [...inventory.warnings, ...warnings],
        runningKnown: running !== null
      };
    }
  },
  {
    name: 'vmrun_status',
    title: 'Get VM status',
    description:
      'Read a .vmx file and report its configured properties plus whether vmrun currently lists it as running. Read-only.',
    inputSchema: vmPathInput,
    inputSchemaFile: 'vmPath.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: false,
    timeout: 30000,
    async handler(args, { config }) {
      const vmPath = assertVmPath(config, args.vmPath);
      const info = readVmx(vmPath);
      let running = null;
      let runningKnown = false;
      if (config.vmrunPath && fs.existsSync(config.vmrunPath)) {
        try {
          const result = await runVmrun(config, 'list', []);
          runningKnown = result.ok;
          if (result.ok) {
            running = parseRunningList(result.stdout).vms.some(
              (entry) => path.resolve(entry).toLowerCase() === vmPath.toLowerCase()
            );
          }
        } catch {
          runningKnown = false;
        }
      }
      return { ok: true, ...info, running, runningKnown };
    }
  },
  {
    name: 'vmrun_start',
    title: 'Start a VM',
    description: 'Start a VM with `vmrun start`. mode is gui or nogui (default nogui). Mutating.',
    inputSchema: schema(
      'Start VM',
      {
        vmPath: vmPathProperty,
        mode: { type: 'string', enum: ['gui', 'nogui'], default: 'nogui' }
      },
      ['vmPath']
    ),
    inputSchemaFile: 'vm_start.input.json',
    sideEffects: 'external',
    consent: 'confirm-stage',
    idempotent: false,
    safeForSelftest: false,
    timeout: 120000,
    async handler(args, { config }) {
      const mode = requireEnum(args, 'mode', ['gui', 'nogui'], 'nogui');
      return power(config, 'start', args, mode);
    }
  },
  {
    name: 'vmrun_stop',
    title: 'Stop a VM',
    description:
      'Stop a VM with `vmrun stop`. mode is soft or hard. A hard stop requires confirm: true and is refused before spawn otherwise.',
    inputSchema: schema(
      'Stop VM',
      {
        vmPath: vmPathProperty,
        mode: { type: 'string', enum: ['soft', 'hard'], default: 'soft' },
        confirm: confirmProperty
      },
      ['vmPath']
    ),
    inputSchemaFile: 'vm_stop.input.json',
    sideEffects: 'external',
    consent: 'confirm-stage',
    idempotent: false,
    safeForSelftest: false,
    timeout: 120000,
    async handler(args, { config }) {
      const mode = requireEnum(args, 'mode', ['soft', 'hard'], 'soft');
      if (mode === 'hard') assertConfirm(args, 'vmrun_stop mode=hard');
      return power(config, 'stop', args, mode);
    }
  },
  {
    name: 'vmrun_reset',
    title: 'Reset a VM',
    description: 'Reset a VM with `vmrun reset`. Always requires confirm: true.',
    inputSchema: schema(
      'Reset VM',
      {
        vmPath: vmPathProperty,
        mode: { type: 'string', enum: ['soft', 'hard'], default: 'soft' },
        confirm: confirmProperty
      },
      ['vmPath', 'confirm']
    ),
    inputSchemaFile: 'vm_reset.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 120000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_reset');
      const mode = requireEnum(args, 'mode', ['soft', 'hard'], 'soft');
      return power(config, 'reset', args, mode);
    }
  },
  {
    name: 'vmrun_suspend',
    title: 'Suspend a VM',
    description: 'Suspend a VM with `vmrun suspend`. A hard suspend requires confirm: true.',
    inputSchema: schema(
      'Suspend VM',
      {
        vmPath: vmPathProperty,
        mode: { type: 'string', enum: ['soft', 'hard'], default: 'soft' },
        confirm: confirmProperty
      },
      ['vmPath']
    ),
    inputSchemaFile: 'vm_suspend.input.json',
    sideEffects: 'external',
    consent: 'confirm-stage',
    idempotent: false,
    safeForSelftest: false,
    timeout: 120000,
    async handler(args, { config }) {
      const mode = requireEnum(args, 'mode', ['soft', 'hard'], 'soft');
      if (mode === 'hard') assertConfirm(args, 'vmrun_suspend mode=hard');
      return power(config, 'suspend', args, mode);
    }
  },
  {
    name: 'vmrun_pause',
    title: 'Pause a VM',
    description: 'Pause a running VM with `vmrun pause`. Mutating but reversible with vmrun_unpause.',
    inputSchema: vmPathInput,
    inputSchemaFile: 'vmPath.input.json',
    sideEffects: 'external',
    consent: 'confirm-stage',
    idempotent: true,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      return power(config, 'pause', args, null);
    }
  },
  {
    name: 'vmrun_unpause',
    title: 'Unpause a VM',
    description: 'Resume a paused VM with `vmrun unpause`.',
    inputSchema: vmPathInput,
    inputSchemaFile: 'vmPath.input.json',
    sideEffects: 'external',
    consent: 'confirm-stage',
    idempotent: true,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      return power(config, 'unpause', args, null);
    }
  },
  {
    name: 'vmrun_guest_ip',
    title: 'Get guest IP address',
    description:
      'Ask VMware Tools for the guest IP with `vmrun getGuestIPAddress`. Set wait: true to wait for Tools before answering.',
    inputSchema: schema(
      'Guest IP',
      {
        vmPath: vmPathProperty,
        wait: { type: 'boolean', default: false, description: 'Pass -wait and block until VMware Tools reports an address' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000, default: 30000 }
      },
      ['vmPath']
    ),
    inputSchemaFile: 'guest_ip.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      const vmPath = assertVmPath(config, args.vmPath);
      const wait = args.wait === true;
      const timeoutMs = Math.min(Number(args.timeoutMs) || 30000, 300000);
      const argv = wait ? [vmPath, '-wait'] : [vmPath];
      const result = assertVmrunOk(await runVmrun(config, 'getGuestIPAddress', argv, { timeout: timeoutMs }), 'vmrun getGuestIPAddress');
      const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const ip = lines.find((line) => /^[0-9a-f:.]+$/i.test(line)) || lines.at(-1) || null;
      return { ok: true, vmPath, ip, raw: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_run',
    title: 'Run a program in the guest',
    description:
      'Run a program inside the guest with `vmrun runProgramInGuest`. Requires guest credentials and confirm: true.',
    inputSchema: schema(
      'Run guest program',
      {
        vmPath: vmPathProperty,
        program: { type: 'string', description: 'Complete path to the program inside the guest' },
        args: { type: 'array', items: { type: 'string' }, description: 'Program arguments, passed as separate argv entries' },
        mode: { type: 'string', enum: ['default', 'noWait', 'activeWindow', 'interactive'], default: 'default' },
        confirm: confirmProperty
      },
      ['vmPath', 'program', 'confirm']
    ),
    inputSchemaFile: 'guest_run.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 300000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_run');
      assertMutable(config, 'vmrun_run');
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const program = requireString(args, 'program');
      const extra = args.args === undefined ? [] : args.args;
      if (!Array.isArray(extra) || extra.some((item) => typeof item !== 'string')) {
        throw new ToolError('INVALID_ARGUMENT', 'args must be an array of strings');
      }
      const mode = requireEnum(args, 'mode', ['default', 'noWait', 'activeWindow', 'interactive'], 'default');
      const flags = { default: null, noWait: '-noWait', activeWindow: '-activeWindow', interactive: '-interactive' };
      const argv = [vmPath];
      if (flags[mode]) argv.push(flags[mode]);
      argv.push(program, ...extra);
      const result = assertVmrunOk(await runVmrun(config, 'runProgramInGuest', argv, { guest: true }), 'vmrun runProgramInGuest');
      return { ok: true, vmPath, program, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_ps',
    title: 'List guest processes',
    description: 'List processes inside the guest with `vmrun listProcessesInGuest`. Requires guest credentials. Read-only.',
    inputSchema: vmPathInput,
    inputSchemaFile: 'vmPath.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const result = assertVmrunOk(
        await runVmrun(config, 'listProcessesInGuest', [vmPath], { guest: true }),
        'vmrun listProcessesInGuest'
      );
      const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return { ok: true, vmPath, lines, raw: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_kill',
    title: 'Kill a guest process',
    description: 'Kill a guest process by pid with `vmrun killProcessInGuest`. Requires guest credentials and confirm: true.',
    inputSchema: schema(
      'Kill guest process',
      {
        vmPath: vmPathProperty,
        pid: { type: 'integer', minimum: 1 },
        confirm: confirmProperty
      },
      ['vmPath', 'pid', 'confirm']
    ),
    inputSchemaFile: 'guest_kill.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_kill');
      assertMutable(config, 'vmrun_kill');
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const pid = requireInt(args, 'pid', 1, 2147483647);
      const result = assertVmrunOk(
        await runVmrun(config, 'killProcessInGuest', [vmPath, pid], { guest: true }),
        'vmrun killProcessInGuest'
      );
      return { ok: true, vmPath, pid, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_file_exists',
    title: 'Check a guest file',
    description: 'Check whether a path exists inside the guest with `vmrun fileExistsInGuest`. Requires guest credentials.',
    inputSchema: schema(
      'Guest file check',
      {
        vmPath: vmPathProperty,
        guestPath: { type: 'string', description: 'Path inside the guest' }
      },
      ['vmPath', 'guestPath']
    ),
    inputSchemaFile: 'guest_file_exists.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const guestPath = requireString(args, 'guestPath');
      const result = await runVmrun(config, 'fileExistsInGuest', [vmPath, guestPath], { guest: true });
      const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (!result.ok && !text.includes('does not exist')) {
        throw vmrunFailure(result, 'vmrun fileExistsInGuest');
      }
      return {
        ok: true,
        vmPath,
        guestPath,
        exists: text.includes('file exists') && !text.includes('does not exist'),
        exitCode: result.exitCode,
        raw: (result.stdout || result.stderr).trim(),
        argv: result.argv
      };
    }
  },
  {
    name: 'vmrun_copy_to',
    title: 'Copy host file into guest',
    description:
      'Copy a host file or directory into the guest with `vmrun CopyFileFromHostToGuest`. hostPath must be inside VMWARE_WORKSPACE_ROOT; confirm: true is required.',
    inputSchema: guestCopyInput,
    inputSchemaFile: 'guest_copy.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 300000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_copy_to');
      assertMutable(config, 'vmrun_copy_to');
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const hostPath = assertWorkspacePath(config, requireString(args, 'hostPath'), { mustExist: true, label: 'hostPath' });
      const guestPath = requireString(args, 'guestPath');
      const result = assertVmrunOk(
        await runVmrun(config, 'CopyFileFromHostToGuest', [vmPath, hostPath, guestPath], { guest: true }),
        'vmrun CopyFileFromHostToGuest'
      );
      return { ok: true, vmPath, hostPath, guestPath, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_copy_from',
    title: 'Copy guest file to host',
    description:
      'Copy a guest file or directory to the host with `vmrun CopyFileFromGuestToHost`. hostPath must be inside VMWARE_WORKSPACE_ROOT; confirm: true is required.',
    inputSchema: guestCopyInput,
    inputSchemaFile: 'guest_copy.input.json',
    sideEffects: 'local-write',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 300000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_copy_from');
      assertMutable(config, 'vmrun_copy_from');
      guestPreflight(config);
      const vmPath = assertVmPath(config, args.vmPath);
      const guestPath = requireString(args, 'guestPath');
      const hostPath = assertWorkspacePath(config, requireString(args, 'hostPath'), { mustExist: false, label: 'hostPath' });
      const result = assertVmrunOk(
        await runVmrun(config, 'CopyFileFromGuestToHost', [vmPath, guestPath, hostPath], { guest: true }),
        'vmrun CopyFileFromGuestToHost'
      );
      return { ok: true, vmPath, guestPath, hostPath, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_clone',
    title: 'Clone a VM',
    description:
      'Clone a VM with `vmrun clone`. destVmx must be a new .vmx inside VMWARE_VMX_ROOTS whose parent directory already exists; confirm: true is required. Linked clones require snapshotName.',
    inputSchema: schema(
      'Clone VM',
      {
        vmPath: vmPathProperty,
        destVmx: { type: 'string', description: 'New .vmx path inside VMWARE_VMX_ROOTS' },
        type: { type: 'string', enum: ['full', 'linked'], default: 'full' },
        snapshotName: { type: 'string', description: 'Snapshot to clone from; required for linked clones' },
        confirm: confirmProperty
      },
      ['vmPath', 'destVmx', 'confirm']
    ),
    inputSchemaFile: 'vm_clone.input.json',
    sideEffects: 'local-write',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 600000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_clone');
      assertMutable(config, 'vmrun_clone');
      const vmPath = assertVmPath(config, args.vmPath);
      const destVmx = assertNewPathInside(config, requireString(args, 'destVmx'), { label: 'destVmx' });
      if (path.extname(destVmx).toLowerCase() !== '.vmx') {
        throw new ToolError('INVALID_ARGUMENT', 'destVmx must end with .vmx');
      }
      const type = requireEnum(args, 'type', ['full', 'linked'], 'full');
      const snapshotName = optionalString(args, 'snapshotName');
      if (type === 'linked' && !snapshotName) {
        throw new ToolError('INVALID_ARGUMENT', 'linked clones require snapshotName');
      }
      const argv = buildCloneArgv(vmPath, destVmx, type, snapshotName);
      const result = assertVmrunOk(
        await runVmrun(config, 'clone', argv, { timeout: config.cloneTimeoutMs }),
        'vmrun clone'
      );
      return { ok: true, vmPath, destVmx, type, snapshotName, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_host_networks',
    title: 'List host networks',
    description: 'List VMware host networks with `vmrun listHostNetworks`. Read-only.',
    inputSchema: emptyInput,
    inputSchemaFile: 'empty.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: true,
    timeout: 30000,
    async handler(args, { config }) {
      const result = assertVmrunOk(await runVmrun(config, 'listHostNetworks', []), 'vmrun listHostNetworks');
      return { ok: true, ...parseHostNetworks(result.stdout), raw: result.stdout.trim() };
    }
  },
  {
    name: 'vmrun_portforward_list',
    title: 'List port forwardings',
    description: 'List port forwardings on a host network with `vmrun listPortForwardings`. Read-only.',
    inputSchema: schema('Port forward list', { network: { type: 'string', minLength: 1 } }, ['network']),
    inputSchemaFile: 'portforward_list.input.json',
    sideEffects: 'none',
    consent: 'auto',
    idempotent: true,
    safeForSelftest: false,
    timeout: 30000,
    async handler(args, { config }) {
      const network = requireString(args, 'network');
      const result = assertVmrunOk(
        await runVmrun(config, 'listPortForwardings', [network]),
        'vmrun listPortForwardings'
      );
      return { ok: true, network, raw: result.stdout.trim(), lines: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), argv: result.argv };
    }
  },
  {
    name: 'vmrun_portforward_set',
    title: 'Add or update a port forwarding',
    description:
      'Add or update a host network port forwarding with `vmrun setPortForwarding`. Requires confirm: true.',
    inputSchema: schema(
      'Port forward set',
      {
        network: { type: 'string', minLength: 1 },
        protocol: { type: 'string', enum: ['tcp', 'udp'] },
        hostPort: { type: 'integer', minimum: 1, maximum: 65535 },
        guestIp: { type: 'string', minLength: 1 },
        guestPort: { type: 'integer', minimum: 1, maximum: 65535 },
        description: { type: 'string' },
        confirm: confirmProperty
      },
      ['network', 'protocol', 'hostPort', 'guestIp', 'guestPort', 'confirm']
    ),
    inputSchemaFile: 'portforward_set.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_portforward_set');
      assertMutable(config, 'vmrun_portforward_set');
      const { network, protocol, hostPort } = validatePortforward(args);
      const guestIp = requireString(args, 'guestIp');
      const guestPort = requireInt(args, 'guestPort', 1, 65535);
      const description = optionalString(args, 'description');
      const argv = [network, protocol, hostPort, guestIp, guestPort];
      if (description) argv.push(description);
      const result = assertVmrunOk(
        await runVmrun(config, 'setPortForwarding', argv),
        'vmrun setPortForwarding'
      );
      return { ok: true, network, protocol, hostPort, guestIp, guestPort, description, stdout: result.stdout.trim(), argv: result.argv };
    }
  },
  {
    name: 'vmrun_portforward_delete',
    title: 'Delete a port forwarding',
    description: 'Delete a host network port forwarding with `vmrun deletePortForwarding`. Requires confirm: true.',
    inputSchema: schema(
      'Port forward delete',
      {
        network: { type: 'string', minLength: 1 },
        protocol: { type: 'string', enum: ['tcp', 'udp'] },
        hostPort: { type: 'integer', minimum: 1, maximum: 65535 },
        confirm: confirmProperty
      },
      ['network', 'protocol', 'hostPort', 'confirm']
    ),
    inputSchemaFile: 'portforward_delete.input.json',
    sideEffects: 'external',
    consent: 'confirm-call',
    idempotent: false,
    safeForSelftest: false,
    timeout: 60000,
    async handler(args, { config }) {
      assertConfirm(args, 'vmrun_portforward_delete');
      assertMutable(config, 'vmrun_portforward_delete');
      const { network, protocol, hostPort } = validatePortforward(args);
      const result = assertVmrunOk(
        await runVmrun(config, 'deletePortForwarding', [network, protocol, hostPort]),
        'vmrun deletePortForwarding'
      );
      return { ok: true, network, protocol, hostPort, stdout: result.stdout.trim(), argv: result.argv };
    }
  }
];

export const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
