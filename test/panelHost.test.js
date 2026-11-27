import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ensurePanelHostExecutable, findDotnetSdk, PANEL_HOST_EXE_PATH } from '../src/panelHost.js';
import { renderLoginHtml } from '../src/templates/loginPage.js';

test('Native WebView2 host source, launcher priority, portable fallback, and build', () => {
  const csproj = fs.readFileSync(new URL('../panel/host/PcOperatorPanel.csproj', import.meta.url), 'utf8');
  const panelForm = fs.readFileSync(new URL('../panel/host/PanelForm.cs', import.meta.url), 'utf8');
  const nativeMethods = fs.readFileSync(new URL('../panel/host/NativeMethods.cs', import.meta.url), 'utf8');
  const programCs = fs.readFileSync(new URL('../panel/host/Program.cs', import.meta.url), 'utf8');
  const abrirPs1 = fs.readFileSync(new URL('../panel/abrir-panel.ps1', import.meta.url), 'utf8');
  const trayCs = fs.readFileSync(new URL('../panel/tray/TrayDaemon.cs', import.meta.url), 'utf8');
  const ciWorkflow = fs.readFileSync(new URL('../.github/workflows/build-panel-host.yml', import.meta.url), 'utf8');

  // 1. C# host configures WebView2 + DWM Mica + integrated titlebar + single-instance
  assert.match(csproj, /Microsoft\.Web\.WebView2/);
  assert.match(nativeMethods, /DWMWA_SYSTEMBACKDROP_TYPE\s*=\s*38/);
  assert.match(nativeMethods, /DWMWA_USE_IMMERSIVE_DARK_MODE\s*=\s*20/);
  assert.match(panelForm, /DefaultBackgroundColor\s*=\s*Color\.Transparent/);
  assert.match(panelForm, /IsNonClientRegionSupportEnabled\s*=\s*true/);
  assert.match(panelForm, /WM_NCCALCSIZE/);
  assert.match(panelForm, /dataset\.nativeHost\s*=\s*'webview2'/);
  assert.match(programCs, /PcOperatorMcpPanelActivate_/);

  // 2. Launchers prefer native WebView2 host when built and preserve Chrome/Edge browser fallback
  const nativePsIdx = abrirPs1.indexOf('pc-operator-panel.exe');
  const chromePsIdx = abrirPs1.indexOf('chrome.exe');
  const edgePsIdx = abrirPs1.indexOf('msedge.exe');
  assert.ok(nativePsIdx > -1 && nativePsIdx < chromePsIdx && chromePsIdx < edgePsIdx);

  const nativeTrayIdx = trayCs.indexOf('pc-operator-panel.exe');
  const chromeTrayIdx = trayCs.indexOf('chrome.exe');
  const edgeTrayIdx = trayCs.indexOf('msedge.exe');
  assert.ok(nativeTrayIdx > -1 && nativeTrayIdx < chromeTrayIdx && chromeTrayIdx < edgeTrayIdx);
  assert.match(trayCs, /PcOperatorMcpPanelActivate_/);

  // 3. Login page supports native Mica transparency and caption buttons while remaining standard HTML in browsers
  const loginHtml = renderLoginHtml({ lang: 'es', theme: 'dark' });
  assert.match(loginHtml, /data-native-host="webview2"/);
  assert.match(loginHtml, /class="native-bar"/);
  assert.match(loginHtml, /window:minimize/);
  assert.match(loginHtml, /theme:sync/);

  // 4. GitHub Actions portability workflow compiles and packages the host for Releases
  assert.match(ciWorkflow, /dotnet build panel\/host\/PcOperatorPanel\.csproj -c Release/);
  assert.match(ciWorkflow, /pc-operator-panel-win-x64\.zip/);

  // 5. On Windows with .NET 8 SDK available, ensurePanelHostExecutable builds cleanly
  if (process.platform === 'win32' && findDotnetSdk()) {
    const exe = ensurePanelHostExecutable({ buildIfMissing: true });
    assert.equal(exe, PANEL_HOST_EXE_PATH);
    assert.ok(fs.existsSync(PANEL_HOST_EXE_PATH), 'pc-operator-panel.exe must exist after build');
  }
});
