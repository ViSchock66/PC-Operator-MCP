import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANGUAGE, DEFAULT_THEME, SUPPORTED_LANGUAGES, SUPPORTED_THEMES, normalizeLanguage, normalizeTheme } from './i18n.js';
import { normalizeEnvVarList } from './shellEnv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const APP_ROOT = path.resolve(__dirname, '..');
export const DEFAULT_DATA_DIR = path.join(APP_ROOT, 'data');
export const DEFAULT_PLAYGROUND = path.join(APP_ROOT, 'playground');
export const DEFAULT_OPERATOR_SERVER_PATH = path.join(
  os.homedir(),
  '.gemini',
  'config',
  'plugins',
  'antigravity-operator',
  'server',
  'index.mjs'
);

export const TUNNEL_MODES = ['tailscale', 'cloudflare-named', 'cloudflare-quick', 'local'];

export const BUILTIN_OAUTH_PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', origin: 'https://oauth-redirect.googleusercontent.com' },
  { id: 'gemini-sandbox', name: 'Google Gemini (Sandbox)', origin: 'https://oauth-redirect-sandbox.googleusercontent.com' },
  { id: 'gemini-test', name: 'Google Gemini (Test)', origin: 'https://oauth-redirect-test.googleusercontent.com' },
  { id: 'claude', name: 'Claude (claude.ai)', origin: 'https://claude.ai' },
  { id: 'chatgpt', name: 'ChatGPT', origin: 'https://chatgpt.com' },
  { id: 'openai-legacy', name: 'ChatGPT (chat.openai.com)', origin: 'https://chat.openai.com' }
];

/**
 * Writes a file atomically via a same-directory temporary file + rename
 * to avoid corrupted/partial JSON reads during concurrent access.
 */
export function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameErr) {
      // On Windows, a transient AV/reader lock can cause EPERM/EBUSY on rename; fall back cleanly.
      fs.writeFileSync(filePath, content, 'utf8');
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore temp cleanup error.
      }
      if (!fs.existsSync(filePath)) throw renameErr;
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Ignore temp cleanup error.
    }
    throw err;
  }
}

function generatePin() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateStaticClient() {
  return {
    client_id: `gemini-pc-${crypto.randomBytes(6).toString('hex')}`,
    client_secret: crypto.randomBytes(24).toString('hex')
  };
}

function generateApiKeyToken() {
  return `gp_key_${crypto.randomBytes(24).toString('hex')}`;
}

function maskToken(token) {
  const str = String(token || '');
  if (str.length <= 12) return '••••••••';
  return `${str.slice(0, 10)}••••${str.slice(-4)}`;
}

export function normalizeTunnelMode(mode) {
  const val = String(mode || '').trim().toLowerCase();
  if (TUNNEL_MODES.includes(val)) return val;
  return 'tailscale';
}

export function normalizePublicUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('La URL pública debe usar http:// o https://.');
  }
  return parsed.origin;
}

export function normalizeRedirectEntry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Protocolo inválido en redirect URI: ${trimmed}`);
  }
  // If user entered a bare origin (no path or '/'), store origin; otherwise preserve origin + pathname.
  if (!parsed.pathname || parsed.pathname === '/') {
    return parsed.origin;
  }
  return `${parsed.origin}${parsed.pathname}`;
}

export function normalizeDirPath(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`La carpeta no existe: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`La ruta no es una carpeta: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function isInsideOrEqual(parentDir, candidateDir) {
  const rel = path.relative(parentDir, candidateDir);
  return rel === '' || (
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

function safeRealLower(dirPath) {
  const resolved = path.resolve(dirPath);
  try {
    return fs.realpathSync(resolved).toLowerCase();
  } catch {
    return resolved.toLowerCase();
  }
}

export function isProtectedWorkspacePath(dirPath) {
  const candidate = safeRealLower(dirPath);
  const appRoot = safeRealLower(APP_ROOT);
  const playgroundRoot = safeRealLower(DEFAULT_PLAYGROUND);

  if (isInsideOrEqual(appRoot, candidate)) {
    // Allow the dedicated playground sandbox folder (and subfolders inside it),
    // but block APP_ROOT itself and every other internal directory (src, data, panel, test, .backups, etc.).
    if (!isInsideOrEqual(playgroundRoot, candidate)) {
      return true;
    }
  }

  const operatorRoot = safeRealLower(path.dirname(path.dirname(DEFAULT_OPERATOR_SERVER_PATH)));
  return isInsideOrEqual(operatorRoot, candidate);
}

/**
 * Manages persisted runtime configuration for workspaces, permissions, tunnel domain,
 * provider-agnostic auth (OAuth + API keys), and the Antigravity Operator bridge.
 */
export class ConfigManager {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
    this.configFile = path.join(this.dataDir, 'config.json');
    this.authFile = path.join(this.dataDir, 'auth-state.json');
    this.defaultWorkspace = options.defaultWorkspace || DEFAULT_PLAYGROUND;
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.defaultWorkspace)) {
      fs.mkdirSync(this.defaultWorkspace, { recursive: true });
    }
    this.config = this.#loadOrInit(options);
  }

  #loadOrInit(options) {
    let loaded = {};
    if (fs.existsSync(this.configFile)) {
      try {
        loaded = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      } catch {
        loaded = {};
      }
    }

    let fallbackWorkspace = fs.realpathSync(path.resolve(this.defaultWorkspace));
    if (isProtectedWorkspacePath(fallbackWorkspace)) {
      fs.mkdirSync(DEFAULT_PLAYGROUND, { recursive: true });
      fallbackWorkspace = fs.realpathSync(DEFAULT_PLAYGROUND);
    }

    let activeWorkspace = loaded.activeWorkspace;
    try {
      activeWorkspace = activeWorkspace ? normalizeDirPath(activeWorkspace) : fallbackWorkspace;
    } catch {
      activeWorkspace = fallbackWorkspace;
    }

    if (options.initialWorkspace) {
      activeWorkspace = normalizeDirPath(options.initialWorkspace);
    }
    if (isProtectedWorkspacePath(activeWorkspace)) {
      activeWorkspace = fallbackWorkspace;
    }

    const allowedSet = new Set();
    const rawAllowed = Array.isArray(loaded.allowedWorkspaces) ? loaded.allowedWorkspaces : [fallbackWorkspace];
    for (const candidate of rawAllowed) {
      try {
        const normalizedCandidate = normalizeDirPath(candidate);
        if (!isProtectedWorkspacePath(normalizedCandidate)) {
          allowedSet.add(normalizedCandidate);
        }
      } catch {
        // Ignore stale directories that no longer exist on disk.
      }
    }
    allowedSet.add(activeWorkspace);

    const envToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
    const envPublicUrl = String(process.env.MCP_PUBLIC_URL || '').trim();
    let safePublicUrl = '';
    try {
      safePublicUrl = normalizePublicUrl(envPublicUrl || loaded.tunnel?.publicUrl || '');
    } catch {
      safePublicUrl = '';
    }
    let safeCustomDomain = '';
    try {
      safeCustomDomain = normalizePublicUrl(loaded.tunnel?.customDomain || '');
    } catch {
      safeCustomDomain = '';
    }

    const defaultMode = envToken ? 'cloudflare-named' : normalizeTunnelMode(loaded.tunnel?.mode);
    const resolvedPort = options.port !== undefined
      ? Number(options.port)
      : Number(loaded.port || process.env.MCP_PORT || 3333);

    const customRedirectOrigins = [];
    if (Array.isArray(loaded.oauth?.allowedRedirectOrigins)) {
      for (const item of loaded.oauth.allowedRedirectOrigins) {
        try {
          const norm = normalizeRedirectEntry(item);
          if (norm && !customRedirectOrigins.includes(norm)) {
            customRedirectOrigins.push(norm);
          }
        } catch {
          // Ignore malformed entries.
        }
      }
    }

    const apiKeys = [];
    if (Array.isArray(loaded.apiKeys)) {
      for (const k of loaded.apiKeys) {
        if (k && typeof k.id === 'string' && typeof k.token === 'string' && k.token.length >= 16) {
          apiKeys.push({
            id: k.id,
            name: String(k.name || 'Cliente API').slice(0, 64),
            token: k.token,
            scopes: Array.isArray(k.scopes) && k.scopes.length ? k.scopes : ['mcp:tools'],
            createdAt: k.createdAt || new Date().toISOString(),
            lastUsedAt: k.lastUsedAt || null
          });
        }
      }
    }

    const configuredOperatorPath = typeof loaded.operator?.serverPath === 'string' && loaded.operator.serverPath.trim()
      ? loaded.operator.serverPath.trim()
      : DEFAULT_OPERATOR_SERVER_PATH;
    const operatorEnabledDefault = options.operatorEnabled !== undefined
      ? Boolean(options.operatorEnabled)
      : (typeof loaded.operator?.enabled === 'boolean'
          ? loaded.operator.enabled
          : fs.existsSync(configuredOperatorPath));

    const normalized = {
      port: Number.isFinite(resolvedPort) ? resolvedPort : 3333,
      host: loaded.host || '127.0.0.1',
      pin: process.env.MCP_PIN || loaded.pin || generatePin(),
      staticClient: loaded.staticClient?.client_id && loaded.staticClient?.client_secret
        ? loaded.staticClient
        : generateStaticClient(),
      oauth: {
        allowedRedirectOrigins: customRedirectOrigins
      },
      apiKeys,
      operator: {
        enabled: operatorEnabledDefault,
        serverPath: configuredOperatorPath
      },
      activeWorkspace,
      allowedWorkspaces: Array.from(allowedSet),
      permissions: {
        allowWrite: loaded.permissions?.allowWrite ?? true,
        allowDelete: loaded.permissions?.allowDelete ?? true,
        allowCommands: loaded.permissions?.allowCommands ?? true,
        protectSensitiveFiles: loaded.permissions?.protectSensitiveFiles ?? true,
        filterSensitiveEnv: loaded.permissions?.filterSensitiveEnv ?? true,
        envAllowlist: normalizeEnvVarList(loaded.permissions?.envAllowlist),
        envBlocklist: normalizeEnvVarList(loaded.permissions?.envBlocklist),
        commandTimeoutMs: Number(loaded.permissions?.commandTimeoutMs || 30000),
        maxReadBytes: Number(loaded.permissions?.maxReadBytes || 131072)
      },
      fullControl: {
        enabled: Boolean(loaded.fullControl?.enabled),
        ttlMinutes: Number.isFinite(Number(loaded.fullControl?.ttlMinutes))
          ? Math.max(0, Math.min(Math.floor(Number(loaded.fullControl.ttlMinutes)), 1440))
          : 60,
        expiresAt: typeof loaded.fullControl?.expiresAt === 'string' ? loaded.fullControl.expiresAt : null,
        allowUnrestrictedCwd: Boolean(loaded.fullControl?.allowUnrestrictedCwd),
        stopProcessesOnDisable: loaded.fullControl?.stopProcessesOnDisable !== false
      },
      tunnel: {
        mode: defaultMode,
        publicUrl: safePublicUrl,
        customDomain: safeCustomDomain,
        cloudflareToken: envToken || String(loaded.tunnel?.cloudflareToken || ''),
        autoStart: loaded.tunnel?.autoStart ?? true
      },
      ui: {
        language: normalizeLanguage(loaded.ui?.language || process.env.MCP_LANG, DEFAULT_LANGUAGE),
        theme: normalizeTheme(loaded.ui?.theme, DEFAULT_THEME)
      }
    };

    this.config = normalized;
    this.save();
    return normalized;
  }

  save() {
    atomicWriteFileSync(this.configFile, JSON.stringify(this.config, null, 2));
  }

  get() {
    return this.config;
  }

  addWorkspace(dirPath, { activate = true } = {}) {
    const real = normalizeDirPath(dirPath);
    if (isProtectedWorkspacePath(real)) {
      throw new Error('No se permite usar la carpeta del servidor ni la del plugin Operator como workspace.');
    }
    if (!this.config.allowedWorkspaces.some((w) => w.toLowerCase() === real.toLowerCase())) {
      this.config.allowedWorkspaces.push(real);
    }
    if (activate) {
      this.config.activeWorkspace = real;
    }
    this.save();
    return real;
  }

  removeWorkspace(dirPath) {
    const resolved = path.resolve(dirPath);
    if (this.config.allowedWorkspaces.length <= 1) {
      throw new Error('Debe quedar al menos un workspace autorizado.');
    }
    const next = this.config.allowedWorkspaces.filter(
      (w) => w.toLowerCase() !== resolved.toLowerCase()
    );
    if (next.length === this.config.allowedWorkspaces.length) {
      throw new Error(`Workspace no encontrado: ${resolved}`);
    }
    this.config.allowedWorkspaces = next;
    if (this.config.activeWorkspace.toLowerCase() === resolved.toLowerCase()) {
      this.config.activeWorkspace = next[0];
    }
    this.save();
    return this.config.activeWorkspace;
  }

  resolveAllowedWorkspace(dirPath) {
    const real = normalizeDirPath(dirPath);
    if (isProtectedWorkspacePath(real)) {
      throw new Error('No se permite usar la carpeta del servidor ni la del plugin Operator como workspace.');
    }
    const match = this.config.allowedWorkspaces.find(
      (w) => w.toLowerCase() === real.toLowerCase()
    );
    if (!match) {
      throw new Error(
        `El workspace '${real}' no está en la lista de workspaces autorizados. Agrégalo primero desde el panel local /admin.`
      );
    }
    return match;
  }

  selectWorkspace(dirPath) {
    const match = this.resolveAllowedWorkspace(dirPath);
    this.config.activeWorkspace = match;
    this.save();
    return match;
  }

  updatePermissions(patch) {
    const p = this.config.permissions;
    if (typeof patch.allowWrite === 'boolean') p.allowWrite = patch.allowWrite;
    if (typeof patch.allowDelete === 'boolean') p.allowDelete = patch.allowDelete;
    if (typeof patch.allowCommands === 'boolean') p.allowCommands = patch.allowCommands;
    if (typeof patch.protectSensitiveFiles === 'boolean') p.protectSensitiveFiles = patch.protectSensitiveFiles;
    if (typeof patch.filterSensitiveEnv === 'boolean') p.filterSensitiveEnv = patch.filterSensitiveEnv;
    if (patch.envAllowlist !== undefined) p.envAllowlist = normalizeEnvVarList(patch.envAllowlist);
    if (patch.envBlocklist !== undefined) p.envBlocklist = normalizeEnvVarList(patch.envBlocklist);
    if (Number.isFinite(patch.commandTimeoutMs) && patch.commandTimeoutMs >= 1000 && patch.commandTimeoutMs <= 300000) {
      p.commandTimeoutMs = Math.floor(patch.commandTimeoutMs);
    }
    if (Number.isFinite(patch.maxReadBytes) && patch.maxReadBytes >= 1024 && patch.maxReadBytes <= 10485760) {
      p.maxReadBytes = Math.floor(patch.maxReadBytes);
    }
    this.save();
    return {
      ...p,
      envAllowlist: [...(p.envAllowlist || [])],
      envBlocklist: [...(p.envBlocklist || [])]
    };
  }

  updateTunnelConfig(patch = {}) {
    const t = this.config.tunnel;
    if (patch.mode !== undefined) {
      const m = String(patch.mode || '').trim().toLowerCase();
      if (!TUNNEL_MODES.includes(m)) {
        throw new Error(`Modo de túnel inválido: ${patch.mode}`);
      }
      t.mode = m;
    }
    if (patch.publicUrl !== undefined) {
      t.publicUrl = normalizePublicUrl(patch.publicUrl);
    }
    if (patch.customDomain !== undefined) {
      t.customDomain = normalizePublicUrl(patch.customDomain);
    }
    if (patch.cloudflareToken !== undefined) {
      t.cloudflareToken = String(patch.cloudflareToken || '').trim();
    }
    if (typeof patch.autoStart === 'boolean') {
      t.autoStart = patch.autoStart;
    }
    this.save();
    return { ...t };
  }

  updateServerConfig(patch = {}) {
    let portChanged = false;
    if (patch.port !== undefined) {
      const nextPort = Number(patch.port);
      if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
        throw new Error('El puerto debe estar entre 1024 y 65535.');
      }
      if (nextPort !== this.config.port) {
        this.config.port = nextPort;
        portChanged = true;
      }
    }
    if (patch.regeneratePin) {
      this.config.pin = generatePin();
    } else if (patch.pin !== undefined) {
      const cleanPin = String(patch.pin || '').trim();
      if (cleanPin.length < 4 || cleanPin.length > 64) {
        throw new Error('El PIN debe tener entre 4 y 64 caracteres.');
      }
      this.config.pin = cleanPin;
    }
    if (patch.regenerateStaticClient) {
      this.config.staticClient = generateStaticClient();
    }
    this.save();
    return {
      port: this.config.port,
      portChanged,
      pin: this.config.pin,
      staticClient: { ...this.config.staticClient }
    };
  }

  updateOAuthConfig(patch = {}) {
    if (!this.config.oauth) {
      this.config.oauth = { allowedRedirectOrigins: [] };
    }
    if (Array.isArray(patch.allowedRedirectOrigins)) {
      const next = [];
      for (const raw of patch.allowedRedirectOrigins) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) continue;
        const norm = normalizeRedirectEntry(trimmed);
        if (norm && !next.includes(norm)) {
          next.push(norm);
        }
      }
      this.config.oauth.allowedRedirectOrigins = next;
    }
    this.save();
    return {
      builtinProviders: BUILTIN_OAUTH_PROVIDERS,
      allowedRedirectOrigins: [...this.config.oauth.allowedRedirectOrigins]
    };
  }

  listApiKeysMasked() {
    return (this.config.apiKeys || []).map((k) => ({
      id: k.id,
      name: k.name,
      preview: maskToken(k.token),
      scopes: k.scopes,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null
    }));
  }

  createApiKey(name = 'Conector Personalizado') {
    const cleanName = String(name || '').trim().slice(0, 64) || 'Conector Personalizado';
    if (!Array.isArray(this.config.apiKeys)) {
      this.config.apiKeys = [];
    }
    if (this.config.apiKeys.length >= 25) {
      throw new Error('Límite máximo de 25 API Keys alcanzado. Revoca alguna antes de crear otra.');
    }
    const record = {
      id: `key_${crypto.randomBytes(6).toString('hex')}`,
      name: cleanName,
      token: generateApiKeyToken(),
      scopes: ['mcp:tools'],
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };
    this.config.apiKeys.push(record);
    this.save();
    return {
      ...record,
      preview: maskToken(record.token)
    };
  }

  revokeApiKey(id) {
    const targetId = String(id || '').trim();
    const before = (this.config.apiKeys || []).length;
    this.config.apiKeys = (this.config.apiKeys || []).filter((k) => k.id !== targetId);
    if (this.config.apiKeys.length === before) {
      throw new Error('API Key no encontrada.');
    }
    this.save();
    return true;
  }

  findApiKeyByToken(token) {
    const candidate = String(token || '').trim();
    if (!candidate) return null;
    const candBuf = Buffer.from(candidate, 'utf8');
    for (const record of this.config.apiKeys || []) {
      const recBuf = Buffer.from(record.token, 'utf8');
      if (candBuf.length === recBuf.length && crypto.timingSafeEqual(candBuf, recBuf)) {
        record.lastUsedAt = new Date().toISOString();
        return record;
      }
    }
    return null;
  }

  updateFullControlConfig(patch = {}) {
    if (!this.config.fullControl) {
      this.config.fullControl = {
        enabled: false,
        ttlMinutes: 60,
        expiresAt: null,
        allowUnrestrictedCwd: false,
        stopProcessesOnDisable: true
      };
    }
    const fc = this.config.fullControl;
    if (typeof patch.enabled === 'boolean') fc.enabled = patch.enabled;
    if (patch.ttlMinutes !== undefined && Number.isFinite(Number(patch.ttlMinutes))) {
      fc.ttlMinutes = Math.max(0, Math.min(Math.floor(Number(patch.ttlMinutes)), 1440));
    }
    if (patch.expiresAt !== undefined) {
      fc.expiresAt = typeof patch.expiresAt === 'string' && patch.expiresAt ? patch.expiresAt : null;
    }
    if (typeof patch.allowUnrestrictedCwd === 'boolean') fc.allowUnrestrictedCwd = patch.allowUnrestrictedCwd;
    if (typeof patch.stopProcessesOnDisable === 'boolean') fc.stopProcessesOnDisable = patch.stopProcessesOnDisable;
    this.save();
    return { ...fc };
  }

  updateOperatorConfig(patch = {}) {
    if (!this.config.operator) {
      this.config.operator = {
        enabled: false,
        serverPath: DEFAULT_OPERATOR_SERVER_PATH
      };
    }
    if (typeof patch.enabled === 'boolean') {
      this.config.operator.enabled = patch.enabled;
    }
    if (patch.serverPath !== undefined) {
      const cleanPath = String(patch.serverPath || '').trim();
      if (!cleanPath) {
        throw new Error('La ruta del servidor antigravity-operator no puede estar vacía.');
      }
      this.config.operator.serverPath = path.resolve(cleanPath);
    }
    this.save();
    return { ...this.config.operator };
  }

  updateUiConfig(patch = {}) {
    if (!this.config.ui) {
      this.config.ui = { language: DEFAULT_LANGUAGE, theme: DEFAULT_THEME };
    }
    if (patch.language !== undefined) {
      const raw = String(patch.language || '').trim().toLowerCase();
      if (!SUPPORTED_LANGUAGES.includes(raw)) {
        throw new Error(`Unsupported UI language: "${patch.language}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`);
      }
      this.config.ui.language = raw;
    }
    if (patch.theme !== undefined) {
      const rawTheme = String(patch.theme || '').trim().toLowerCase();
      if (!SUPPORTED_THEMES.includes(rawTheme)) {
        throw new Error(`Unsupported UI theme: "${patch.theme}". Supported: ${SUPPORTED_THEMES.join(', ')}.`);
      }
      this.config.ui.theme = rawTheme;
    }
    this.save();
    return { ...this.config.ui };
  }
}
