// Shared JSON + containment primitives (3.5.0 P9 consolidation).
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

export function readJson(path) {
  return parseJson(readFileSync(path, 'utf8'));
}

export function parseJson(text) { return JSON.parse(String(text).replace(/^\uFEFF/, '')); }

export function stableJson(value) {
  if(Array.isArray(value)) return '['+value.map(stableJson).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export function inside(parent, target) {
  const rel = relative(parent, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !/^[A-Za-z]:/i.test(rel));
}
