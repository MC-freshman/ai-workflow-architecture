// Child-process environment hygiene for vendor CLIs.
//
// Hosts that run inside a vendor desktop app (the manager launched from WorkBuddy,
// or an agent session in its process tree) inherit dozens of app-injected
// CODEBUDDY_*/SERVER__*/CLAUDE_*/WB_* variables. A vendor CLI that inherits
// SERVER__PORT tries to bind the host app's service-proxy port, dies with
// EADDRINUSE and never resolves its endpoint (D-146). Strip the injected set and
// let callers re-apply their own intentional variables, so the child environment
// is fully determined by the manager instead of ambient host state.
import net from 'node:net';

const INJECTED = /^(CODEBUDDY_|SERVER__|CLAUDE_|WB_)/;

export function childEnv(base = process.env, overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !INJECTED.test(key)) env[key] = value;
  }
  return { ...env, ...overrides };
}

// The vendor serve bootstrap listens on SERVER__PORT with no fallback when the
// port is taken, so hand it a port this process just verified free instead of
// relying on the vendor default (3000) being available.
export function freeLocalPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
