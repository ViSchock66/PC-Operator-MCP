/**
 * Environment variable hygiene for shell tools (`run_command` and `process_start`).
 *
 * Strips well-known API keys, tokens, secrets, and passwords from inherited `process.env`
 * before spawning PowerShell / sh child processes, while supporting per-user allowlist
 * overrides and extra blocklist patterns.
 *
 * NOTE: This mitigates accidental secret exposure via shell inspection commands;
 * it does NOT turn `run_command` / `process_*` into an OS-level sandbox.
 */

export const DEFAULT_SENSITIVE_ENV_NAMES = Object.freeze([
  'GEMINI_API_KEY',
  'NVIDIA_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'PLAYWRIGHT_MCP_EXTENSION_TOKEN',
  'MCP_PIN',
  'CLOUDFLARE_TUNNEL_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN'
]);

const DEFAULT_SENSITIVE_ENV_SET = new Set(DEFAULT_SENSITIVE_ENV_NAMES.map((n) => n.toUpperCase()));

export const DEFAULT_SENSITIVE_ENV_PATTERNS = Object.freeze([
  /(?:^|_)API_?KEY$/i,
  /SECRET/i,
  /(?:^|_)TOKEN$/i,
  /PASSWORD|PASSWD/i,
  /(?:^|_)PRIVATE_KEY$/i
]);

const MAX_ENV_LIST_ITEMS = 100;

export function normalizeEnvVarList(input) {
  const rawItems = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split(/[\r\n,;]+/) : []);

  const seen = new Set();
  const result = [];
  for (const item of rawItems) {
    const cleaned = String(item ?? '').trim().replace(/^["']|["']$/g, '').trim();
    if (!cleaned || !/^[A-Za-z0-9_.*-]+$/.test(cleaned)) continue;
    const key = cleaned.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_ENV_LIST_ITEMS) break;
  }
  return result;
}

function compileEnvRule(rule) {
  const clean = String(rule || '').trim();
  if (!clean) return null;
  if (!clean.includes('*')) {
    const upper = clean.toUpperCase();
    return (name) => name.toUpperCase() === upper;
  }
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return (name) => regex.test(name);
}

function matchesAnyRule(name, matchers) {
  for (const matcher of matchers) {
    if (matcher(name)) return true;
  }
  return false;
}

export function isSensitiveEnvName(name, { envAllowlist = [], envBlocklist = [] } = {}) {
  const key = String(name || '').trim();
  if (!key) return false;

  const allowMatchers = normalizeEnvVarList(envAllowlist).map(compileEnvRule).filter(Boolean);
  if (matchesAnyRule(key, allowMatchers)) {
    return false;
  }

  if (DEFAULT_SENSITIVE_ENV_SET.has(key.toUpperCase())) {
    return true;
  }

  if (DEFAULT_SENSITIVE_ENV_PATTERNS.some((re) => re.test(key))) {
    return true;
  }

  const blockMatchers = normalizeEnvVarList(envBlocklist).map(compileEnvRule).filter(Boolean);
  return matchesAnyRule(key, blockMatchers);
}

/**
 * Builds a sanitized copy of `baseEnv` for shell child processes (`run_command`, `process_start`).
 * Does NOT affect `OperatorBridge` (`src/operatorBridge.js`), which preserves its own env.
 */
export function buildSanitizedShellEnv(baseEnv = process.env, permissions = {}) {
  const source = baseEnv && typeof baseEnv === 'object' ? baseEnv : {};
  if (permissions?.filterSensitiveEnv === false) {
    return { ...source };
  }

  const allowMatchers = normalizeEnvVarList(permissions?.envAllowlist).map(compileEnvRule).filter(Boolean);
  const blockMatchers = normalizeEnvVarList(permissions?.envBlocklist).map(compileEnvRule).filter(Boolean);

  const sanitized = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (matchesAnyRule(key, allowMatchers)) {
      sanitized[key] = value;
      continue;
    }
    const isDefaultSensitive =
      DEFAULT_SENSITIVE_ENV_SET.has(key.toUpperCase()) ||
      DEFAULT_SENSITIVE_ENV_PATTERNS.some((re) => re.test(key));
    if (isDefaultSensitive || matchesAnyRule(key, blockMatchers)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
