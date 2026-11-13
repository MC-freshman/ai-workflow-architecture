import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient } from './mcp-client.mjs';

const KALI = 'D:\\VMwareVMware\\kali\\kali.vmx';

test('MCP protocol: initialize, tools/list, tools/call and error shapes', async (t) => {
  const client = new McpClient();
  t.after(async () => client.close());

  const init = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' }
  });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(init.serverInfo.name, 'vmware-workstation-mcp');
  assert.equal(init.capabilities.tools.listChanged, false);

  client.notify('notifications/initialized');

  const list = await client.request('tools/list');
  assert.ok(Array.isArray(list.tools));
  assert.equal(list.tools.length, 21);
  const names = new Set(list.tools.map((tool) => tool.name));
  for (const expected of ['vmrun_list', 'vmrun_status', 'vmrun_run', 'vmrun_clone', 'vmrun_host_networks']) {
    assert.ok(names.has(expected), `missing tool ${expected}`);
  }
  const stop = list.tools.find((tool) => tool.name === 'vmrun_stop');
  assert.equal(stop.inputSchema.properties.mode.enum.includes('hard'), true);

  const running = await client.request('tools/call', { name: 'vmrun_list', arguments: {} });
  assert.equal(running.isError, false);
  const runningPayload = JSON.parse(running.content[0].text);
  assert.equal(runningPayload.ok, true);
  assert.ok(runningPayload.total >= 1);

  const confirmGate = await client.request('tools/call', {
    name: 'vmrun_stop',
    arguments: { vmPath: KALI, mode: 'hard' }
  });
  assert.equal(confirmGate.isError, true);
  assert.equal(JSON.parse(confirmGate.content[0].text).code, 'CONFIRM_REQUIRED');

  const resetGate = await client.request('tools/call', { name: 'vmrun_reset', arguments: { vmPath: KALI } });
  assert.equal(resetGate.isError, true);
  assert.equal(JSON.parse(resetGate.content[0].text).code, 'CONFIRM_REQUIRED');

  const unknownTool = await client.request('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknownTool.isError, true);
  assert.equal(JSON.parse(unknownTool.content[0].text).code, 'TOOL_NOT_FOUND');

  await assert.rejects(client.request('does/not/exist'), (error) => error.code === -32601);

  const parseError = client.waitFor((message) => message.id === null && message.error?.code === -32700);
  client.raw('this is not json\n');
  const parseMessage = await parseError;
  assert.equal(parseMessage.error.message, 'Parse error');
});
