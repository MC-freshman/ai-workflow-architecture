import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/app/api.mjs';
import * as queries from '../src/app/query-api.mjs';
import * as commands from '../src/app/command-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('application boundary exposes the complete IPC domain surface', () => {
  const expected = [
    'buildGlobalUpdatePlan','buildGlobalUpdateRestorePlan','cancelGlobalUpdate','readGlobalUpdateHistory',
    'readPlatformResourceVersions','buildPlatformResourceDefaultPlan','buildAutomaticSoftwarePlan',
    'scanExternalBody',
    'readBodyEditor','listBodyDependencies','buildAgentSkillBodyPlan',
    'checkSharedBody',
    'readToolBodyEditor','buildToolBodyPlan',
    'buildPlatformBodyPlan',
    'buildExistingSoftwareBindingPlan','buildSoftwareBodyPlacementPlan','buildSoftwareBodyPlan','readSoftwareBodyActions','buildMcpBodyPlan','buildNativeCredentialPlan','buildNativeCredentialProviderPlan','discoverNativeMcp','readMcpConfiguration','buildSoftwareCommandPlan',
    'listRuntimeBodies',
    'listIntakeJournals','readIntakeJournal','buildIntakeRevertPlan',
    'applyPlan', 'applyWorkspaceClone', 'buildDefectBookEditPlan', 'buildDocsSite', 'buildDocumentPlan', 'buildGitPlan', 'buildIntegrationPlan',
    'buildPlatformViewPlan', 'buildRegistryPlan', 'buildReleasePlan', 'buildResourcePointerPlan',
    'buildAnchorMaterialisationPlan', 'applyAnchorMaterialisation', 'verifyAnchorMaterialisation', 'buildAnchorAlignmentPlan', 'applyAnchorAlignment', 'verifyAnchorAlignment', 'readAnchorReport', 'listAnchorPlatforms',
    'buildSoftwareImportPlan', 'buildSoftwareLaunchPlan', 'buildSoftwareRecipePlan', 'buildSoftwareRevertPlan', 'buildSoftwareConnectorLaunchPlan', 'buildPlatformScaffoldPlan', 'buildWorkspaceClonePlan', 'checkDocsLinks', 'diffDocument', 'healthSoftware', 'inspectGit',
    'inspectPlatformConnection', 'previewPlatformCheck','inspectPlatformDirectory', 'inspectRegistration', 'listIntegrationTargets', 'listResourceReferences', 'listSoftwareIntakes', 'listSoftwareRecoveries',
    'parseImplementationTables', 'readCatalogEntry', 'readDocument', 'readIntegrationTarget', 'readRegistryBaseline', 'readSkillContent',
    'governanceOnboardingDraft', 'buildOnboardingCard', 'runOnboardingPipeline', 'readOnboardingConfig', 'buildOnboardingConfigPlan',
    'buildOnboardingRuntimePlan', 'buildOnboardingBackendPlan', 'detectRuntime',
    'buildOnboardingClientPlan', 'probeOnboardingClient',
    'buildOnboardingProvidersPlan','buildGatewayMigrationPlan',
    'probeOnboardingCapabilities', 'buildOnboardingAttestationPlan',
    'buildOnboardingGovernancePlan', 'executeOnboardingChecks', 'cancelOnboarding', 'readOnboardingState', 'markOnboardingRecorded', 'executePostAlignmentChecks',
    'buildOnboardingFinalizePlan',
    'buildAutomaticOnboardingPlan',
    'prepareAutomaticOnboardingPlan','buildNativeClientPlan','probeNativeClient','probeNativeClientWithAi','nativeClientStatus','suggestBodyImport','buildAutomaticTextBodyPlan',
    'inspectRunDirectory', 'listPlatformRuns', 'listRunLedger',
    'readDefectBook', 'verifyDefectBook', 'inspectInbox', 'readAuditEvents',
    'runPlatformCheck', 'scanSensitiveFiles', 'scanWorkspace', 'suggestPlatformBridge', 'verifyPlanTarget', 'verifySoftwareImport', 'verifySoftwareRecipe'
  ];
  assert.deepEqual(Object.keys(api).sort(), expected.sort());
});

test('read and write application surfaces stay separate', () => {
  assert.equal(typeof queries.scanWorkspace, 'function');
  assert.equal(typeof queries.applyPlan, 'undefined');
  assert.equal(typeof commands.applyPlan, 'function');
  assert.equal(typeof commands.scanWorkspace, 'undefined');
});

test('core and transaction kernel remain Electron independent', () => {
  const files = [
    join(root, 'src', 'core', 'hash.mjs'),
    join(root, 'src', 'core', 'paths.mjs'),
    join(root, 'src', 'transactions', 'kernel.mjs')
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ['"]electron['"]|require\(['"]electron['"]\)/, file);
    assert.doesNotMatch(source, /renderer\//, file);
  }
});

// The channel guard above catches a channel that was never registered; this one catches the other
// half of the same mistake — a handler that references a binding the entry point never imported,
// which in a packaged asar fails at load time rather than at the call site.
const LOCAL = new Set(['Error', 'Object', 'String', 'Number', 'Boolean', 'Array', 'JSON', 'Promise', 'process', 'console', 'Date', 'Math']);
function unresolvedHandlerBindings(source) {
  const imported = new Set();
  for (const block of source.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  const declared = new Set([...source.matchAll(/(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
  const parameters = new Set([...source.matchAll(/\(([^)]*)\)\s*=>/g)].flatMap((match) => match[1].split(',').map((item) => item.trim().split(/\s|=/)[0])));
  const unresolved = [];
  for (const call of source.matchAll(/handleOperation\(\s*'[^']+'\s*,\s*\(([^)]*)\)\s*=>\s*([^\n]*)/g)) {
    for (const token of call[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = token[1];
      if (!imported.has(name) && !declared.has(name) && !parameters.has(name) && !LOCAL.has(name)) unresolved.push(name);
    }
  }
  return [...new Set(unresolved)].sort();
}

test('every binding referenced by an Electron handler is imported or locally bound', () => {
  const source = readFileSync(join(root, 'src', 'electron', 'register-operations.mjs'), 'utf8');
  assert.deepEqual(unresolvedHandlerBindings(source), [], 'handler references a binding the registration module never imports');
  // The guard must actually detect the failure it exists for, so the same mistake is injected here.
  const synthetic = "import {a} from 'b';\nhandleOperation('x:y', (_event, input) => missingHelper(input));\n";
  assert.deepEqual(unresolvedHandlerBindings(synthetic), ['missingHelper']);
});
test('every declared operation channel is registered by the Electron entry point', () => {
  const declarations = JSON.parse(readFileSync(join(root, 'src', 'app', 'operations.json'), 'utf8'));
  const source = readFileSync(join(root, 'src', 'electron', 'register-operations.mjs'), 'utf8');
  const registered = new Set([...source.matchAll(/handleOperation\(\s*'([^']+)'/g)].map((match) => match[1]));
  const declared = Object.entries(declarations.operations).map(([method, operation]) => ({ method, channel: operation.channel }));
  const missing = declared.filter((entry) => !registered.has(entry.channel));
  assert.deepEqual(missing, [], 'declared but never registered in main.mjs');
  // The preload bridge is generated from the same table, so the two must agree channel for channel.
  const preload = readFileSync(join(root, 'src', 'preload.cjs'), 'utf8');
  const bridged = new Set([...preload.matchAll(/invoke\("([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...registered].filter((channel) => !bridged.has(channel)), [], 'registered in main.mjs but absent from preload');
  assert.deepEqual([...bridged].filter((channel) => !registered.has(channel)), [], 'exposed by preload but never registered in main.mjs');
});

