import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(new URL('../src/app/operations.json', import.meta.url), 'utf8'));
const methods = Object.entries(manifest.operations).map(([method,operation]) => `  ${method}: (...args) => ipcRenderer.invoke(${JSON.stringify(operation.channel)}, ...args),`).join('\n');
const source = [
  '// Generated from app/operations.json; sandbox preload must remain standalone.',
  "const { contextBridge, ipcRenderer } = require('electron');",
  "contextBridge.exposeInMainWorld('architectureManager', Object.freeze({",
  methods,
  "  onTransactionProgress: (callback) => { const listener = (_event, progress) => callback(progress); ipcRenderer.on('transaction:progress', listener); return () => ipcRenderer.removeListener('transaction:progress', listener); }",
  '}));',
  ''
].join('\n');
const output = new URL('../src/preload.cjs', import.meta.url);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(output,'utf8') !== source) throw Error('PRELOAD_DECLARATION_DRIFT');
} else fs.writeFileSync(output,source);
