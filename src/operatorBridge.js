import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DEFAULT_CALL_TIMEOUT_MS = 45000;
const DEFAULT_IDLE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_MAX_SESSIONS = 12;

/**
 * Bridges gemini-pc-mcp with a dedicated local antigravity-operator MCP stdio process.
 * Each OperatorBridge gets its own SESSION_ID in pipe-broker.mjs, its own ownedTabs,
 * and its own PlaywrightFallbackEngine instance so parallel LLM clients never collide.
 */
export class OperatorBridge {
  constructor({
    configManager,
    logger,
    sessionKey = 'default',
    clientLabel = 'Default',
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    extraEnv = null
  } = {}) {
    this.configManager = configManager;
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.sessionKey = String(sessionKey || 'default');
    this.clientLabel = String(clientLabel || sessionKey || 'MCP');
    this.callTimeoutMs = Number.isFinite(callTimeoutMs) ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS;
    this.extraEnv = extraEnv && typeof extraEnv === 'object' ? { ...extraEnv } : null;

    this.client = null;
    this.transport = null;
    this.connectPromise = null;
    this.cachedTools = [];
    this.status = 'standby'; // disabled | missing | standby | connecting | connected | error
    this.lastError = null;
    this.connectedAt = null;
    this.lastUsedAt = null;
    this.activeCalls = 0;
    this.totalCalls = 0;
  }

  getConfig() {
    return this.configManager.get().operator || { enabled: false, serverPath: '' };
  }

  isEnabled() {
    const cfg = this.getConfig();
    return Boolean(cfg.enabled && cfg.serverPath && fs.existsSync(cfg.serverPath));
  }

  getState() {
    const cfg = this.getConfig();
    const exists = Boolean(cfg.serverPath && fs.existsSync(cfg.serverPath));
    let effectiveStatus = this.status;
    if (!cfg.enabled) {
      effectiveStatus = 'disabled';
    } else if (!exists) {
      effectiveStatus = 'missing';
    }

    return {
      sessionKey: this.sessionKey,
      clientLabel: this.clientLabel,
      enabled: Boolean(cfg.enabled),
      exists,
      serverPath: cfg.serverPath || '',
      status: effectiveStatus,
      pid: this.transport?.pid || null,
      toolCount: this.cachedTools.length,
      tools: this.cachedTools.map((t) => ({ name: t.name, description: t.description || '' })),
      connectedAt: this.connectedAt,
      lastUsedAt: this.lastUsedAt,
      activeCalls: this.activeCalls,
      totalCalls: this.totalCalls,
      lastError: this.lastError
    };
  }

  async ensureConnected() {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.status = 'disabled';
      return null;
    }
    if (!cfg.serverPath || !fs.existsSync(cfg.serverPath)) {
      this.status = 'missing';
      this.lastError = `No se encontró el servidor de operador en: ${cfg.serverPath || '(vacío)'}`;
      return null;
    }

    if (this.client && this.transport && this.status === 'connected') {
      return this.client;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      await this.#disconnectInternal();
      this.status = 'connecting';
      this.lastError = null;

      try {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [cfg.serverPath],
          cwd: path.dirname(cfg.serverPath),
          stderr: 'pipe',
          env: {
            ...process.env,
            ...(this.extraEnv || {}),
            AG_OPERATOR_CLIENT_LABEL: this.clientLabel,
            AG_OPERATOR_SESSION_KEY: this.sessionKey
          }
        });

        if (transport.stderr) {
          transport.stderr.on('data', (chunk) => {
            const text = String(chunk || '').trim();
            if (text) {
              this.logger('info', 'operator', `[${this.clientLabel}] ${text}`);
            }
          });
        }

        transport.onclose = () => {
          if (this.transport === transport) {
            this.client = null;
            this.transport = null;
            this.connectedAt = null;
            this.status = this.getConfig().enabled ? 'standby' : 'disabled';
          }
        };

        transport.onerror = (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.logger('warn', 'operator', `[${this.clientLabel}] Error de transporte stdio: ${this.lastError}`);
        };

        const client = new Client(
          { name: `gemini-pc-mcp-federator:${this.clientLabel}`, version: '0.3.0' },
          { capabilities: {} }
        );

        await client.connect(transport);
        const listRes = await client.listTools();

        this.transport = transport;
        this.client = client;
        this.cachedTools = Array.isArray(listRes?.tools) ? listRes.tools : [];
        this.status = 'connected';
        this.connectedAt = new Date().toISOString();
        this.lastUsedAt = this.connectedAt;
        this.lastError = null;

        this.logger(
          'ok',
          'operator',
          `[${this.clientLabel}] Antigravity Operator aislado conectado (${this.cachedTools.length} tools, PID ${transport.pid || '?'})`
        );
        return client;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.status = 'error';
        this.logger('error', 'operator', `[${this.clientLabel}] No se pudo iniciar Antigravity Operator: ${this.lastError}`);
        await this.#disconnectInternal();
        throw err;
      }
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async getTools() {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.serverPath || !fs.existsSync(cfg.serverPath)) {
      return [];
    }
    if (this.cachedTools.length > 0 && (this.status === 'connected' || this.status === 'standby')) {
      return this.cachedTools;
    }
    try {
      await this.ensureConnected();
      return this.cachedTools;
    } catch {
      return this.cachedTools;
    }
  }

  async callTool(name, args = {}, options = {}) {
    this.lastUsedAt = new Date().toISOString();
    const client = await this.ensureConnected();
    if (!client) {
      throw new Error(this.lastError || 'Antigravity Operator está deshabilitado o no disponible.');
    }

    const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.callTimeoutMs;
    this.activeCalls += 1;
    this.totalCalls += 1;
    try {
      return await client.callTool(
        {
          name,
          arguments: args && typeof args === 'object' ? args : {}
        },
        undefined,
        { timeout }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      // If the child transport broke or timed out badly, drop only this client's bridge so the next call recovers cleanly
      // without touching any other parallel client's bridge.
      if (/closed|EPIPE|broken pipe|not connected|timeout/i.test(msg)) {
        this.logger('warn', 'operator', `[${this.clientLabel}] Reiniciando bridge aislado tras error en ${name}: ${msg}`);
        await this.#disconnectInternal().catch(() => {});
        this.status = this.getConfig().enabled ? 'standby' : 'disabled';
      }
      throw err;
    } finally {
      this.activeCalls = Math.max(0, this.activeCalls - 1);
      this.lastUsedAt = new Date().toISOString();
    }
  }

  async #disconnectInternal() {
    const oldClient = this.client;
    const oldTransport = this.transport;
    this.client = null;
    this.transport = null;
    this.connectedAt = null;
    if (oldClient) {
      await oldClient.close().catch(() => {});
    }
    if (oldTransport) {
      await oldTransport.close().catch(() => {});
    }
  }

  async stop() {
    await this.#disconnectInternal();
    this.status = this.getConfig().enabled ? 'standby' : 'disabled';
  }

  async restart() {
    this.cachedTools = [];
    await this.#disconnectInternal();
    if (!this.getConfig().enabled) {
      this.status = 'disabled';
      return this.getState();
    }
    await this.ensureConnected();
    return this.getState();
  }
}

/**
 * Pool of isolated OperatorBridge instances keyed by client sessionKey (Claude, Gemini, ChatGPT, API Keys).
 * Guarantees zero tab/Playwright/process interference across parallel LLM sessions while caching tool schemas.
 */
export class OperatorBridgePool {
  constructor({
    configManager,
    logger,
    idleTtlMs = DEFAULT_IDLE_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    extraEnv = null
  } = {}) {
    this.configManager = configManager;
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.idleTtlMs = Number.isFinite(idleTtlMs) ? idleTtlMs : DEFAULT_IDLE_TTL_MS;
    this.maxSessions = Math.max(1, Number(maxSessions) || DEFAULT_MAX_SESSIONS);
    this.callTimeoutMs = Number.isFinite(callTimeoutMs) ? callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS;
    this.extraEnv = extraEnv && typeof extraEnv === 'object' ? { ...extraEnv } : null;

    this.bridges = new Map(); // sessionKey -> OperatorBridge
    this.cachedTools = [];
    this.cachedServerPath = '';
    this.catalogPromise = null;
    this.lastError = null;

    this.reapTimer = setInterval(() => {
      this.reapIdleSessions().catch(() => {});
    }, Math.min(60000, Math.max(5000, Math.floor(this.idleTtlMs / 2))));
    this.reapTimer.unref();
  }

  getConfig() {
    return this.configManager.get().operator || { enabled: false, serverPath: '' };
  }

  isEnabled() {
    const cfg = this.getConfig();
    return Boolean(cfg.enabled && cfg.serverPath && fs.existsSync(cfg.serverPath));
  }

  #getOrCreateBridge(sessionKey = 'default', clientLabel = 'Default') {
    const key = String(sessionKey || 'default');
    let bridge = this.bridges.get(key);
    if (bridge) {
      if (clientLabel && clientLabel !== 'MCP') {
        bridge.clientLabel = String(clientLabel);
      }
      return bridge;
    }

    if (this.bridges.size >= this.maxSessions) {
      // Evict the oldest idle bridge (never evict a bridge with activeCalls > 0).
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, b] of this.bridges.entries()) {
        if (b.activeCalls > 0) continue;
        const ts = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
        if (ts < oldestTime) {
          oldestTime = ts;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const evicted = this.bridges.get(oldestKey);
        this.bridges.delete(oldestKey);
        evicted?.stop().catch(() => {});
      }
    }

    bridge = new OperatorBridge({
      configManager: this.configManager,
      logger: this.logger,
      sessionKey: key,
      clientLabel: clientLabel || key,
      callTimeoutMs: this.callTimeoutMs,
      extraEnv: this.extraEnv
    });
    if (this.cachedTools.length > 0 && this.cachedServerPath === this.getConfig().serverPath) {
      bridge.cachedTools = this.cachedTools;
    }
    this.bridges.set(key, bridge);
    return bridge;
  }

  async getTools(sessionKey, clientLabel) {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.serverPath || !fs.existsSync(cfg.serverPath)) {
      return [];
    }
    if (this.cachedTools.length > 0 && this.cachedServerPath === cfg.serverPath) {
      return this.cachedTools;
    }

    if (this.catalogPromise) {
      return this.catalogPromise;
    }

    this.catalogPromise = (async () => {
      // Reuse any already-connected bridge first, or probe via the requesting client's bridge.
      for (const existing of this.bridges.values()) {
        if (existing.cachedTools.length > 0) {
          this.cachedTools = existing.cachedTools;
          this.cachedServerPath = cfg.serverPath;
          return this.cachedTools;
        }
      }

      const probeKey = sessionKey || '__catalog__';
      const bridge = sessionKey
        ? this.#getOrCreateBridge(probeKey, clientLabel || 'MCP')
        : new OperatorBridge({
            configManager: this.configManager,
            logger: this.logger,
            sessionKey: probeKey,
            clientLabel: 'Catalog',
            callTimeoutMs: this.callTimeoutMs,
            extraEnv: this.extraEnv
          });

      try {
        const tools = await bridge.getTools();
        if (tools.length > 0) {
          this.cachedTools = tools;
          this.cachedServerPath = cfg.serverPath;
          this.lastError = null;
        }
        return this.cachedTools;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        return this.cachedTools;
      } finally {
        if (!sessionKey) {
          await bridge.stop().catch(() => {});
        }
      }
    })();

    try {
      return await this.catalogPromise;
    } finally {
      this.catalogPromise = null;
    }
  }

  forClient(sessionKey = 'default', clientLabel = 'MCP') {
    const key = String(sessionKey || 'default');
    const label = String(clientLabel || key);
    return {
      sessionKey: key,
      clientLabel: label,
      getTools: () => this.getTools(key, label),
      callTool: (name, args, options) => this.callToolForClient(key, label, name, args, options),
      getState: () => this.#getOrCreateBridge(key, label).getState()
    };
  }

  async callTool(name, args = {}, options = {}) {
    return this.callToolForClient('default', 'Default', name, args, options);
  }

  async callToolForClient(sessionKey, clientLabel, name, args = {}, options = {}) {
    const bridge = this.#getOrCreateBridge(sessionKey, clientLabel);
    const result = await bridge.callTool(name, args, options);
    if (bridge.cachedTools.length > 0) {
      this.cachedTools = bridge.cachedTools;
      this.cachedServerPath = this.getConfig().serverPath || '';
    }
    return result;
  }

  async reapIdleSessions() {
    if (this.idleTtlMs <= 0) return;
    const now = Date.now();
    for (const [key, bridge] of Array.from(this.bridges.entries())) {
      if (bridge.activeCalls > 0) continue;
      if (bridge.status !== 'connected') continue;
      const last = bridge.lastUsedAt ? Date.parse(bridge.lastUsedAt) : 0;
      if (last > 0 && now - last > this.idleTtlMs) {
        this.logger('info', 'operator', `[${bridge.clientLabel}] Cerrando bridge aislado por inactividad.`);
        await bridge.stop().catch(() => {});
        this.bridges.delete(key);
      }
    }
  }

  getState() {
    const cfg = this.getConfig();
    const exists = Boolean(cfg.serverPath && fs.existsSync(cfg.serverPath));
    const sessions = Array.from(this.bridges.values()).map((b) => {
      const s = b.getState();
      return {
        sessionKey: s.sessionKey,
        clientLabel: s.clientLabel,
        status: s.status,
        pid: s.pid,
        connectedAt: s.connectedAt,
        lastUsedAt: s.lastUsedAt,
        activeCalls: s.activeCalls,
        totalCalls: s.totalCalls,
        lastError: s.lastError
      };
    });

    const connectedSessions = sessions.filter((s) => s.status === 'connected');
    let effectiveStatus = 'standby';
    if (!cfg.enabled) {
      effectiveStatus = 'disabled';
    } else if (!exists) {
      effectiveStatus = 'missing';
    } else if (connectedSessions.length > 0) {
      effectiveStatus = 'connected';
    } else if (sessions.some((s) => s.status === 'connecting')) {
      effectiveStatus = 'connecting';
    } else if (this.lastError || sessions.some((s) => s.status === 'error')) {
      effectiveStatus = 'error';
    }

    const primary = connectedSessions[0] || sessions[0] || null;
    return {
      enabled: Boolean(cfg.enabled),
      exists,
      serverPath: cfg.serverPath || '',
      status: effectiveStatus,
      isolationMode: 'per-client',
      pid: primary?.pid || null,
      activeSessionCount: connectedSessions.length,
      sessions,
      toolCount: this.cachedTools.length,
      tools: this.cachedTools.map((t) => ({ name: t.name, description: t.description || '' })),
      connectedAt: primary?.connectedAt || null,
      lastError: this.lastError || primary?.lastError || null
    };
  }

  async stopSession(sessionKey) {
    const bridge = this.bridges.get(String(sessionKey || ''));
    if (!bridge) return false;
    await bridge.stop().catch(() => {});
    this.bridges.delete(String(sessionKey || ''));
    return true;
  }

  async stop() {
    clearInterval(this.reapTimer);
    await Promise.allSettled(Array.from(this.bridges.values()).map((b) => b.stop()));
    this.bridges.clear();
  }

  async restart() {
    this.cachedTools = [];
    this.cachedServerPath = '';
    this.lastError = null;
    await Promise.allSettled(Array.from(this.bridges.values()).map((b) => b.stop()));
    this.bridges.clear();
    if (!this.getConfig().enabled) {
      return this.getState();
    }
    // Warm up the tool catalog via a short-lived catalog probe so active parallel clients stay clean and lazy.
    await this.getTools();
    if (this.cachedTools.length === 0 && this.lastError) {
      throw new Error(this.lastError);
    }
    return this.getState();
  }
}
