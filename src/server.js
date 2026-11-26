import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLocalAdminRouter, createTrayInternalRouter } from './admin.js';
import { McpOAuthService } from './auth.js';
import { BUILTIN_OAUTH_PROVIDERS, ConfigManager } from './config.js';
import { HandoffManager } from './handoff.js';
import { createWorkspaceMcpServer } from './mcpTools.js';
import { OperatorBridgePool } from './operatorBridge.js';
import { ProcessManager } from './processManager.js';
import { SkillCatalog } from './skills.js';
import { TunnelManager } from './tunnel.js';
import { ClientSessionStore, WorkspaceHarness } from './workspace.js';

/**
 * Builds and starts the Express + MCP Streamable HTTP server with per-client
 * parallel session isolation (dedicated workspace override + dedicated Operator bridge).
 */
export async function createMcpAppServer(options = {}) {
  const configManager = options.configManager || new ConfigManager(options);
  const tunnelManager = options.tunnelManager || new TunnelManager({ configManager });
  const authService = new McpOAuthService(configManager, {
    logger: (level, source, message) => tunnelManager.log(level, source, message)
  });
  const sessionStore = options.sessionStore || new ClientSessionStore();
  const operatorBridge = options.operatorBridge || new OperatorBridgePool({
    configManager,
    logger: (level, source, message) => tunnelManager.log(level, source, message),
    extraEnv: options.operatorEnv || null
  });
  const processManager = options.processManager || new ProcessManager({
    configManager,
    logger: (level, source, message) => tunnelManager.log(level, source, message),
    onStateChange: () => tunnelManager.notifyStateChange?.()
  });
  const handoffManager = options.handoffManager || new HandoffManager({
    dataDir: configManager.dataDir,
    configManager,
    processManager,
    logger: (level, source, message) => tunnelManager.log(level, source, message)
  });
  const harness = new WorkspaceHarness(configManager, { sessionStore, handoffManager });
  const skillCatalog = options.skillCatalog || new SkillCatalog({
    configManager,
    globalSkillsDir: options.globalSkillsDir
  });

  const app = express();
  app.disable('x-powered-by');
  // Required behind cloudflared / Tailscale / reverse proxies so express-rate-limit & proto headers work accurately.
  app.set('trust proxy', 1);

  const BASE_ALLOWED_CORS_ORIGINS = new Set([
    'https://claude.ai',
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://gemini.google.com',
    ...BUILTIN_OAUTH_PROVIDERS.map((p) => p.origin)
  ]);
  const LOOPBACK_CORS_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

  const isAllowedMcpOrigin = (origin) => {
    if (!origin) return true; // Server-to-server (Claude/Gemini/ChatGPT backends) and CLI/SDK clients
    let parsed;
    try {
      parsed = new URL(String(origin));
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    if (LOOPBACK_CORS_HOSTS.has(parsed.hostname.toLowerCase())) {
      return true;
    }
    if (BASE_ALLOWED_CORS_ORIGINS.has(parsed.origin)) {
      return true;
    }
    const cfgNow = configManager.get();
    const dynamicEntries = [
      ...(cfgNow.oauth?.allowedRedirectOrigins || []),
      cfgNow.tunnel?.publicUrl,
      cfgNow.tunnel?.customDomain
    ].filter(Boolean);
    for (const entry of dynamicEntries) {
      try {
        if (new URL(entry).origin === parsed.origin) return true;
      } catch {
        // Ignore malformed entry.
      }
    }
    return false;
  };

  const mcpCors = cors({
    origin: (origin, callback) => callback(null, isAllowedMcpOrigin(origin)),
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate']
  });

  // Public liveness endpoint: do not disclose workspace paths, process details, or tool inventory.
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get('/', (_req, res) => {
    res.status(200).type('text/plain').send('PC Workspace & Operator MCP server activo. Endpoint MCP: /mcp');
  });

  app.use(authService.createAuthRouter());

  let stateNotifyTimer = null;
  const scheduleStateNotify = () => {
    if (stateNotifyTimer) return;
    stateNotifyTimer = setTimeout(() => {
      stateNotifyTimer = null;
      tunnelManager.notifyStateChange?.();
    }, 500);
    stateNotifyTimer.unref?.();
  };

  const createMcpEndpointHandler = ({ forceGeminiRoute = false } = {}) => async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed on stateless MCP endpoint. Use POST.' },
        id: null
      });
    }

    const isGeminiClient = Boolean(forceGeminiRoute || req.mcpIsGemini);
    const baseLabel = req.mcpClientLabel || 'MCP';
    const clientLabel = (forceGeminiRoute && !/^google\b|gemini/i.test(baseLabel))
      ? `Gemini (${baseLabel})`
      : baseLabel;
    const sessionKey = req.mcpSessionKey || req.mcpClientId || 'default';
    sessionStore.touch(sessionKey, { clientLabel });

    const clientHarness = harness.forSession(sessionKey, clientLabel);
    const clientOperator = typeof operatorBridge.forClient === 'function'
      ? operatorBridge.forClient(sessionKey, clientLabel)
      : operatorBridge;
    const operatorTools = await clientOperator.getTools();

    const rpcMessages = Array.isArray(req.body)
      ? req.body
      : (req.body && typeof req.body === 'object' ? [req.body] : []);
    const reqPath = (req.originalUrl || req.url || req.path || '/mcp').split('?')[0];
    const totalToolsCount = 15 + (handoffManager ? 3 : 0) + (processManager ? 5 : 0) + operatorTools.length;
    for (const msg of rpcMessages) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.method === 'initialize') {
        tunnelManager.log(
          'info',
          'mcp',
          `[${clientLabel}] initialize en ${reqPath} (proto=${msg.params?.protocolVersion || '?'}, client=${msg.params?.clientInfo?.name || '?'}${isGeminiClient ? ', anotaciones compat Gemini (sin restricción)' : ''})`
        );
      } else if (msg.method === 'tools/list') {
        tunnelManager.log(
          'ok',
          'mcp',
          `[${clientLabel}] tools/list en ${reqPath} (${totalToolsCount} tools, ${isGeminiClient ? 'anotaciones compat Gemini (no restringe herramientas)' : 'annotations reales'})`
        );
      }
    }

    const mcpServer = createWorkspaceMcpServer(clientHarness, {
      operatorBridge: clientOperator,
      operatorTools,
      processManager,
      handoffManager,
      skillCatalog,
      sessionKey,
      clientLabel,
      isGeminiClient,
      onToolEvent: ({ tool, args, ok, durationMs, error }) => {
        sessionStore.touch(sessionKey, { clientLabel, tool });
        handoffManager?.recordToolCall({
          sessionKey,
          clientLabel,
          activeWorkspace: clientHarness.getActiveRoot(),
          tool,
          args,
          ok,
          durationMs,
          error
        });
        tunnelManager.log(
          ok ? 'ok' : 'warn',
          'mcp',
          ok
            ? `[${clientLabel}] ${tool} (${durationMs}ms)`
            : `[${clientLabel}] ${tool} falló (${durationMs}ms): ${error}`
        );
        scheduleStateNotify();
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      tunnelManager.log('error', 'mcp', `[${clientLabel}] Error procesando petición: ${error?.message || error}`);
      console.error('[mcp] Error procesando petición:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  };

  const validateGeminiSlot = (req, res, next) => {
    const slot = String(req.params.slot || '');
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(slot)) {
      return res.status(404).json({ error: 'not_found' });
    }
    next();
  };

  const endPreflight = (_req, res) => res.status(204).end();

  app.options('/mcp', mcpCors, endPreflight);
  app.all('/mcp', mcpCors, authService.requireBearerMiddleware({ resourcePath: '/mcp' }), express.json({ limit: '4mb' }), createMcpEndpointHandler({ forceGeminiRoute: false }));

  app.options('/mcp/gemini', mcpCors, endPreflight);
  app.all('/mcp/gemini', mcpCors, authService.requireBearerMiddleware({ resourcePath: '/mcp/gemini' }), express.json({ limit: '4mb' }), createMcpEndpointHandler({ forceGeminiRoute: true }));

  app.options('/mcp/gemini/:slot', validateGeminiSlot, mcpCors, endPreflight);
  app.all('/mcp/gemini/:slot', validateGeminiSlot, mcpCors, authService.requireBearerMiddleware(), express.json({ limit: '4mb' }), createMcpEndpointHandler({ forceGeminiRoute: true }));

  const cfg = configManager.get();
  const listenPort = options.port !== undefined ? Number(options.port) : cfg.port;
  const host = cfg.host || '127.0.0.1';

  let httpServer = null;
  const closeAll = async () => {
    if (stateNotifyTimer) {
      clearTimeout(stateNotifyTimer);
      stateNotifyTimer = null;
    }
    await processManager.shutdown().catch(() => {});
    await operatorBridge.stop().catch(() => {});
    if (!httpServer) return;
    await new Promise((resolve) => httpServer.close(resolve));
  };

  const trayToken = options.trayToken || crypto.randomBytes(24).toString('hex');
  const shutdownHandler = options.onShutdown || (async () => {
    await processManager.shutdown();
    await operatorBridge.stop();
    await tunnelManager.stop();
    await closeAll();
    process.exit(0);
  });

  app.use(
    '/internal/tray',
    createTrayInternalRouter({
      configManager,
      authService,
      tunnelManager,
      operatorBridge,
      processManager,
      trayToken,
      onShutdown: shutdownHandler
    })
  );

  app.use(
    '/admin',
    createLocalAdminRouter({
      configManager,
      authService,
      tunnelManager,
      operatorBridge,
      processManager,
      handoffManager,
      sessionStore,
      getTunnelUrl: options.getTunnelUrl || (() => tunnelManager.getActiveTunnelUrl()),
      onShutdown: shutdownHandler
    })
  );

  httpServer = await new Promise((resolve, reject) => {
    const srv = app.listen(listenPort, host, () => resolve(srv));
    srv.on('error', reject);
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
  configManager.config.port = actualPort;

  tunnelManager.log('info', 'server', `Servidor MCP escuchando en http://${host}:${actualPort} (aislamiento por sesión activo)`);

  return {
    app,
    httpServer,
    port: actualPort,
    host,
    configManager,
    authService,
    sessionStore,
    harness,
    tunnelManager,
    operatorBridge,
    processManager,
    handoffManager,
    trayToken,
    close: closeAll
  };
}
