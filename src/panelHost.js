import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './config.js';

export const PANEL_HOST_DIR = path.join(APP_ROOT, 'panel', 'host');
export const PANEL_HOST_PROJECT_PATH = path.join(PANEL_HOST_DIR, 'PcOperatorPanel.csproj');
export const PANEL_HOST_DIST_DIR = path.join(PANEL_HOST_DIR, 'dist');
export const PANEL_HOST_EXE_PATH = path.join(PANEL_HOST_DIST_DIR, 'pc-operator-panel.exe');

/**
 * Finds a dotnet.exe installation that has at least one .NET 8+ SDK available.
 */
export function findDotnetSdk() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet', 'dotnet.exe') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.dotnet', 'dotnet.exe') : '',
    'C:\\Program Files\\dotnet\\dotnet.exe',
    'dotnet'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate !== 'dotnet' && !fs.existsSync(candidate)) continue;
    try {
      const out = execFileSync(candidate, ['--list-sdks'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 8000
      });
      if (/^[89]\.|^\d{2,}\./m.test(out)) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function getLatestHostSourceMtimeMs() {
  if (!fs.existsSync(PANEL_HOST_DIR)) return 0;
  let latest = 0;
  for (const entry of fs.readdirSync(PANEL_HOST_DIR)) {
    if (!entry.endsWith('.cs') && !entry.endsWith('.csproj')) continue;
    const stat = fs.statSync(path.join(PANEL_HOST_DIR, entry));
    if (stat.mtimeMs > latest) latest = stat.mtimeMs;
  }
  return latest;
}

/**
 * Returns the path to `pc-operator-panel.exe` if already built or buildable with .NET 8+ SDK.
 * Never throws when .NET SDK is absent — returns null so callers seamlessly fall back to browser `--app=`.
 */
export function ensurePanelHostExecutable({ buildIfMissing = true, logger = null } = {}) {
  if (process.platform !== 'win32') return null;
  if (!fs.existsSync(PANEL_HOST_PROJECT_PATH)) return null;

  const exeExists = fs.existsSync(PANEL_HOST_EXE_PATH);
  const exeStat = exeExists ? fs.statSync(PANEL_HOST_EXE_PATH) : null;
  const latestSrcMtime = getLatestHostSourceMtimeMs();

  if (exeExists && exeStat && exeStat.mtimeMs >= latestSrcMtime) {
    return PANEL_HOST_EXE_PATH;
  }

  if (!buildIfMissing) {
    return exeExists ? PANEL_HOST_EXE_PATH : null;
  }

  const dotnet = findDotnetSdk();
  if (!dotnet) {
    return exeExists ? PANEL_HOST_EXE_PATH : null;
  }

  try {
    execFileSync(
      dotnet,
      ['build', PANEL_HOST_PROJECT_PATH, '-c', 'Release', '--nologo', '-v', 'quiet'],
      { windowsHide: true, encoding: 'utf8', timeout: 120000 }
    );
    if (fs.existsSync(PANEL_HOST_EXE_PATH)) {
      logger?.('info', 'panel', 'Compilado host nativo WebView2 (pc-operator-panel.exe).');
      return PANEL_HOST_EXE_PATH;
    }
  } catch (err) {
    logger?.('warn', 'panel', `No se pudo compilar pc-operator-panel.exe; se usará navegador fallback (${err?.message || err}).`);
  }

  return exeExists ? PANEL_HOST_EXE_PATH : null;
}

/**
 * Launches the native WebView2 panel host when available, otherwise falls back to Chrome/Edge `--app=`.
 */
export function openPanelWindow({ host = '127.0.0.1', port = 3333, url = null, logger = null } = {}) {
  if (process.platform !== 'win32') return { mode: 'unsupported' };
  const adminUrl = url || `http://${host}:${port}/admin`;

  const nativeExe = ensurePanelHostExecutable({ buildIfMissing: false, logger });
  if (nativeExe && fs.existsSync(nativeExe)) {
    spawn(nativeExe, ['--host', host, '--port', String(port), '--url', adminUrl], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    return { mode: 'native-webview2', exe: nativeExe };
  }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);

  const browser = candidates.find((p) => fs.existsSync(p)) || null;
  if (browser) {
    spawn(browser, [`--app=${adminUrl}`], { detached: true, stdio: 'ignore' }).unref();
    return { mode: 'browser-app', exe: browser };
  }

  spawn('cmd.exe', ['/c', 'start', '', adminUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref();
  return { mode: 'browser-default', exe: null };
}
