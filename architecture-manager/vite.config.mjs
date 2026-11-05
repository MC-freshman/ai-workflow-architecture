import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { META_CONTENT_SECURITY_POLICY } from './src/electron/security-policy.mjs';

export default defineConfig({
  plugins: [react(), {name: 'application-csp', transformIndexHtml(html) {
    return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*("\s*\/?>)/,
      (_match, before, after) => before + META_CONTENT_SECURITY_POLICY + after);
  }}],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true }
});
