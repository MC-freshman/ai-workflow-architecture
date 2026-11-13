export class ToolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(err) {
  if (err instanceof ToolError) {
    const payload = { code: err.code, message: err.message };
    if (err.details !== undefined) payload.details = err.details;
    return payload;
  }
  return { code: 'INTERNAL_ERROR', message: 'unexpected server error' };
}
