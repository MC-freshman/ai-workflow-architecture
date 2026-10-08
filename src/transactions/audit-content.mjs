import {sha256} from '../core/hash.mjs';

export function redactAuditText(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) if (typeof secret === 'string' && secret) text = text.split(secret).join('[REDACTED]');
  text = text.replace(/(\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]');
  text = text.replace(/(\b(?:Authorization\s*[:=]\s*)?Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
  text = text.replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  text = text.replace(/\bsk-(?:sp-|ws-)?[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED]');
  return text.slice(0, 2048);
}

export function sanitizeAuditEvent(event, secrets = []) {
  let redacted = false;
  const metadata = new Set(['schema','action','status','planId','transactionId','operationId','parentOperationId','phase','occurredAt','oldSha256','newSha256','checkpointSha256','eventSha256','writeState']);
  const visit = (value,key = '') => {
    if(metadata.has(key)) return value;
    if (typeof value === 'string') { const clean = redactAuditText(value, secrets); redacted ||= clean !== value; return clean; }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,visit(item,key)]));
    return value;
  };
  const clean = visit(event);
  clean.sensitiveRedacted = redacted || event.sensitiveRedacted === true;
  return clean;
}

export function auditEventHash(event) {
  const {eventSha256: ignored, ...content} = event;
  return sha256(JSON.stringify(content));
}
