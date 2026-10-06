// Read-only application operations. These functions must not mutate workspace files.
export {readMcpConfiguration} from '../domains/software/mcp-config.mjs';
export {scanExternalBody} from '../domains/intake/sources.mjs';
export {readBodyEditor,listBodyDependencies} from '../domains/intake/shared-body.mjs';
export {readToolBodyEditor} from '../domains/intake/tool-body.mjs';
export {readSoftwareBodyActions} from '../domains/intake/software-body.mjs';
export {listRuntimeBodies} from '../domains/intake/runtime-body.mjs';
export {listIntakeJournals,readIntakeJournal} from '../domains/intake/journals.mjs';
export { inspectPlatformDirectory, scanWorkspace } from '../inventory.mjs';
export { inspectRegistration, readCatalogEntry, readSkillContent } from '../catalog.mjs';
export { readDocument } from '../documents.mjs';
export { inspectGit, scanSensitiveFiles } from '../git.mjs';
export { listIntegrationTargets, readIntegrationTarget, suggestPlatformBridge } from '../integration.mjs';
export { inspectPlatformConnection,previewPlatformCheck } from '../platform-check.mjs';
export { verifySoftwareImport } from '../software-intake.mjs';
export { listSoftwareIntakes, verifySoftwareRecipe } from '../software-publish.mjs';
export { listSoftwareRecoveries } from '../software-recovery.mjs';
export { inspectRunDirectory, listPlatformRuns, listRunLedger } from '../runs.mjs';
export { readDefectBook, verifyDefectBook } from '../defects.mjs';
export { inspectInbox } from '../inbox.mjs';
export { readAuditEvents } from '../audit.mjs';
export { listResourceReferences, readRegistryBaseline } from '../releases.mjs';
export { parseImplementationTables } from '../plans-center.mjs';
export { diffDocument } from '../docs-ops.mjs';
export { governanceOnboardingDraft, buildOnboardingCard } from '../onboarding.mjs';
export { readOnboardingConfig } from '../onboarding-config.mjs';
export { readOnboardingState } from '../onboarding-state.mjs';
export { readAnchorReport, listAnchorPlatforms } from '../domains/certification/anchor-report.mjs';

