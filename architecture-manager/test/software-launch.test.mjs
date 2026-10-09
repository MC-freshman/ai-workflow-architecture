import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSoftwareConnectorLaunchPlan, applySoftwareLaunch } from '../src/software-launch.mjs';
import { resolveRecipeVersion } from '../src/software-publish.mjs';

const CONNECTOR = `import json, sys
request = json.loads(sys.stdin.read())
if request.get('softwareId') == 'good-cli':
    print(json.dumps({'ok': True, 'result': {'status': 'launched', 'pid': 123}}))
elif request.get('softwareId') == 'gui-app':
    print(json.dumps({'ok': True, 'result': {'status': 'INTERACTIVE_REQUIRED', 'reason': 'desktop session needs a human'}}))
else:
    sys.stdout.write('not json at all')
`;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'am-launch-'));
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-launch-audit-'));
  const connectorPath = join(root, 'software', '_connector', 'versions', '1.0.7', 'connector.py');
  mkdirSync(join(connectorPath, '..'), { recursive: true });
  writeFileSync(connectorPath, CONNECTOR);
  const gatewayConfigPath = join(root, 'zcode', 'bridge', 'zcode-config.json');
  mkdirSync(join(gatewayConfigPath, '..'), { recursive: true });
  writeFileSync(gatewayConfigPath, JSON.stringify({
    platform: 'zcode',
    softwareGateway: connectorPath.replaceAll('\\', '/'),
    softwareGatewayConfig: join(root, 'zcode', 'bridge', 'software-gateway.json').replaceAll('\\', '/'),
    interpreters: { '.py': 'python' }
  }));
  writeFileSync(join(root, 'zcode', 'bridge', 'software-gateway.json'), JSON.stringify({
    bodies: { 'good-cli': 'C:/tools/good.exe', 'gui-app': 'C:/tools/gui.exe', 'broken': 'C:/tools/broken.exe' },
    interpreters: { '.py': 'python' },
    allowGuiLaunch: false
  }));
  return { root, auditRoot, gatewayConfigPath };
}

function planFor(fixture, softwareId) {
  return buildSoftwareConnectorLaunchPlan({ workspaceRoot: fixture.root, platformId: 'zcode', softwareId });
}

test('builder resolves the connector, gateway config and interpreter from the platform config', () => {
  const fixture = makeFixture();
  const plan = planFor(fixture, 'good-cli');
  assert.equal(plan.kind, 'software-launch');
  assert.equal(plan.target.connectorPath.replaceAll('\\', '/'), join(fixture.root, 'software/_connector/versions/1.0.7/connector.py').replaceAll('\\', '/'));
  assert.equal(plan.target.interpreter, 'python');
  assert.equal(plan.target.allowGuiLaunch, false);
  assert.equal(plan.target.bodyPath, 'C:/tools/good.exe');
  assert.throws(() => planFor(fixture, 'undeclared'), /SOFTWARE_NOT_DECLARED/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('apply relays the connector answer verbatim, including INTERACTIVE_REQUIRED', () => {
  const fixture = makeFixture();
  const plan = planFor(fixture, 'gui-app');
  const result = applySoftwareLaunch({ plan }, { auditRoot: fixture.auditRoot });
  assert.equal(result.connectorStatus, 'INTERACTIVE_REQUIRED');
  assert.equal(result.writePerformed, true);
  const events = readFileSync(join(fixture.auditRoot, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.action === 'software-launch' && event.connectorStatus === 'INTERACTIVE_REQUIRED'));
  const launched = applySoftwareLaunch({ plan: planFor(fixture, 'good-cli') }, { auditRoot: fixture.auditRoot });
  assert.equal(launched.connectorStatus, 'launched');
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('invalid connector output and process failure are structured, never guessed', () => {
  const fixture = makeFixture();
  assert.throws(() => applySoftwareLaunch({ plan: planFor(fixture, 'broken') }, { auditRoot: fixture.auditRoot }), /SOFTWARE_CONNECTOR_INVALID/);
  const bad = { ...planFor(fixture, 'good-cli'), steps: [{ ...planFor(fixture, 'good-cli').steps[0], interpreter: 'definitely-not-a-real-interpreter' }] };
  assert.throws(() => applySoftwareLaunch({ plan: bad }, { auditRoot: fixture.auditRoot }), /PLAN_PAYLOAD_MISMATCH/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('recipe versions are derived, not hardcoded', () => {
  const root = mkdtempSync(join(tmpdir(), 'am-recipever-'));
  assert.equal(resolveRecipeVersion(root, 'nope', null), '1.0.0');
  const versions = join(root, 'software', 'dirsearch', 'versions');
  mkdirSync(join(versions, '1.0.1'), { recursive: true });
  mkdirSync(join(versions, '1.0.2'), { recursive: true });
  assert.equal(resolveRecipeVersion(root, 'dirsearch', null), '1.0.3');
  assert.throws(() => resolveRecipeVersion(root, 'dirsearch', '1.0'), /RELEASE_SEMVER_INVALID/);
  assert.equal(resolveRecipeVersion(root, 'dirsearch', '2.0.0'), '2.0.0');
  rmSync(root, { recursive: true, force: true });
});
