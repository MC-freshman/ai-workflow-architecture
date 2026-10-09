// Stable application boundary for the Electron entry point.
// Domain modules can evolve behind this file without changing IPC wiring.
export * from './query-api.mjs';
export * from './command-api.mjs';

