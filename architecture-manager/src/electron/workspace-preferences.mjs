import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson } from '../core/json.mjs';

export function workspacePreferences(directory) {
  const path = join(directory, 'workspace-preferences.json');
  const read = () => {
    try { return parseJson(readFileSync(path, 'utf8')); } catch { return {}; }
  };
  const remember = root => {
    mkdirSync(directory, {recursive: true});
    writeFileSync(path, JSON.stringify({lastWorkspace: root,
      recent: [root, ...(read().recent || []).filter(value => value !== root)].slice(0, 8)}));
  };
  return {read, remember};
}
