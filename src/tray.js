import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './config.js';

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];

export const TRAY_SOURCE_PATH = path.join(APP_ROOT, 'panel', 'tray', 'TrayDaemon.cs');
export const TRAY_EXE_PATH = path.join(APP_ROOT, 'panel', 'tray', 'pc-operator-tray.exe');
export const TRAY_ICON_PATH = path.join(APP_ROOT, 'panel', 'assets', 'pc-operator.ico');

export function findCscCompiler() {
  if (process.platform !== 'win32') return null;
  for (const candidate of CSC_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ensures the native Windows System Tray helper is compiled and up to date.
 */
export function ensureTrayExecutable({ logger } = {}) {
  if (process.platform !== 'win32') return null;
  if (!fs.existsSync(TRAY_SOURCE_PATH)) return null;

  const srcStat = fs.statSync(TRAY_SOURCE_PATH);
  const exeExists = fs.existsSync(TRAY_EXE_PATH);
  const exeStat = exeExists ? fs.statSync(TRAY_EXE_PATH) : null;
  const iconExists = fs.existsSync(TRAY_ICON_PATH);

  if (exeExists && exeStat && exeStat.mtimeMs >= srcStat.mtimeMs) {
    return TRAY_EXE_PATH;
  }

  const csc = findCscCompiler();
  if (!csc) {
    logger?.('warn', 'tray', 'No se encontró csc.exe (.NET 4.x); el icono en bandeja no se iniciará.');
    return null;
  }

  fs.mkdirSync(path.dirname(TRAY_EXE_PATH), { recursive: true });
  const trayDir = path.dirname(TRAY_EXE_PATH);
  for (const entry of fs.readdirSync(trayDir)) {
    if (entry.startsWith('pc-operator-tray.exe.old.')) {
      try { fs.unlinkSync(path.join(trayDir, entry)); } catch { /* Still locked by running instance. */ }
    }
  }

  let movedPath = null;
  if (exeExists) {
    const bakPath = `${TRAY_EXE_PATH}.bak`;
    try {
      if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
      fs.renameSync(TRAY_EXE_PATH, bakPath);
      movedPath = bakPath;
    } catch {
      const oldPath = `${TRAY_EXE_PATH}.old.${Date.now()}`;
      try {
        fs.renameSync(TRAY_EXE_PATH, oldPath);
        movedPath = oldPath;
      } catch {
        // Leave in place if rename fails; csc will attempt direct write.
      }
    }
  }

  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${TRAY_EXE_PATH}`,
    '/r:System.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:System.Web.Extensions.dll'
  ];
  if (iconExists) {
    args.push(`/win32icon:${TRAY_ICON_PATH}`);
  }
  args.push(TRAY_SOURCE_PATH);

  try {
    execFileSync(csc, args, { windowsHide: true, encoding: 'utf8' });
  } catch (err) {
    if (movedPath && !fs.existsSync(TRAY_EXE_PATH)) {
      try { fs.renameSync(movedPath, TRAY_EXE_PATH); } catch { /* Best-effort restore. */ }
    }
    throw err;
  }
  logger?.('info', 'tray', 'Compilado indicador nativo de bandeja (pc-operator-tray.exe).');
  return TRAY_EXE_PATH;
}

/**
 * Manages the Windows System Tray companion process bound to the Node daemon lifetime.
 */
export class TrayCompanion {
  constructor({ host = '127.0.0.1', port = 3333, trayToken = '', logger = null } = {}) {
    this.host = host;
    this.port = port;
    this.trayToken = trayToken;
    this.logger = logger;
    this.child = null;
    this.stopped = false;
    this.respawnTimer = null;
    this.respawnTimestamps = [];
  }

  start() {
    if (process.platform !== 'win32') return false;
    this.stopped = false;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    return this.#spawnOnce();
  }

  #spawnOnce() {
    if (this.stopped) return false;
    if (this.child && !this.child.killed) return true;

    let exePath = null;
    try {
      exePath = ensureTrayExecutable({ logger: this.logger });
    } catch (err) {
      this.logger?.('warn', 'tray', `No se pudo compilar el icono de bandeja: ${err?.message || err}`);
      return false;
    }

    if (!exePath) return false;

    try {
      const child = spawn(
        exePath,
        ['--host', this.host, '--port', String(this.port), '--pid', String(process.pid)],
        {
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            MCP_TRAY_TOKEN: this.trayToken
          }
        }
      );
      child.unref();
      child.on('error', (err) => {
        this.logger?.('warn', 'tray', `Error en proceso de bandeja: ${err?.message || err}`);
      });
      child.on('exit', () => {
        if (this.child === child) this.child = null;
        if (this.stopped || this.respawnTimer) return;
        const now = Date.now();
        this.respawnTimestamps = this.respawnTimestamps.filter((ts) => now - ts < 60_000);
        if (this.respawnTimestamps.length >= 5) {
          this.logger?.('warn', 'tray', 'Icono de bandeja se cerró repetidamente; auto-reinicio en pausa.');
          return;
        }
        this.respawnTimestamps.push(now);
        this.respawnTimer = setTimeout(() => {
          this.respawnTimer = null;
          this.#spawnOnce();
        }, 2500);
        this.respawnTimer.unref?.();
      });
      this.child = child;
      this.logger?.('info', 'tray', 'Icono de estado activo en la bandeja del sistema (System Tray).');
      return true;
    } catch (err) {
      this.logger?.('warn', 'tray', `No se pudo iniciar el icono de bandeja: ${err?.message || err}`);
      return false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (!this.child) return;
    try {
      if (!this.child.killed) {
        this.child.kill();
      }
    } catch {
      // Ignore cleanup error.
    }
    this.child = null;
  }
}
