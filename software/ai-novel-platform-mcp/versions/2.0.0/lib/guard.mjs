import fs from 'node:fs'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function preload(spec) {
  const cache = new Map(), writeCache = new Map(), errors = [];
  if (!spec.root) return { cache, writeCache, errors, available: false, reason: spec.reason };
  const root = path.resolve(spec.root);
  const original = process.stdout.write.bind(process.stdout);
  let noise = '';
  process.stdout.write = chunk => { noise += String(chunk); return true; };
  const load = async (entries, target) => {
    for (const [rel, names] of Object.entries(entries || {})) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) { errors.push({ rel, error: 'PATH_ESCAPE' }); continue; }
      try {
        const mod = spec.kind === 'cjs' ? require(file) : await import(pathToFileURL(file).href);
        target.set(rel, { mod, names: names.filter(n => typeof mod[n] === 'function') });
      } catch (e) { errors.push({ rel, error: String(e.message || e).slice(0, 140) }); }
    }
  };
  try { await load(spec.whitelist, cache); await load(spec.writeWhitelist, writeCache); }
  finally { process.stdout.write = original; }
  return { cache, writeCache, errors, available: cache.size > 0, noise: noise.trim().slice(0, 200), reason: spec.reason };
}
