import { scanWorkspace } from './inventory.mjs';

const root = process.argv[2];
if (!root) {
  console.error('usage: npm run scan -- <workspace-root>');
  process.exitCode = 2;
} else {
  try {
    process.stdout.write(`${JSON.stringify(scanWorkspace(root), null, 2)}\n`);
  } catch (error) {
    console.error(JSON.stringify({ schema: 'architecture-manager-error/v1', error: String(error?.message ?? error) }));
    process.exitCode = 1;
  }
}
