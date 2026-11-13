#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { loadConfig } from './lib/config.mjs';
import { errorPayload, ToolError } from './lib/errors.mjs';
import { toolMap, tools } from './lib/tools.mjs';

const SERVER_NAME = 'vmware-workstation-mcp';
const SERVER_VERSION = '1.0.0';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL = '2025-06-18';

const config = loadConfig();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function audit(event) {
  if (!config.logFile && !config.debug) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  if (config.logFile) {
    try {
      fs.appendFileSync(config.logFile, `${line}\n`, 'utf8');
    } catch {
      // A log target that cannot be written must not change tool behavior.
    }
  }
  if (config.debug) process.stderr.write(`${line}\n`);
}

async function callTool(params) {
  const name = params?.name;
  if (typeof name !== 'string' || !name) {
    throw new ToolError('INVALID_ARGUMENT', 'params.name must be a non-empty string');
  }
  const tool = toolMap.get(name);
  if (!tool) throw new ToolError('TOOL_NOT_FOUND', `unknown tool: ${name}`);
  const args = params?.arguments ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolError('INVALID_ARGUMENT', 'params.arguments must be an object');
  }

  const startedAt = Date.now();
  try {
    const result = await tool.handler(args, { config });
    audit({ tool: name, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const payload = errorPayload(error);
    audit({ tool: name, ok: false, code: payload.code, durationMs: Date.now() - startedAt });
    throw Object.assign(new Error(payload.message), { payload });
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return { __error: { id: message?.id ?? null, code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (typeof method !== 'string') {
    if (isNotification) return null;
    return { __error: { id, code: -32600, message: 'Invalid Request' } };
  }

  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
    if (isNotification) return null;
    return {
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Controls VMware Workstation through vmrun. Paths must stay inside VMWARE_VMX_ROOTS. Destructive or host-changing calls require confirm: true. Guest operations require guest credentials in the server environment.'
      }
    };
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled' || method === 'initialized') {
    return null;
  }

  if (method === 'ping') {
    return isNotification ? null : { id, result: {} };
  }

  if (method === 'tools/list') {
    return isNotification
      ? null
      : {
          id,
          result: {
            tools: tools.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
          }
        };
  }

  if (method === 'tools/call') {
    if (isNotification) return null;
    try {
      const result = await callTool(params);
      return {
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false
        }
      };
    } catch (error) {
      const payload = error.payload || errorPayload(error);
      return {
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: true
        }
      };
    }
  }

  if (isNotification) return null;
  return { __error: { id, code: -32601, message: `Method not found: ${method}` } };
}

let queue = Promise.resolve();

function handleLine(line) {
  queue = queue
    .then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        sendError(null, -32700, 'Parse error');
        return;
      }
      const outcome = await handleMessage(message);
      if (!outcome) return;
      if (outcome.__error) {
        sendError(outcome.__error.id, outcome.__error.code, outcome.__error.message);
        return;
      }
      sendResult(outcome.id, outcome.result);
    })
    .catch((error) => {
      audit({ event: 'requestFailed', message: String(error?.message || error) });
      sendError(null, -32603, 'Internal error');
    });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (line.trim()) handleLine(line);
});

process.on('SIGINT', () => {
  rl.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  rl.close();
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  audit({ event: 'unhandledRejection', message: String(reason) });
});
