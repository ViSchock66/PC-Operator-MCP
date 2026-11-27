import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { APP_ROOT, DEFAULT_OPERATOR_SERVER_PATH, DEFAULT_PLAYGROUND, ConfigManager } from '../src/config.js';
import { createWorkspaceMcpServer } from '../src/mcpTools.js';
import { createMcpAppServer } from '../src/server.js';
import { WorkspaceHarness } from '../src/workspace.js';

function createTempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-pc-mcp-test-'));
  const dataDir = path.join(base, 'data');
  const ws1 = path.join(base, 'workspace-one');
  const ws2 = path.join(base, 'workspace-two');
  const outside = path.join(base, 'outside-secret');
  fs.mkdirSync(ws1, { recursive: true });
  fs.mkdirSync(ws2, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP_SECRET', 'utf8');
  return { base, dataDir, ws1, ws2, outside };
}

function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge };
}

async function authorizeAndGetTokens({ baseUrl, clientId, clientSecret, redirectUri, pin, usePkce = true, useBasic = false }) {
  const pkce = usePkce ? generatePkcePair() : null;
  const authUrl = new URL(`${baseUrl}/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', 'state-xyz');
  if (pkce) {
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }

  const consentRes = await fetch(authUrl);
  assert.equal(consentRes.status, 200);
  const html = await consentRes.text();
  const match = html.match(/name="request_id" value="([^"]+)"/);
  assert.ok(match, 'Debe renderizar request_id en el formulario de consentimiento');
  const requestId = match[1];

  const confirmRes = await fetch(`${baseUrl}/authorize/confirm`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      request_id: requestId,
      pin,
      decision: 'allow'
    })
  });
  assert.equal(confirmRes.status, 302);
  const location = confirmRes.headers.get('location');
  assert.ok(location?.startsWith(redirectUri));
  const locUrl = new URL(location);
  assert.equal(locUrl.searchParams.get('state'), 'state-xyz');
  const code = locUrl.searchParams.get('code');
  assert.ok(code);

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  if (pkce) {
    tokenParams.set('code_verifier', pkce.verifier);
  }

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (useBasic && clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
  } else {
    tokenParams.set('client_id', clientId);
    if (clientSecret) tokenParams.set('client_secret', clientSecret);
  }

  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers,
    body: tokenParams
  });
  assert.equal(tokenRes.status, 200);
  return tokenRes.json();
}

test('OAuth 2.1 discovery, DCR, static client, MCP tools, and security boundaries', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  configManager.addWorkspace(env.ws2, { activate: false });

  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  assert.deepEqual(await healthRes.json(), { ok: true });

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // 1. Unauthenticated /mcp returns 401 with proxied HTTPS resource_metadata
  const unauthRes = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'demo-test.trycloudflare.com'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  });
  assert.equal(unauthRes.status, 401);
  const wwwAuth = unauthRes.headers.get('www-authenticate') || '';
  assert.match(wwwAuth, /https:\/\/demo-test\.trycloudflare\.com\/\.well-known\/oauth-protected-resource\/mcp/);

  // 2. Well-known metadata reflects proxied HTTPS origin dynamically
  const prmRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'demo-test.trycloudflare.com' }
  });
  assert.equal(prmRes.status, 200);
  const prm = await prmRes.json();
  assert.equal(prm.resource, 'https://demo-test.trycloudflare.com/mcp');
  assert.deepEqual(prm.authorization_servers, ['https://demo-test.trycloudflare.com']);

  const asmRes = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'demo-test.trycloudflare.com' }
  });
  assert.equal(asmRes.status, 200);
  const asm = await asmRes.json();
  assert.equal(asm.issuer, 'https://demo-test.trycloudflare.com');
  assert.equal(asm.registration_endpoint, 'https://demo-test.trycloudflare.com/register');

  // 3. Dynamic Client Registration (DCR) + PKCE + Refresh Token
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Gemini Test DCR',
      redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/dcr-test'],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(regRes.status, 201);
  const dcrClient = await regRes.json();

  const dcrTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: dcrClient.client_id,
    redirectUri: 'https://oauth-redirect.googleusercontent.com/r/dcr-test',
    pin: configManager.get().pin,
    usePkce: true
  });
  assert.ok(dcrTokens.access_token);
  assert.ok(dcrTokens.refresh_token);

  // Refresh token works
  const refreshRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: dcrClient.client_id,
      refresh_token: dcrTokens.refresh_token
    })
  });
  assert.equal(refreshRes.status, 200);
  const refreshed = await refreshRes.json();
  assert.ok(refreshed.access_token);

  // 4. Static Client (Ajustes adicionales) with HTTP Basic Auth and non-PKCE fallback
  const staticClient = configManager.get().staticClient;
  const staticTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: staticClient.client_id,
    clientSecret: staticClient.client_secret,
    redirectUri: 'https://oauth-redirect.googleusercontent.com/r/static-123',
    pin: configManager.get().pin,
    usePkce: false,
    useBasic: true
  });
  assert.ok(staticTokens.access_token);

  // 5. Connect real MCP Client using StreamableHTTPClientTransport + Bearer token
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${staticTokens.access_token}`
      }
    }
  });
  await client.connect(transport);

  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((x) => x.name);
  for (const expected of [
    'workspace_info',
    'list_workspaces',
    'select_workspace',
    'list_dir',
    'find_files',
    'search_text',
    'read_file',
    'write_file',
    'edit_file',
    'move_path',
    'delete_path',
    'run_command',
    'git_harness'
  ]) {
    assert.ok(toolNames.includes(expected), `Falta tool ${expected}`);
  }

  const callJson = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(res.isError), false, `Tool ${name} falló: ${res.content?.[0]?.text}`);
    return JSON.parse(res.content[0].text);
  };

  // Write, read, CRLF edit, search, find, move, command, delete
  await callJson('write_file', { path: 'src/hello.js', content: 'const greet = "hola";\r\nconsole.log(greet);\r\n' });
  const readBack = await callJson('read_file', { path: 'src/hello.js' });
  assert.match(readBack.content, /1: const greet = "hola";/);

  const edited = await callJson('edit_file', {
    path: 'src/hello.js',
    target: 'const greet = "hola";\nconsole.log(greet);',
    replacement: 'const greet = "hola mundo";\nconsole.log(greet);'
  });
  assert.equal(edited.replacements, 1);

  const searched = await callJson('search_text', { query: 'hola mundo' });
  assert.equal(searched.count, 1);
  assert.equal(searched.matches[0].file, 'src/hello.js');

  const found = await callJson('find_files', { pattern: '**/*.js' });
  assert.deepEqual(found.files, ['src/hello.js']);

  const moved = await callJson('move_path', { source: 'src/hello.js', destination: 'src/app.js' });
  assert.equal(moved.to, 'src/app.js');

  const cmd = await callJson('run_command', { command: 'node src/app.js' });
  assert.equal(cmd.exitCode, 0);
  assert.match(cmd.stdout, /hola mundo/);

  const dirListing = await callJson('list_dir', { path: '.', depth: 3 });
  assert.ok(dirListing.entries.some((e) => e.path === 'src/app.js' && e.type === 'file'));

  const deletedFile = await callJson('delete_path', { path: 'src/app.js' });
  assert.equal(deletedFile.deleted, 'src/app.js');

  const rootDeleteAttempt = await client.callTool({ name: 'delete_path', arguments: { path: '.' } });
  assert.equal(rootDeleteAttempt.isError, true);

  // Switch workspace to ws2 and verify isolation
  await callJson('select_workspace', { path: env.ws2 });
  const info2 = await callJson('workspace_info');
  assert.equal(info2.activeWorkspace.toLowerCase(), fs.realpathSync(env.ws2).toLowerCase());

  // Path traversal & unauthorized workspace & sensitive file blocking
  const traversal = await client.callTool({
    name: 'read_file',
    arguments: { path: '../outside-secret/secret.txt' }
  });
  assert.equal(traversal.isError, true);

  const envWrite = await client.callTool({
    name: 'write_file',
    arguments: { path: '.env', content: 'SECRET=123' }
  });
  assert.equal(envWrite.isError, true);

  const unauthWs = await client.callTool({
    name: 'select_workspace',
    arguments: { path: env.outside }
  });
  assert.equal(unauthWs.isError, true);

  // 6. Wrong PIN & unauthorized static redirect URI rejection
  const badRedirectRes = await fetch(
    `${baseUrl}/authorize?client_id=${encodeURIComponent(staticClient.client_id)}&redirect_uri=${encodeURIComponent('https://evil.example.com/cb')}&response_type=code`
  );
  assert.equal(badRedirectRes.status, 400);

  const consentRes2 = await fetch(
    `${baseUrl}/authorize?client_id=${encodeURIComponent(staticClient.client_id)}&redirect_uri=${encodeURIComponent('https://oauth-redirect.googleusercontent.com/r/pin-test')}&response_type=code`
  );
  const html2 = await consentRes2.text();
  const reqId2 = html2.match(/name="request_id" value="([^"]+)"/)[1];
  const wrongPinRes = await fetch(`${baseUrl}/authorize/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: reqId2, pin: 'WRONGPIN', decision: 'allow' })
  });
  assert.equal(wrongPinRes.status, 403);

  // 7. /admin must reject proxied requests, authenticate locally with PIN, toggle permissions, and revoke tokens
  const proxiedAdmin = await fetch(`${baseUrl}/admin`, {
    headers: { 'cf-ray': '12345', 'x-forwarded-for': '8.8.8.8' }
  });
  assert.equal(proxiedAdmin.status, 403);

  const localAdmin = await fetch(`${baseUrl}/admin`);
  assert.equal(localAdmin.status, 200);
  assert.match(await localAdmin.text(), /PC-Operator-MCP/);

  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: configManager.get().pin })
  });
  assert.equal(loginRes.status, 302);
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const permRes = await fetch(`${baseUrl}/admin/permissions`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: adminCookie
    },
    body: new URLSearchParams({ allowWrite: 'on', allowDelete: 'on' })
  });
  assert.equal(permRes.status, 302);

  // Commands are now disabled immediately for active MCP clients
  const disabledCmd = await client.callTool({ name: 'run_command', arguments: { command: 'echo test' } });
  assert.equal(disabledCmd.isError, true);

  // Revoke all tokens from /admin invalidates active Bearer token
  const revokeRes = await fetch(`${baseUrl}/admin/revoke-all`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: adminCookie }
  });
  assert.equal(revokeRes.status, 302);

  const afterRevoke = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${staticTokens.access_token}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' })
  });
  assert.equal(afterRevoke.status, 401);

  // 8. Admin JSON API requires auth + localhost, updates fixed domain/permissions, and updates OAuth origin
  const unauthApi = await fetch(`${baseUrl}/admin/api/state`);
  assert.equal(unauthApi.status, 401);

  const proxiedApi = await fetch(`${baseUrl}/admin/api/state`, {
    headers: { 'x-forwarded-for': '1.2.3.4', Cookie: adminCookie }
  });
  assert.equal(proxiedApi.status, 403);

  const stateRes = await fetch(`${baseUrl}/admin/api/state`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(stateRes.status, 200);
  const initialState = await stateRes.json();
  assert.equal(initialState.tunnelConfig.mode, 'tailscale');

  const tunnelCfgRes = await fetch(`${baseUrl}/admin/api/config/tunnel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      mode: 'tailscale',
      publicUrl: 'pc-demo.tailnet.ts.net',
      autoStart: true,
      applyNow: false
    })
  });
  assert.equal(tunnelCfgRes.status, 200);
  const tunnelCfgData = await tunnelCfgRes.json();
  assert.equal(tunnelCfgData.state.tunnelConfig.publicUrl, 'https://pc-demo.tailnet.ts.net');

  // OAuth metadata now always uses the configured fixed publicUrl even without forwarded headers
  const fixedPrmRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(fixedPrmRes.status, 200);
  const fixedPrm = await fixedPrmRes.json();
  assert.equal(fixedPrm.resource, 'https://pc-demo.tailnet.ts.net/mcp');
  assert.deepEqual(fixedPrm.authorization_servers, ['https://pc-demo.tailnet.ts.net']);

  // Permissions API updates timeout and maxReadBytes
  const permApiRes = await fetch(`${baseUrl}/admin/api/config/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      allowCommands: true,
      commandTimeoutMs: 45000,
      maxReadBytes: 262144
    })
  });
  assert.equal(permApiRes.status, 200);
  const permApiData = await permApiRes.json();
  assert.equal(permApiData.state.permissions.commandTimeoutMs, 45000);
  assert.equal(permApiData.state.permissions.maxReadBytes, 262144);

  await client.close();
});

test('Provider-agnostic Auth (Claude, ChatGPT, custom origin, client_credentials, Bearer API keys)', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const staticClient = configManager.get().staticClient;
  const pin = configManager.get().pin;

  // 1. Claude.ai static OAuth callback works out of the box
  const claudeTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: staticClient.client_id,
    clientSecret: staticClient.client_secret,
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    pin,
    usePkce: true
  });
  assert.ok(claudeTokens.access_token);

  // 2. ChatGPT static OAuth callback works out of the box
  const chatgptTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: staticClient.client_id,
    clientSecret: staticClient.client_secret,
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    pin,
    usePkce: true
  });
  assert.ok(chatgptTokens.access_token);

  // 3. client_credentials grant works for confidential clients
  const ccRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: staticClient.client_id,
      client_secret: staticClient.client_secret
    })
  });
  assert.equal(ccRes.status, 200);
  const ccData = await ccRes.json();
  assert.ok(ccData.access_token);
  assert.equal(ccData.refresh_token, undefined);

  // 4. Admin API adds custom OAuth redirect origin & creates/revokes static Bearer API Key
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const oauthCfgRes = await fetch(`${baseUrl}/admin/api/config/oauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      allowedRedirectOrigins: ['https://example.com/oauth/callback']
    })
  });
  assert.equal(oauthCfgRes.status, 200);

  const customTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: staticClient.client_id,
    clientSecret: staticClient.client_secret,
    redirectUri: 'https://example.com/oauth/callback',
    pin,
    usePkce: true
  });
  assert.ok(customTokens.access_token);

  // Create Bearer API Key
  const createKeyRes = await fetch(`${baseUrl}/admin/api/auth/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'Custom Script Client' })
  });
  assert.equal(createKeyRes.status, 201);
  const createdKeyData = await createKeyRes.json();
  const apiKeyToken = createdKeyData.createdKey.token;
  const apiKeyId = createdKeyData.createdKey.id;
  assert.ok(apiKeyToken.startsWith('gp_key_'));

  // Connect MCP client directly with static Bearer API Key (no OAuth dance)
  const apiClient = new Client({ name: 'custom-apikey-client', version: '1.0.0' });
  const apiTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${apiKeyToken}` }
    }
  });
  await apiClient.connect(apiTransport);
  const infoRes = await apiClient.callTool({ name: 'workspace_info', arguments: {} });
  assert.equal(Boolean(infoRes.isError), false);
  await apiClient.close();

  // Revoke API Key and verify 401
  const delKeyRes = await fetch(`${baseUrl}/admin/api/auth/api-keys/${encodeURIComponent(apiKeyId)}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie }
  });
  assert.equal(delKeyRes.status, 200);

  const rejectedRes = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${apiKeyToken}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  });
  assert.equal(rejectedRes.status, 401);
});

test('Federates Antigravity Operator stdio MCP tools seamlessly', async (t) => {
  const env = createTempEnv();
  const mockOpScript = path.join(env.base, 'mock-operator.mjs');
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
        serverInfo: { name: 'mock-antigravity-operator', version: '1.1.0' }
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'operator_chrome_status',
            description: 'Mock Chrome status',
            inputSchema: {
              type: 'object',
              properties: { verbose: { type: 'boolean', description: 'Detalle extra' } }
            }
          }
        ]
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ connected: true, echo: msg.params?.arguments || {} }) }]
      }
    }) + '\\n');
  }
});
`,
    'utf8'
  );

  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: true
  });
  configManager.updateOperatorConfig({ enabled: true, serverPath: mockOpScript });

  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const apiKey = configManager.createApiKey('Operator Test');
  const client = new Client({ name: 'operator-federation-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${apiKey.token}` }
    }
  });
  await client.connect(transport);

  const toolsList = await client.listTools();
  const names = toolsList.tools.map((x) => x.name);
  assert.ok(names.includes('workspace_info'), 'Debe incluir herramientas base');
  assert.ok(names.includes('operator_chrome_status'), 'Debe incluir herramientas federadas del operator');

  const callRes = await client.callTool({
    name: 'operator_chrome_status',
    arguments: { verbose: true }
  });
  assert.equal(Boolean(callRes.isError), false);
  const parsed = JSON.parse(callRes.content[0].text);
  assert.equal(parsed.connected, true);
  assert.equal(parsed.echo.verbose, true);

  await client.close();
});



test('Seguridad: un cliente registrado por /register (DCR) no puede obtener token con client_credentials', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // Un atacante no debe poder registrar callbacks bajo su propio dominio.
  const blockedRegRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'redirect externo',
      redirect_uris: ['https://evil.example/cb'],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(blockedRegRes.status, 400);

  // Un cliente DCR con callback permitido sigue necesitando el PIN y no puede usar client_credentials.
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'atacante',
      redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/dcr-test'],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['client_credentials']
    })
  });
  assert.equal(regRes.status, 201);
  const rogue = await regRes.json();
  assert.ok(rogue.client_secret);

  // Con client_credentials NO debe recibir token.
  const ccRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: rogue.client_id,
      client_secret: rogue.client_secret
    })
  });
  assert.equal(ccRes.status, 400);
  const body = await ccRes.json();
  assert.equal(body.access_token, undefined);

  // Y sin token, /mcp sigue cerrado.
  const mcpRes = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  });
  assert.equal(mcpRes.status, 401);
});


test('DCR poda clientes inactivos sin tokens y conserva los que aún tienen tokens', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const register = async (clientName) => {
    const response = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: ['https://claude.ai/oauth/callback'],
        token_endpoint_auth_method: 'none'
      })
    });
    assert.equal(response.status, 201);
    return response.json();
  };

  const abandoned = await register('abandoned');
  const active = await register('active');
  const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;

  srv.authService.state.clients[abandoned.client_id]._lastUsedAt = oldTimestamp;
  srv.authService.state.clients[active.client_id]._lastUsedAt = oldTimestamp;
  srv.authService.state.accessTokens['test-live-token'] = {
    clientId: active.client_id,
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  };

  const fresh = await register('fresh-trigger');

  assert.equal(srv.authService.state.clients[abandoned.client_id], undefined);
  assert.ok(srv.authService.state.clients[active.client_id]);
  assert.ok(srv.authService.state.clients[fresh.client_id]);
});


test('ConfigManager no permite el servidor ni Operator como workspaces', (t) => {
  const env = createTempEnv();
  t.after(() => fs.rmSync(env.base, { recursive: true, force: true }));

  const operatorRoot = path.dirname(path.dirname(DEFAULT_OPERATOR_SERVER_PATH));
  const allowedWorkspaces = [env.ws1, APP_ROOT];
  if (fs.existsSync(operatorRoot)) allowedWorkspaces.push(operatorRoot);
  fs.mkdirSync(env.dataDir, { recursive: true });

  fs.writeFileSync(path.join(env.dataDir, 'config.json'), JSON.stringify({
    activeWorkspace: env.ws1,
    allowedWorkspaces
  }), 'utf8');

  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    operatorEnabled: false
  });

  const configured = configManager.get().allowedWorkspaces.map((item) => item.toLowerCase());
  assert.ok(configured.includes(env.ws1.toLowerCase()));
  assert.ok(!configured.includes(APP_ROOT.toLowerCase()));
  assert.throws(() => configManager.addWorkspace(APP_ROOT), /No se permite/);
  assert.throws(() => configManager.selectWorkspace(APP_ROOT), /No se permite/);

  if (fs.existsSync(operatorRoot)) {
    assert.ok(!configured.includes(fs.realpathSync(operatorRoot).toLowerCase()));
    assert.throws(() => configManager.addWorkspace(operatorRoot), /No se permite/);
  }
});

test('MCP rechaza tokens que no incluyen el scope mcp:tools', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const staticClient = configManager.get().staticClient;
  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: staticClient.client_id,
      client_secret: staticClient.client_secret,
      scope: 'files:read'
    })
  });
  assert.equal(tokenRes.status, 200);
  const tokenBody = await tokenRes.json();

  const mcpRes = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  });
  assert.equal(mcpRes.status, 403);
});

test('Gemini DCR con 6 redirect_uris (prod, sandbox y test) es aceptado y subdirectorios de APP_ROOT siguen bloqueados', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // Google Gemini envía los 3 dominios oauth-redirect* al hacer DCR
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Google',
      redirect_uris: [
        'https://oauth-redirect-sandbox.googleusercontent.com/r/user_bound_custom-mcp-abc123',
        'https://oauth-redirect-test.googleusercontent.com/r/user_bound_custom-mcp-abc123',
        'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-abc123',
        'https://oauth-redirect-sandbox.googleusercontent.com/a/user_bound_custom-mcp-abc123',
        'https://oauth-redirect-test.googleusercontent.com/a/user_bound_custom-mcp-abc123',
        'https://oauth-redirect.googleusercontent.com/a/user_bound_custom-mcp-abc123'
      ],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(regRes.status, 201);

  // Subcarpetas internas del servidor siguen bloqueadas, mientras playground está permitido
  assert.throws(() => configManager.addWorkspace(path.join(APP_ROOT, 'src')), /No se permite/);
  assert.throws(() => configManager.addWorkspace(path.join(APP_ROOT, 'panel')), /No se permite/);
  if (fs.existsSync(DEFAULT_PLAYGROUND)) {
    const added = configManager.addWorkspace(DEFAULT_PLAYGROUND, { activate: false });
    assert.equal(added.toLowerCase(), fs.realpathSync(DEFAULT_PLAYGROUND).toLowerCase());
  }
});

test('MCP expone instructions, resource/prompt guía, schemas enriquecidos y lectura multimodal (imagen, PDF texto+visual, DOCX, lote)', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // 1) Crear archivos de prueba: texto, PNG 1x1, PDF 1 página y DOCX válido
  fs.writeFileSync(path.join(env.ws1, 'notas.txt'), 'linea 1\nlinea 2\nlinea 3\n', 'utf8');
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  fs.writeFileSync(path.join(env.ws1, 'pixel.png'), Buffer.from(tinyPngBase64, 'base64'));

  // Minimal valid 1-page PDF
  const pdfObjs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    '4 0 obj << /Length 49 >> stream\nBT /F1 20 Tf 72 720 Td (CV Vicente PDF Prueba) Tj ET\nendstream endobj\n',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'
  ];
  let pdfStr = '%PDF-1.4\n';
  const offsets = [0];
  for (const o of pdfObjs) {
    offsets.push(Buffer.byteLength(pdfStr, 'utf8'));
    pdfStr += o;
  }
  const xrefPos = Buffer.byteLength(pdfStr, 'utf8');
  pdfStr += `xref\n0 ${pdfObjs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfStr += `trailer << /Size ${pdfObjs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  fs.writeFileSync(path.join(env.ws1, 'cv.pdf'), pdfStr, 'utf8');

  // Create minimal valid .docx using python stdlib zipfile
  const { execFileSync } = await import('node:child_process');
  const docxPath = path.join(env.ws1, 'perfil.docx');
  execFileSync('python', [
    '-c',
    'import os, zipfile; z=zipfile.ZipFile(os.environ["OUT"], "w"); z.writestr("word/document.xml", "<w:document xmlns:w=\\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\\"><w:body><w:p><w:r><w:t>Resumen DOCX Vicente</w:t></w:r></w:p></w:body></w:document>"); z.close()'
  ], { env: { ...process.env, OUT: docxPath }, windowsHide: true });

  const apiKey = configManager.createApiKey('Guide & Multimodal Test');
  const client = new Client({ name: 'multimodal-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  });
  await client.connect(transport);
  t.after(async () => client.close().catch(() => {}));

  // Verify MCP instructions, resource, and prompt
  const instructions = client.getInstructions() || '';
  assert.match(instructions, /read_file/);
  assert.match(instructions, /renderPages/);

  const resList = await client.listResources();
  assert.ok(resList.resources.some((r) => r.uri === 'mcp://workspace-operator/guide'));
  const guideRes = await client.readResource({ uri: 'mcp://workspace-operator/guide' });
  assert.match(guideRes.contents[0].text, /PC Workspace & Operator MCP/);

  const promptsList = await client.listPrompts();
  assert.ok(promptsList.prompts.some((p) => p.name === 'como_usar_este_mcp'));
  const promptVal = await client.getPrompt({ name: 'como_usar_este_mcp' });
  assert.match(promptVal.messages[0].content.text, /read_files/);

  // Image inline reading
  const imgRes = await client.callTool({ name: 'read_file', arguments: { path: 'pixel.png' } });
  assert.equal(Boolean(imgRes.isError), false);
  assert.equal(imgRes.content[1]?.type, 'image');
  assert.equal(imgRes.content[1]?.mimeType, 'image/png');

  // DOCX text reading
  const docxRes = await client.callTool({ name: 'read_file', arguments: { path: 'perfil.docx' } });
  assert.equal(Boolean(docxRes.isError), false);
  const docxJson = JSON.parse(docxRes.content[0].text);
  assert.equal(docxJson.type, 'docx');
  assert.match(docxJson.content, /Resumen DOCX Vicente/);

  // PDF text reading
  const pdfTextRes = await client.callTool({ name: 'read_file', arguments: { path: 'cv.pdf' } });
  assert.equal(Boolean(pdfTextRes.isError), false);
  const pdfTextJson = JSON.parse(pdfTextRes.content[0].text);
  assert.equal(pdfTextJson.type, 'pdf');
  assert.equal(pdfTextJson.totalPages, 1);
  assert.match(pdfTextJson.pages[0].text, /CV Vicente PDF Prueba/);

  // PDF visual rendering on Windows (WinRT, zero Chrome!)
  if (process.platform === 'win32') {
    const pdfVisRes = await client.callTool({
      name: 'read_file',
      arguments: { path: 'cv.pdf', renderPages: true, pages: '1' }
    });
    assert.equal(Boolean(pdfVisRes.isError), false, pdfVisRes.content?.[0]?.text);
    const pdfVisMeta = JSON.parse(pdfVisRes.content[0].text);
    assert.equal(pdfVisMeta.type, 'pdf_visual');
    assert.equal(pdfVisRes.content[1]?.type, 'image');
    assert.equal(pdfVisRes.content[1]?.mimeType, 'image/jpeg');
  }

  // Batch read_files in a single tool call
  const batchRes = await client.callTool({
    name: 'read_files',
    arguments: { paths: ['notas.txt', 'perfil.docx', 'cv.pdf', 'pixel.png'] }
  });
  assert.equal(Boolean(batchRes.isError), false);
  const batchJson = JSON.parse(batchRes.content[0].text);
  assert.equal(batchJson.files.length, 4);
  assert.equal(batchJson.files[0].ok, true);
  assert.match(batchJson.files[1].content, /Resumen DOCX Vicente/);
  assert.match(batchJson.files[2].content, /CV Vicente PDF Prueba/);
  assert.equal(batchJson.files[3].type, 'image');
});

test('Sesiones paralelas aisladas: workspace y Operator bridge por cliente sin interrupciones', async (t) => {
  const env = createTempEnv();
  fs.writeFileSync(path.join(env.ws1, 'owner.txt'), 'WORKSPACE_1', 'utf8');
  fs.writeFileSync(path.join(env.ws2, 'owner.txt'), 'WORKSPACE_2', 'utf8');

  const mockOpScript = path.join(env.base, 'mock-isolated-operator.mjs');
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
        serverInfo: { name: 'mock-isolated-operator', version: '1.1.0' }
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'operator_chrome_act',
            description: 'Mock Chrome act',
            inputSchema: {
              type: 'object',
              properties: {
                files: {
                  oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  description: 'Local file path(s).'
                },
                for_user: { type: 'boolean', default: false, description: 'Handoff flag.' }
              }
            }
          }
        ]
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
            pid: process.pid,
            label: process.env.AG_OPERATOR_CLIENT_LABEL || '',
            sessionKey: process.env.AG_OPERATOR_SESSION_KEY || '',
            args: msg.params?.arguments || {}
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
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: true
  });
  configManager.addWorkspace(env.ws2, { activate: false });
  configManager.updateOperatorConfig({ enabled: true, serverPath: mockOpScript });

  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const keyClaude = configManager.createApiKey('Claude Paralelo');
  const keyGemini = configManager.createApiKey('Gemini Paralelo');

  const connectClient = async (name, token) => {
    const c = new Client({ name, version: '1.0.0' });
    const tr = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    await c.connect(tr);
    return c;
  };

  const clientA = await connectClient('claude-parallel', keyClaude.token);
  const clientB = await connectClient('gemini-parallel', keyGemini.token);
  t.after(async () => {
    await clientA.close().catch(() => {});
    await clientB.close().catch(() => {});
  });

  // Verify federated schema preserves oneOf (anyOf in JSON Schema) and default hint without mutation
  const toolsA = await clientA.listTools();
  const actTool = toolsA.tools.find((x) => x.name === 'operator_chrome_act');
  assert.ok(actTool);
  assert.ok(Array.isArray(actTool.inputSchema.properties.files.anyOf));
  assert.match(actTool.inputSchema.properties.for_user.description, /default: false/);

  // 1) Workspace isolation: Client A switches to ws2, Client B stays in ws1!
  await clientA.callTool({ name: 'select_workspace', arguments: { path: env.ws2 } });

  const [readA, readB] = await Promise.all([
    clientA.callTool({ name: 'read_file', arguments: { path: 'owner.txt' } }),
    clientB.callTool({ name: 'read_file', arguments: { path: 'owner.txt' } })
  ]);
  assert.match(JSON.parse(readA.content[0].text).content, /WORKSPACE_2/);
  assert.match(JSON.parse(readB.content[0].text).content, /WORKSPACE_1/);

  // 2) Operator isolation: parallel calls spawn two distinct Operator child processes (distinct PIDs)
  const [opA1, opB1] = await Promise.all([
    clientA.callTool({ name: 'operator_chrome_act', arguments: { files: ['a.pdf'] } }),
    clientB.callTool({ name: 'operator_chrome_act', arguments: { files: 'b.pdf' } })
  ]);
  const resA1 = JSON.parse(opA1.content[0].text);
  const resB1 = JSON.parse(opB1.content[0].text);
  assert.notEqual(resA1.pid, resB1.pid, 'Cada cliente paralelo debe tener su propio proceso Operator aislado');
  assert.equal(resA1.label, 'Claude Paralelo');
  assert.equal(resB1.label, 'Gemini Paralelo');

  // 3) Stopping ONLY Client A's Operator bridge via /admin does NOT interrupt Client B's Operator process!
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: configManager.get().pin })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const stopARes = await fetch(`${baseUrl}/admin/api/operator/sessions/${encodeURIComponent(resA1.sessionKey)}/stop`, {
    method: 'POST',
    headers: { Cookie: adminCookie }
  });
  assert.equal(stopARes.status, 200);
  const stopAData = await stopARes.json();
  assert.equal(stopAData.stopped, true);

  // Client B keeps the exact same PID; Client A cleanly spawns a fresh isolated PID
  const opB2 = await clientB.callTool({ name: 'operator_chrome_act', arguments: { files: 'b2.pdf' } });
  const resB2 = JSON.parse(opB2.content[0].text);
  assert.equal(resB2.pid, resB1.pid, 'Detener el bridge de Cliente A no debe afectar a Cliente B');

  const opA2 = await clientA.callTool({ name: 'operator_chrome_act', arguments: { files: 'a2.pdf' } });
  const resA2 = JSON.parse(opA2.content[0].text);
  assert.notEqual(resA2.pid, resA1.pid);
  assert.notEqual(resA2.pid, resB2.pid);
});

test('Modo Control Total, Gestor de Demonios/Consolas persistentes y mejoras del Gestor de Workspaces', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  configManager.addWorkspace(env.ws2, { activate: false });

  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const apiKey = configManager.createApiKey('Daemon Tester');
  const client = new Client({ name: 'daemon-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  });
  await client.connect(transport);
  t.after(async () => client.close().catch(() => {}));

  // 1) Con Modo Control Total apagado, process_start debe rechazarse
  const blockedStart = await client.callTool({
    name: 'process_start',
    arguments: { command: 'echo hola', name: 'bloqueado' }
  });
  assert.equal(blockedStart.isError, true);
  assert.match(blockedStart.content[0].text, /Modo Control Total/);

  // Login en /admin
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: configManager.get().pin })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  // 2) Activar Modo Control Total desde /admin
  const fcOnRes = await fetch(`${baseUrl}/admin/api/config/full-control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ enabled: true, ttlMinutes: 60, allowUnrestrictedCwd: false, stopProcessesOnDisable: true })
  });
  assert.equal(fcOnRes.status, 200);
  const fcOnData = await fcOnRes.json();
  assert.equal(fcOnData.fullControl.enabled, true);
  assert.ok(fcOnData.fullControl.expiresAt);

  // 3) Lanzar una consola interactiva viva en segundo plano (Node stdin->stdout echo)
  const startRes = await client.callTool({
    name: 'process_start',
    arguments: {
      name: 'Echo Interactivo',
      command: `node -e "process.stdin.setEncoding('utf8'); console.log('READY_DAEMON'); process.stdin.on('data', d => console.log('ECHO:' + d.trim()));"`,
      waitMs: 700
    }
  });
  assert.equal(Boolean(startRes.isError), false, startRes.content?.[0]?.text);
  const proc = JSON.parse(startRes.content[0].text);
  assert.equal(proc.status, 'running');
  assert.ok(proc.pid);
  assert.match(proc.tailPreview, /READY_DAEMON/);

  // 4) Enviar entrada por stdin con process_send y leer salida nueva
  const sendRes = await client.callTool({
    name: 'process_send',
    arguments: { id: proc.id, input: 'hola-vicente', waitMs: 500 }
  });
  assert.equal(Boolean(sendRes.isError), false, sendRes.content?.[0]?.text);
  const sendOut = JSON.parse(sendRes.content[0].text);
  assert.match(sendOut.output, /ECHO:hola-vicente/);

  // 5) Verificar en /admin/api/state y /admin/api/processes/:id/output
  const listRes = await client.callTool({ name: 'process_list', arguments: {} });
  const listJson = JSON.parse(listRes.content[0].text);
  assert.equal(listJson.runningCount, 1);

  const adminOutRes = await fetch(`${baseUrl}/admin/api/processes/${encodeURIComponent(proc.id)}/output`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(adminOutRes.status, 200);
  const adminOut = await adminOutRes.json();
  assert.match(adminOut.output, /ECHO:hola-vicente/);

  // 6) Apagar Modo Control Total debe detener automáticamente los demonios activos
  const fcOffRes = await fetch(`${baseUrl}/admin/api/config/full-control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(fcOffRes.status, 200);
  const fcOffData = await fcOffRes.json();
  assert.equal(fcOffData.fullControl.enabled, false);
  assert.equal(fcOffData.state.daemons.runningCount, 0);

  // 7) Gestor de Workspaces mejorado: detalles + sincronización de overrides de sesión
  await client.callTool({ name: 'select_workspace', arguments: { path: env.ws2 } });
  const stBefore = await (await fetch(`${baseUrl}/admin/api/state`, { headers: { Cookie: adminCookie } })).json();
  const ws2Detail = stBefore.workspaces.details.find((d) => d.path.toLowerCase() === fs.realpathSync(env.ws2).toLowerCase());
  assert.ok(ws2Detail);
  assert.equal(ws2Detail.exists, true);
  assert.ok(ws2Detail.usedBy.includes('Daemon Tester'));

  const resetRes = await fetch(`${baseUrl}/admin/api/workspaces/reset-sessions`, {
    method: 'POST',
    headers: { Cookie: adminCookie }
  });
  assert.equal(resetRes.status, 200);
  const resetData = await resetRes.json();
  assert.equal(resetData.cleared, 1);

  const infoAfterReset = JSON.parse((await client.callTool({ name: 'workspace_info', arguments: {} })).content[0].text);
  assert.equal(infoAfterReset.activeWorkspace.toLowerCase(), fs.realpathSync(env.ws1).toLowerCase());
});

test('Tool use_skill lista y carga skills SKILL.md (workspace, global y builtin) en solo lectura', async (t) => {
  const env = createTempEnv();
  const wsSkillDir = path.join(env.ws1, 'skills', 'mi-flujo');
  const globalSkillsDir = path.join(env.base, 'global-skills');
  const globalSkillDir = path.join(globalSkillsDir, 'cv-demo');
  fs.mkdirSync(wsSkillDir, { recursive: true });
  fs.mkdirSync(globalSkillDir, { recursive: true });

  fs.writeFileSync(
    path.join(wsSkillDir, 'SKILL.md'),
    '---\nname: mi-flujo\ndescription: Flujo personalizado del workspace\n---\n\n# Mi Flujo\nPaso 1: revisar PDFs.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(globalSkillDir, 'SKILL.md'),
    '---\nname: cv-demo\ndescription: >-\n  Skill global multilinea de prueba\n---\n\n# CV Demo\nContenido de prueba.\n',
    'utf8'
  );

  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0, globalSkillsDir });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const apiKey = configManager.createApiKey('Skills Tester');
  const client = new Client({ name: 'skills-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  });
  await client.connect(transport);
  t.after(async () => client.close().catch(() => {}));

  const tools = (await client.listTools()).tools;
  const skillTool = tools.find((x) => x.name === 'use_skill');
  assert.ok(skillTool);
  assert.equal(skillTool.annotations?.readOnlyHint, true);

  // Listar todas
  const listRes = await client.callTool({ name: 'use_skill', arguments: {} });
  assert.equal(Boolean(listRes.isError), false);
  const listJson = JSON.parse(listRes.content[0].text);
  const names = listJson.skills.map((s) => s.name);
  assert.ok(names.includes('workspace-operator-guide'));
  assert.ok(names.includes('mi-flujo'));
  assert.ok(names.includes('cv-demo'));

  // Cargar skill de workspace
  const wsRes = await client.callTool({ name: 'use_skill', arguments: { name: 'mi-flujo' } });
  const wsJson = JSON.parse(wsRes.content[0].text);
  assert.equal(wsJson.source, 'workspace');
  assert.match(wsJson.content, /Paso 1: revisar PDFs/);

  // Cargar skill global con frontmatter multilinea
  const glRes = await client.callTool({ name: 'use_skill', arguments: { name: 'cv-demo' } });
  const glJson = JSON.parse(glRes.content[0].text);
  assert.equal(glJson.source, 'global');
  assert.match(glJson.description, /Skill global multilinea de prueba/);
  assert.match(glJson.content, /Contenido de prueba/);

  // Error accionable si no existe
  const missingRes = await client.callTool({ name: 'use_skill', arguments: { name: 'inexistente' } });
  assert.equal(missingRes.isError, true);
  assert.match(missingRes.content[0].text, /Skills disponibles/);
});

test('OAuth 30d access_token TTL, ventana de gracia en refresh_token y annotations idempotentes para Gemini vs Claude', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const pin = configManager.get().pin;

  // 1) Registrar dos clientes DCR: Google (Gemini) y Claude
  const regGoogleRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Google',
      redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/ttl-grace-test'],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(regGoogleRes.status, 201);
  const googleClient = await regGoogleRes.json();

  const regClaudeRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(regClaudeRes.status, 201);
  const claudeClient = await regClaudeRes.json();

  // 2) Autorizar Google y comprobar expires_in === 30 días (2592000 s)
  const googleTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: googleClient.client_id,
    redirectUri: 'https://oauth-redirect.googleusercontent.com/r/ttl-grace-test',
    pin,
    usePkce: true
  });
  assert.equal(googleTokens.expires_in, 30 * 24 * 60 * 60);
  assert.ok(googleTokens.refresh_token);

  const claudeTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: claudeClient.client_id,
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    pin,
    usePkce: true
  });
  assert.equal(claudeTokens.expires_in, 30 * 24 * 60 * 60);

  // 3) Ventana de gracia en refresh_token (60s): dos peticiones con el mismo refresh_token devuelven el mismo par
  const refreshOnce = async (clientId, refreshToken) => fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken
    })
  });

  const r1 = await refreshOnce(googleClient.client_id, googleTokens.refresh_token);
  assert.equal(r1.status, 200);
  const r1Json = await r1.json();
  assert.equal(r1Json.expires_in, 30 * 24 * 60 * 60);
  assert.ok(r1Json.access_token);

  const r2 = await refreshOnce(googleClient.client_id, googleTokens.refresh_token);
  assert.equal(r2.status, 200);
  const r2Json = await r2.json();
  assert.equal(r2Json.access_token, r1Json.access_token);
  assert.equal(r2Json.refresh_token, r1Json.refresh_token);

  // Otro cliente no puede usar ese refresh_token antiguo en ventana de gracia
  const crossClientRefresh = await refreshOnce(claudeClient.client_id, googleTokens.refresh_token);
  assert.equal(crossClientRefresh.status, 400);

  // 4) Annotations: Gemini recibe readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=false;
  //    Claude mantiene las annotations reales (run_command: readOnlyHint=false, destructiveHint=true)
  const mcpGoogle = new Client({ name: 'gemini-check', version: '1.0.0' });
  await mcpGoogle.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${r1Json.access_token}` } }
  }));
  t.after(async () => mcpGoogle.close().catch(() => {}));

  const googleTools = (await mcpGoogle.listTools()).tools;
  assert.ok(googleTools.length > 0);
  for (const tool of googleTools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `Gemini ${tool.name} debe tener readOnlyHint=true`);
    assert.equal(tool.annotations?.destructiveHint, false, `Gemini ${tool.name} debe tener destructiveHint=false`);
    assert.equal(tool.annotations?.idempotentHint, true, `Gemini ${tool.name} debe tener idempotentHint=true`);
    assert.equal(tool.annotations?.openWorldHint, false, `Gemini ${tool.name} debe tener openWorldHint=false`);
  }
  const googleRunCmd = googleTools.find((x) => x.name === 'run_command');
  assert.deepEqual(
    {
      readOnlyHint: googleRunCmd.annotations.readOnlyHint,
      destructiveHint: googleRunCmd.annotations.destructiveHint,
      idempotentHint: googleRunCmd.annotations.idempotentHint,
      openWorldHint: googleRunCmd.annotations.openWorldHint
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  );

  const mcpClaude = new Client({ name: 'claude-check', version: '1.0.0' });
  await mcpClaude.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${claudeTokens.access_token}` } }
  }));
  t.after(async () => mcpClaude.close().catch(() => {}));

  const claudeTools = (await mcpClaude.listTools()).tools;
  const claudeRunCmd = claudeTools.find((x) => x.name === 'run_command');
  assert.equal(claudeRunCmd.annotations?.readOnlyHint, false);
  assert.equal(claudeRunCmd.annotations?.destructiveHint, true);

  // 5) revokeAllTokens() también invalida la ventana de gracia
  srv.authService.revokeAllTokens();
  const afterRevokeRefresh = await refreshOnce(googleClient.client_id, googleTokens.refresh_token);
  assert.equal(afterRevokeRefresh.status, 400);
});

test('Rutas dedicadas /mcp/gemini y /mcp/gemini/:slot, PRM RFC 9728 y detección por redirect_uri googleusercontent', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // 1) Discovery RFC 9728 por ruta (/mcp/gemini y /mcp/gemini/2) y 404 para rutas inválidas
  for (const sub of ['/mcp/gemini', '/mcp/gemini/2']) {
    const prmRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource${sub}`, {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'node-demo.ts.net' }
    });
    assert.equal(prmRes.status, 200);
    const prm = await prmRes.json();
    assert.equal(prm.resource, `https://node-demo.ts.net${sub}`);
    assert.deepEqual(prm.authorization_servers, ['https://node-demo.ts.net']);
  }

  const badPrmRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/otra`);
  assert.equal(badPrmRes.status, 404);

  // 2) 401 en /mcp/gemini apunta WWW-Authenticate al metadata de /mcp/gemini
  const unauthGemini = await fetch(`${baseUrl}/mcp/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'node-demo.ts.net'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  });
  assert.equal(unauthGemini.status, 401);
  assert.match(
    unauthGemini.headers.get('www-authenticate') || '',
    /https:\/\/node-demo\.ts\.net\/\.well-known\/oauth-protected-resource\/mcp\/gemini/
  );

  // 3) API Key con nombre genérico: en /mcp ve annotations reales, en /mcp/gemini y /mcp/gemini/2 recibe readOnlyHint=true
  const genericKey = configManager.createApiKey('Cliente Generico');

  const connectAt = async (endpointPath) => {
    const c = new Client({ name: 'route-test-client', version: '1.0.0' });
    const tr = new StreamableHTTPClientTransport(new URL(`${baseUrl}${endpointPath}`), {
      requestInit: { headers: { Authorization: `Bearer ${genericKey.token}` } }
    });
    await c.connect(tr);
    t.after(async () => c.close().catch(() => {}));
    return c;
  };

  const clientDefault = await connectAt('/mcp');
  const toolsDefault = (await clientDefault.listTools()).tools;
  const runCmdDefault = toolsDefault.find((x) => x.name === 'run_command');
  assert.equal(runCmdDefault.annotations?.readOnlyHint, false);
  assert.equal(runCmdDefault.annotations?.destructiveHint, true);

  for (const geminiPath of ['/mcp/gemini', '/mcp/gemini/2']) {
    const clientGemini = await connectAt(geminiPath);
    const toolsGemini = (await clientGemini.listTools()).tools;
    assert.ok(toolsGemini.length > 0);
    for (const tool of toolsGemini) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${geminiPath} ${tool.name} readOnlyHint`);
      assert.equal(tool.annotations?.destructiveHint, false, `${geminiPath} ${tool.name} destructiveHint`);
      assert.equal(tool.annotations?.idempotentHint, true, `${geminiPath} ${tool.name} idempotentHint`);
      assert.equal(tool.annotations?.openWorldHint, false, `${geminiPath} ${tool.name} openWorldHint`);
      assert.ok(tool.annotations?.title, `${geminiPath} ${tool.name} debe incluir annotations.title`);
    }
  }

  // 4) Cliente DCR cuyo client_name NO dice Google/Gemini, pero usa redirect_uri googleusercontent.com, recibe readOnlyHint=true en /mcp
  const regCustomRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Custom App',
      redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/custom-test'],
      token_endpoint_auth_method: 'none'
    })
  });
  assert.equal(regCustomRes.status, 201);
  const customClient = await regCustomRes.json();

  const customTokens = await authorizeAndGetTokens({
    baseUrl,
    clientId: customClient.client_id,
    redirectUri: 'https://oauth-redirect.googleusercontent.com/r/custom-test',
    pin: configManager.get().pin,
    usePkce: true
  });

  const mcpCustom = new Client({ name: 'custom-google-redirect', version: '1.0.0' });
  await mcpCustom.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${customTokens.access_token}` } }
  }));
  t.after(async () => mcpCustom.close().catch(() => {}));

  const customTools = (await mcpCustom.listTools()).tools;
  const customRunCmd = customTools.find((x) => x.name === 'run_command');
  assert.equal(customRunCmd.annotations?.readOnlyHint, true);
  assert.equal(customRunCmd.annotations?.destructiveHint, false);
});

test('Segment 1: UI language config (EN/ES), bilingual login & OAuth consent, and bundled public skills discovery', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  assert.equal(configManager.get().ui.language, 'en');

  const srv = await createMcpAppServer({ configManager, port: 0, globalSkillsDir: null });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // 1) Admin login renders in English by default and supports ?lang=es
  const loginEn = await (await fetch(`${baseUrl}/admin`)).text();
  assert.match(loginEn, /<html lang="en">/);
  assert.match(loginEn, /Open Control Panel/);

  const loginEs = await (await fetch(`${baseUrl}/admin?lang=es`)).text();
  assert.match(loginEs, /<html lang="es">/);
  assert.match(loginEs, /Entrar al Panel/);

  // 2) OAuth consent renders in English by default and supports ?lang=es
  const staticClient = configManager.get().staticClient;
  const consentParams = new URLSearchParams({
    client_id: staticClient.client_id,
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    response_type: 'code'
  });
  const consentEn = await (await fetch(`${baseUrl}/authorize?${consentParams}`)).text();
  assert.match(consentEn, /<html lang="en">/);
  assert.match(consentEn, /Authorize PC-Operator-MCP Access/);

  const consentEs = await (await fetch(`${baseUrl}/authorize?${consentParams}&lang=es`)).text();
  assert.match(consentEs, /<html lang="es">/);
  assert.match(consentEs, /Autorizar acceso a PC-Operator-MCP/);

  // 3) Sign in to /admin and verify /admin/api/state + POST /admin/api/config/ui persistence
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: configManager.get().pin })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const st1 = await (await fetch(`${baseUrl}/admin/api/state`, { headers: { Cookie: adminCookie } })).json();
  assert.equal(st1.server.version, '0.5.0');
  assert.equal(st1.ui.language, 'en');
  assert.equal(st1.ui.theme, 'system');

  const badLangRes = await fetch(`${baseUrl}/admin/api/config/ui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ language: 'fr' })
  });
  assert.equal(badLangRes.status, 400);

  const badThemeRes = await fetch(`${baseUrl}/admin/api/config/ui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ theme: 'neon' })
  });
  assert.equal(badThemeRes.status, 400);

  const setEsRes = await fetch(`${baseUrl}/admin/api/config/ui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ language: 'es', theme: 'light' })
  });
  assert.equal(setEsRes.status, 200);
  const setEsJson = await setEsRes.json();
  assert.equal(setEsJson.ui.language, 'es');
  assert.equal(setEsJson.ui.theme, 'light');
  assert.equal(setEsJson.state.ui.language, 'es');
  assert.equal(setEsJson.state.ui.theme, 'light');

  const loginDarkRes = await (await fetch(`${baseUrl}/admin?theme=dark`)).text();
  assert.match(loginDarkRes, /<meta name="color-scheme" content="dark" \/>/);

  // Persisted language reflects in /internal/tray/status and reloaded ConfigManager
  const trayRes = await fetch(`${baseUrl}/internal/tray/status`, {
    headers: { 'x-tray-token': srv.trayToken }
  });
  assert.equal(trayRes.status, 200);
  const trayJson = await trayRes.json();
  assert.equal(trayJson.language, 'es');
  assert.equal(trayJson.version, '0.5.0');

  const reloaded = new ConfigManager({ dataDir: env.dataDir, defaultWorkspace: env.ws1, operatorEnabled: false });
  assert.equal(reloaded.get().ui.language, 'es');
  assert.equal(reloaded.get().ui.theme, 'light');

  // 4) Bundled public skills/ are automatically discovered by use_skill
  const apiKey = configManager.createApiKey('Bundled Skills Tester');
  const client = new Client({ name: 'bundled-skills-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  }));
  t.after(async () => client.close().catch(() => {}));

  const listRes = await client.callTool({ name: 'use_skill', arguments: {} });
  assert.equal(Boolean(listRes.isError), false);
  const listJson = JSON.parse(listRes.content[0].text);
  const byName = new Map(listJson.skills.map((s) => [s.name, s]));
  for (const expected of [
    'workspace-operator-guide',
    'windows-operator',
    'chrome-operator',
    'firefox-operator',
    'desktop-operator'
  ]) {
    assert.ok(byName.has(expected), `Expected bundled skill: ${expected}`);
    assert.equal(byName.get(expected).source, 'bundled');
  }
});

test('Auditoría 2 (4.1 y 4.3): run_command aclara permisos de usuario, protectSensitiveFiles solo tools de archivos, y logs Gemini no inducen solo lectura', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  const apiKey = configManager.createApiKey('Audit2 Clarity Test');
  const client = new Client({ name: 'audit2-clarity', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/gemini`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  }));
  t.after(async () => client.close().catch(() => {}));

  const instructions = client.getInstructions() || '';
  assert.match(instructions, /permisos completos del usuario/i);
  assert.match(instructions, /protectSensitiveFiles/);

  const tools = (await client.listTools()).tools;
  const runCmd = tools.find((x) => x.name === 'run_command');
  assert.ok(runCmd);
  assert.match(runCmd.description, /permisos completos del usuario/i);
  assert.match(runCmd.description, /protectSensitiveFiles solo cubre las tools de archivos/i);
  assert.equal(runCmd.annotations?.readOnlyHint, true);

  // protectSensitiveFiles error explicitly clarifies it only covers file tools
  const envWrite = await client.callTool({ name: 'write_file', arguments: { path: '.env', content: 'A=1' } });
  assert.equal(envWrite.isError, true);
  assert.match(envWrite.content[0].text, /solo cubre herramientas de archivos/i);

  // Logs on /mcp/gemini must not show misleading "Gemini readOnly=ON" or "readOnlyHint=true forzado"
  const logLines = srv.tunnelManager.getState().logs.map((l) => l.message).join('\n');
  assert.doesNotMatch(logLines, /Gemini readOnly=ON/);
  assert.doesNotMatch(logLines, /readOnlyHint=true forzado/);
  assert.match(logLines, /anotaciones compat Gemini/i);
});

test('Auditoría 2 (4.4): fallo en onToolEvent/handoff no rompe la tool y excepciones del handler quedan registradas', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // 1) Simulate disk/write failure inside handoffManager.recordToolCall
  let recordAttempts = 0;
  srv.handoffManager.recordToolCall = () => {
    recordAttempts += 1;
    throw new Error('ENOSPC: simulated disk error');
  };

  const apiKey = configManager.createApiKey('Audit2 Resilience Test');
  const client = new Client({ name: 'audit2-resilience', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey.token}` } }
  }));
  t.after(async () => client.close().catch(() => {}));

  const writeRes = await client.callTool({
    name: 'write_file',
    arguments: { path: 'resilient.txt', content: 'ok-despite-handoff-error' }
  });
  assert.equal(Boolean(writeRes.isError), false, `write_file no debe fallar si falla recordToolCall: ${writeRes.content?.[0]?.text}`);
  assert.equal(recordAttempts >= 1, true);
  assert.equal(fs.readFileSync(path.join(env.ws1, 'resilient.txt'), 'utf8'), 'ok-despite-handoff-error');

  // 2) Thrown handler exception in server.registerTool is still recorded in onToolEvent and rethrown
  const events = [];
  const harness = new WorkspaceHarness(configManager);
  const customMcp = createWorkspaceMcpServer(harness, {
    onToolEvent: (ev) => {
      events.push(ev);
    }
  });
  let wrappedCb = null;
  const registered = customMcp.registerTool(
    'boom_tool',
    { title: 'Boom', description: 'Throws directly' },
    async () => {
      throw new Error('direct-handler-boom');
    }
  );
  wrappedCb = registered.handler || registered.callback;
  assert.equal(typeof wrappedCb, 'function');
  await assert.rejects(() => wrappedCb({ sample: 1 }, {}), /direct-handler-boom/);
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, 'boom_tool');
  assert.equal(events[0].ok, false);
  assert.match(events[0].error, /direct-handler-boom/);
});

test('Auditoría 2 (4.5): CORS en /mcp permite orígenes autorizados y loopback, y no refleja orígenes arbitrarios', async (t) => {
  const env = createTempEnv();
  const configManager = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv = await createMcpAppServer({ configManager, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  t.after(async () => {
    await srv.close();
    fs.rmSync(env.base, { recursive: true, force: true });
  });

  // Allowed origins reflect Access-Control-Allow-Origin
  for (const allowedOrigin of [
    'https://claude.ai',
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://gemini.google.com',
    'https://oauth-redirect.googleusercontent.com',
    'http://127.0.0.1:6274',
    'http://localhost:5173'
  ]) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(res.status, 204, `OPTIONS para ${allowedOrigin}`);
    assert.equal(res.headers.get('access-control-allow-origin'), allowedOrigin);
  }

  // Arbitrary external origin must NOT be reflected (nor 500)
  for (const endpoint of ['/mcp', '/mcp/gemini', '/mcp/gemini/2']) {
    const evilRes = await fetch(`${baseUrl}${endpoint}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(evilRes.status, 204, `OPTIONS rechazado limpiamente en ${endpoint}`);
    assert.equal(evilRes.headers.get('access-control-allow-origin'), null);
  }

  // Custom OAuth origin configured dynamically is also honored by CORS
  configManager.updateOAuthConfig({ allowedRedirectOrigins: ['https://mi-cliente.example.org/oauth/cb'] });
  const customCorsRes = await fetch(`${baseUrl}/mcp`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://mi-cliente.example.org',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(customCorsRes.status, 204);
  assert.equal(customCorsRes.headers.get('access-control-allow-origin'), 'https://mi-cliente.example.org');

  // Server-to-server request without Origin header still succeeds with Bearer token
  const apiKey = configManager.createApiKey('No-Origin S2S');
  const s2sRes = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  });
  assert.equal(s2sRes.status, 200);
});
