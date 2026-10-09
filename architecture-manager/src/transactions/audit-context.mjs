import {AsyncLocalStorage} from 'node:async_hooks';

// Only metadata and in-memory values to redact; never persisted as a context.
export const auditContext = new AsyncLocalStorage();
