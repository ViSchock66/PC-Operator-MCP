import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigManager } from '../src/config.js';
import { OperatorBridge } from '../src/operatorBridge.js';
import { ProcessManager } from '../src/processManager.js';
import { createMcpAppServer } from '../src/server.js';
import {
  DEFAULT_SENSITIVE_ENV_NAMES,
  buildSanitizedShellEnv,
  isSensitiveEnvName,
  normalizeEnvVarList
} from '../src/shellEnv.js';
import { WorkspaceHarness } from '../src/workspace.js';

function createTempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-pc-mcp-env-'));
  const dataDir = path.join(base, 'data');
  const ws = path.join(base, 'ws');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  return { base, dataDir, ws };
}

test('shellEnv unit: filtra nombres/patrones sensibles por defecto y respeta allowlist/blocklist/toggle', () => {
  const sampleEnv = {
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    USERNAME: 'tester',
    SSH_AUTH_SOCK: '/tmp/ssh-agent',
    SAFE_APP_MODE: 'dev',
    GEMINI_API_KEY: 'dummy-gemini',
    NVIDIA_API_KEY: 'dummy-nv',
    OPENROUTER_API_KEY: 'dummy-or',
    PLAYWRIGHT_MCP_EXTENSION_TOKEN: 'dummy-pw',
    MCP_PIN: '12345678',
    CLOUDFLARE_TUNNEL_TOKEN: 'dummy-cf',
    CUSTOM_SERVICE_API_KEY: 'dummy-custom-key',
    DB_PASSWORD: 'dummy-password',
    APP_CLIENT_SECRET: 'dummy-secret',
    SIGNING_PRIVATE_KEY: 'dummy-priv',
    CORP_INTERNAL_FLAG: 'keep-unless-blocked'
  };

  // Default behavior (filterSensitiveEnv = true)
  const filtered = buildSanitizedShellEnv(sampleEnv);
  assert.equal(filtered.PATH, sampleEnv.PATH);
  assert.equal(filtered.SystemRoot, sampleEnv.SystemRoot);
  assert.equal(filtered.USERNAME, sampleEnv.USERNAME);
  assert.equal(filtered.SSH_AUTH_SOCK, sampleEnv.SSH_AUTH_SOCK);
  assert.equal(filtered.SAFE_APP_MODE, 'dev');
  assert.equal(filtered.CORP_INTERNAL_FLAG, 'keep-unless-blocked');

  for (const key of [
    'GEMINI_API_KEY',
    'NVIDIA_API_KEY',
    'OPENROUTER_API_KEY',
    'PLAYWRIGHT_MCP_EXTENSION_TOKEN',
    'MCP_PIN',
    'CLOUDFLARE_TUNNEL_TOKEN',
    'CUSTOM_SERVICE_API_KEY',
    'DB_PASSWORD',
    'APP_CLIENT_SECRET',
    'SIGNING_PRIVATE_KEY'
  ]) {
    assert.equal(key in filtered, false, `${key} debe ser filtrado por defecto`);
  }

  // Allowlist override (exact + wildcard, case-insensitive) and extra blocklist
  const customized = buildSanitizedShellEnv(sampleEnv, {
    filterSensitiveEnv: true,
    envAllowlist: ['gemini_api_key', 'CUSTOM_*_KEY'],
    envBlocklist: ['CORP_*']
  });
  assert.equal(customized.GEMINI_API_KEY, 'dummy-gemini');
  assert.equal(customized.CUSTOM_SERVICE_API_KEY, 'dummy-custom-key');
  assert.equal('NVIDIA_API_KEY' in customized, false);
  assert.equal('PLAYWRIGHT_MCP_EXTENSION_TOKEN' in customized, false);
  assert.equal('CORP_INTERNAL_FLAG' in customized, false);

  // Disabled filter inherits full env
  const unfiltered = buildSanitizedShellEnv(sampleEnv, { filterSensitiveEnv: false });
  assert.equal(unfiltered.GEMINI_API_KEY, 'dummy-gemini');
  assert.equal(unfiltered.MCP_PIN, '12345678');
  assert.equal(unfiltered.CORP_INTERNAL_FLAG, 'keep-unless-blocked');

  // Helper exports
  assert.ok(DEFAULT_SENSITIVE_ENV_NAMES.includes('GEMINI_API_KEY'));
  assert.equal(isSensitiveEnvName('GEMINI_API_KEY'), true);
  assert.equal(isSensitiveEnvName('GEMINI_API_KEY', { envAllowlist: ['GEMINI_API_KEY'] }), false);
  assert.equal(isSensitiveEnvName('SAFE_VAR', { envBlocklist: ['SAFE_*'] }), true);
  assert.deepEqual(
    normalizeEnvVarList(' GEMINI_API_KEY , "MY_*_TOKEN"\nGEMINI_API_KEY; invalid name '),
    ['GEMINI_API_KEY', 'MY_*_TOKEN']
  );
});

test('Auditoría 4.2 (Opción A): run_command y process_start filtran env sensible mientras OperatorBridge conserva el suyo', async (t) => {
  const env = createTempEnv();

  // Inject isolated test-only variables into process.env and restore unconditionally after the test.
  const injectedKeys = [
    'AUDIT42_TEST_API_KEY',
    'AUDIT42_TEST_SECRET',
    'AUDIT42_OPERATOR_TOKEN',
    'AUDIT42_SAFE_VAR',
    'AUDIT42_CUSTOM_BLOCK'
  ];
  const prevValues = new Map(injectedKeys.map((k) => [k, process.env[k]]));
  process.env.AUDIT42_TEST_API_KEY = 'val_api_key_42';
  process.env.AUDIT42_TEST_SECRET = 'val_secret_42';
  process.env.AUDIT42_OPERATOR_TOKEN = 'val_op_token_42';
  process.env.AUDIT42_SAFE_VAR = 'val_safe_42';
  process.env.AUDIT42_CUSTOM_BLOCK = 'val_block_42';

  const mockOpScript = path.join(env.base, 'mock-env-operator.mjs');
  fs.writeFileSync(
    mockOpScript,
    `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-env-operator', version: '1.0.0' }
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [{ name: 'operator_probe_env', description: 'Probes env visibility', inputSchema: { type: 'object', properties: {} } }]
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            hasOpToken: process.env.AUDIT42_OPERATOR_TOKEN === 'val_op_token_42',
            hasSafeVar: process.env.AUDIT42_SAFE_VAR === 'val_safe_42'
          })
        }]
      }
    }) + '\\n');
  }
});
`,
    'utf8'
  );

  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws,
    port: 0,
    operatorEnabled: true
  });
  configManager.updateOperatorConfig({ enabled: true, serverPath: mockOpScript });

  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;
  const harness = new WorkspaceHarness(configManager);
  const processManager = new ProcessManager({ configManager });
  const operatorBridge = new OperatorBridge({ configManager, sessionKey: 'audit42', clientLabel: 'Audit42' });

  t.after(async () => {
    await operatorBridge.stop().catch(() => {});
    await processManager.shutdown().catch(() => {});
    await srv.close().catch(() => {});
    for (const k of injectedKeys) {
      const prev = prevValues.get(k);
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const probeCmd = process.platform === 'win32'
    ? 'Write-Output ("KEY=" + $env:AUDIT42_TEST_API_KEY + "|SEC=" + $env:AUDIT42_TEST_SECRET + "|TOK=" + $env:AUDIT42_OPERATOR_TOKEN + "|SAFE=" + $env:AUDIT42_SAFE_VAR + "|BLK=" + $env:AUDIT42_CUSTOM_BLOCK)'
    : 'echo "KEY=$AUDIT42_TEST_API_KEY|SEC=$AUDIT42_TEST_SECRET|TOK=$AUDIT42_OPERATOR_TOKEN|SAFE=$AUDIT42_SAFE_VAR|BLK=$AUDIT42_CUSTOM_BLOCK"';

  // 1) run_command strips sensitive env by default while keeping safe env
  const run1 = await harness.runCommand({ command: probeCmd });
  assert.equal(run1.exitCode, 0, run1.stderr);
  assert.match(run1.stdout, /KEY=\|SEC=\|TOK=\|SAFE=val_safe_42\|BLK=val_block_42/);

  // 2) process_start strips sensitive env by default as well
  await processManager.setFullControl({ enabled: true, ttlMinutes: 15 });
  const proc1 = await processManager.startProcess({
    command: probeCmd,
    name: 'audit42-env-probe',
    waitMs: 4000,
    harness
  });
  const procOut1 = processManager.readProcessOutput({ id: proc1.id }).output;
  assert.match(procOut1, /KEY=\|SEC=\|TOK=\|SAFE=val_safe_42\|BLK=val_block_42/);

  // 3) OperatorBridge is NOT stripped (retains AUDIT42_OPERATOR_TOKEN untouched)
  const opRes = await operatorBridge.callTool('operator_probe_env', {});
  const opPayload = JSON.parse(opRes.content[0].text);
  assert.equal(opPayload.hasOpToken, true, 'OperatorBridge debe conservar variables de token necesarias');
  assert.equal(opPayload.hasSafeVar, true);

  // 4) Updating envAllowlist & envBlocklist via /admin/api/config/permissions works live
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: configManager.get().pin })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const permRes = await fetch(`${baseUrl}/admin/api/config/permissions`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterSensitiveEnv: true,
      envAllowlist: 'AUDIT42_TEST_API_KEY',
      envBlocklist: 'AUDIT42_CUSTOM_BLOCK'
    })
  });
  assert.equal(permRes.status, 200);
  const permBody = await permRes.json();
  assert.equal(permBody.state.permissions.filterSensitiveEnv, true);
  assert.deepEqual(permBody.state.permissions.envAllowlist, ['AUDIT42_TEST_API_KEY']);
  assert.deepEqual(permBody.state.permissions.envBlocklist, ['AUDIT42_CUSTOM_BLOCK']);

  const run2 = await harness.runCommand({ command: probeCmd });
  assert.equal(run2.exitCode, 0, run2.stderr);
  assert.match(run2.stdout, /KEY=val_api_key_42\|SEC=\|TOK=\|SAFE=val_safe_42\|BLK=/);

  // 5) Disabling filterSensitiveEnv restores full inheritance
  configManager.updatePermissions({ filterSensitiveEnv: false });
  const run3 = await harness.runCommand({ command: probeCmd });
  assert.equal(run3.exitCode, 0, run3.stderr);
  assert.match(run3.stdout, /KEY=val_api_key_42\|SEC=val_secret_42\|TOK=val_op_token_42\|SAFE=val_safe_42\|BLK=val_block_42/);
});
