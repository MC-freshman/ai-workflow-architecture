// N4 (approved U-table 20261113): opt-in Electron shell smoke test.
// Fills declared gap 2 (发布门禁.md) without adding environment-sensitive reds to the default
// suite: runs ONLY with MANAGER_ELECTRON_SMOKE=1, otherwise skips. Zero new dependencies
// (node built-in fetch/WebSocket CDP, proven by the P3/P4/P5 real-render harnesses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import registry from '../src/app/module-registry.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.MANAGER_ELECTRON_SMOKE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('electron shell smoke: 12 views render (opt-in MANAGER_ELECTRON_SMOKE=1)', { skip: enabled ? false : 'opt-in: set MANAGER_ELECTRON_SMOKE=1', timeout: 240000 }, async () => {
  const port = 9300 + Math.floor(Math.random() * 90);
  const electronBin = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
  assert.ok(fs.existsSync(electronBin), 'electron binary present');
  // Workspace preference: temporary when absent (restored in finally), so nav is enabled.
  const prefDir = path.join(os.homedir(), 'AppData', 'Roaming', 'architecture-manager');
  const prefFile = path.join(prefDir, 'workspace-preferences.json');
  const prefExisted = fs.existsSync(prefFile);
  if (!prefExisted) {
    fs.mkdirSync(prefDir, { recursive: true });
    fs.writeFileSync(prefFile, JSON.stringify({ lastWorkspace: path.resolve(ROOT, '..'), recent: [path.resolve(ROOT, '..')] }));
  }
  const child = spawn(electronBin, ['.', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  let ws = null;
  const pending = new Map();
  let msgId = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(Error('CDP_TIMEOUT:' + method)); } }, 30000);
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error('EVAL_FAIL:' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result?.value;
  };
  try {
    let page = null;
    for (let i = 0; i < 60 && !page; i++) {
      await sleep(1000);
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes('index.html')); } catch { /* not up yet */ }
    }
    assert.ok(page, 'electron page reachable via CDP');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(Error(m.error.message)) : res(m.result); }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      ready = await evaluate(`document.querySelectorAll('.nav-item:not([disabled])').length >= ${registry.views.length}`);
      if (!ready) await sleep(1000);
    }
    assert.ok(ready, 'navigation rendered');
    const rendered = [];
    for (const view of registry.views) {
      const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim() === ${JSON.stringify(view.label)}); if (!b) return false; b.click(); return true; })()`);
      assert.ok(clicked, 'nav item found: ' + view.id);
      await sleep(1200);
      const heading = await evaluate(`document.querySelector('.view-heading h2')?.textContent || null`);
      assert.equal(heading, view.label, 'view heading renders: ' + view.id);
      const broken = await evaluate(`[...document.querySelectorAll('.module-empty-state-title')].some(t => t.textContent.includes('加载失败'))`);
      assert.equal(broken, false, 'no panel load failure in view: ' + view.id);
      rendered.push(view.id);
    }
    assert.equal(rendered.length, registry.views.length);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(os.tmpdir(), `manager-electron-smoke-${Date.now()}.png`);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    assert.ok(fs.statSync(out).size > 10000, 'screenshot non-trivial');
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    try { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { encoding: 'utf8', windowsHide: true }); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    if (!prefExisted) { try { fs.unlinkSync(prefFile); } catch { /* ignore */ } }
    await sleep(1000);
  }
});