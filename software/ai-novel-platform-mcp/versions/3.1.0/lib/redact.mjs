const BLOCKED = /apiKey|apikey|api_key|token|password|passwd|secret|cookie|credential|authorization|baseUrl|base_url/i;
export function redact(value, depth = 0) {
  if (depth > 14) return '[REDACTED:DEPTH]';
  if (Array.isArray(value)) return value.map(row => redact(row, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = BLOCKED.test(key) ? '[REDACTED]' : redact(item, depth + 1);
    return out;
  }
  return value;
}
export const SAFE_CONFIG_FIELDS = ['version','projectSchemaVersion','title','author','createdAt','updatedAt'];
export function safeConfig(c) {
  const fields = {}; for (const k of SAFE_CONFIG_FIELDS) if (k in c) fields[k] = c[k];
  return { schema: 'novel-config/v1', fields, topLevelKeys: Object.keys(c) };
}
export function assertNoSecrets(t) {
  return !/"(?:apiKey|embeddingApiKey|api_key|token|password|secret)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i.test(t);
}
