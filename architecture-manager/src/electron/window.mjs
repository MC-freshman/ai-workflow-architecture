import { join } from 'node:path';
import { secureWindow } from './security-policy.mjs';

export function createApplicationWindow({BrowserWindow, sourceRoot, onClose}) {
  const window = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 680, show: false,
    webPreferences: {
      preload: join(sourceRoot, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.once('ready-to-show', () => {
    if (process.env.ARCHITECTURE_MANAGER_TEST_HIDDEN !== '1') window.show();
  });
  window.on('close', onClose);
  const entryPath = join(sourceRoot, '..', 'dist', 'index.html');
  secureWindow(window.webContents, entryPath);
  window.loadFile(entryPath);
  return window;
}
