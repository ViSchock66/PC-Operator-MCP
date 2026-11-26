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

  execFileSync(csc, args, { windowsHide: true, encoding: 'utf8' });
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
  }

  start() {
    if (process.platform !== 'win32') return false;
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
