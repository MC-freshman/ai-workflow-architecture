import {buildGatewayMigrationPlan} from '../domains/software/gateway-migration.mjs';
import {buildGlobalUpdatePlan,buildGlobalUpdateRestorePlan,cancelGlobalUpdate,readGlobalUpdateHistory} from '../domains/platforms/global-update.mjs';
import {readPlatformResourceVersions,buildPlatformResourceDefaultPlan} from '../domains/platforms/resource-defaults.mjs';
import {buildAutomaticSoftwarePlan} from '../domains/intake/automatic-software.mjs';
import {buildNativeClientPlan,probeNativeClient,nativeClientStatus} from '../domains/platforms/native-client.mjs';
import {probeNativeClientWithAi} from '../domains/platforms/native-ai-probe.mjs';
import {suggestBodyImport,buildAutomaticTextBodyPlan} from '../domains/intake/automatic.mjs';
import {buildExistingSoftwareBindingPlan} from '../domains/intake/software-binding.mjs';
import {buildSoftwareBodyPlacementPlan,buildSoftwareBodyPlan,readSoftwareBodyActions} from '../domains/intake/software-body.mjs';
import {buildSoftwareCommandPlan} from '../domains/software/actions.mjs';
import {listRuntimeBodies} from '../domains/intake/runtime-body.mjs';
import {parseJson as parseJsonText} from '../core/json.mjs';
import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startOnboardingJob } from '../core/onboarding-jobs.mjs';
import { refreshPlatformInventory } from '../domains/resources/inventory.mjs';
import {
  applyPlan,
  buildDefectBookEditPlan,
  buildDocumentPlan,
  buildGitPlan,
  buildIntegrationPlan,
  buildPlatformViewPlan,
  buildRegistryPlan,
  buildReleasePlan,
  buildResourcePointerPlan,
  buildSoftwareLaunchPlan,
  buildSoftwareImportPlan,
  buildSoftwareRecipePlan,
  buildSoftwareRevertPlan,
  buildSoftwareConnectorLaunchPlan,
  buildDocsSite,
  buildPlatformScaffoldPlan,
  buildOnboardingConfigPlan,
  readOnboardingConfig,
  detectRuntime,
  buildOnboardingRuntimePlan,
  buildOnboardingBackendPlan,
  buildOnboardingClientPlan,
  probeOnboardingClient,
  buildOnboardingProvidersPlan,
  probeOnboardingCapabilities,
  buildOnboardingAttestationPlan,
  buildOnboardingGovernancePlan,
  buildOnboardingFinalizePlan,
  prepareAutomaticOnboardingPlan,
  executeOnboardingChecks,
  executePostAlignmentChecks,
  cancelOnboarding,
  readOnboardingState,
  markOnboardingRecorded,
  buildOnboardingCard,
  buildWorkspaceClonePlan,
  applyWorkspaceClone,
  governanceOnboardingDraft,
  runOnboardingPipeline,
  checkDocsLinks,
  diffDocument,
  parseImplementationTables,
  healthSoftware,
  inspectGit,
  inspectPlatformDirectory,
  inspectPlatformConnection,
  inspectRunTimeline,
  previewPlatformCheck,
  inspectRegistration,
  listIntegrationTargets,
  listResourceReferences,
  listRunLedger,
  listSoftwareIntakes,
  listSoftwareRecoveries,
  readAuditEvents,
  readGateCockpit,
  readCatalogEntry,
  readDefectBook,
  readDocument,
  readIntegrationTarget,
  readSkillContent,
  readRegistryBaseline,
  scanSensitiveFiles,
  scanWorkspace,
  suggestPlatformBridge,
  runPlatformCheck,
  verifyDefectBook,
  verifyPlanTarget,
  inspectInbox
} from '../app/api.mjs';

import { createOperationRouter } from './ipc-router.mjs';
import { cancelDomainTask } from '../infrastructure/tasks.mjs';

export function registerOperations(options) {
  const lifecycle = options.lifecycle;
  const preferences = options.preferences;
  const rememberWorkspace = options.rememberWorkspace;
  const defaultWorkspace = options.defaultWorkspace;
  const handleOperation = createOperationRouter({ipcMain, lifecycle, rememberWorkspace});
  handleOperation('task:cancel',(_event,input)=>cancelDomainTask(input));
  handleOperation('global-update:previewGlobalUpdate',(_event,input)=>buildGlobalUpdatePlan(input));
  handleOperation('global-update:previewGlobalUpdateRestore',(_event,input)=>buildGlobalUpdateRestorePlan(input));
  handleOperation('global-update:cancelGlobalUpdate',(_event,input)=>cancelGlobalUpdate(input));
  handleOperation('global-update:readGlobalUpdateHistory',(_event,input)=>readGlobalUpdateHistory(input));
  const owned = async (input, operation) => {
    const control = startOnboardingJob(input.workspaceRoot, input.platformId);
    try { return await lifecycle.track(() => operation(control.registerCancel)); } finally { control.finish(); }
  };
  handleOperation('ui:version', () => app.getVersion());
  handleOperation('ui:confirm', async (_event, message) => {
    const result = await dialog.showMessageBox({ type: 'question', title: '确认操作', message: String(message), buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  });
  handleOperation('workspace:default', () => defaultWorkspace || (existsSync(preferences().lastWorkspace || '') ? preferences().lastWorkspace : null));
  handleOperation('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择架构工作区',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handleOperation('workspace:select-directory', async () => {
    const result = await dialog.showOpenDialog({ title: '选择平台目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handleOperation('intake:select-source',async(_event,input)=>{
    if(!['file','directory'].includes(input?.kind))throw Error('INTAKE_FILE_TYPE');
    const result=await dialog.showOpenDialog({title:'选择要接入的本体来源',properties:[input.kind==='directory'?'openDirectory':'openFile']});
    return result.canceled?null:result.filePaths[0] ?? null;
  });
  handleOperation('native-mcp:readMcpConfiguration',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('native-mcp:discoverNativeMcp',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('native-mcp:previewMcpBody',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('native-mcp:previewNativeCredential',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('native-mcp:previewNativeCredentialProvider',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:scan-source',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:body-editor',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:body-smoke',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:tool-editor',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:tool-plan',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:platform-body',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:dependencies',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:agent-skill-plan',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:history',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:journal',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('intake:revert-plan',()=>{throw Error('IPC_BACKEND_REQUIRED');});
  handleOperation('workspace:scan', (_event, root) => { const result = scanWorkspace(root); rememberWorkspace(result.workspaceRoot); return result; });
  handleOperation('platform:refresh', (_event, input) => refreshPlatformInventory(input));
  handleOperation('platform:inspect', (_event, input) => inspectPlatformDirectory(input.workspaceRoot, input.platformId, input.directoryRelative));
  handleOperation('platform:connection', (_event, input) => inspectPlatformConnection(input));
  handleOperation('platform:check-preview', (_event,input)=>previewPlatformCheck(input));
  handleOperation('platform:check', (event, input) => owned(input, (registerCancel) => runPlatformCheck({ ...input, registerCancel, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('plan:platform-view', (_event, input) => buildPlatformViewPlan(input));
  handleOperation('plan:resource-pointer', (_event, input) => buildResourcePointerPlan(input));
  handleOperation('platform:resource-versions',(_event,input)=>readPlatformResourceVersions(input));
  handleOperation('plan:platform-resource-default',(_event,input)=>buildPlatformResourceDefaultPlan(input));
  handleOperation('plan:automatic-software',(_event,input)=>buildAutomaticSoftwarePlan(input));
  // The anchor surface has a declared backend for each channel, so the dispatcher runs the work and
  // these handlers only have to exist: every operation needs a registered channel before it can be
  // called from the renderer at all.
  handleOperation('anchor:report', () => { throw Error('IPC_BACKEND_REQUIRED'); });
  handleOperation('plan:anchor-generation', () => { throw Error('IPC_BACKEND_REQUIRED'); });
  handleOperation('plan:platform-anchor-alignment', () => { throw Error('IPC_BACKEND_REQUIRED'); });
  handleOperation('anchor:post-align-check', (event, input) => owned(input, (registerCancel) => executePostAlignmentChecks(input, { registerCancel, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('catalog:read', (_event, input) => readCatalogEntry(input));
  handleOperation('skill:read', (_event, input) => readSkillContent(input));
  handleOperation('catalog:select', async (_event, input) => {
    const result = await dialog.showOpenDialog({ title: input.kind === 'agent' ? '选择 agent 仓内的资源目录' : '选择 tool/_registry 下的技能目录 JSON', defaultPath: join(input.workspaceRoot, input.kind === 'agent' ? 'agent' : 'tool/_registry'), properties: [input.kind === 'agent' ? 'openDirectory' : 'openFile'], ...(input.kind === 'skill' ? { filters: [{ name: '技能目录', extensions: ['json'] }] } : {}) });
    return result.canceled ? null : inspectRegistration({ ...input, selectedPath: result.filePaths[0] });
  });
  handleOperation('plan:registry', (_event, input) => buildRegistryPlan(input));
  handleOperation('document:read', (_event, input) => readDocument(input.workspaceRoot, input.relativePath));
  handleOperation('plan:document', (_event, input) => buildDocumentPlan(input));
  handleOperation('software:health', (event,input) => owned(input,registerCancel=>healthSoftware(input.workspaceRoot,input.softwareId,input.platformId,{registerCancel,onProgress:progress=>event.sender.send('transaction:progress',progress)})));
  handleOperation('plan:software', (_event, input) => buildSoftwareLaunchPlan(input));
  handleOperation('plan:software-import', (_event, input) => buildSoftwareImportPlan(input));
  handleOperation('intake:software-placement',(_event,input)=>buildSoftwareBodyPlacementPlan(input));
  handleOperation('intake:software-binding',(_event,input)=>buildExistingSoftwareBindingPlan(input));
  handleOperation('intake:software-body',(_event,input)=>buildSoftwareBodyPlan(input));
  handleOperation('software:body-actions',(_event,input)=>readSoftwareBodyActions(input));
  handleOperation('intake:runtime-bodies',(_event,input)=>listRuntimeBodies(input));
  handleOperation('plan:software-command',(_event,input)=>buildSoftwareCommandPlan(input));
  handleOperation('software:intakes', (_event, input) => listSoftwareIntakes(input));
  handleOperation('plan:software-recipe', (_event, input) => buildSoftwareRecipePlan(input));
  handleOperation('software:recoveries', (_event, input) => listSoftwareRecoveries(input));
  handleOperation('plan:software-revert', (_event, input) => buildSoftwareRevertPlan(input));
  handleOperation('software:select-source', async (_event, kind) => {
    const result = await dialog.showOpenDialog({ title: kind === 'unpacked-directory' ? '选择已解压的软件目录' : '选择下载的软件文件', properties: [kind === 'unpacked-directory' ? 'openDirectory' : 'openFile'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handleOperation('software:open-location', async (_event, input) => {
    const plan = buildSoftwareLaunchPlan({ workspaceRoot: input.workspaceRoot, softwareId: input.softwareId, platformId: input.platformId, mode: 'open-location' });
    if (!plan.target.bodyPath || !existsSync(plan.target.bodyPath) || !statSync(plan.target.bodyPath).isDirectory()) throw new Error('SOFTWARE_BODY_PATH_NOT_FOUND');
    if (input.expectedPath !== plan.target.bodyPath) throw new Error('EXTERNAL_CHANGE_DETECTED');
    const error = await shell.openPath(plan.target.bodyPath);
    if (error) throw new Error(`SOFTWARE_LOCATION_OPEN_FAILED:${error}`);
    return { ...plan, status: 'opened', writePerformed: false };
  });
  handleOperation('git:inspect', (_event, root) => inspectGit(root));
  handleOperation('git:sensitive-scan', (_event, root) => scanSensitiveFiles(root));
  handleOperation('plan:git', (_event, input) => buildGitPlan(input));
  handleOperation('integration:targets', (_event, input) => listIntegrationTargets(input));
  handleOperation('integration:read', (_event, input) => readIntegrationTarget(input));
  handleOperation('platform:suggest-bridge', (_event, input) => suggestPlatformBridge(input));
  handleOperation('plan:integration', (_event, input) => buildIntegrationPlan(input));
  handleOperation('runs:ledger', (_event, root) => listRunLedger(root));
  handleOperation('runs:detail', (_event, input) => inspectRunTimeline(input));
  handleOperation('defects:read', (_event, root) => readDefectBook(root));
  handleOperation('defects:verify', (_event, root) => verifyDefectBook(root));
  handleOperation('inbox:inspect', (_event, root) => inspectInbox(root));
  handleOperation('audit:events', (_event, input) => readAuditEvents({ limit: input?.limit }));
  handleOperation('gate:cockpit', (_event, input) => readGateCockpit(input || {}));
  handleOperation('plan:defect-book-edit', (_event, input) => buildDefectBookEditPlan(input));
  handleOperation('plan:release', (_event, input) => buildReleasePlan(input));
  handleOperation('releases:references', (_event, input) => listResourceReferences(input.workspaceRoot, input.repository, input.resourceId));
  handleOperation('releases:registry-baseline', (_event, input) => readRegistryBaseline(input.workspaceRoot, input.kind));
  handleOperation('plan:software-launch', (_event, input) => buildSoftwareConnectorLaunchPlan(input));
  handleOperation('plans:parse', (_event, root) => parseImplementationTables(root));
  handleOperation('docs:build', (_event, root) => buildDocsSite(root));
  handleOperation('docs:conform', (_event, root) => checkDocsLinks(root));
  handleOperation('document:diff', (_event, input) => diffDocument(input.workspaceRoot, input.relativePath));
  handleOperation('plan:platform-scaffold', (_event, input) => buildPlatformScaffoldPlan(input));
  handleOperation('onboarding:config', (_event, input) => readOnboardingConfig(input));
  handleOperation('plan:platform-configuration', (_event, input) => buildOnboardingConfigPlan(input));
  handleOperation('onboarding:runtime-detect', (_event, input) => detectRuntime(input));
  handleOperation('plan:platform-runtime', (_event, input) => buildOnboardingRuntimePlan(input));
  handleOperation('plan:platform-backend', (_event, input) => buildOnboardingBackendPlan(input));
  handleOperation('plan:platform-client', (_event, input) => buildOnboardingClientPlan(input));
  handleOperation('plan:software-binding-migration', (_event,input)=>buildGatewayMigrationPlan(input));
  handleOperation('plan:platform-providers', (_event, input) => buildOnboardingProvidersPlan(input));
  handleOperation('onboarding:capability-probe', (event, input) => owned(input, (registerCancel) => probeOnboardingCapabilities(input, { registerCancel, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('plan:platform-attestation', (_event, input) => buildOnboardingAttestationPlan(input));
  handleOperation('onboarding:client-probe', (_event, input) => owned(input, (registerCancel) => probeOnboardingClient(input, { registerCancel })));
  handleOperation('onboarding:select-file', async () => {
    const result = await dialog.showOpenDialog({ title: '选择解释器、客户端入口或配置文件', properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handleOperation('onboarding:draft', (_event, input) => governanceOnboardingDraft(input.workspaceRoot, input.platformId));
  handleOperation('onboarding:card', (_event, input) => buildOnboardingCard(input.workspaceRoot, input.platformId));
  handleOperation('onboarding:pipeline', (event, input) => lifecycle.track(() => executeOnboardingChecks(input, { onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('onboarding:state', (_event, input) => readOnboardingState(input));
  handleOperation('onboarding:cancel', (_event, input) => cancelOnboarding(input));
  handleOperation('onboarding:recorded', (_event, input) => markOnboardingRecorded(input));
  handleOperation('plan:platform-governance', (_event, input) => buildOnboardingGovernancePlan(input));
  handleOperation('plan:platform-finalize', (_event, input) => buildOnboardingFinalizePlan(input));
  handleOperation('plan:platform-onboarding', (_event, input) => prepareAutomaticOnboardingPlan(input));
  handleOperation('plan:platform-native-client',(_event,input)=>buildNativeClientPlan(input));
  handleOperation('onboarding:native-probe',(_event,input)=>probeNativeClient(input));
  handleOperation('onboarding:native-status',(_event,input)=>nativeClientStatus(input.workspaceRoot,input.platformId));
  handleOperation('onboarding:native-ai-probe',(_event,input)=>probeNativeClientWithAi(input));
  handleOperation('intake:automatic-suggestions',(_event,input)=>suggestBodyImport(input));
  handleOperation('plan:automatic-text-body',(_event,input)=>buildAutomaticTextBodyPlan(input));
  handleOperation('plan:workspace-clone', (_event, input) => buildWorkspaceClonePlan(input));
  handleOperation('workspace:clone', (_event, input) => applyWorkspaceClone({ plan: input.plan }, { actor: 'local-user', now: new Date().toISOString() }));
  handleOperation('transaction:apply', (event, input) => lifecycle.track(() => applyPlan({ ...input, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('transaction:verify', (_event, input) => verifyPlanTarget(input));
}

