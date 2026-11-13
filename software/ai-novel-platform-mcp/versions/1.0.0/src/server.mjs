#!/usr/bin/env node
import readline from 'node:readline';
import { TOOLS, handle } from './lib/tools.mjs';
const NAME = process.env.MCP_SERVER_NAME || 'mcp-server';
const PROTO = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const id = m.id, method = m.method, params = m.params || {};
  try {
    if (method === 'initialize') {
      const want = params.protocolVersion || '2025-06-18';
      if (!PROTO.has(want)) { send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'MCP_PROTOCOL_UNSUPPORTED' } }); return; }
      send({ jsonrpc: '2.0', id, result: { protocolVersion: want, capabilities: { tools: {} }, serverInfo: { name: NAME, version: '1.0.0' } } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
    } else if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) { send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'TOOL_UNKNOWN', data: { name: params.name } } }); return; }
      const result = await handle(tool.name, params.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false } });
    } else if (method && method.startsWith('notifications/')) {
      // notifications carry no id and must not be answered
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'METHOD_NOT_FOUND' } });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: e.code || 'TOOL_FAILED', data: { message: e.message || String(e) } } });
  }
});
