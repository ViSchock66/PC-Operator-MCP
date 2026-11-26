import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildSanitizedShellEnv } from './shellEnv.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 256 * 1024;
const MAX_STORED_PROCESSES = 24;
const MAX_RUNNING_PROCESSES = 10;

async function killProcessTree(pid, child) {
  if (!pid) {
    try {
      child?.kill();
    } catch {
      // Ignore already exited child.
    }
    return;
  }

  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        timeout: 6000,
        windowsHide: true
      });
      return;
    } catch {
      // Fall back to direct child.kill() if process already exited or taskkill failed.
    }
  }

  try {
    child?.kill('SIGTERM');
  } catch {
    // Ignore.
  }
}

/**
 * Manages persistent background consoles / daemons started by MCP models or the local panel,
 * gated by the explicit on-demand "Modo Control Total" switch (with optional auto-expiry TTL).
 */
export class ProcessManager {
  constructor({ configManager, logger, onStateChange } = {}) {
    this.configManager = configManager;
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
    this.processes = new Map(); // id -> record
    this.expiryTimer = null;

    this.#scheduleExpiryCheck();
  }

  getFullControlConfig() {
    const fc = this.configManager.get().fullControl || {};
    const enabled = Boolean(fc.enabled);
    const expiresAt = fc.expiresAt || null;
    const ttlMinutes = Number.isFinite(Number(fc.ttlMinutes)) ? Number(fc.ttlMinutes) : 60;
    const allowUnrestrictedCwd = Boolean(fc.allowUnrestrictedCwd);
    const stopProcessesOnDisable = fc.stopProcessesOnDisable !== false;

    let active = enabled;
    let remainingSec = null;
    if (enabled && expiresAt) {
      const diffMs = Date.parse(expiresAt) - Date.now();
      if (!Number.isFinite(diffMs) || diffMs <= 0) {
        active = false;
        remainingSec = 0;
        // Lazily persist auto-expiration
        this.#handleAutoExpire();
      } else {
        remainingSec = Math.ceil(diffMs / 1000);
      }
    }

    return {
      enabled: active,
      ttlMinutes,
      expiresAt: active ? expiresAt : null,
      remainingSec,
      allowUnrestrictedCwd: active && allowUnrestrictedCwd,
      stopProcessesOnDisable
    };
  }

  isFullControlActive() {
    return this.getFullControlConfig().enabled;
  }

  #handleAutoExpire() {
    const raw = this.configManager.get().fullControl;
    if (!raw?.enabled) return;
    const shouldStop = raw.stopProcessesOnDisable !== false;
    this.configManager.updateFullControlConfig({ enabled: false, expiresAt: null });
    this.logger('warn', 'daemon', 'Modo Control Total expiró automáticamente por temporizador.');
    if (shouldStop) {
      this.stopAll({ reason: 'auto-expire' }).catch(() => {});
    }
    this.onStateChange();
  }

  #scheduleExpiryCheck() {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    const raw = this.configManager.get().fullControl;
    if (!raw?.enabled || !raw.expiresAt) return;
    const diffMs = Date.parse(raw.expiresAt) - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) {
      this.#handleAutoExpire();
      return;
    }
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.#handleAutoExpire();
    }, Math.min(diffMs + 100, 2147483000));
    this.expiryTimer.unref();
  }

  async setFullControl({ enabled, ttlMinutes, allowUnrestrictedCwd, stopProcessesOnDisable } = {}) {
    const current = this.configManager.get().fullControl || {};
    const nextEnabled = typeof enabled === 'boolean' ? enabled : Boolean(current.enabled);
    const nextTtl = ttlMinutes !== undefined ? Number(ttlMinutes) : Number(current.ttlMinutes ?? 60);
    const safeTtl = Number.isFinite(nextTtl) && nextTtl >= 0 ? Math.min(Math.floor(nextTtl), 1440) : 60;
    const nextExpiresAt = nextEnabled && safeTtl > 0
      ? new Date(Date.now() + safeTtl * 60 * 1000).toISOString()
      : null;

    const updated = this.configManager.updateFullControlConfig({
      enabled: nextEnabled,
      ttlMinutes: safeTtl,
      expiresAt: nextExpiresAt,
      allowUnrestrictedCwd: typeof allowUnrestrictedCwd === 'boolean'
        ? allowUnrestrictedCwd
        : Boolean(current.allowUnrestrictedCwd),
      stopProcessesOnDisable: typeof stopProcessesOnDisable === 'boolean'
        ? stopProcessesOnDisable
        : (current.stopProcessesOnDisable !== false)
    });

    this.#scheduleExpiryCheck();

    if (nextEnabled) {
      this.logger(
        'warn',
        'daemon',
        `Modo Control Total ACTIVADO (${safeTtl > 0 ? `auto-apagado en ${safeTtl} min` : 'sin límite de tiempo'}${updated.allowUnrestrictedCwd ? ', cwd libre' : ', cwd en workspace'}).`
      );
    } else {
      this.logger('info', 'daemon', 'Modo Control Total DESACTIVADO.');
      if (updated.stopProcessesOnDisable) {
        await this.stopAll({ reason: 'disabled' });
      }
    }

    this.onStateChange();
    return this.getFullControlConfig();
  }

  #assertFullControlAllowed() {
    if (!this.configManager.get().permissions?.allowCommands) {
      throw new Error('La ejecución de comandos está desactivada en Permisos del Harness (/admin).');
    }
    if (!this.isFullControlActive()) {
      throw new Error(
        'El gestor de consolas/demonios persistentes requiere activar "Modo Control Total / Consola Persistente" en el panel local (/admin → Workspaces & Operator).'
      );
    }
  }

  #pruneOldExited() {
    if (this.processes.size <= MAX_STORED_PROCESSES) return;
    const exited = Array.from(this.processes.values())
      .filter((p) => p.status !== 'running')
      .sort((a, b) => Date.parse(a.endedAt || a.startedAt) - Date.parse(b.endedAt || b.startedAt));
    for (const rec of exited) {
      if (this.processes.size <= MAX_STORED_PROCESSES) break;
      this.processes.delete(rec.id);
    }
  }

  #appendOutput(rec, streamName, chunk) {
    const text = chunk.toString('utf8');
    if (!text) return;
    const prefix = streamName === 'stderr' ? '[stderr] ' : '';
    const piece = prefix ? `${prefix}${text}` : text;
    rec.output += piece;
    rec.totalChars += piece.length;
    if (rec.output.length > MAX_OUTPUT_CHARS) {
      const dropped = rec.output.length - MAX_OUTPUT_CHARS;
      rec.output = rec.output.slice(dropped);
      rec.baseOffset += dropped;
    }
    rec.lastOutputAt = new Date().toISOString();
  }

  #summarize(rec, { tailLines = 6 } = {}) {
    const allLines = rec.output ? rec.output.replace(/\r\n/g, '\n').split('\n') : [];
    const nonEmptyTail = allLines.slice(-Math.max(1, tailLines)).join('\n');
    const startedMs = Date.parse(rec.startedAt);
    const endedMs = rec.endedAt ? Date.parse(rec.endedAt) : Date.now();
    return {
      id: rec.id,
      name: rec.name,
      command: rec.command,
      cwd: rec.cwd,
      pid: rec.pid,
      status: rec.status,
      exitCode: rec.exitCode,
      sessionKey: rec.sessionKey,
      clientLabel: rec.clientLabel,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      lastOutputAt: rec.lastOutputAt,
      uptimeSec: Math.max(0, Math.floor((endedMs - startedMs) / 1000)),
      outputOffset: rec.baseOffset + rec.output.length,
      tailPreview: nonEmptyTail
    };
  }

  async startProcess({
    command,
    cwd,
    name,
    waitMs = 800,
    harness,
    sessionKey = 'local',
    clientLabel = 'Panel Local',
    bypassGate = false
  } = {}) {
    if (!bypassGate) {
      this.#assertFullControlAllowed();
    }
    if (!command || typeof command !== 'string' || !command.trim()) {
      throw new Error('Debes indicar el comando a ejecutar.');
    }

    const runningCount = Array.from(this.processes.values()).filter((p) => p.status === 'running').length;
    if (runningCount >= MAX_RUNNING_PROCESSES) {
      throw new Error(`Límite alcanzado: hay ${runningCount} procesos en segundo plano activos. Detén alguno con process_stop o desde /admin.`);
    }

    const fc = this.getFullControlConfig();
    let resolvedCwd;
    if (bypassGate || (fc.allowUnrestrictedCwd && cwd && path.isAbsolute(String(cwd)))) {
      const target = cwd ? path.resolve(String(cwd)) : (harness ? harness.getActiveRoot() : this.configManager.get().activeWorkspace);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new Error(`La carpeta de trabajo no existe: ${target}`);
      }
      resolvedCwd = fs.realpathSync(target);
    } else if (harness) {
      const safe = harness.resolveSafePath(cwd || '.', { mustExist: true });
      if (!fs.statSync(safe.fullPath).isDirectory()) {
        throw new Error(`La ruta cwd no es una carpeta: ${safe.relPath}`);
      }
      resolvedCwd = safe.fullPath;
    } else {
      resolvedCwd = fs.realpathSync(this.configManager.get().activeWorkspace);
    }

    const id = `proc_${crypto.randomBytes(4).toString('hex')}`;
    const labelName = String(name || command.trim().split(/\s+/).slice(0, 3).join(' ')).slice(0, 48);
    const shellExe = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32'
      ? ['-NoProfile', '-NoLogo', '-Command', command]
      : ['-lc', command];

    const child = spawn(shellExe, shellArgs, {
      cwd: resolvedCwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildSanitizedShellEnv(process.env, this.configManager?.get?.().permissions)
    });

    const rec = {
      id,
      name: labelName,
      command: command.trim(),
      cwd: resolvedCwd,
      pid: child.pid || null,
      child,
      status: 'running',
      exitCode: null,
      sessionKey: String(sessionKey || 'default'),
      clientLabel: String(clientLabel || 'MCP'),
      startedAt: new Date().toISOString(),
      endedAt: null,
      lastOutputAt: null,
      output: '',
      baseOffset: 0,
      totalChars: 0
    };

    this.processes.set(id, rec);
    this.#pruneOldExited();

    child.stdout?.on('data', (chunk) => this.#appendOutput(rec, 'stdout', chunk));
    child.stderr?.on('data', (chunk) => this.#appendOutput(rec, 'stderr', chunk));
    child.on('error', (err) => {
      this.#appendOutput(rec, 'stderr', `Spawn error: ${err.message}\n`);
      rec.status = 'exited';
      rec.exitCode = -1;
      rec.endedAt = new Date().toISOString();
      this.onStateChange();
    });
    child.on('close', (code) => {
      rec.status = 'exited';
      rec.exitCode = code;
      rec.endedAt = new Date().toISOString();
      this.logger('info', 'daemon', `[${rec.clientLabel}] Proceso ${rec.id} (${rec.name}) terminó con código ${code}`);
      this.onStateChange();
    });

    this.logger('ok', 'daemon', `[${rec.clientLabel}] Proceso iniciado: ${rec.id} (PID ${rec.pid || '?'}) — ${rec.name}`);
    this.onStateChange();

    const waitDuration = Math.max(0, Math.min(Number(waitMs) || 0, 10000));
    if (waitDuration > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, waitDuration);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    return this.#summarize(rec, { tailLines: 25 });
  }

  listProcesses({ includeExited = true } = {}) {
    const list = Array.from(this.processes.values())
      .filter((p) => includeExited || p.status === 'running')
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .map((p) => this.#summarize(p, { tailLines: 4 }));

    return {
      fullControl: this.getFullControlConfig(),
      runningCount: list.filter((x) => x.status === 'running').length,
      totalCount: list.length,
      processes: list
    };
  }

  readProcessOutput({ id, tailLines = 80, fromOffset } = {}) {
    const rec = this.processes.get(String(id || '').trim());
    if (!rec) {
      throw new Error(`Proceso no encontrado: ${id}`);
    }

    const currentEndOffset = rec.baseOffset + rec.output.length;
    let output;
    let truncated = false;

    if (fromOffset !== undefined && Number.isFinite(Number(fromOffset))) {
      const reqOff = Math.max(0, Math.floor(Number(fromOffset)));
      if (reqOff < rec.baseOffset) {
        truncated = true;
        output = rec.output;
      } else {
        output = rec.output.slice(reqOff - rec.baseOffset);
      }
    } else {
      const lines = rec.output ? rec.output.replace(/\r\n/g, '\n').split('\n') : [];
      const limit = Math.max(1, Math.min(Number(tailLines) || 80, 500));
      truncated = lines.length > limit;
      output = lines.slice(-limit).join('\n');
    }

    return {
      id: rec.id,
      name: rec.name,
      pid: rec.pid,
      status: rec.status,
      exitCode: rec.exitCode,
      cwd: rec.cwd,
      nextOffset: currentEndOffset,
      truncated,
      output
    };
  }

  async sendProcessInput({ id, input, appendNewline = true, waitMs = 400, bypassGate = false } = {}) {
    if (!bypassGate) {
      this.#assertFullControlAllowed();
    }
    const rec = this.processes.get(String(id || '').trim());
    if (!rec) {
      throw new Error(`Proceso no encontrado: ${id}`);
    }
    if (rec.status !== 'running' || !rec.child?.stdin || rec.child.stdin.destroyed || !rec.child.stdin.writable) {
      throw new Error(`El proceso ${rec.id} no está corriendo o su stdin está cerrado (estado: ${rec.status}).`);
    }

    const beforeOffset = rec.baseOffset + rec.output.length;
    const text = String(input ?? '');
    const payload = appendNewline ? `${text}\n` : text;
    rec.child.stdin.write(payload, 'utf8');

    const waitDuration = Math.max(0, Math.min(Number(waitMs) || 0, 5000));
    if (waitDuration > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitDuration));
    }

    return this.readProcessOutput({ id: rec.id, fromOffset: beforeOffset });
  }

  async stopProcess({ id, bypassGate = false } = {}) {
    if (!bypassGate) {
      this.#assertFullControlAllowed();
    }
    const rec = this.processes.get(String(id || '').trim());
    if (!rec) {
      throw new Error(`Proceso no encontrado: ${id}`);
    }
    if (rec.status === 'running') {
      await killProcessTree(rec.pid, rec.child);
      rec.status = 'exited';
      if (rec.exitCode === null) rec.exitCode = -1;
      if (!rec.endedAt) rec.endedAt = new Date().toISOString();
      this.logger('warn', 'daemon', `Proceso detenido: ${rec.id} (PID ${rec.pid || '?'}) — ${rec.name}`);
      this.onStateChange();
    }
    return this.#summarize(rec, { tailLines: 10 });
  }

  clearExited() {
    let removed = 0;
    for (const [id, rec] of Array.from(this.processes.entries())) {
      if (rec.status !== 'running') {
        this.processes.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.onStateChange();
    return removed;
  }

  async stopAll({ reason = 'manual' } = {}) {
    const running = Array.from(this.processes.values()).filter((p) => p.status === 'running');
    await Promise.allSettled(
      running.map(async (rec) => {
        await killProcessTree(rec.pid, rec.child);
        rec.status = 'exited';
        if (rec.exitCode === null) rec.exitCode = -1;
        if (!rec.endedAt) rec.endedAt = new Date().toISOString();
      })
    );
    if (running.length > 0) {
      this.logger('warn', 'daemon', `Se detuvieron ${running.length} proceso(s) persistente(s) (${reason}).`);
      this.onStateChange();
    }
    return running.length;
  }

  async shutdown() {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    await this.stopAll({ reason: 'shutdown' });
  }

  getState() {
    return this.listProcesses({ includeExited: true });
  }
}
