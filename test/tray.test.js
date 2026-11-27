import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigManager } from '../src/config.js';
import { createMcpAppServer } from '../src/server.js';
import { ensureTrayExecutable } from '../src/tray.js';

test('Tray internal loopback API security, static UI assets, and tray executable build', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-operator-tray-test-'));
  const dataDir = path.join(base, 'data');
  const ws = path.join(base, 'ws');
  fs.mkdirSync(ws, { recursive: true });

  let shutdownCalled = false;
  const configManager = new ConfigManager({
    dataDir,
    defaultWorkspace: ws,
    port: 0,
    operatorEnabled: false
  });

  const srv = await createMcpAppServer({
    configManager,
    port: 0,
    onShutdown: () => {
      shutdownCalled = true;
    }
  });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  // 1. Rejects missing or wrong token
  const noTok = await fetch(`${baseUrl}/internal/tray/status`);
  assert.equal(noTok.status, 401);

  const badTok = await fetch(`${baseUrl}/internal/tray/status`, {
    headers: { 'x-tray-token': 'wrong-token' }
  });
  assert.equal(badTok.status, 401);

  // 2. Rejects proxied requests even with valid token
  const proxied = await fetch(`${baseUrl}/internal/tray/status`, {
    headers: {
      'x-tray-token': srv.trayToken,
      'X-Forwarded-For': '1.2.3.4'
    }
  });
  assert.equal(proxied.status, 403);

  // 3. Valid loopback token returns live state
  const okRes = await fetch(`${baseUrl}/internal/tray/status`, {
    headers: { 'x-tray-token': srv.trayToken }
  });
  assert.equal(okRes.status, 200);
  const statusJson = await okRes.json();
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.language, 'en');
  assert.equal(typeof statusJson.version, 'string');
  assert.equal(statusJson.pin, configManager.get().pin);
  assert.equal(statusJson.adminUrl, `${baseUrl}/admin`);

  // 4. Shutdown endpoint triggers onShutdown callback
  const shutRes = await fetch(`${baseUrl}/internal/tray/shutdown`, {
    method: 'POST',
    headers: { 'x-tray-token': srv.trayToken }
  });
  assert.equal(shutRes.status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(shutdownCalled, true);

  // 5. Static assets and built Vite Preact bundle refs in src/public/index.html are served cleanly
  for (const asset of [
    '/admin/assets/favicon.svg',
    '/admin/assets/icon-32.png',
    '/admin/assets/icon-192.png',
    '/admin/assets/manifest.webmanifest'
  ]) {
    const assetRes = await fetch(`${baseUrl}${asset}`);
    assert.equal(assetRes.status, 200, `Expected 200 for ${asset}`);
  }

  const builtIndexPath = new URL('../src/public/index.html', import.meta.url);
  assert.ok(fs.existsSync(builtIndexPath), 'src/public/index.html must exist (run npm run build:web)');
  const builtIndexHtml = fs.readFileSync(builtIndexPath, 'utf8');
  const assetRefs = [...new Set([...builtIndexHtml.matchAll(/\/admin\/assets\/[^"']+/g)].map((m) => m[0]))];
  assert.ok(assetRefs.some((r) => r.endsWith('.js')), 'Built index.html must reference at least one JS asset');
  assert.ok(assetRefs.some((r) => r.endsWith('.css')), 'Built index.html must reference at least one CSS asset');
  for (const ref of assetRefs) {
    const assetRes = await fetch(`${baseUrl}${ref}`);
    assert.equal(assetRes.status, 200, `Expected 200 for ${ref}`);
  }

  // 5b. Auditoría 2 (4.6): /admin/assets/index.html blocked, missing assets & unknown /admin paths return 404/401 instead of 200 login HTML
  for (const blockedPath of [
    '/admin/assets/index.html',
    '/admin/assets/',
    '/admin/assets/no-existe-123.js',
    '/admin/assets/%2e%2e/server.js',
    '/admin/ruta-inexistente'
  ]) {
    const res = await fetch(`${baseUrl}${blockedPath}`);
    assert.equal(res.status, 404, `Expected 404 for ${blockedPath}, got ${res.status}`);
  }

  const unauthPost = await fetch(`${baseUrl}/admin/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ allowWrite: 'on' })
  });
  assert.equal(unauthPost.status, 401);

  const loginPage = await fetch(`${baseUrl}/admin`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /PC-Operator-MCP/);

  // 6. TrayDaemon FindPanelWindow matches current PC-Operator-MCP window title & builds/exists
  const traySource = fs.readFileSync(new URL('../panel/tray/TrayDaemon.cs', import.meta.url), 'utf8');
  assert.match(traySource, /PC-Operator-MCP/);
  assert.ok(traySource.indexOf('chrome.exe') > -1 && traySource.indexOf('chrome.exe') < traySource.indexOf('msedge.exe'), 'TrayDaemon should prefer Chrome --app= over Edge for theme-color titlebar');
  if (process.platform === 'win32') {
    const exePath = ensureTrayExecutable();
    assert.ok(exePath && fs.existsSync(exePath), 'pc-operator-tray.exe should exist');
  }
});
