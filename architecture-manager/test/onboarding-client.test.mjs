import {seedRuntimeReleases} from './support/resources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { buildOnboardingConfigPlan, applyOnboardingConfig } from '../src/onboarding-config.mjs';
import { buildOnboardingClientPlan, applyOnboardingClient, probeOnboardingClient } from '../src/onboarding-client.mjs';

test('actual CLI and MCP connections pass; wrong platform, replay and direct runner impersonation fail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'manager-client-')); const auditRoot = join(root, 'audit');
  const python = execFileSync('python', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  try {
    seedRuntimeReleases(root);
    for (const repo of ['tool','agent','software']) put(`${repo}/registry.json`, JSON.stringify({entries:[]}));
    for (const id of ['first-client','second-client']) {
      applyOnboardingConfig(buildOnboardingConfigPlan({workspaceRoot:root,platformId:id,confirmed:true,fields:{pythonExecutable:python}}), {auditRoot});
      applyOnboardingClient(buildOnboardingClientPlan({workspaceRoot:root,platformId:id}), {auditRoot});
    }
    const input = {workspaceRoot:root,platformId:'first-client'};
    const first = await probeOnboardingClient(input); assert.equal(first.status, 'passed'); assert.equal(first.nativeVendorClientVerified, false);
    const path = join(root,'first-client/bridge/client-adapter.json'); const standard = JSON.parse(readFileSync(path));
    const descriptor = {schema:standard.schema,platformId:input.platformId,kind:'mcp-stdio',executable:python,args:standard.server.args,probeTool:'architecture_probe'};
    writeFileSync(path,JSON.stringify(descriptor)); assert.equal((await probeOnboardingClient(input)).status,'passed');
    writeFileSync(path,JSON.stringify({...descriptor,args:['-B',join(root,'second-client/bridge/manager-client/mcp_service.py'),join(root,'second-client/bridge/second-client-config.json')]}));
    await assert.rejects(probeOnboardingClient(input),/CLIENT_CONNECTION_FAILED/);
    const replay = join(root,'first-client/bridge/replay.py'); writeFileSync(replay,`import json,sys\njson.load(sys.stdin)\nprint(${JSON.stringify(JSON.stringify(first.receipt))})\n`);
    writeFileSync(path,JSON.stringify({...descriptor,kind:'cli',args:['-B',replay]}));
    await assert.rejects(probeOnboardingClient(input),/CLIENT_RECEIPT_MISMATCH/);
    writeFileSync(path,JSON.stringify({...descriptor,kind:'cli',args:['-B',join(root,'tool/wf-runner/versions/0.12.0/cli.py')]}));
    await assert.rejects(probeOnboardingClient(input),/CLIENT_ROUTE_NOT_VERIFIED/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
