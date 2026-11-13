import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class McpClient {
  constructor(env = {}) {
    this.child = spawn(process.execPath, ['src/server.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        VMWARE_VMX_ROOTS: 'D:\\VMwareVMware',
        VMWARE_VMRUN: 'D:\\VMwareVMware\\vmrun.exe',
        VMWARE_WORKSPACE_ROOT: ROOT,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.nextId = 1;
    this.pending = new Map();
    this.unsolicited = [];
    this.waiters = [];
    this.stderr = '';
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    this.rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        message = { unparsable: line };
      }
      if (message.id !== undefined && message.id !== null && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          const error = new Error(message.error.message);
          error.code = message.error.code;
          entry.reject(error);
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const waiter = this.waiters.splice(waiterIndex, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.unsolicited.push(message);
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  raw(text) {
    this.child.stdin.write(text);
  }

  waitFor(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for unsolicited message')), timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' }
    });
    this.notify('notifications/initialized');
    return result;
  }

  async call(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  async close() {
    this.rl.close();
    this.child.kill();
  }
}
