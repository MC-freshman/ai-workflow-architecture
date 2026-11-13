#!/usr/bin/env node
import readline from 'node:readline';
import { preload } from '../lib/guard.mjs';
import { TOOLS, handle, INJECT_SPEC, configure } from '../lib/handlers.mjs';
const PROTOCOLS = new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']);
const NAME = 'ai-novel-platform-mcp', VERSION = '3.1.0';
const guard = await preload(INJECT_SPEC);
configure(guard);
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method } = req, params = req.params || {};
  try {
    if (method === 'initialize') {
      const want = params.protocolVersion || '2025-06-18';
      if (!PROTOCOLS.has(want)) { send({jsonrpc:'2.0',id,error:{code:-32602,message:'MCP_PROTOCOL_UNSUPPORTED'}}); return; }
      send({jsonrpc:'2.0',id,result:{protocolVersion:want,capabilities:{tools:{}},serverInfo:{name:NAME,version:VERSION},instructions:'Read tools are open. Write tools require *.plan then planId+confirmToken. Injected tools need the corresponding *_ROOT.'}});
    } else if (method === 'ping') send({jsonrpc:'2.0',id,result:{}});
    else if (method === 'tools/list') send({jsonrpc:'2.0',id,result:{tools:TOOLS.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))}});
    else if (method === 'tools/call') {
      const tool = TOOLS.find(t=>t.name===params.name);
      if (!tool) { send({jsonrpc:'2.0',id,error:{code:-32602,message:'TOOL_UNKNOWN',data:{name:params.name}}}); return; }
      const result = await handle(tool.name, params.arguments || {});
      send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false}});
    } else if (method && method.startsWith('notifications/')) { /* no reply */ }
    else send({jsonrpc:'2.0',id,error:{code:-32601,message:'METHOD_NOT_FOUND'}});
  } catch (e) {
    send({jsonrpc:'2.0',id,error:{code:-32000,message:e.code||'TOOL_FAILED',data:{message:e.message||String(e)}}});
  }
});
