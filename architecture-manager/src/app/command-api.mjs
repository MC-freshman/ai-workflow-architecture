// Mutating operations always return a plan or pass through plan -> apply -> verify.
export {buildGlobalUpdatePlan,buildGlobalUpdateRestorePlan,cancelGlobalUpdate} from '../domains/platforms/global-update.mjs';
export {buildPlatformResourceDefaultPlan} from '../domains/platforms/resource-defaults.mjs';
export {buildAutomaticSoftwarePlan} from '../domains/intake/automatic-software.mjs';
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
export { buildRegistryPlan } from '../domains/resources/catalog.mjs';
export { buildDefectBookEditPlan } from '../domains/audit/defects.mjs';
export { buildPlatformViewPlan, buildResourcePointerPlan } from '../domains/plans/plans.mjs';
export { buildAnchorMaterialisationPlan, applyAnchorMaterialisation, verifyAnchorMaterialisation, buildAnchorAlignmentPlan, applyAnchorAlignment, verifyAnchorAlignment } from '../domains/certification/anchor-plans.mjs';
export { buildDocumentPlan } from '../domains/docs/documents.mjs';
export { buildSoftwareLaunchPlan } from '../domains/software/software.mjs';
export { buildGitPlan } from '../domains/git/git.mjs';
export { buildIntegrationPlan } from '../domains/platforms/integration.mjs';
export { applyPlan, verifyPlanTarget } from '../transactions/router.mjs';
export { runPlatformCheck } from '../domains/platforms/platform-check.mjs';
export { buildSoftwareImportPlan } from '../domains/software/software-intake.mjs';
export { buildSoftwareRecipePlan } from '../domains/software/software-publish.mjs';
export { buildSoftwareRevertPlan } from '../domains/software/software-recovery.mjs';
export { buildReleasePlan } from '../domains/intake/releases.mjs';
export { buildSoftwareConnectorLaunchPlan } from '../domains/software/software-launch.mjs';
export { buildDocsSite, checkDocsLinks } from '../domains/docs/docs-ops.mjs';
export { buildPlatformScaffoldPlan } from '../domains/onboarding/onboarding.mjs';
export { buildOnboardingConfigPlan } from '../domains/onboarding/onboarding-config.mjs';
export { buildOnboardingRuntimePlan, buildOnboardingBackendPlan } from '../domains/onboarding/onboarding-runtime.mjs';
export {buildExistingSoftwareBindingPlan} from '../domains/intake/software-binding.mjs';
export { buildOnboardingClientPlan, probeOnboardingClient } from '../domains/onboarding/onboarding-client.mjs';
export { buildOnboardingProvidersPlan } from '../domains/onboarding/onboarding-providers.mjs';
export { probeOnboardingCapabilities, buildOnboardingAttestationPlan } from '../domains/onboarding/onboarding-attestation.mjs';
export { buildOnboardingGovernancePlan } from '../domains/onboarding/onboarding-governance.mjs';
export { buildOnboardingFinalizePlan } from '../domains/onboarding/onboarding-finalize.mjs';
export { buildAutomaticOnboardingPlan, prepareAutomaticOnboardingPlan } from '../domains/onboarding/onboarding-auto.mjs';
export { executeOnboardingChecks, cancelOnboarding, markOnboardingRecorded } from '../domains/onboarding/onboarding-state.mjs';
export { executePostAlignmentChecks } from '../domains/onboarding/onboarding-state.mjs';
export { buildWorkspaceClonePlan, applyWorkspaceClone } from '../domains/workspace/workspace-bootstrap.mjs';


// Probes and pipelines execute programs or write evidence; never export as queries.
export { healthSoftware } from '../domains/software/software.mjs';
export { runOnboardingPipeline } from '../domains/onboarding/onboarding.mjs';
export { detectRuntime } from '../domains/onboarding/onboarding-runtime.mjs';

export {buildGatewayMigrationPlan} from '../domains/software/gateway-migration.mjs';
export {buildNativeClientPlan,probeNativeClient,nativeClientStatus} from '../domains/platforms/native-client.mjs';
export {probeNativeClientWithAi} from '../domains/platforms/native-ai-probe.mjs';
export {suggestBodyImport,buildAutomaticTextBodyPlan} from '../domains/intake/automatic.mjs';
