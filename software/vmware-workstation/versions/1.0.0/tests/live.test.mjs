import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient } from './mcp-client.mjs';

const LIVE = process.env.VMWARE_LIVE === '1';
const KALI = process.env.VMWARE_TEST_VMX || 'D:\\VMwareVMware\\kali\\kali.vmx';

test('live read-only smoke against the installed Workstation', { skip: !LIVE }, async (t) => {
  const client = new McpClient();
  t.after(async () => client.close());
  await client.initialize();

  const list = JSON.parse((await client.call('vmrun_list')).content[0].text);
  assert.equal(list.ok, true);
  assert.ok(list.total >= 1);

  const inventory = JSON.parse((await client.call('vmrun_inventory', { includeRunning: true })).content[0].text);
  assert.equal(inventory.ok, true);
  assert.ok(inventory.count >= 1);
  assert.ok(inventory.vms.some((vm) => vm.vmxPath.toLowerCase() === KALI.toLowerCase()));

  const status = JSON.parse((await client.call('vmrun_status', { vmPath: KALI })).content[0].text);
  assert.equal(status.ok, true);
  assert.equal(status.running, true);
  assert.ok(status.displayName);

  const ip = JSON.parse((await client.call('vmrun_guest_ip', { vmPath: KALI })).content[0].text);
  assert.equal(ip.ok, true);
  assert.match(ip.ip, /^[0-9a-f:.]+$/i);

  const networks = JSON.parse((await client.call('vmrun_host_networks')).content[0].text);
  assert.equal(networks.ok, true);
  assert.ok(networks.total >= 1);
  assert.ok(networks.rows.length >= 1);

  const forwards = JSON.parse((await client.call('vmrun_portforward_list', { network: networks.rows[0].name })).content[0].text);
  assert.equal(forwards.ok, true);
});

test('live safety gates never spawn a destructive command', { skip: !LIVE }, async (t) => {
  const client = new McpClient();
  t.after(async () => client.close());
  await client.initialize();

  const hardStop = await client.call('vmrun_stop', { vmPath: KALI, mode: 'hard' });
  assert.equal(hardStop.isError, true);
  assert.equal(JSON.parse(hardStop.content[0].text).code, 'CONFIRM_REQUIRED');

  const reset = await client.call('vmrun_reset', { vmPath: KALI });
  assert.equal(reset.isError, true);
  assert.equal(JSON.parse(reset.content[0].text).code, 'CONFIRM_REQUIRED');

  const guestRun = await client.call('vmrun_run', {
    vmPath: KALI,
    program: '/bin/true',
    confirm: true
  });
  assert.equal(guestRun.isError, true);
  assert.equal(JSON.parse(guestRun.content[0].text).code, 'CREDENTIALS_REQUIRED');

  const clone = await client.call('vmrun_clone', {
    vmPath: KALI,
    destVmx: 'C:\\clone-outside-test.vmx',
    confirm: true
  });
  assert.equal(clone.isError, true);
  assert.equal(JSON.parse(clone.content[0].text).code, 'PATH_DENIED');

  const portforward = await client.call('vmrun_portforward_set', {
    network: 'vmnet1',
    protocol: 'tcp',
    hostPort: 18080,
    guestIp: '192.168.1.128',
    guestPort: 80,
    confirm: false
  });
  assert.equal(portforward.isError, true);
  assert.equal(JSON.parse(portforward.content[0].text).code, 'CONFIRM_REQUIRED');
});
