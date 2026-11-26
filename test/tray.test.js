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

  // 5. All refactored admin assets, modular views, i18n dictionaries & icons are served cleanly
  for (const asset of [
    '/admin/assets/favicon.svg',
    '/admin/assets/icon-32.png',
    '/admin/assets/icon-192.png',
    '/admin/assets/manifest.webmanifest',
    '/admin/assets/styles.css',
    '/admin/assets/app.js',
    '/admin/assets/i18n/index.js',
    '/admin/assets/i18n/en.js',
    '/admin/assets/i18n/es.js',
    '/admin/assets/js/api.js',
    '/admin/assets/js/render.js',
    '/admin/assets/js/views/overview.js',
    '/admin/assets/js/views/workspaces.js',
    '/admin/assets/js/views/connections.js',
    '/admin/assets/js/views/runtime.js',
    '/admin/assets/js/views/handoff.js'
  ]) {
    const assetRes = await fetch(`${baseUrl}${asset}`);
    assert.equal(assetRes.status, 200, `Expected 200 for ${asset}`);
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

  // 6. Native Windows tray executable builds/exists
  if (process.platform === 'win32') {
    const exePath = ensureTrayExecutable();
    assert.ok(exePath && fs.existsSync(exePath), 'pc-operator-tray.exe should exist');
  }
});
