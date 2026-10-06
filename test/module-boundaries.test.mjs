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
    'scanExternalBody',
    'readBodyEditor','listBodyDependencies','buildAgentSkillBodyPlan',
    'checkSharedBody',
    'readToolBodyEditor','buildToolBodyPlan',
    'buildPlatformBodyPlan',
    'buildSoftwareBodyPlacementPlan','buildSoftwareBodyPlan','readSoftwareBodyActions','buildMcpBodyPlan','buildNativeCredentialPlan','buildNativeCredentialProviderPlan','discoverNativeMcp','readMcpConfiguration','buildSoftwareCommandPlan',
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
    'buildOnboardingProvidersPlan',
    'probeOnboardingCapabilities', 'buildOnboardingAttestationPlan',
    'buildOnboardingGovernancePlan', 'executeOnboardingChecks', 'cancelOnboarding', 'readOnboardingState', 'markOnboardingRecorded', 'executePostAlignmentChecks',
    'buildOnboardingFinalizePlan',
    'buildAutomaticOnboardingPlan',
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

