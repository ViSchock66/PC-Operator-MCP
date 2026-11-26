import crypto from 'node:crypto';
import fs from 'node:fs';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  OAuthError,
  ServerError,
  TooManyRequestsError,
  UnsupportedGrantTypeError
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { BUILTIN_OAUTH_PROVIDERS, atomicWriteFileSync } from './config.js';
import { getServerMessages, normalizeLanguage } from './i18n.js';
import { renderConsentPage } from './templates/consentPage.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CLIENT_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DYNAMIC_CLIENTS = 500;
const DEFAULT_ACCESS_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
const REFRESH_GRACE_WINDOW_MS = 60 * 1000;

function resolveAccessTokenTtlSec() {
  const raw = process.env.MCP_ACCESS_TOKEN_TTL_SEC;
  if (raw !== undefined && String(raw).trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(60, Math.min(Math.floor(parsed), 90 * 24 * 60 * 60));
    }
  }
  return DEFAULT_ACCESS_TOKEN_TTL_SEC;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeMatch(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64UrlSha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('base64url');
}

export function getPublicOrigin(req, configManager) {
  if (process.env.MCP_PUBLIC_URL) {
    return new URL(process.env.MCP_PUBLIC_URL).origin;
  }
  const configuredUrl = configManager?.get?.()?.tunnel?.publicUrl;
  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      // Ignore malformed persisted publicUrl and fall back to request headers.
    }
  }
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1:3333')
    .split(',')[0]
    .trim();
  return `${proto}://${rawHost}`;
}

export function isLoopbackRedirect(uri) {
  try {
    const parsed = new URL(uri);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function redirectUriMatches(requested, registered) {
  if (requested === registered) return true;
  let reqUrl;
  let regUrl;
  try {
    reqUrl = new URL(requested);
    regUrl = new URL(registered);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(reqUrl.hostname) || !LOOPBACK_HOSTS.has(regUrl.hostname)) {
    return false;
  }
  // RFC 8252 Section 7.3: loopback native clients may use dynamic ephemeral ports.
  return (
    reqUrl.protocol === regUrl.protocol &&
    reqUrl.hostname === regUrl.hostname &&
    reqUrl.pathname === regUrl.pathname &&
    reqUrl.search === regUrl.search
  );
}

function matchesOriginOrPrefix(parsedUri, allowedEntry) {
  if (!allowedEntry) return false;
  try {
    const allowedUrl = new URL(allowedEntry);
    if (parsedUri.origin !== allowedUrl.origin) return false;
    if (!allowedUrl.pathname || allowedUrl.pathname === '/') {
      return true;
    }
    return parsedUri.pathname === allowedUrl.pathname || parsedUri.pathname.startsWith(`${allowedUrl.pathname}/`);
  } catch {
    return false;
  }
}

function isAllowedDcrRedirectUri(uri, allowedEntries) {
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return true;
    if (parsed.protocol !== 'https:') return false;
    return allowedEntries.some((entry) => matchesOriginOrPrefix(parsed, entry));
  } catch {
    return false;
  }
}

export function isGoogleRedirectUri(uri) {
  try {
    const host = new URL(String(uri || '')).hostname.toLowerCase();
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'googleusercontent.com' ||
      host.endsWith('.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

export function resolveProtectedResourcePath(subpath) {
  const clean = String(subpath || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/' || clean === '/mcp') return '/mcp';
  if (clean === '/mcp/gemini') return '/mcp/gemini';
  const slotMatch = /^\/mcp\/gemini\/([a-zA-Z0-9_-]{1,32})$/.exec(clean);
  if (slotMatch) return `/mcp/gemini/${slotMatch[1]}`;
  return null;
}

function inferProviderLabelFromUri(uri) {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    if (host.includes('googleusercontent.com') || host.includes('google.com')) return 'Gemini';
    if (host.includes('claude.ai') || host.includes('anthropic.com')) return 'Claude';
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'ChatGPT';
    if (LOOPBACK_HOSTS.has(host)) return 'Cliente Local';
    return host;
  } catch {
    return 'Cliente OAuth';
  }
}

function extractClientCredentials(req) {
  const authHeader = req.headers.authorization;
  let clientId = req.body?.client_id;
  let clientSecret = req.body?.client_secret;

  if ((!clientId || !clientSecret) && typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep !== -1) {
      const basicId = decodeURIComponent(decoded.slice(0, sep));
      const basicSecret = decodeURIComponent(decoded.slice(sep + 1));
      if (!clientId) clientId = basicId;
      if (!clientSecret) clientSecret = basicSecret;
    }
  }
  return { clientId, clientSecret };
}

/**
 * Implements provider-agnostic MCP OAuth 2.1 Authorization Server + Static Bearer API Key verification.
 */
export class McpOAuthService {
  constructor(configManager, options = {}) {
    this.configManager = configManager;
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.stateFile = configManager.authFile;
    this.pendingAuths = new Map();
    this.authCodes = new Map();
    this.recentRefreshRotations = new Map();
    this.state = this.#loadState();
    this.clientsStore = {
      getClient: (clientId) => this.getClient(clientId),
      registerClient: (clientInfo) => this.registerClient(clientInfo)
    };
  }

  #isClientGemini(client, redirectUri) {
    if (redirectUri && isGoogleRedirectUri(redirectUri)) return true;
    if (Array.isArray(client?.redirect_uris) && client.redirect_uris.some(isGoogleRedirectUri)) return true;
    return /^google\b|gemini/i.test(String(client?.client_name || '').trim());
  }

  #loadState() {
    let data = { clients: {}, accessTokens: {}, refreshTokens: {} };
    if (fs.existsSync(this.stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        data = {
          clients: parsed.clients || {},
          accessTokens: parsed.accessTokens || {},
          refreshTokens: parsed.refreshTokens || {}
        };
      } catch {
        data = { clients: {}, accessTokens: {}, refreshTokens: {} };
      }
    }
    this.#pruneExpired(data);
    return data;
  }

  #pruneExpired(target = this.state) {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [token, info] of Object.entries(target.accessTokens)) {
      if (!info || info.expiresAt <= nowSec) delete target.accessTokens[token];
    }
    for (const [token, info] of Object.entries(target.refreshTokens)) {
      if (!info || info.expiresAt <= nowSec) delete target.refreshTokens[token];
    }

    const clientsWithTokens = new Set(
      [...Object.values(target.accessTokens), ...Object.values(target.refreshTokens)]
        .filter(Boolean)
        .map((record) => record.clientId)
    );
    const nowMs = Date.now();
    for (const [clientId, client] of Object.entries(target.clients)) {
      const lastUsedAt = Number(client?._lastUsedAt);
      if (!Number.isFinite(lastUsedAt) || nowMs - lastUsedAt <= CLIENT_IDLE_TTL_MS) continue;
      if (!clientsWithTokens.has(clientId)) delete target.clients[clientId];
    }
  }

  #saveState() {
    this.#pruneExpired();
    atomicWriteFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  getAllowedStaticOrigins() {
    const builtin = BUILTIN_OAUTH_PROVIDERS.map((p) => p.origin);
    const custom = this.configManager.get().oauth?.allowedRedirectOrigins || [];
    return Array.from(new Set([...builtin, ...custom]));
  }

  getStaticClient() {
    const { client_id, client_secret } = this.configManager.get().staticClient;
    return {
      client_id,
      client_secret,
      client_name: 'Conector OAuth Estático (Multi-Proveedor)',
      redirect_uris: this.getAllowedStaticOrigins(),
      grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      isStatic: true
    };
  }

  getClient(clientId) {
    if (!clientId) return undefined;
    const staticClient = this.getStaticClient();
    if (clientId === staticClient.client_id) {
      return staticClient;
    }
    return this.state.clients[clientId];
  }

  registerClient(clientInfo) {
    const redirectUris = Array.isArray(clientInfo.redirect_uris) ? clientInfo.redirect_uris : [];
    const allowedEntries = this.getAllowedStaticOrigins();
    if (!redirectUris.length || redirectUris.some((uri) => !isAllowedDcrRedirectUri(uri, allowedEntries))) {
      throw new InvalidClientMetadataError(
        'redirect_uris solo puede incluir HTTPS de proveedores permitidos o HTTP en loopback.'
      );
    }

    this.#pruneExpired();
    if (Object.keys(this.state.clients).length >= MAX_DYNAMIC_CLIENTS) {
      throw new InvalidClientMetadataError('El servidor alcanzó el límite de clientes OAuth registrados.');
    }
    const isGemini = this.#isClientGemini(clientInfo);
    this.state.clients[clientInfo.client_id] = {
      ...clientInfo,
      _isGemini: isGemini,
      _lastUsedAt: Date.now()
    };
    this.#saveState();
    this.logger('info', 'auth', `DCR /register: ${clientInfo.client_name || clientInfo.client_id}${isGemini ? ' [Gemini]' : ''}`);
    return clientInfo;
  }

  isRedirectAllowedForClient(client, requestedUri) {
    if (!requestedUri) return false;
    let parsed;
    try {
      parsed = new URL(requestedUri);
    } catch {
      return false;
    }

    if (client.isStatic) {
      if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return true;
      const allowedEntries = this.getAllowedStaticOrigins();
      return allowedEntries.some((entry) => matchesOriginOrPrefix(parsed, entry));
    }
    return Array.isArray(client.redirect_uris) && client.redirect_uris.some((reg) => redirectUriMatches(requestedUri, reg));
  }

  async verifyAccessToken(token) {
    const apiKeyRecord = this.configManager.findApiKeyByToken?.(token);
    if (apiKeyRecord) {
      return {
        token,
        clientId: `apikey:${apiKeyRecord.id}`,
        clientName: apiKeyRecord.name,
        scopes: apiKeyRecord.scopes || ['mcp:tools'],
        isGemini: /^google\b|gemini/i.test(String(apiKeyRecord.name || '').trim()),
        expiresAt: Math.floor(Date.now() / 1000) + 86400
      };
    }

    const record = this.state.accessTokens[token];
    if (!record) {
      throw new InvalidTokenError('Token inválido o revocado.');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (record.expiresAt <= nowSec) {
      delete this.state.accessTokens[token];
      this.#saveState();
      throw new InvalidTokenError('Token expirado.');
    }
    const registeredClient = this.state.clients[record.clientId];
    let clientName = record.clientName;
    if (!clientName || clientName === record.clientId) {
      if (registeredClient?.client_name) {
        clientName = registeredClient.client_name;
      } else if (registeredClient?.redirect_uris?.[0]) {
        clientName = inferProviderLabelFromUri(registeredClient.redirect_uris[0]);
      } else if (record.isGemini) {
        clientName = 'Gemini';
      } else {
        clientName = record.clientId;
      }
    }
    const isGemini = Boolean(
      record.isGemini ||
      registeredClient?._isGemini ||
      /^google\b|gemini/i.test(String(clientName || '').trim()) ||
      (Array.isArray(registeredClient?.redirect_uris) && registeredClient.redirect_uris.some(isGoogleRedirectUri))
    );
    return {
      token,
      clientId: record.clientId,
      clientName,
      scopes: record.scopes || [],
      isGemini,
      expiresAt: record.expiresAt,
      ...(record.resource ? { resource: new URL(record.resource) } : {})
    };
  }

  revokeAllTokens() {
    this.state.accessTokens = {};
    this.state.refreshTokens = {};
    this.authCodes.clear();
    this.pendingAuths.clear();
    this.recentRefreshRotations.clear();
    this.#saveState();
  }

  activeSessionCount() {
    this.#pruneExpired();
    return Object.keys(this.state.accessTokens).length;
  }

  #markClientUsed(clientId) {
    const client = this.state.clients[clientId];
    if (client) client._lastUsedAt = Date.now();
  }

  #issueTokenPair({ clientId, clientName, scopes, resource, includeRefresh = true, isGemini = false }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const accessTtl = resolveAccessTokenTtlSec();

    this.state.accessTokens[accessToken] = {
      clientId,
      clientName: clientName || clientId,
      scopes,
      resource,
      isGemini: Boolean(isGemini),
      expiresAt: nowSec + accessTtl
    };

    const payload = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessTtl,
      scope: scopes.join(' ')
    };

    if (includeRefresh) {
      const refreshToken = crypto.randomBytes(32).toString('base64url');
      const refreshTtl = Math.max(30 * 24 * 60 * 60, accessTtl * 2);
      this.state.refreshTokens[refreshToken] = {
        clientId,
        clientName: clientName || clientId,
        scopes,
        resource,
        isGemini: Boolean(isGemini),
        expiresAt: nowSec + refreshTtl
      };
      payload.refresh_token = refreshToken;
    }

    this.#markClientUsed(clientId);
    this.#saveState();
    return payload;
  }

  #renderConsentPage({ requestId, client, redirectUri, errorMessage, lang, langSwitchQuery = '' }) {
    const cfg = this.configManager.get();
    const effectiveLang = normalizeLanguage(lang || cfg.ui?.language);
    const providerLabel = inferProviderLabelFromUri(redirectUri);

    return renderConsentPage({
      lang: effectiveLang,
      requestId,
      client,
      providerLabel,
      redirectUri,
      activeWorkspace: cfg.activeWorkspace,
      permissions: cfg.permissions,
      operatorEnabled: Boolean(cfg.operator?.enabled),
      errorMessage,
      langSwitchQuery
    });
  }

  createAuthRouter() {
    const router = express.Router();

    const metadataCors = cors();
    const sendAuthServerMetadata = (req, res) => {
      const origin = getPublicOrigin(req, this.configManager);
      res.status(200).json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
        revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: ['mcp:tools']
      });
    };

    router.use('/.well-known/oauth-protected-resource', metadataCors, (req, res, next) => {
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      const resourcePath = resolveProtectedResourcePath(req.path);
      if (!resourcePath) {
        return res.status(404).json({ error: 'not_found' });
      }
      const origin = getPublicOrigin(req, this.configManager);
      return res.status(200).json({
        resource: `${origin}${resourcePath}`,
        authorization_servers: [origin],
        bearer_methods_supported: ['header'],
        scopes_supported: ['mcp:tools'],
        resource_name: resourcePath.startsWith('/mcp/gemini')
          ? 'PC Workspace & Operator MCP (Gemini)'
          : 'PC Workspace & Operator MCP'
      });
    });
    router.options('/.well-known/oauth-authorization-server', metadataCors);
    router.get('/.well-known/oauth-authorization-server', metadataCors, sendAuthServerMetadata);
    router.options('/.well-known/openid-configuration', metadataCors);
    router.get('/.well-known/openid-configuration', metadataCors, sendAuthServerMetadata);

    router.use('/register', clientRegistrationHandler({ clientsStore: this.clientsStore }));

    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 80,
      standardHeaders: true,
      legacyHeaders: false,
      message: new TooManyRequestsError('Demasiados intentos de autorización').toResponseObject()
    });

    router.get('/authorize', authLimiter, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, scope, state, resource } = req.query;

      const client = this.getClient(String(client_id || ''));
      if (!client) {
        return res.status(400).json(new InvalidClientError('client_id inválido o no registrado.').toResponseObject());
      }

      const resolvedRedirect = redirect_uri ? String(redirect_uri) : (client.redirect_uris?.length === 1 && !client.isStatic ? client.redirect_uris[0] : '');
      if (!this.isRedirectAllowedForClient(client, resolvedRedirect)) {
        return res.status(400).json(new InvalidRequestError('redirect_uri no autorizado.').toResponseObject());
      }

      const sendRedirectError = (errorCode, message) => {
        const url = new URL(resolvedRedirect);
        url.searchParams.set('error', errorCode);
        url.searchParams.set('error_description', message);
        if (state) url.searchParams.set('state', String(state));
        return res.redirect(302, url.href);
      };

      if (response_type !== 'code') {
        return sendRedirectError('unsupported_response_type', 'Solo se soporta response_type=code.');
      }

      const requirePkce = !client.isStatic;
      if (code_challenge) {
        if (code_challenge_method !== 'S256') {
          return sendRedirectError('invalid_request', 'code_challenge_method debe ser S256.');
        }
      } else if (requirePkce) {
        return sendRedirectError('invalid_request', 'PKCE code_challenge (S256) es obligatorio.');
      }

      const isGemini = this.#isClientGemini(client, resolvedRedirect);
      const providerLabel = inferProviderLabelFromUri(resolvedRedirect);
      const clientName = (isGemini && (client.isStatic || !client.client_name))
        ? 'Gemini'
        : (client.isStatic ? providerLabel : (client.client_name || providerLabel));

      const requestId = crypto.randomBytes(24).toString('base64url');
      this.pendingAuths.set(requestId, {
        clientId: client.client_id,
        clientName,
        isGemini,
        redirectUri: resolvedRedirect,
        codeChallenge: code_challenge ? String(code_challenge) : undefined,
        scopes: scope ? String(scope).split(/\s+/).filter(Boolean) : ['mcp:tools'],
        state: state ? String(state) : undefined,
        resource: resource ? String(resource) : undefined,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      const consentLang = normalizeLanguage(req.query.lang || this.configManager.get().ui?.language);
      const queryIndex = req.originalUrl.indexOf('?');
      const langSwitchQuery = queryIndex >= 0 ? req.originalUrl.slice(queryIndex + 1) : '';

      res.status(200).type('html').send(
        this.#renderConsentPage({
          requestId,
          client,
          redirectUri: resolvedRedirect,
          lang: consentLang,
          langSwitchQuery
        })
      );
    });

    router.post('/authorize/confirm', authLimiter, express.urlencoded({ extended: false }), (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const { request_id, pin, decision, lang } = req.body || {};
      const effectiveLang = normalizeLanguage(lang || this.configManager.get().ui?.language);
      const consentMsgs = getServerMessages(effectiveLang).consent;
      const pending = this.pendingAuths.get(String(request_id || ''));
      if (!pending || pending.expiresAt < Date.now()) {
        this.pendingAuths.delete(String(request_id || ''));
        return res.status(400).send(consentMsgs.expired);
      }

      const redirectUrl = new URL(pending.redirectUri);
      if (decision !== 'allow') {
        this.pendingAuths.delete(String(request_id));
        redirectUrl.searchParams.set('error', 'access_denied');
        redirectUrl.searchParams.set('error_description', consentMsgs.deniedByUser);
        if (pending.state) redirectUrl.searchParams.set('state', pending.state);
        return res.redirect(302, redirectUrl.href);
      }

      const expectedPin = this.configManager.get().pin;
      if (!timingSafeMatch(String(pin || '').trim(), expectedPin)) {
        const client = this.getClient(pending.clientId) || { client_id: pending.clientId };
        return res.status(403).type('html').send(
          this.#renderConsentPage({
            requestId: String(request_id),
            client,
            redirectUri: pending.redirectUri,
            lang: effectiveLang,
            errorMessage: consentMsgs.invalidPin
          })
        );
      }

      this.pendingAuths.delete(String(request_id));
      const code = crypto.randomBytes(32).toString('base64url');
      this.authCodes.set(code, {
        clientId: pending.clientId,
        clientName: pending.clientName,
        isGemini: Boolean(pending.isGemini),
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scopes: pending.scopes,
        resource: pending.resource,
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      this.logger('ok', 'auth', `OAuth autorizado con PIN para ${pending.clientName || pending.clientId}${pending.isGemini ? ' [Gemini]' : ''}`);

      redirectUrl.searchParams.set('code', code);
      if (pending.state) redirectUrl.searchParams.set('state', pending.state);
      return res.redirect(302, redirectUrl.href);
    });

    const tokenCors = cors();
    const tokenLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: new TooManyRequestsError('Límite de peticiones de token excedido').toResponseObject()
    });

    router.options('/token', tokenCors);
    router.post('/token', tokenCors, tokenLimiter, express.urlencoded({ extended: false }), express.json(), (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const { clientId, clientSecret } = extractClientCredentials(req);
        const client = this.getClient(clientId);
        if (!client) {
          throw new InvalidClientError('client_id inválido.');
        }
        if (client.client_secret) {
          if (!clientSecret || !timingSafeMatch(clientSecret, client.client_secret)) {
            throw new InvalidClientError('client_secret inválido.');
          }
          if (client.client_secret_expires_at && client.client_secret_expires_at < Math.floor(Date.now() / 1000)) {
            throw new InvalidClientError('client_secret expirado.');
          }
        }

        const grantType = req.body?.grant_type;
        if (grantType === 'authorization_code') {
          const code = String(req.body?.code || '');
          const codeData = this.authCodes.get(code);
          if (!codeData || codeData.expiresAt < Date.now()) {
            this.authCodes.delete(code);
            throw new InvalidGrantError('Código de autorización inválido o expirado.');
          }
          if (codeData.clientId !== client.client_id) {
            throw new InvalidGrantError('El código no pertenece a este cliente.');
          }
          if (req.body?.redirect_uri && String(req.body.redirect_uri) !== codeData.redirectUri) {
            throw new InvalidGrantError('redirect_uri no coincide.');
          }
          if (codeData.codeChallenge) {
            const verifier = String(req.body?.code_verifier || '');
            if (!verifier || base64UrlSha256(verifier) !== codeData.codeChallenge) {
              throw new InvalidGrantError('code_verifier inválido.');
            }
          } else if (!client.client_secret) {
            throw new InvalidGrantError('Falta validación PKCE para cliente público.');
          }

          this.authCodes.delete(code);
          const tokens = this.#issueTokenPair({
            clientId: client.client_id,
            clientName: codeData.clientName,
            scopes: codeData.scopes,
            resource: req.body?.resource ? String(req.body.resource) : codeData.resource,
            isGemini: Boolean(codeData.isGemini || this.#isClientGemini(client, codeData.redirectUri))
          });
          this.logger('ok', 'auth', `Token OAuth emitido (authorization_code) para ${codeData.clientName || client.client_id}`);
          return res.status(200).json(tokens);
        }

        if (grantType === 'refresh_token') {
          const refreshToken = String(req.body?.refresh_token || '');
          const nowMs = Date.now();
          for (const [oldToken, entry] of this.recentRefreshRotations.entries()) {
            if (!entry || entry.expiresAt <= nowMs) {
              this.recentRefreshRotations.delete(oldToken);
            }
          }

          const existing = this.state.refreshTokens[refreshToken];
          const nowSec = Math.floor(nowMs / 1000);
          if (!existing) {
            const recent = this.recentRefreshRotations.get(refreshToken);
            if (recent && recent.expiresAt > nowMs) {
              if (recent.clientId !== client.client_id) {
                throw new InvalidGrantError('El refresh_token no pertenece a este cliente.');
              }
              return res.status(200).json(recent.tokens);
            }
            throw new InvalidGrantError('refresh_token inválido o expirado.');
          }
          if (existing.expiresAt <= nowSec) {
            delete this.state.refreshTokens[refreshToken];
            this.#saveState();
            throw new InvalidGrantError('refresh_token inválido o expirado.');
          }
          if (existing.clientId !== client.client_id) {
            throw new InvalidGrantError('El refresh_token no pertenece a este cliente.');
          }
          delete this.state.refreshTokens[refreshToken];
          const tokens = this.#issueTokenPair({
            clientId: client.client_id,
            clientName: existing.clientName,
            scopes: existing.scopes,
            resource: req.body?.resource ? String(req.body.resource) : existing.resource,
            isGemini: Boolean(existing.isGemini || this.#isClientGemini(client))
          });
          this.recentRefreshRotations.set(refreshToken, {
            clientId: client.client_id,
            tokens,
            expiresAt: nowMs + REFRESH_GRACE_WINDOW_MS
          });
          this.logger('info', 'auth', `Token OAuth renovado (refresh_token) para ${existing.clientName || client.client_id}`);
          return res.status(200).json(tokens);
        }

        if (grantType === 'client_credentials') {
          // Solo el cliente estático (cuyo secreto vive en config.json) puede usar este grant.
          // Los clientes de /register (DCR) son públicos en internet y deben pasar por el PIN.
          if (!client.isStatic) {
            throw new InvalidClientError('client_credentials solo está permitido para el cliente estático.');
          }
          if (!client.client_secret) {
            throw new InvalidClientError('client_credentials requiere un cliente confidencial con client_secret.');
          }
          const rawScope = req.body?.scope ? String(req.body.scope) : 'mcp:tools';
          const scopes = rawScope.split(/\s+/).filter(Boolean);
          const tokens = this.#issueTokenPair({
            clientId: client.client_id,
            clientName: client.client_name || 'Client Credentials',
            scopes: scopes.length ? scopes : ['mcp:tools'],
            resource: req.body?.resource ? String(req.body.resource) : undefined,
            includeRefresh: false,
            isGemini: false
          });
          return res.status(200).json(tokens);
        }

        throw new UnsupportedGrantTypeError('grant_type no soportado.');
      } catch (error) {
        if (error instanceof OAuthError) {
          this.logger('warn', 'auth', `Rechazo en /token (${req.body?.grant_type || '?'}): ${error.message}`);
          const status = error instanceof ServerError ? 500 : 400;
          return res.status(status).json(error.toResponseObject());
        }
        return res.status(500).json(new ServerError('Error interno en /token').toResponseObject());
      }
    });

    router.options('/revoke', tokenCors);
    router.post('/revoke', tokenCors, express.urlencoded({ extended: false }), (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const { clientId, clientSecret } = extractClientCredentials(req);
      const client = this.getClient(clientId);
      if (!client || (client.client_secret && !timingSafeMatch(clientSecret, client.client_secret))) {
        return res.status(400).json(new InvalidClientError('Cliente inválido.').toResponseObject());
      }
      const token = String(req.body?.token || '');
      if (this.state.accessTokens[token]?.clientId === client.client_id) {
        delete this.state.accessTokens[token];
      }
      if (this.state.refreshTokens[token]?.clientId === client.client_id) {
        delete this.state.refreshTokens[token];
      }
      if (this.recentRefreshRotations.get(token)?.clientId === client.client_id) {
        this.recentRefreshRotations.delete(token);
      }
      for (const [oldTok, entry] of this.recentRefreshRotations.entries()) {
        if (
          entry?.clientId === client.client_id &&
          (entry.tokens?.access_token === token || entry.tokens?.refresh_token === token)
        ) {
          this.recentRefreshRotations.delete(oldTok);
        }
      }
      this.#saveState();
      return res.status(200).json({});
    });

    return router;
  }

  requireBearerMiddleware({ resourcePath } = {}) {
    return (req, res, next) => {
      const rawReqPath = (req.originalUrl || req.url || '/mcp').split('?')[0];
      const effectivePath = resourcePath || resolveProtectedResourcePath(rawReqPath) || '/mcp';
      const resourceMetadataUrl = `${getPublicOrigin(req, this.configManager)}/.well-known/oauth-protected-resource${effectivePath}`;
      return requireBearerAuth({
        verifier: this,
        requiredScopes: ['mcp:tools'],
        resourceMetadataUrl
      })(req, res, () => {
        const clientId = req.auth?.clientId || 'anonymous';
        const clientName = req.auth?.clientName || clientId;
        const staticId = this.configManager.get().staticClient?.client_id;
        const isGeminiRoute = effectivePath.startsWith('/mcp/gemini');
        // DCR clients and API keys already have unique clientIds; for the shared static client,
        // scope the parallel session key by provider/clientName so Claude, Gemini and ChatGPT stay isolated.
        req.mcpClientId = clientId;
        req.mcpClientLabel = clientName;
        req.mcpIsGemini = Boolean(req.auth?.isGemini || isGeminiRoute);
        req.mcpSessionKey = clientId === staticId
          ? (isGeminiRoute
              ? 'static:gemini'
              : `static:${clientName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}`)
          : clientId;
        next();
      });
    };
  }
}
