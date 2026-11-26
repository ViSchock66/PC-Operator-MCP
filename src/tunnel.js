import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TAILSCALE_CANDIDATES = [
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
  'tailscale'
];

const CLOUDFLARED_CANDIDATES = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'cloudflared'
];

async function findExecutable(envVar, candidates) {
  if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar])) {
    return process.env[envVar];
  }
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(cmd, [candidate], { timeout: 3000, windowsHide: true });
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
    } catch {
      // Not in PATH.
    }
  }
  return null;
}

/**
 * Manages tunnel lifecycle (Tailscale Funnel, Cloudflare Named/Quick, or Local-only) and live daemon logs.
 */
export class TunnelManager {
  constructor({ configManager }) {
    this.configManager = configManager;
    this.runtimeFile = path.join(configManager.dataDir, 'runtime.json');
    this.processStartedAt = Date.now();
    this.status = 'stopped';
    this.mode = configManager.get().tunnel?.mode || 'tailscale';
    this.activeUrl = null;
    this.actionUrl = null;
    this.lastError = null;
    this.startedAt = null;
    this.cfProcess = null;
    this.tailscaleFunnelManaged = false;
    this.nextLogId = 1;
    this.logs = [];
    this.subscribers = new Set();
    this.envCache = null;
    this.opLock = Promise.resolve();
  }

  log(level, source, message) {
    const entry = {
      id: this.nextLogId++,
      ts: new Date().toISOString(),
      level,
      source,
      message: String(message ?? '').trimEnd()
    };
    if (!entry.message) return;
    this.logs.push(entry);
    if (this.logs.length > 300) {
      this.logs.splice(0, this.logs.length - 300);
    }
    this.#emit({ type: 'log', entry });
  }

  clearLogs() {
    this.logs = [];
    this.#emit({ type: 'logs_cleared' });
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  #emit(event) {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // Ignore broken SSE listeners.
      }
    }
  }

  #emitState() {
    this.#emit({ type: 'state', state: this.getState() });
  }

  notifyStateChange() {
    this.#emitState();
  }

  #writeRuntimeInfo(tunnelUrl) {
    const cfg = this.configManager.get();
    const localMcpUrl = `http://${cfg.host}:${cfg.port}/mcp`;
    const localGeminiMcpUrl = `${localMcpUrl}/gemini`;
    const mcpUrl = tunnelUrl ? `${tunnelUrl}/mcp` : localMcpUrl;
    const geminiMcpUrl = tunnelUrl ? `${tunnelUrl}/mcp/gemini` : localGeminiMcpUrl;
    fs.writeFileSync(
      this.runtimeFile,
      JSON.stringify(
        {
          pid: process.pid,
          mode: this.mode,
          tunnelUrl: tunnelUrl || null,
          mcpUrl,
          geminiMcpUrl,
          localMcpUrl,
          localGeminiMcpUrl,
          adminUrl: `http://${cfg.host}:${cfg.port}/admin`,
          startedAt: this.startedAt || new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    );
  }

  async inspectEnvironment() {
    const tailscaleBin = await findExecutable('TAILSCALE_PATH', TAILSCALE_CANDIDATES);
    const cloudflaredBin = await findExecutable('CLOUDFLARED_PATH', CLOUDFLARED_CANDIDATES);

    const tailscale = {
      installed: Boolean(tailscaleBin),
      binaryPath: tailscaleBin,
      online: false,
      dnsName: '',
      suggestedUrl: '',
      tailnetIp: '',
      magicDnsSuffix: '',
      funnelActive: false,
      error: null
    };

    if (tailscaleBin) {
      try {
        const { stdout } = await execFileAsync(tailscaleBin, ['status', '--json'], {
          timeout: 6000,
          windowsHide: true
        });
        const parsed = JSON.parse(stdout);
        const dnsName = String(parsed?.Self?.DNSName || '').replace(/\.$/, '');
        tailscale.online = Boolean(parsed?.Self?.Online);
        tailscale.dnsName = dnsName;
        tailscale.suggestedUrl = dnsName ? `https://${dnsName}` : '';
        tailscale.tailnetIp = Array.isArray(parsed?.Self?.TailscaleIPs) ? (parsed.Self.TailscaleIPs[0] || '') : '';
        tailscale.magicDnsSuffix = String(parsed?.MagicDNSSuffix || '');
      } catch (err) {
        tailscale.error = err instanceof Error ? err.message : String(err);
      }

      try {
        const { stdout } = await execFileAsync(tailscaleBin, ['funnel', 'status', '--json'], {
          timeout: 5000,
          windowsHide: true
        });
        const funnelJson = JSON.parse(stdout || '{}');
        tailscale.funnelActive = Boolean(funnelJson && Object.keys(funnelJson).length > 0);
      } catch {
        tailscale.funnelActive = false;
      }
    }

    this.envCache = {
      tailscale,
      cloudflared: {
        installed: Boolean(cloudflaredBin),
        binaryPath: cloudflaredBin
      }
    };
    return this.envCache;
  }

  getActiveTunnelUrl() {
    if (this.status === 'running' && this.activeUrl) {
      return this.activeUrl;
    }
    const cfgUrl = this.configManager.get().tunnel?.publicUrl;
    if (this.status === 'running' && this.mode !== 'local' && cfgUrl) {
      return cfgUrl;
    }
    return null;
  }

  getState() {
    const cfg = this.configManager.get();
    const localMcpUrl = `http://${cfg.host}:${cfg.port}/mcp`;
    const localGeminiMcpUrl = `${localMcpUrl}/gemini`;
    const activeUrl = this.getActiveTunnelUrl();
    const configuredUrl = cfg.tunnel?.publicUrl || '';
    const displayUrl = activeUrl || (this.mode !== 'local' ? configuredUrl : '');
    return {
      pid: process.pid,
      uptimeSec: Math.floor((Date.now() - this.processStartedAt) / 1000),
      status: this.status,
      mode: this.mode,
      activeUrl,
      configuredUrl,
      mcpUrl: displayUrl ? `${displayUrl}/mcp` : localMcpUrl,
      geminiMcpUrl: displayUrl ? `${displayUrl}/mcp/gemini` : localGeminiMcpUrl,
      localMcpUrl,
      localGeminiMcpUrl,
      adminUrl: `http://${cfg.host}:${cfg.port}/admin`,
      actionUrl: this.actionUrl,
      lastError: this.lastError,
      startedAt: this.startedAt,
      env: this.envCache,
      logs: this.logs
    };
  }

  async #enqueue(task) {
    const run = this.opLock.then(task, task);
    this.opLock = run.catch(() => {});
    return run;
  }

  async start() {
    return this.#enqueue(async () => {
      await this.#stopInternal({ quiet: true });

      const cfg = this.configManager.get();
      const t = cfg.tunnel || {};
      this.mode = t.mode || 'tailscale';
      this.status = 'starting';
      this.lastError = null;
      this.actionUrl = null;
      this.activeUrl = null;
      this.#emitState();

      if (this.mode === 'local') {
        this.status = 'running';
        this.startedAt = new Date().toISOString();
        this.#writeRuntimeInfo(null);
        this.log('info', 'tunnel', `Modo solo local activo en http://${cfg.host}:${cfg.port}/mcp`);
        this.#emitState();
        return this.getState();
      }

      if (this.mode === 'tailscale') {
        return this.#startTailscale(cfg);
      }

      if (this.mode === 'cloudflare-named') {
        return this.#startCloudflareNamed(cfg);
      }

      return this.#startCloudflareQuick(cfg);
    });
  }

  async #startTailscale(cfg) {
    const env = await this.inspectEnvironment();
    const ts = env.tailscale;
    if (!ts.installed || !ts.binaryPath) {
      this.status = 'error';
      this.lastError = 'Tailscale no está instalado en este equipo.';
      this.log('error', 'tailscale', this.lastError);
      this.#emitState();
      return this.getState();
    }
    if (!ts.online || !ts.suggestedUrl) {
      this.status = 'error';
      this.lastError = 'Tailscale está desconectado o sin DNS asignado. Inicia sesión en Tailscale primero.';
      this.log('error', 'tailscale', this.lastError);
      this.#emitState();
      return this.getState();
    }

    const effectiveUrl = cfg.tunnel?.publicUrl || ts.suggestedUrl;
    if (!cfg.tunnel?.publicUrl && ts.suggestedUrl) {
      this.configManager.updateTunnelConfig({ publicUrl: ts.suggestedUrl });
      this.log('info', 'tailscale', `Dominio fijo autodetectado: ${ts.suggestedUrl}`);
    }

    this.log('info', 'tailscale', `Activando Tailscale Funnel hacia http://${cfg.host}:${cfg.port} ...`);
    try {
      const { stdout, stderr } = await execFileAsync(
        ts.binaryPath,
        ['funnel', '--bg', '--yes', `http://${cfg.host}:${cfg.port}`],
        { timeout: 15000, windowsHide: true }
      );
      const combined = `${stdout || ''}\n${stderr || ''}`.trim();
      if (combined) {
        for (const line of combined.split(/\r?\n/)) {
          if (line.trim()) this.log('info', 'tailscale', line);
        }
      }
      const actionMatch = combined.match(/https:\/\/login\.tailscale\.com\/[^\s]+/i);
      if (actionMatch) {
        this.status = 'needs_action';
        this.actionUrl = actionMatch[0];
        this.lastError = 'Falta habilitar Funnel en tu tailnet. Abre el enlace de Tailscale, actívalo y pulsa Reiniciar Túnel.';
        this.#emitState();
        return this.getState();
      }

      this.tailscaleFunnelManaged = true;
      this.status = 'running';
      this.activeUrl = effectiveUrl;
      this.startedAt = new Date().toISOString();
      await this.inspectEnvironment();
      this.#writeRuntimeInfo(this.activeUrl);
      this.log('ok', 'tailscale', `URLs fijas listas: ${this.activeUrl}/mcp (general) | ${this.activeUrl}/mcp/gemini (Gemini)`);
      this.#emitState();
      return this.getState();
    } catch (err) {
      const out = `${err?.stdout || ''}\n${err?.stderr || ''}\n${err?.message || ''}`.trim();
      const actionMatch = out.match(/https:\/\/login\.tailscale\.com\/[^\s]+/i);
      if (actionMatch) {
        this.status = 'needs_action';
        this.actionUrl = actionMatch[0];
        this.lastError = 'Tailscale requiere habilitar Funnel/HTTPS en tu tailnet desde el enlace.';
        this.log('warn', 'tailscale', `${this.lastError} -> ${this.actionUrl}`);
      } else {
        this.status = 'error';
        this.lastError = out || 'Error al iniciar Tailscale Funnel.';
        this.log('error', 'tailscale', this.lastError);
      }
      this.#emitState();
      return this.getState();
    }
  }

  async #startCloudflareNamed(cfg) {
    const env = await this.inspectEnvironment();
    const exe = env.cloudflared.binaryPath;
    if (!exe) {
      this.status = 'error';
      this.lastError = 'No se encontró cloudflared.exe en el equipo.';
      this.log('error', 'cloudflared', this.lastError);
      this.#emitState();
      return this.getState();
    }
    const token = String(cfg.tunnel?.cloudflareToken || '').trim();
    if (!token) {
      this.status = 'error';
      this.lastError = 'Falta el Cloudflare Tunnel Token en Dominio & Parámetros.';
      this.log('error', 'cloudflared', this.lastError);
      this.#emitState();
      return this.getState();
    }
    const domainUrl = cfg.tunnel?.customDomain || cfg.tunnel?.publicUrl || '';
    if (domainUrl && cfg.tunnel?.publicUrl !== domainUrl) {
      this.configManager.updateTunnelConfig({ publicUrl: domainUrl });
    }

    this.log('info', 'cloudflared', 'Iniciando Cloudflare Named Tunnel...');
    this.#spawnCloudflared(exe, ['tunnel', '--no-autoupdate', 'run', '--token', token], {
      fixedUrl: domainUrl || null
    });
    this.status = 'running';
    this.activeUrl = domainUrl || null;
    this.startedAt = new Date().toISOString();
    this.#writeRuntimeInfo(this.activeUrl);
    if (this.activeUrl) {
      this.log('ok', 'cloudflared', `URLs fijas listas: ${this.activeUrl}/mcp (general) | ${this.activeUrl}/mcp/gemini (Gemini)`);
    }
    this.#emitState();
    return this.getState();
  }

  async #startCloudflareQuick(cfg) {
    const env = await this.inspectEnvironment();
    const exe = env.cloudflared.binaryPath;
    if (!exe) {
      this.status = 'error';
      this.lastError = 'No se encontró cloudflared.exe en el equipo.';
      this.log('error', 'cloudflared', this.lastError);
      this.#emitState();
      return this.getState();
    }

    this.log('info', 'cloudflared', `Iniciando Quick Tunnel temporal hacia http://${cfg.host}:${cfg.port} ...`);
    this.#spawnCloudflared(exe, ['tunnel', '--no-autoupdate', '--url', `http://${cfg.host}:${cfg.port}`], {
      fixedUrl: null
    });
    this.#emitState();
    return this.getState();
  }

  #spawnCloudflared(exe, args, { fixedUrl }) {
    const proc = spawn(exe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.cfProcess = proc;
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

    const handleChunk = (chunk) => {
      const text = chunk.toString('utf8');
      if (!fixedUrl && !this.activeUrl) {
        const match = text.match(urlRegex);
        if (match) {
          this.activeUrl = match[0];
          this.status = 'running';
          this.startedAt = new Date().toISOString();
          this.#writeRuntimeInfo(this.activeUrl);
          this.log('ok', 'cloudflared', `Quick Tunnel activo: ${this.activeUrl}/mcp | Gemini: ${this.activeUrl}/mcp/gemini`);
          this.#emitState();
        }
      }
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().includes('error') || trimmed.toLowerCase().includes('failed')) {
          this.log('warn', 'cloudflared', trimmed);
        }
      }
    };

    proc.stdout.on('data', handleChunk);
    proc.stderr.on('data', handleChunk);
    proc.on('error', (err) => {
      if (this.cfProcess !== proc) return;
      this.status = 'error';
      this.lastError = err.message;
      this.log('error', 'cloudflared', `Error al ejecutar cloudflared: ${err.message}`);
      this.#emitState();
    });
    proc.on('close', (code) => {
      if (this.cfProcess !== proc) return;
      this.cfProcess = null;
      if (this.status !== 'stopped') {
        this.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) {
          this.lastError = `cloudflared finalizó con código ${code}.`;
        }
        this.activeUrl = null;
        this.log('warn', 'cloudflared', `Túnel cerrado (código ${code ?? 'null'}).`);
        this.#emitState();
      }
    });
  }

  async #stopInternal({ quiet = false } = {}) {
    if (this.cfProcess) {
      const proc = this.cfProcess;
      this.cfProcess = null;
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        proc.once('close', done);
        proc.kill();
        setTimeout(done, 1500);
      });
    }

    if (this.tailscaleFunnelManaged || this.mode === 'tailscale') {
      const env = this.envCache || (await this.inspectEnvironment());
      if (env.tailscale.installed && env.tailscale.binaryPath && (this.tailscaleFunnelManaged || env.tailscale.funnelActive)) {
        try {
          await execFileAsync(env.tailscale.binaryPath, ['funnel', 'reset'], {
            timeout: 8000,
            windowsHide: true
          });
          if (!quiet) {
            this.log('info', 'tailscale', 'Tailscale Funnel desactivado (reset).');
          }
        } catch (err) {
          if (!quiet) {
            this.log('warn', 'tailscale', `No se pudo resetear Funnel: ${err.message}`);
          }
        }
      }
      this.tailscaleFunnelManaged = false;
    }

    this.status = 'stopped';
    this.activeUrl = null;
    this.actionUrl = null;
    this.startedAt = null;
    if (!quiet) {
      this.log('info', 'tunnel', 'Túnel detenido.');
    }
    this.#emitState();
  }

  async stop() {
    return this.#enqueue(() => this.#stopInternal({ quiet: false }));
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}
