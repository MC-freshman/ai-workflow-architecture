import {parseJson as parseJsonText} from './json.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { targetPath } from './paths.mjs';

export const PLATFORM_IDS = Object.freeze(['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder']);

export function isFormalPlatform(id) {
  return PLATFORM_IDS.includes(id);
}

const RESERVED = new Set(['tool', 'agent', 'software', 'versions', 'inbox', 'docs-site', 'architecture-manager']);
export function validPlatformId(id) { return typeof id === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(id) && !RESERVED.has(id); }
export function isRegisteredPlatform(id, workspaceRoot) { return validPlatformId(id) && (isFormalPlatform(id) || discoverPlatformIds(workspaceRoot).includes(id)); }

// Data-driven platform list (3.5.0 P7): the six base platforms plus any
// first-level directory that carries its own bridge.json. Registered extras
// need no code change.
export function discoverPlatformIds(workspaceRoot) {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return [];
  const discovered = [];
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || isFormalPlatform(entry.name) || !validPlatformId(entry.name)) continue;
    try {
      const bridge = targetPath(workspaceRoot, `${entry.name}/bridge.json`);
      if (!existsSync(bridge) || !statSync(bridge).isFile()) continue;
      const value = parseJsonText(readFileSync(bridge, 'utf8'));
      if (value.platform === entry.name && ['ai-platform-bridge/v1', 'ai-platform-bridge/v1.1'].includes(value.schema) && value.shared?.readOnly === true) discovered.push(entry.name);
    } catch { /* An invalid or escaping bridge is not a registered platform. */ }
  }
  return discovered.sort();
}

export function allPlatformIds(workspaceRoot) {
  const discovered = discoverPlatformIds(workspaceRoot);
  return [...PLATFORM_IDS, ...discovered.filter((id) => !PLATFORM_IDS.includes(id))];
}
