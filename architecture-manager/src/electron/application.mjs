import { app, BrowserWindow, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskLifecycle } from '../core/task-lifecycle.mjs';
import { cancelAllOnboardingJobs } from '../core/onboarding-jobs.mjs';
import { cancelAllOnboardingChecks } from '../domains/onboarding/onboarding-state.mjs';
import { cancelAllDomainTasks } from '../infrastructure/tasks.mjs';
import { registerOperations } from './register-operations.mjs';
import { workspacePreferences } from './workspace-preferences.mjs';
import { secureSession } from './security-policy.mjs';
import { createApplicationWindow } from './window.mjs';

export function startApplication() {
  const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lifecycle = taskLifecycle(() => {
    cancelAllOnboardingJobs(); cancelAllOnboardingChecks(); cancelAllDomainTasks();
  });
  let quitReady = false;
  const safeQuit = async () => { await lifecycle.close(); quitReady = true; app.quit(); };
  const onClose = event => {
    if (!quitReady && lifecycle.pending) { event.preventDefault(); void safeQuit(); }
  };
  const createWindow = () => createApplicationWindow({BrowserWindow, sourceRoot, onClose});
  app.whenReady().then(() => {
    const preferences = workspacePreferences(app.getPath('userData'));
    secureSession(session.defaultSession);
    registerOperations({lifecycle, preferences: preferences.read, rememberWorkspace: preferences.remember,
      defaultWorkspace: process.env.ARCHITECTURE_MANAGER_WORKSPACE || null});
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', onClose);
}
