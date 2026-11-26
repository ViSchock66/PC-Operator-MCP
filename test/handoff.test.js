import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConfigManager } from '../src/config.js';
import { createMcpAppServer } from '../src/server.js';

function createTempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-pc-mcp-handoff-'));
  const dataDir = path.join(base, 'data');
  const ws1 = path.join(base, 'ws-alpha');
  const ws2 = path.join(base, 'ws-beta');
  fs.mkdirSync(ws1, { recursive: true });
  fs.mkdirSync(ws2, { recursive: true });
  return { base, dataDir, ws1, ws2 };
}

async function connectWithApiKey(baseUrl, token, clientName = 'test-client') {
  const client = new Client({ name: clientName, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` }
    }
  });
  await client.connect(transport);
  return {
    client,
    callJson: async (name, args = {}) => {
      const res = await client.callTool({ name, arguments: args });
      assert.equal(Boolean(res.isError), false, `Tool ${name} falló: ${res.content?.[0]?.text}`);
      return JSON.parse(res.content[0].text);
    }
  };
}

test('Handoff 100% opt-in: cero contaminación en workspace_info, aislamiento por workspace, desambiguación segura, redacción de secretos y persistencia', async (t) => {
  const env = createTempEnv();
  t.after(() => fs.rmSync(env.base, { recursive: true, force: true }));

  // --- Phase 1: Server #1 ---
  const cm1 = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  cm1.addWorkspace(env.ws2, { activate: false });
  cm1.updatePermissions({ allowWrite: true, allowCommands: true });

  const claudeKey = cm1.createApiKey('Claude Web');
  const geminiKey = cm1.createApiKey('Gemini Web');
  const chatgptKey = cm1.createApiKey('ChatGPT');

  const srv1 = await createMcpAppServer({ configManager: cm1, port: 0 });
  const baseUrl1 = `http://127.0.0.1:${srv1.port}`;

  // Claude works in ws-alpha (writes file + runs command with secrets), then switches to ws-beta (writes another file)
  const claude = await connectWithApiKey(baseUrl1, claudeKey.token, 'claude');
  await claude.callJson('write_file', { path: 'src/alpha.js', content: 'export const a = 1;\n' });
  await claude.callJson('run_command', {
    command: 'node -e "console.log(\'Bearer supersecrettoken999 gp_key_abcdef1234567890 password=miClave123\')"'
  });

  await claude.callJson('select_workspace', { path: env.ws2 });
  await claude.callJson('write_file', { path: 'src/beta.js', content: 'export const b = 2;\n' });
  await claude.callJson('edit_file', {
    path: 'src/beta.js',
    target: 'export const b = 2;',
    replacement: 'export const b = 99;'
  });
  await claude.client.close().catch(() => {});

  // Check secret redaction directly on disk in data/handoffs.json
  const handoffsFile = path.join(env.dataDir, 'handoffs.json');
  assert.ok(fs.existsSync(handoffsFile), 'data/handoffs.json debe persistirse en disco');
  const rawDisk = fs.readFileSync(handoffsFile, 'utf8');
  assert.doesNotMatch(rawDisk, /supersecrettoken999/, 'Bearer token no debe guardarse en claro');
  assert.doesNotMatch(rawDisk, /gp_key_abcdef1234567890/, 'gp_key no debe guardarse en claro');
  assert.doesNotMatch(rawDisk, /miClave123/, 'password no debe guardarse en claro');
  assert.match(rawDisk, /\[REDACTED\]/);

  await srv1.close();

  // --- Phase 2: Server restart (#2) verifies persistence + strict zero-pollution + disambiguation ---
  const cm2 = new ConfigManager({
    dataDir: env.dataDir,
    defaultWorkspace: env.ws1,
    port: 0,
    operatorEnabled: false
  });
  const srv2 = await createMcpAppServer({ configManager: cm2, port: 0 });
  t.after(async () => srv2.close().catch(() => {}));
  const baseUrl2 = `http://127.0.0.1:${srv2.port}`;

  const gemini = await connectWithApiKey(baseUrl2, geminiKey.token, 'gemini');
  t.after(async () => gemini.client.close().catch(() => {}));

  // 1) ZERO POLLUTION: A brand-new unrelated chat calling workspace_info gets NO handoffAvailable or other-session hints
  const wsInfoClean = await gemini.callJson('workspace_info');
  assert.equal(wsInfoClean.activeWorkspace, fs.realpathSync(env.ws1));
  assert.equal(wsInfoClean.handoffAvailable, undefined, 'workspace_info jamás debe inyectar handoffAvailable');
  assert.doesNotMatch(JSON.stringify(wsInfoClean), /Claude Web|alpha\.js|beta\.js|hoff_|handoffAvailable/);

  // 2) SAME-CLIENT WORKSPACE PARTITIONING: Claude has 2 separate trails (ws-alpha and ws-beta)
  const listed = await gemini.callJson('handoff_list');
  assert.equal(listed.trailsCount, 2, 'Un mismo cliente en 2 workspaces debe generar 2 trails separados');
  const wsNames = listed.trails.map((x) => x.workspaceName).sort();
  assert.deepEqual(wsNames, ['ws-alpha', 'ws-beta']);

  // 3) SAFE DISAMBIGUATION: Calling handoff_resume() with NO filters when 2 distinct recent workspaces exist
  //    returns needsSelection=true and does NOT hijack Gemini's activeWorkspace!
  const ambiguous = await gemini.callJson('handoff_resume');
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.needsSelection, true);
  assert.equal(ambiguous.candidates.length, 2);
  const wsInfoStillUnchanged = await gemini.callJson('workspace_info');
  assert.equal(wsInfoStillUnchanged.activeWorkspace, fs.realpathSync(env.ws1), 'No debe cambiar el workspace si hay ambigüedad');

  // 4) TARGETED RESUME BY WORKSPACE: Resuming "ws-beta" aligns workspace to ws2 and ONLY brings beta.js (never alpha.js)
  const resumedBeta = await gemini.callJson('handoff_resume', { workspace: 'ws-beta' });
  assert.equal(resumedBeta.found, true);
  assert.equal(resumedBeta.mode, 'auto_trail_only');
  assert.equal(resumedBeta.workspaceAligned, true);
  assert.equal(resumedBeta.activeWorkspace, fs.realpathSync(env.ws2));
  assert.ok(resumedBeta.liveAutoTrail.modifiedFiles.some((f) => f.path === 'src/beta.js' && f.op === 'edit'));
  assert.equal(resumedBeta.liveAutoTrail.modifiedFiles.some((f) => f.path === 'src/alpha.js'), false, 'No debe mezclar archivos de ws-alpha');

  // --- Phase 3: Anti-cross-contamination between Checkpoint (ws-beta) and another model's activity (ws-alpha) ---
  const savedCp = await gemini.callJson('handoff_save', {
    title: 'Terminar beta.js',
    summary: 'b=99 listo, falta test.',
    pendingTasks: ['Escribir test unitario para beta.js'],
    relevantFiles: ['src/beta.js']
  });
  assert.ok(savedCp.id.startsWith('hoff_'));
  assert.equal(savedCp.status, 'pending');

  // Meanwhile, ChatGPT does unrelated work in ws-alpha AFTER Gemini saved the checkpoint in ws-beta
  const chatgpt = await connectWithApiKey(baseUrl2, chatgptKey.token, 'chatgpt');
  t.after(async () => chatgpt.client.close().catch(() => {}));
  await chatgpt.callJson('write_file', { path: 'src/unrelated.js', content: 'export const u = 1;\n' });

  // Resuming Gemini's checkpoint MUST NOT attach ChatGPT's ws-alpha liveAutoTrail or switch to ws-alpha!
  const resumedCp = await chatgpt.callJson('handoff_resume', { id: savedCp.id });
  assert.equal(resumedCp.found, true);
  assert.equal(resumedCp.checkpoint.id, savedCp.id);
  assert.equal(resumedCp.activeWorkspace, fs.realpathSync(env.ws2));
  if (resumedCp.liveAutoTrail) {
    assert.equal(resumedCp.liveAutoTrail.activeWorkspace, fs.realpathSync(env.ws2));
    assert.equal(resumedCp.liveAutoTrail.clientLabel, 'Gemini Web');
    assert.equal(resumedCp.liveAutoTrail.modifiedFiles.some((f) => f.path === 'src/unrelated.js'), false);
  }

  // --- Phase 4: /admin API freeze (with human note), prompt, clear_resumed & delete ---
  const loginRes = await fetch(`${baseUrl2}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pin: cm2.get().pin })
  });
  assert.equal(loginRes.status, 302);
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  const alphaTrail = listed.trails.find((x) => x.workspaceName === 'ws-alpha');
  assert.ok(alphaTrail?.trailKey);

  const freezeRes = await fetch(`${baseUrl2}/admin/api/handoffs/freeze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      trailKey: alphaTrail.trailKey,
      notes: 'Faltaba validar el token en alpha.js'
    })
  });
  assert.equal(freezeRes.status, 200);
  const freezeData = await freezeRes.json();
  assert.equal(freezeData.ok, true);
  assert.equal(freezeData.checkpoint.notes, 'Faltaba validar el token en alpha.js');
  assert.match(freezeData.prompt, /handoff_resume/);
  assert.match(freezeData.prompt, /Faltaba validar el token en alpha\.js/);

  // Clear resumed checkpoints leaves the newly frozen pending checkpoint intact
  const clearResumedRes = await fetch(`${baseUrl2}/admin/api/handoffs/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action: 'clear_resumed' })
  });
  assert.equal(clearResumedRes.status, 200);
  const clearResumedData = await clearResumedRes.json();
  assert.equal(clearResumedData.pruned.removedCheckpoints, 1);
  assert.equal(clearResumedData.state.handoffs.checkpointsCount, 1);

  // Delete the remaining checkpoint
  const delRes = await fetch(`${baseUrl2}/admin/api/handoffs/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: freezeData.checkpoint.id })
  });
  assert.equal(delRes.status, 200);
  assert.equal((await delRes.json()).removed, true);
});
