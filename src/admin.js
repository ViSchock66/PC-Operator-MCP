import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { APP_ROOT, BUILTIN_OAUTH_PROVIDERS } from './config.js';
import { getServerMessages, normalizeLanguage } from './i18n.js';
import { renderLoginHtml } from './templates/loginPage.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '0.5.0');
  } catch {
    return '0.5.0';
  }
})();

function hasProxyHeaders(req) {
  const suspicious = [
    'cf-ray',
    'cf-connecting-ip',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'forwarded'
  ];
  return suspicious.some((h) => Boolean(req.headers[h]));
}

function isLocalhostHostHeader(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === '127.0.0.1' || host === 'localhost';
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    map[key] = decodeURIComponent(val);
  }
  return map;
}

async function pickFolderInWindows(lang = 'en') {
  if (process.platform !== 'win32') {
    throw new Error('The native folder picker is only available on Windows.');
  }
  const title = getServerMessages(lang).dialog.pickFolderTitle.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '${title}'
$dlg.UseDescriptionForTitle = $true
$dlg.ShowNewFolderButton = $true
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
$res = $dlg.ShowDialog($top)
$top.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Sta', '-Command', script],
    { timeout: 120000, windowsHide: false }
  );
  return stdout.trim();
}

function readGitBranchFast(dirPath) {
  try {
    const gitPath = path.join(dirPath, '.git');
    if (!fs.existsSync(gitPath)) return { isGit: false, gitBranch: '' };
    const stat = fs.statSync(gitPath);
    let headFile = path.join(gitPath, 'HEAD');
    if (stat.isFile()) {
      const pointer = fs.readFileSync(gitPath, 'utf8').trim();
      const match = /^gitdir:\s*(.+)$/i.exec(pointer);
      if (match) {
        const resolvedGitDir = path.resolve(dirPath, match[1].trim());
        headFile = path.join(resolvedGitDir, 'HEAD');
      }
    }
    if (!fs.existsSync(headFile)) return { isGit: true, gitBranch: '' };
    const head = fs.readFileSync(headFile, 'utf8').trim();
    if (head.startsWith('ref:')) {
      return { isGit: true, gitBranch: head.replace(/^ref:\s*refs\/heads\//, '') };
    }
    return { isGit: true, gitBranch: head.slice(0, 8) };
  } catch {
    return { isGit: false, gitBranch: '' };
  }
}

/**
 * Creates a strictly localhost-only web UI and JSON/SSE API router at /admin.
 */
export function createLocalAdminRouter({ configManager, authService, tunnelManager, operatorBridge, processManager, handoffManager, sessionStore, getTunnelUrl, onShutdown }) {
  const router = express.Router();
  const COOKIE_NAME = 'gemini_mcp_admin';
  let portRestartRequired = false;

  function deriveCookieSecret() {
    const cfg = configManager.get();
    return crypto
      .createHash('sha256')
      .update(`${cfg.pin}:${cfg.staticClient?.client_secret || ''}`)
      .digest('hex');
  }

  function signSession() {
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const payload = String(exp);
    const sig = crypto.createHmac('sha256', deriveCookieSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  function verifySession(token) {
    if (!token || !token.includes('.')) return false;
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', deriveCookieSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return Number(payload) > Math.floor(Date.now() / 1000);
  }

  function buildFullState() {
    const cfg = configManager.get();
    const tunnelState = tunnelManager ? tunnelManager.getState() : {
      pid: process.pid,
      uptimeSec: 0,
      status: getTunnelUrl?.() ? 'running' : 'stopped',
      mode: cfg.tunnel?.mode || 'tailscale',
      activeUrl: getTunnelUrl?.() || null,
      configuredUrl: cfg.tunnel?.publicUrl || '',
      mcpUrl: (getTunnelUrl?.() || cfg.tunnel?.publicUrl)
        ? `${getTunnelUrl?.() || cfg.tunnel?.publicUrl}/mcp`
        : `http://${cfg.host}:${cfg.port}/mcp`,
      geminiMcpUrl: (getTunnelUrl?.() || cfg.tunnel?.publicUrl)
        ? `${getTunnelUrl?.() || cfg.tunnel?.publicUrl}/mcp/gemini`
        : `http://${cfg.host}:${cfg.port}/mcp/gemini`,
      localMcpUrl: `http://${cfg.host}:${cfg.port}/mcp`,
      localGeminiMcpUrl: `http://${cfg.host}:${cfg.port}/mcp/gemini`,
      adminUrl: `http://${cfg.host}:${cfg.port}/admin`,
      actionUrl: null,
      lastError: null,
      startedAt: null,
      env: null,
      logs: []
    };

    const operatorState = operatorBridge
      ? operatorBridge.getState()
      : {
          enabled: Boolean(cfg.operator?.enabled),
          exists: Boolean(cfg.operator?.serverPath && fs.existsSync(cfg.operator.serverPath)),
          serverPath: cfg.operator?.serverPath || '',
          status: cfg.operator?.enabled ? 'standby' : 'disabled',
          isolationMode: 'per-client',
          pid: null,
          activeSessionCount: 0,
          sessions: [],
          toolCount: 0,
          tools: [],
          connectedAt: null,
          lastError: null
        };

    const opByKey = new Map((operatorState.sessions || []).map((s) => [s.sessionKey, s]));
    const wsSessions = sessionStore ? sessionStore.list(cfg.activeWorkspace) : [];
    const seenKeys = new Set();
    const parallelSessions = [];
    for (const ws of wsSessions) {
      seenKeys.add(ws.sessionKey);
      const op = opByKey.get(ws.sessionKey);
      parallelSessions.push({
        ...ws,
        operatorStatus: op?.status || 'standby',
        operatorPid: op?.pid || null,
        operatorActiveCalls: op?.activeCalls || 0
      });
    }
    for (const op of operatorState.sessions || []) {
      if (seenKeys.has(op.sessionKey)) continue;
      parallelSessions.push({
        sessionKey: op.sessionKey,
        clientLabel: op.clientLabel,
        activeWorkspace: cfg.activeWorkspace,
        workspaceScope: 'global',
        lastSeenAt: op.lastUsedAt || op.connectedAt,
        lastTool: null,
        toolCalls: op.totalCalls || 0,
        operatorStatus: op.status,
        operatorPid: op.pid || null,
        operatorActiveCalls: op.activeCalls || 0
      });
    }

    const daemonsState = processManager
      ? processManager.getState()
      : {
          fullControl: {
            enabled: Boolean(cfg.fullControl?.enabled),
            ttlMinutes: Number(cfg.fullControl?.ttlMinutes ?? 60),
            expiresAt: cfg.fullControl?.expiresAt || null,
            remainingSec: null,
            allowUnrestrictedCwd: Boolean(cfg.fullControl?.allowUnrestrictedCwd),
            stopProcessesOnDisable: cfg.fullControl?.stopProcessesOnDisable !== false
          },
          runningCount: 0,
          totalCount: 0,
          processes: []
        };

    const wsDetails = (cfg.allowedWorkspaces || []).map((wsPath) => {
      const exists = fs.existsSync(wsPath);
      const gitMeta = exists ? readGitBranchFast(wsPath) : { isGit: false, gitBranch: '' };
      const usedBy = parallelSessions
        .filter((ps) => (ps.activeWorkspace || '').toLowerCase() === wsPath.toLowerCase())
        .map((ps) => ps.clientLabel);
      return {
        path: wsPath,
        name: path.basename(wsPath) || wsPath,
        exists,
        isActive: wsPath.toLowerCase() === (cfg.activeWorkspace || '').toLowerCase(),
        isGit: gitMeta.isGit,
        gitBranch: gitMeta.gitBranch,
        usedBy
      };
    });

    return {
      server: {
        pid: process.pid,
        version: APP_VERSION,
        port: cfg.port,
        host: cfg.host,
        portRestartRequired,
        platform: process.platform
      },
      ui: {
        language: normalizeLanguage(cfg.ui?.language)
      },
      auth: {
        pin: cfg.pin,
        staticClient: { ...cfg.staticClient },
        activeSessions: authService.activeSessionCount(),
        builtinProviders: BUILTIN_OAUTH_PROVIDERS,
        allowedRedirectOrigins: [...(cfg.oauth?.allowedRedirectOrigins || [])],
        apiKeys: configManager.listApiKeysMasked ? configManager.listApiKeysMasked() : []
      },
      operator: operatorState,
      parallelSessions,
      daemons: daemonsState,
      handoffs: handoffManager
        ? handoffManager.getAdminState()
        : {
            checkpointsCount: 0,
            trailsCount: 0,
            checkpoints: [],
            trails: [],
            trailsDetailed: [],
            checkpointsDetailed: []
          },
      workspaces: {
        active: cfg.activeWorkspace,
        allowed: [...cfg.allowedWorkspaces],
        details: wsDetails
      },
      permissions: { ...cfg.permissions },
      tunnelConfig: {
        mode: cfg.tunnel?.mode || 'tailscale',
        publicUrl: cfg.tunnel?.publicUrl || '',
        customDomain: cfg.tunnel?.customDomain || '',
        hasCloudflareToken: Boolean(cfg.tunnel?.cloudflareToken),
        cloudflareTokenPreview: cfg.tunnel?.cloudflareToken
          ? `${cfg.tunnel.cloudflareToken.slice(0, 6)}••••${cfg.tunnel.cloudflareToken.slice(-4)}`
          : '',
        autoStart: cfg.tunnel?.autoStart ?? true
      },
      tunnel: tunnelState
    };
  }

  // Block any tunneled or remote access completely.
  router.use((req, res, next) => {
    const port = configManager.get().port;
    const remote = req.socket?.remoteAddress || '';
    if (!LOOPBACK_ADDRS.has(remote) || hasProxyHeaders(req) || !isLocalhostHostHeader(req, port)) {
      return res.status(403).type('text/plain').send('Acceso denegado: /admin solo es accesible directamente desde localhost.');
    }
    if (req.method === 'POST' || req.method === 'DELETE') {
      const origin = req.headers.origin;
      if (origin && !origin.startsWith(`http://127.0.0.1:${port}`) && !origin.startsWith(`http://localhost:${port}`)) {
        return res.status(403).type('text/plain').send('Origin no permitido.');
      }
    }
    next();
  });

  // Public static assets for login + app shell (strictly localhost-only due to guard above).
  // Block direct access to index.html (served behind the session gate at GET /admin/) and return 404 for missing assets.
  router.use('/assets', (req, res, next) => {
    const clean = String(req.path || '').toLowerCase();
    if (clean === '/' || clean === '' || clean === '/index.html') {
      return res.status(404).type('text/plain').send('No encontrado.');
    }
    return next();
  });
  router.use('/assets', express.static(PUBLIC_DIR, { maxAge: 0, index: false }));
  router.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Asset no encontrado.'));

  router.use(express.urlencoded({ extended: false }));
  router.use(express.json({ limit: '1mb' }));

  router.post('/login', (req, res) => {
    const submitted = String(req.body?.pin || '').trim();
    const submittedLang = req.body?.lang ? normalizeLanguage(req.body.lang) : null;
    const expected = configManager.get().pin;
    const a = Buffer.from(submitted, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      if (submittedLang && submittedLang !== configManager.get().ui?.language) {
        try {
          configManager.updateUiConfig({ language: submittedLang });
        } catch {
          // Ignore invalid optional language hint.
        }
      }
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(signSession())}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${30 * 24 * 3600}`
      );
      return res.redirect('/admin');
    }
    const langParam = submittedLang ? `&lang=${encodeURIComponent(submittedLang)}` : '';
    return res.redirect(`/admin?error=invalid_pin${langParam}`);
  });

  router.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
    return res.redirect('/admin');
  });

  // Session authentication gate
  router.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (verifySession(cookies[COOKIE_NAME])) {
      return next();
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Sesión local expirada. Recarga e ingresa tu PIN.' });
    }
    if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
      const lang = normalizeLanguage(req.query.lang || configManager.get().ui?.language);
      const rawErr = req.query.error ? String(req.query.error) : '';
      const err = rawErr === 'invalid_pin'
        ? getServerMessages(lang).login.invalidPin
        : rawErr;
      return res.status(200).type('html').send(renderLoginHtml({ lang, errorMessage: err }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(401).type('text/plain').send('Sesión local requerida.');
    }
    return res.status(404).type('text/plain').send('No encontrado.');
  });

  // Serve desktop panel HTML
  router.get('/', (_req, res) => {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.status(200).sendFile(indexPath);
    }
    return res.status(500).type('text/plain').send('Falta src/public/index.html');
  });

  // ---------- JSON + SSE API for Desktop Panel ----------

  router.get('/api/state', async (_req, res) => {
    if (tunnelManager && !tunnelManager.envCache) {
      await tunnelManager.inspectEnvironment().catch(() => {});
    }
    return res.json(buildFullState());
  });

  router.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: 'init', state: buildFullState() });

    const unsubscribe = tunnelManager
      ? tunnelManager.subscribe((ev) => {
          if (ev.type === 'state') {
            send({ type: 'state', full: buildFullState() });
          } else {
            send(ev);
          }
        })
      : () => {};

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  router.post('/api/tunnel/detect', async (req, res) => {
    if (!tunnelManager) {
      return res.status(501).json({ error: 'TunnelManager no disponible.' });
    }
    const env = await tunnelManager.inspectEnvironment();
    if (req.body?.applySuggested && env.tailscale?.suggestedUrl) {
      configManager.updateTunnelConfig({
        mode: 'tailscale',
        publicUrl: env.tailscale.suggestedUrl
      });
    }
    return res.json({ ok: true, env, state: buildFullState() });
  });

  router.post('/api/tunnel/start', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    await tunnelManager.start();
    return res.json({ ok: true, state: buildFullState() });
  });

  router.post('/api/tunnel/stop', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    await tunnelManager.stop();
    return res.json({ ok: true, state: buildFullState() });
  });

  router.post('/api/tunnel/restart', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    await tunnelManager.restart();
    return res.json({ ok: true, state: buildFullState() });
  });

  router.post('/api/config/tunnel', async (req, res) => {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.mode !== undefined) patch.mode = b.mode;
      if (b.publicUrl !== undefined) patch.publicUrl = b.publicUrl;
      if (b.customDomain !== undefined) patch.customDomain = b.customDomain;
      if (b.cloudflareToken !== undefined && !String(b.cloudflareToken).includes('••••')) {
        patch.cloudflareToken = b.cloudflareToken;
      }
      if (typeof b.autoStart === 'boolean') patch.autoStart = b.autoStart;

      configManager.updateTunnelConfig(patch);
      tunnelManager?.log('info', 'config', `Configuración de dominio guardada (modo: ${configManager.get().tunnel.mode})`);

      if (b.applyNow && tunnelManager) {
        await tunnelManager.restart();
      }
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/config/permissions', (req, res) => {
    try {
      const b = req.body || {};
      configManager.updatePermissions({
        allowWrite: typeof b.allowWrite === 'boolean' ? b.allowWrite : undefined,
        allowDelete: typeof b.allowDelete === 'boolean' ? b.allowDelete : undefined,
        allowCommands: typeof b.allowCommands === 'boolean' ? b.allowCommands : undefined,
        protectSensitiveFiles: typeof b.protectSensitiveFiles === 'boolean' ? b.protectSensitiveFiles : undefined,
        commandTimeoutMs: b.commandTimeoutMs !== undefined ? Number(b.commandTimeoutMs) : undefined,
        maxReadBytes: b.maxReadBytes !== undefined ? Number(b.maxReadBytes) : undefined
      });
      tunnelManager?.log('info', 'config', 'Permisos y límites del harness actualizados.');
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/config/server', (req, res) => {
    try {
      const b = req.body || {};
      const result = configManager.updateServerConfig({
        port: b.port !== undefined ? Number(b.port) : undefined,
        pin: b.pin !== undefined ? String(b.pin) : undefined,
        regeneratePin: Boolean(b.regeneratePin),
        regenerateStaticClient: Boolean(b.regenerateStaticClient)
      });
      if (result.portChanged) {
        portRestartRequired = true;
      }
      // Refresh admin cookie so user stays logged in after PIN / client change
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(signSession())}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${30 * 24 * 3600}`
      );
      tunnelManager?.log('info', 'config', 'Parámetros del servidor actualizados.');
      return res.json({ ok: true, portChanged: result.portChanged, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/config/ui', (req, res) => {
    try {
      const b = req.body || {};
      const ui = configManager.updateUiConfig({
        language: b.language !== undefined ? b.language : undefined
      });
      tunnelManager?.notifyStateChange?.();
      return res.json({ ok: true, ui, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/config/oauth', (req, res) => {
    try {
      const b = req.body || {};
      const origins = Array.isArray(b.allowedRedirectOrigins)
        ? b.allowedRedirectOrigins
        : String(b.allowedRedirectOrigins || '')
            .split(/\r?\n|,/)
            .map((s) => s.trim())
            .filter(Boolean);
      configManager.updateOAuthConfig({ allowedRedirectOrigins: origins });
      tunnelManager?.log('info', 'auth', 'Orígenes OAuth personalizados actualizados.');
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/auth/api-keys', (req, res) => {
    try {
      const name = String(req.body?.name || '').trim() || 'Conector Personalizado';
      const created = configManager.createApiKey(name);
      tunnelManager?.log('info', 'auth', `Nueva API Key creada para "${created.name}".`);
      return res.status(201).json({ ok: true, createdKey: created, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.delete('/api/auth/api-keys/:id', (req, res) => {
    try {
      configManager.revokeApiKey(req.params.id);
      tunnelManager?.log('warn', 'auth', `API Key revocada (${req.params.id}).`);
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
  });

  router.post('/api/config/operator', async (req, res) => {
    try {
      const b = req.body || {};
      const updated = configManager.updateOperatorConfig({
        enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
        serverPath: b.serverPath !== undefined ? String(b.serverPath) : undefined
      });
      if (operatorBridge) {
        if (!updated.enabled) {
          await operatorBridge.stop();
        } else if (b.connectNow) {
          await operatorBridge.restart();
        }
      }
      tunnelManager?.log('info', 'operator', `Configuración de Antigravity Operator guardada (activo: ${updated.enabled}).`);
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/operator/restart', async (_req, res) => {
    try {
      if (!operatorBridge) {
        return res.status(501).json({ error: 'OperatorBridge no disponible.' });
      }
      await operatorBridge.restart();
      return res.json({ ok: true, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message, state: buildFullState() });
    }
  });

  router.post('/api/operator/stop', async (_req, res) => {
    if (!operatorBridge) {
      return res.status(501).json({ error: 'OperatorBridge no disponible.' });
    }
    await operatorBridge.stop();
    tunnelManager?.log('info', 'operator', 'Procesos de Antigravity Operator detenidos (en espera).');
    return res.json({ ok: true, state: buildFullState() });
  });

  router.post('/api/operator/sessions/:key/stop', async (req, res) => {
    if (!operatorBridge || typeof operatorBridge.stopSession !== 'function') {
      return res.status(501).json({ error: 'Pool de sesiones Operator no disponible.' });
    }
    const key = decodeURIComponent(String(req.params.key || ''));
    const stopped = await operatorBridge.stopSession(key);
    if (stopped) {
      tunnelManager?.log('info', 'operator', `Bridge aislado detenido para sesión: ${key}`);
    }
    return res.json({ ok: true, stopped, state: buildFullState() });
  });

  router.post('/api/workspaces/add', (req, res) => {
    try {
      const added = configManager.addWorkspace(String(req.body?.path || '').trim(), { activate: true });
      tunnelManager?.log('info', 'workspace', `Workspace agregado y activado: ${added}`);
      return res.json({ ok: true, workspace: added, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/workspaces/select', (req, res) => {
    try {
      const active = configManager.selectWorkspace(String(req.body?.path || ''));
      tunnelManager?.log('info', 'workspace', `Workspace activo: ${active}`);
      return res.json({ ok: true, workspace: active, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/workspaces/remove', (req, res) => {
    try {
      const active = configManager.removeWorkspace(String(req.body?.path || ''));
      tunnelManager?.log('info', 'workspace', `Workspace removido. Activo: ${active}`);
      return res.json({ ok: true, workspace: active, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/workspaces/pick', async (_req, res) => {
    try {
      const picked = await pickFolderInWindows(configManager.get().ui?.language);
      if (!picked) {
        return res.json({ ok: true, cancelled: true, state: buildFullState() });
      }
      const active = configManager.addWorkspace(picked, { activate: true });
      tunnelManager?.log('info', 'workspace', `Workspace elegido desde Explorador: ${active}`);
      return res.json({ ok: true, workspace: active, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/workspaces/open', (req, res) => {
    try {
      const target = configManager.resolveAllowedWorkspace(String(req.body?.path || ''));
      if (process.platform === 'win32') {
        const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
        child.unref();
      }
      return res.json({ ok: true, opened: target });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/workspaces/reset-sessions', (_req, res) => {
    const cleared = sessionStore ? sessionStore.clearAllOverrides() : 0;
    tunnelManager?.log('info', 'workspace', `Sesiones paralelas sincronizadas con el workspace global (${cleared} overrides limpiados).`);
    return res.json({ ok: true, cleared, state: buildFullState() });
  });

  // ---------- Full Control Switch & Persistent Daemons / Consoles ----------

  router.post('/api/config/full-control', async (req, res) => {
    try {
      if (!processManager) {
        return res.status(501).json({ error: 'ProcessManager no disponible.' });
      }
      const b = req.body || {};
      const fullControl = await processManager.setFullControl({
        enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
        ttlMinutes: b.ttlMinutes !== undefined ? Number(b.ttlMinutes) : undefined,
        allowUnrestrictedCwd: typeof b.allowUnrestrictedCwd === 'boolean' ? b.allowUnrestrictedCwd : undefined,
        stopProcessesOnDisable: typeof b.stopProcessesOnDisable === 'boolean' ? b.stopProcessesOnDisable : undefined
      });
      return res.json({ ok: true, fullControl, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/processes/start', async (req, res) => {
    try {
      if (!processManager) {
        return res.status(501).json({ error: 'ProcessManager no disponible.' });
      }
      const b = req.body || {};
      const proc = await processManager.startProcess({
        command: String(b.command || '').trim(),
        name: b.name ? String(b.name).trim() : undefined,
        cwd: b.cwd ? String(b.cwd).trim() : configManager.get().activeWorkspace,
        waitMs: 600,
        sessionKey: 'local-admin',
        clientLabel: 'Panel Local',
        bypassGate: true
      });
      return res.status(201).json({ ok: true, process: proc, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.get('/api/processes/:id/output', (req, res) => {
    try {
      if (!processManager) {
        return res.status(501).json({ error: 'ProcessManager no disponible.' });
      }
      const tailLines = req.query.tailLines ? Number(req.query.tailLines) : 120;
      const out = processManager.readProcessOutput({ id: req.params.id, tailLines });
      return res.json({ ok: true, ...out });
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
  });

  router.post('/api/processes/:id/input', async (req, res) => {
    try {
      if (!processManager) {
        return res.status(501).json({ error: 'ProcessManager no disponible.' });
      }
      const out = await processManager.sendProcessInput({
        id: req.params.id,
        input: String(req.body?.input ?? ''),
        appendNewline: req.body?.appendNewline !== false,
        bypassGate: true
      });
      return res.json({ ok: true, ...out, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/processes/:id/stop', async (req, res) => {
    try {
      if (!processManager) {
        return res.status(501).json({ error: 'ProcessManager no disponible.' });
      }
      const proc = await processManager.stopProcess({ id: req.params.id, bypassGate: true });
      return res.json({ ok: true, process: proc, state: buildFullState() });
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
  });

  router.post('/api/processes/stop-all', async (_req, res) => {
    if (!processManager) {
      return res.status(501).json({ error: 'ProcessManager no disponible.' });
    }
    const stopped = await processManager.stopAll({ reason: 'panel-stop-all' });
    return res.json({ ok: true, stopped, state: buildFullState() });
  });

  router.post('/api/processes/clear-exited', (_req, res) => {
    if (!processManager) {
      return res.status(501).json({ error: 'ProcessManager no disponible.' });
    }
    const removed = processManager.clearExited();
    return res.json({ ok: true, removed, state: buildFullState() });
  });

  // ---------- Cross-Model Handoff & Auto-Tracked Session Recovery ----------

  router.post('/api/handoffs/freeze', (req, res) => {
    try {
      if (!handoffManager) {
        return res.status(501).json({ error: 'HandoffManager no disponible.' });
      }
      const b = req.body || {};
      const trailKey = b.trailKey ? String(b.trailKey).trim() : '';
      const sourceSessionKey = b.sessionKey ? String(b.sessionKey).trim() : null;
      const checkpoint = handoffManager.saveCheckpoint({
        trailKey,
        sessionKey: sourceSessionKey || 'local-admin',
        clientLabel: b.clientLabel || 'Panel Admin',
        sourceSessionKey,
        title: b.title || '',
        summary: b.summary || '',
        notes: b.notes || ''
      });
      const prompt = handoffManager.buildResumePrompt({ id: checkpoint.id });
      tunnelManager?.notifyStateChange?.();
      return res.json({ ok: true, checkpoint, prompt, state: buildFullState() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/handoffs/prompt', (req, res) => {
    try {
      if (!handoffManager) {
        return res.status(501).json({ error: 'HandoffManager no disponible.' });
      }
      const b = req.body || {};
      const prompt = handoffManager.buildResumePrompt({
        id: b.id ? String(b.id) : '',
        trailKey: b.trailKey ? String(b.trailKey) : '',
        sessionKey: b.sessionKey ? String(b.sessionKey) : ''
      });
      return res.json({ ok: true, prompt });
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
  });

  router.post('/api/handoffs/delete', (req, res) => {
    if (!handoffManager) {
      return res.status(501).json({ error: 'HandoffManager no disponible.' });
    }
    const b = req.body || {};
    let removed = false;
    let pruned = null;
    if (b.action === 'clear_resumed') {
      pruned = handoffManager.prune({ clearResumed: true });
      removed = pruned.removedCheckpoints > 0;
    } else if (b.action === 'clear_all_trails') {
      pruned = handoffManager.prune({ clearAllTrails: true });
      removed = pruned.removedTrails > 0;
    } else if (b.id) {
      removed = handoffManager.deleteCheckpoint(String(b.id));
    } else if (b.trailKey) {
      removed = handoffManager.clearTrail(String(b.trailKey));
    } else if (b.sessionKey) {
      removed = handoffManager.clearTrail(String(b.sessionKey));
    }
    tunnelManager?.notifyStateChange?.();
    return res.json({ ok: true, removed, pruned, state: buildFullState() });
  });

  router.post('/api/auth/revoke-all', (_req, res) => {
    authService.revokeAllTokens();
    tunnelManager?.log('warn', 'auth', 'Todas las sesiones OAuth fueron revocadas.');
    return res.json({ ok: true, state: buildFullState() });
  });

  router.post('/api/logs/clear', (_req, res) => {
    tunnelManager?.clearLogs();
    return res.json({ ok: true });
  });

  router.post('/api/daemon/shutdown', (_req, res) => {
    tunnelManager?.log('warn', 'daemon', 'Apagando daemon por petición del panel...');
    res.json({ ok: true });
    setTimeout(() => {
      onShutdown?.();
    }, 150);
  });

  // ---------- Legacy HTML form endpoints (preserved for backwards compatibility & tests) ----------

  router.post('/workspace/add', (req, res) => {
    try {
      const added = configManager.addWorkspace(String(req.body?.path || '').trim(), { activate: true });
      return res.redirect(`/admin?msg=${encodeURIComponent(`Workspace activado: ${added}`)}`);
    } catch (error) {
      return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/workspace/select', (req, res) => {
    try {
      const active = configManager.selectWorkspace(String(req.body?.path || ''));
      return res.redirect(`/admin?msg=${encodeURIComponent(`Workspace activo: ${active}`)}`);
    } catch (error) {
      return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/workspace/remove', (req, res) => {
    try {
      configManager.removeWorkspace(String(req.body?.path || ''));
      return res.redirect('/admin?msg=Workspace+eliminado');
    } catch (error) {
      return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/workspace/pick', async (_req, res) => {
    try {
      const picked = await pickFolderInWindows(configManager.get().ui?.language);
      if (!picked) {
        return res.redirect('/admin?msg=Selecci%C3%B3n+cancelada');
      }
      const active = configManager.addWorkspace(picked, { activate: true });
      return res.redirect(`/admin?msg=${encodeURIComponent(`Workspace activado: ${active}`)}`);
    } catch (error) {
      return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/permissions', (req, res) => {
    const b = req.body || {};
    configManager.updatePermissions({
      allowWrite: b.allowWrite === 'on',
      allowDelete: b.allowDelete === 'on',
      allowCommands: b.allowCommands === 'on',
      protectSensitiveFiles: b.protectSensitiveFiles === 'on'
    });
    return res.redirect('/admin?msg=Permisos+actualizados');
  });

  router.post('/revoke-all', (_req, res) => {
    authService.revokeAllTokens();
    return res.redirect('/admin?msg=Todas+las+sesiones+OAuth+fueron+revocadas');
  });

  return router;
}

/**
 * Strictly loopback-only API router for the native Windows System Tray companion.
 * Authenticated via an ephemeral per-boot token passed in the x-tray-token header.
 */
export function createTrayInternalRouter({
  configManager,
  authService,
  tunnelManager,
  operatorBridge,
  processManager,
  trayToken,
  onShutdown
}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const port = configManager.get().port;
    const remote = req.socket?.remoteAddress || '';
    if (!LOOPBACK_ADDRS.has(remote) || hasProxyHeaders(req) || !isLocalhostHostHeader(req, port)) {
      return res.status(403).json({ error: 'Solo accesible localmente.' });
    }
    const provided = String(req.headers['x-tray-token'] || '');
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(String(trayToken || ''), 'utf8');
    if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Token de bandeja inválido.' });
    }
    next();
  });

  router.get('/status', (_req, res) => {
    const cfg = configManager.get();
    const t = tunnelManager ? tunnelManager.getState() : null;
    const op = operatorBridge ? operatorBridge.getState() : null;
    const daemons = processManager ? processManager.getState() : null;
    return res.json({
      ok: true,
      version: APP_VERSION,
      language: normalizeLanguage(cfg.ui?.language),
      status: t?.status || 'running',
      mode: t?.mode || cfg.tunnel?.mode || 'tailscale',
      mcpUrl: t?.mcpUrl || `http://${cfg.host}:${cfg.port}/mcp`,
      geminiMcpUrl: t?.geminiMcpUrl || `http://${cfg.host}:${cfg.port}/mcp/gemini`,
      adminUrl: `http://${cfg.host}:${cfg.port}/admin`,
      pin: cfg.pin,
      activeSessions: authService.activeSessionCount(),
      runningDaemons: daemons?.runningCount || 0,
      operatorStatus: op?.status || 'disabled',
      lastError: t?.lastError || '',
      uptimeSec: t?.uptimeSec || 0
    });
  });

  router.post('/tunnel/start', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    const st = await tunnelManager.start();
    return res.json({ ok: true, status: st.status });
  });

  router.post('/tunnel/restart', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    const st = await tunnelManager.restart();
    return res.json({ ok: true, status: st.status });
  });

  router.post('/tunnel/stop', async (_req, res) => {
    if (!tunnelManager) return res.status(501).json({ error: 'TunnelManager no disponible.' });
    const st = await tunnelManager.stop();
    return res.json({ ok: true, status: st.status });
  });

  router.post('/shutdown', (_req, res) => {
    tunnelManager?.log('warn', 'daemon', 'Apagando daemon desde el icono de bandeja...');
    res.json({ ok: true });
    setTimeout(() => {
      onShutdown?.();
    }, 120);
  });

  return router;
}
