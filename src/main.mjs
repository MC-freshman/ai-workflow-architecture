import {runDomainTask,cancelDomainTask,cancelAllDomainTasks} from './infrastructure/tasks.mjs';
import {taskContext} from './app/task-context.mjs';
import {buildSoftwareBodyPlacementPlan,buildSoftwareBodyPlan,readSoftwareBodyActions} from './domains/intake/software-body.mjs';
import {buildSoftwareCommandPlan} from './domains/software/actions.mjs';
import {listRuntimeBodies} from './domains/intake/runtime-body.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import { operationRegistrar } from './electron/operation-registry.mjs';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOnboardingJob } from './core/onboarding-jobs.mjs';
import { cancelAllOnboardingJobs } from './core/onboarding-jobs.mjs';
import { cancelAllOnboardingChecks } from './onboarding-state.mjs';
import { taskLifecycle } from './core/task-lifecycle.mjs';
import { refreshPlatformInventory } from './inventory.mjs';
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
  buildAutomaticOnboardingPlan,
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
  previewPlatformCheck,
  inspectRegistration,
  listIntegrationTargets,
  listResourceReferences,
  listRunLedger,
  listSoftwareIntakes,
  listSoftwareRecoveries,
  readAuditEvents,
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
} from './app/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultWorkspace = process.env.ARCHITECTURE_MANAGER_WORKSPACE || null;
const lifecycle = taskLifecycle(() => { cancelAllOnboardingJobs(); cancelAllOnboardingChecks(); cancelAllDomainTasks(); });
let quitReady = false;
async function safeQuit() {
  await lifecycle.close(); quitReady = true; app.quit();
}
function preferences() {
  const path = join(app.getPath('userData'), 'workspace-preferences.json');
  try { return parseJsonText(readFileSync(path, 'utf8')); } catch { return {}; }
}
function rememberWorkspace(root) {
  const directory = app.getPath('userData'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'workspace-preferences.json'), JSON.stringify({ lastWorkspace: root, recent: [root, ...(preferences().recent || []).filter((path) => path !== root)].slice(0, 8) }));
}

function registerIpc() {
  const handleOperation = operationRegistrar(ipcMain,{dispatch:({declaration,event,args,handler})=> {
    const metadata=args.at(-1)?.__managerTaskContext?args.pop():{};
    const input=args[0];
    if(!declaration.backend) return handler(event,...args);
    const {workspaceRoot,platformId}=taskContext(input);
    let parameters;
    switch(declaration.argumentsStyle) {
      case 'document': parameters=[input.workspaceRoot,input.relativePath];break;
      case 'references': parameters=[input.workspaceRoot,input.repository,input.resourceId];break;
      case 'health': parameters=[input.workspaceRoot,input.softwareId,input.platformId];break;
      case 'clone': parameters=[{plan:input.plan}];break;
      default: parameters=args;
    }
    const mode=input?.plan?.kind==='software-launch' || input?.plan?.kind==='software-command' && input.plan.target.operation==='open'?'provider-session':declaration.taskMode;
    return lifecycle.track(async()=>{
      const result=await runDomainTask({method:declaration.backend,args:parameters,workspaceRoot,platformId,jobId:metadata.jobId,workspaceSession:metadata.workspaceSession,mode,phase:declaration.phase,onProgress:progress=>event.sender.send('transaction:progress',progress)});
      if(declaration.backend==='scanWorkspace') rememberWorkspace(result.workspaceRoot);
      return result;
    });
  }});
  handleOperation('task:cancel',(_event,input)=>cancelDomainTask(input));
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
  handleOperation('defects:read', (_event, root) => readDefectBook(root));
  handleOperation('defects:verify', (_event, root) => verifyDefectBook(root));
  handleOperation('inbox:inspect', (_event, root) => inspectInbox(root));
  handleOperation('audit:events', (_event, input) => readAuditEvents({ limit: input?.limit }));
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
  handleOperation('plan:platform-onboarding', (_event, input) => buildAutomaticOnboardingPlan(input));
  handleOperation('plan:workspace-clone', (_event, input) => buildWorkspaceClonePlan(input));
  handleOperation('workspace:clone', (_event, input) => applyWorkspaceClone({ plan: input.plan }, { actor: 'local-user', now: new Date().toISOString() }));
  handleOperation('transaction:apply', (event, input) => lifecycle.track(() => applyPlan({ ...input, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  handleOperation('transaction:verify', (_event, input) => verifyPlanTarget(input));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      // Sandboxed Electron preload scripts must be CommonJS.  An ESM preload
      // is rejected by Electron before contextBridge can expose the API.
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!quitReady && lifecycle.pending) { event.preventDefault(); void safeQuit(); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  return window;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (!quitReady && lifecycle.pending) { event.preventDefault(); void safeQuit(); }
});
