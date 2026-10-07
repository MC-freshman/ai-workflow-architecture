// Mutating operations always return a plan or pass through plan -> apply -> verify.
export {buildMcpBodyPlan} from '../domains/intake/mcp-body.mjs';
export {discoverNativeMcp} from '../domains/software/mcp-discovery.mjs';
export {buildNativeCredentialPlan,buildNativeCredentialProviderPlan} from '../domains/software/credentials.mjs';
export {buildIntakeRevertPlan} from '../domains/intake/journals.mjs';
export {buildAgentSkillBodyPlan} from '../domains/intake/shared-body.mjs';
export {checkSharedBody} from '../domains/intake/smoke.mjs';
export {buildToolBodyPlan} from '../domains/intake/tool-body.mjs';
export {buildPlatformBodyPlan} from '../domains/intake/platform-body.mjs';
export {buildSoftwareBodyPlacementPlan,buildSoftwareBodyPlan} from '../domains/intake/software-body.mjs';
export {buildSoftwareCommandPlan} from '../domains/software/actions.mjs';
export { buildRegistryPlan } from '../catalog.mjs';
export { buildDefectBookEditPlan } from '../defects.mjs';
export { buildPlatformViewPlan, buildResourcePointerPlan } from '../plans.mjs';
export { buildAnchorMaterialisationPlan, applyAnchorMaterialisation, verifyAnchorMaterialisation, buildAnchorAlignmentPlan, applyAnchorAlignment, verifyAnchorAlignment } from '../domains/certification/anchor-plans.mjs';
export { buildDocumentPlan } from '../documents.mjs';
export { buildSoftwareLaunchPlan } from '../software.mjs';
export { buildGitPlan } from '../git.mjs';
export { buildIntegrationPlan } from '../integration.mjs';
export { applyPlan, verifyPlanTarget } from '../transactions.mjs';
export { runPlatformCheck } from '../platform-check.mjs';
export { buildSoftwareImportPlan } from '../software-intake.mjs';
export { buildSoftwareRecipePlan } from '../software-publish.mjs';
export { buildSoftwareRevertPlan } from '../software-recovery.mjs';
export { buildReleasePlan } from '../releases.mjs';
export { buildSoftwareConnectorLaunchPlan } from '../software-launch.mjs';
export { buildDocsSite, checkDocsLinks } from '../docs-ops.mjs';
export { buildPlatformScaffoldPlan } from '../onboarding.mjs';
export { buildOnboardingConfigPlan } from '../onboarding-config.mjs';
export { buildOnboardingRuntimePlan, buildOnboardingBackendPlan } from '../onboarding-runtime.mjs';
export {buildExistingSoftwareBindingPlan} from '../domains/intake/software-binding.mjs';
export { buildOnboardingClientPlan, probeOnboardingClient } from '../onboarding-client.mjs';
export { buildOnboardingProvidersPlan } from '../onboarding-providers.mjs';
export { probeOnboardingCapabilities, buildOnboardingAttestationPlan } from '../onboarding-attestation.mjs';
export { buildOnboardingGovernancePlan } from '../onboarding-governance.mjs';
export { buildOnboardingFinalizePlan } from '../onboarding-finalize.mjs';
export { buildAutomaticOnboardingPlan, prepareAutomaticOnboardingPlan } from '../onboarding-auto.mjs';
export { executeOnboardingChecks, cancelOnboarding, markOnboardingRecorded } from '../onboarding-state.mjs';
export { executePostAlignmentChecks } from '../onboarding-state.mjs';
export { buildWorkspaceClonePlan, applyWorkspaceClone } from '../workspace-bootstrap.mjs';


// Probes and pipelines execute programs or write evidence; never export as queries.
export { healthSoftware } from '../software.mjs';
export { runOnboardingPipeline } from '../onboarding.mjs';
export { detectRuntime } from '../onboarding-runtime.mjs';

export {buildGatewayMigrationPlan} from '../domains/software/gateway-migration.mjs';
export {buildNativeClientPlan,probeNativeClient,nativeClientStatus} from '../domains/platforms/native-client.mjs';
export {probeNativeClientWithAi} from '../domains/platforms/native-ai-probe.mjs';
export {suggestBodyImport,buildAutomaticTextBodyPlan} from '../domains/intake/automatic.mjs';
