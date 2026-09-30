import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

export async function runnerCall(configPath, action, args) {
  const bridge = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const runner = bridge.runner;
  if (!runner?.enabled) throw new Error('Codex workflow runner is disabled');
  return await new Promise((resolve, reject) => {
    const child = spawn(runner.python, ['-B', runner.adapter, runner.config], {
      shell: false, windowsHide: true,
      env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1'},
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '', diagnostic = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => {
      try {
        const value = JSON.parse(output);
        resolve(value);
      } catch {
        reject(new Error(`Runner exited ${code} without a JSON result: ${diagnostic}`));
      }
    });
    child.stdin.end(JSON.stringify({action, args}));
  });
}

export const runnerTools = [
  {name: 'ai_runner_request', description: 'Durable prepare/next/submit/status/stop protocol. A prompt handoff must be completed by the current session.', inputSchema: {type: 'object', required: ['request'], properties: {request: {type: 'object'}}, additionalProperties: false}},
  {name: 'ai_runner_execute', description: 'Execute the already claimed isolated script or an allowed figure tool. Never auto-replay unknown outcomes.', inputSchema: {type: 'object', required: ['runId'], properties: {runId: {type: 'string'}, tool: {enum: ['render-figure', 'record-visual-review']}, review: {type: 'object'}}, additionalProperties: false}},
  {name: 'ai_runner_seal', description: 'Seal immutable stage artifacts and gate evidence from the run project before submit.', inputSchema: {type: 'object', required: ['runId', 'outputPaths', 'gatePaths'], properties: {runId: {type: 'string'}, outputPaths: {type: 'array', items: {type: 'string'}}, gatePaths: {type: 'object', additionalProperties: {type: 'string'}}}, additionalProperties: false}}
];

export async function maybeRunner(configPath, name, args) {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!config.runner?.enabled) return null;
  const actions = {ai_runner_request: 'request', ai_runner_execute: 'execute', ai_runner_seal: 'seal'};
  if (actions[name]) return {value: await runnerCall(configPath, actions[name], args)};
  if (name === 'ai_run_workflow') return {value: await runnerCall(configPath, 'workflow', args)};
  if (name === 'ai_run_agent') return {value: await runnerCall(configPath, 'agent', args)};
  return null;
}
