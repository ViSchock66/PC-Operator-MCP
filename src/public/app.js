import { $, api, copyText, formatUptime, modeLabel, operatorStatusLabel, toast } from './js/api.js';
import {
  createLogRow,
  matchesLogFilter,
  renderAuthSection,
  renderBanner,
  renderChecklist,
  renderDaemonsList,
  renderHandoffs,
  renderKpiStrip,
  renderLogs,
  renderNetworkDetails,
  renderParallelSessions,
  renderWorkspacesList,
  updateFullControlCountdown
} from './js/render.js';

let state = null;
let pinVisible = false;
let secretVisible = false;
let selectedMode = 'tailscale';
let formHydrated = false;
let localUptimeBase = null;
let localUptimeSyncAt = 0;
let lastCreatedApiKeyToken = '';
let wsFilterText = '';
let openDaemonLogId = null;
let openHandoffTrailKey = null;
let logFilter = 'all';
let logSearch = '';
let allLogs = [];
const daemonLogCache = new Map();

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    if (active) {
      $('topbar-title').textContent = btn.dataset.title || '';
      $('topbar-sub').textContent = btn.dataset.subtitle || '';
    }
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

function updateModeCards(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-option').forEach((card) => {
    const m = card.dataset.mode;
    const isSelected = m === mode;
    card.classList.toggle('selected', isSelected);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = isSelected;
  });

  const isCfNamed = mode === 'cloudflare-named';
  const isLocal = mode === 'local';
  const isQuick = mode === 'cloudflare-quick';
  $('field-public-url').classList.toggle('hidden', isCfNamed || isLocal || isQuick);
  $('field-custom-domain').classList.toggle('hidden', !isCfNamed);
  $('field-cf-token').classList.toggle('hidden', !isCfNamed);
}

function syncFormsFromState(s, force = false) {
  if (formHydrated && !force) return;
  formHydrated = true;

  const tc = s.tunnelConfig || {};
  updateModeCards(tc.mode || 'tailscale');
  $('input-public-url').value = tc.publicUrl || '';
  $('input-custom-domain').value = tc.customDomain || '';
  $('input-cf-token').value = tc.hasCloudflareToken ? (tc.cloudflareTokenPreview || '') : '';
  $('chk-autostart').checked = Boolean(tc.autoStart);

  $('input-oauth-origins').value = (s.auth?.allowedRedirectOrigins || []).join('\n');
  $('input-port').value = s.server?.port ?? 3333;
  $('input-pin').value = s.auth?.pin || '';

  const op = s.operator || {};
  $('op-enabled').checked = Boolean(op.enabled);
  $('op-server-path').value = op.serverPath || '';

  const p = s.permissions || {};
  $('perm-write').checked = Boolean(p.allowWrite);
  $('perm-delete').checked = Boolean(p.allowDelete);
  $('perm-commands').checked = Boolean(p.allowCommands);
  $('perm-sensitive').checked = Boolean(p.protectSensitiveFiles);
  $('perm-timeout').value = p.commandTimeoutMs || 30000;
  $('perm-max-read').value = p.maxReadBytes || 131072;

  const fc = s.daemons?.fullControl || {};
  if ($('fc-enabled')) {
    $('fc-enabled').checked = Boolean(fc.enabled);
    $('fc-ttl').value = String(fc.ttlMinutes ?? 60);
    $('fc-free-cwd').checked = Boolean(fc.allowUnrestrictedCwd);
    $('fc-stop-on-off').checked = fc.stopProcessesOnDisable !== false;
  }
}

function appendLogEntry(entry) {
  allLogs.push(entry);
  if (allLogs.length > 300) {
    allLogs.splice(0, allLogs.length - 300);
  }
  if (!matchesLogFilter(entry, logFilter, logSearch)) return;
  const box = $('console-box');
  if (!box) return;
  const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  box.appendChild(createLogRow(entry));
  while (box.children.length > 300) {
    box.removeChild(box.firstChild);
  }
  if (wasNearBottom) {
    box.scrollTop = box.scrollHeight;
  }
}

function renderState(s, { forceForms = false } = {}) {
  state = s;
  localUptimeBase = s.tunnel?.uptimeSec ?? 0;
  localUptimeSyncAt = Date.now();

  const t = s.tunnel || {};
  const statusPill = $('status-pill');
  const statusText = $('status-pill-text');
  statusPill.className = 'pill';
  if (t.status === 'running') {
    statusPill.classList.add('pill-running');
    statusText.textContent = 'ACTIVO';
  } else if (t.status === 'starting' || t.status === 'needs_action') {
    statusPill.classList.add('pill-warn');
    statusText.textContent = t.status === 'starting' ? 'INICIANDO' : 'ACCIÓN';
  } else if (t.status === 'error') {
    statusPill.classList.add('pill-error');
    statusText.textContent = 'ERROR';
  } else {
    statusText.textContent = 'DETENIDO';
  }

  $('pid-badge').textContent = `PID ${s.server?.pid || '--'}`;
  $('uptime-text').textContent = formatUptime(localUptimeBase);
  $('sidebar-mode-val').textContent = modeLabel(t.mode || s.tunnelConfig?.mode);

  const mcpUrl = t.mcpUrl || t.localMcpUrl || '--';
  const geminiMcpUrl = t.geminiMcpUrl || (mcpUrl !== '--' ? `${mcpUrl}/gemini` : '--');
  $('sidebar-mcp-url').textContent = mcpUrl;
  $('dash-mcp-url').textContent = mcpUrl;
  if ($('dash-gemini-mcp-url')) $('dash-gemini-mcp-url').textContent = geminiMcpUrl;
  $('guide-mcp-url').textContent = mcpUrl;
  if ($('guide-gemini-mcp-url')) $('guide-gemini-mcp-url').textContent = geminiMcpUrl;
  $('dash-local-url').textContent = t.localMcpUrl || '--';
  $('dash-active-ws').textContent = `Workspace: ${s.workspaces?.active || '--'}`;

  $('btn-tunnel-start').disabled = t.status === 'running' || t.status === 'starting';
  $('btn-tunnel-stop').disabled = t.status === 'stopped';

  $('dash-pin').textContent = pinVisible ? (s.auth?.pin || '--') : '••••••••';
  $('btn-toggle-pin').textContent = pinVisible ? 'Ocultar' : 'Ver';

  $('dash-client-id').textContent = s.auth?.staticClient?.client_id || '--';
  $('dash-client-secret').textContent = secretVisible
    ? (s.auth?.staticClient?.client_secret || '--')
    : '••••••••••••••••••••';
  $('btn-toggle-secret').textContent = secretVisible ? 'Ocultar' : 'Ver';

  const opInfo = operatorStatusLabel(s.operator);
  $('dash-op-status').textContent = opInfo.text;
  $('dash-op-badge').textContent = opInfo.badge;
  $('dash-op-badge').className = `nav-badge ${opInfo.cls}`;
  $('op-tab-badge').textContent = opInfo.badge;
  $('op-tab-badge').className = `nav-badge ${opInfo.cls}`;

  const ts = t.env?.tailscale;
  if (!ts) {
    $('ts-status-text').textContent = 'Pulsa Detectar Red';
    $('ts-funnel-badge').textContent = '--';
    $('ts-dns-text').textContent = s.tunnelConfig?.publicUrl || '--';
    $('btn-use-ts-url').classList.add('hidden');
  } else if (!ts.installed) {
    $('ts-status-text').textContent = 'No instalado';
    $('ts-funnel-badge').textContent = 'N/A';
    $('ts-dns-text').textContent = '--';
    $('btn-use-ts-url').classList.add('hidden');
  } else {
    $('ts-status-text').textContent = ts.online
      ? `Conectado (${ts.tailnetIp || 'Tailnet OK'})`
      : 'Instalado (Desconectado)';
    $('ts-funnel-badge').textContent = ts.funnelActive ? 'Funnel ON' : 'Funnel OFF';
    $('ts-funnel-badge').className = `nav-badge ${ts.funnelActive ? 'badge-ok' : ''}`;
    $('ts-dns-text').textContent = ts.suggestedUrl || ts.dnsName || '--';
    const needsApply = Boolean(ts.suggestedUrl && s.tunnelConfig?.publicUrl !== ts.suggestedUrl);
    $('btn-use-ts-url').classList.toggle('hidden', !needsApply);
  }

  renderKpiStrip(s, opInfo);
  renderNetworkDetails(s);
  renderAuthSection(s);
  renderParallelSessions(s);
  updateFullControlCountdown(s);
  renderDaemonsList(s, { openDaemonLogId, daemonLogCache });
  renderHandoffs(s, { openTrailKey: openHandoffTrailKey });
  renderWorkspacesList(s, wsFilterText);
  renderChecklist(s, opInfo);
  renderBanner(s);
  syncFormsFromState(s, forceForms);
}

async function runTunnelAction(endpoint, label) {
  try {
    const res = await api(endpoint, 'POST', {});
    renderState(res.state);
    toast(label);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function detectTailscale(applySuggested = false) {
  try {
    const res = await api('/admin/api/tunnel/detect', 'POST', { applySuggested });
    renderState(res.state, { forceForms: applySuggested });
    const url = res.env?.tailscale?.suggestedUrl;
    if (applySuggested && url) {
      toast(`URL fija aplicada: ${url}`);
    } else if (url) {
      toast(`Tailscale detectado: ${url}`);
    } else {
      toast('Detección de red completada');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveTunnelConfig(applyNow) {
  try {
    const payload = {
      mode: selectedMode,
      publicUrl: $('input-public-url').value.trim(),
      customDomain: $('input-custom-domain').value.trim(),
      cloudflareToken: $('input-cf-token').value.trim(),
      autoStart: $('chk-autostart').checked,
      applyNow
    };
    const res = await api('/admin/api/config/tunnel', 'POST', payload);
    renderState(res.state, { forceForms: true });
    toast(applyNow ? 'Configuración guardada y túnel aplicado' : 'Configuración de dominio guardada');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function restartOperatorBridge() {
  try {
    const res = await api('/admin/api/operator/restart', 'POST', {});
    renderState(res.state);
    toast('Antigravity Operator conectado');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveFullControlFromForm() {
  const res = await api('/admin/api/config/full-control', 'POST', {
    enabled: $('fc-enabled').checked,
    ttlMinutes: Number($('fc-ttl').value),
    allowUnrestrictedCwd: $('fc-free-cwd').checked,
    stopProcessesOnDisable: $('fc-stop-on-off').checked
  });
  renderState(res.state, { forceForms: true });
  toast(res.fullControl?.enabled ? 'Modo Control Total ACTIVADO' : 'Modo Control Total apagado');
}

async function refreshDaemonLogs(id) {
  const res = await api(`/admin/api/processes/${encodeURIComponent(id)}/output?tailLines=150`);
  daemonLogCache.set(id, res.output || '(sin salida)');
  if (state) renderDaemonsList(state, { openDaemonLogId, daemonLogCache });
}

// Navigation & keyboard shortcuts
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

const TAB_KEYS = {
  '1': 'dashboard',
  '2': 'auth',
  '3': 'network',
  '4': 'workspaces',
  '5': 'operator',
  '6': 'handoff',
  '7': 'guide'
};
document.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (TAB_KEYS[e.key]) switchTab(TAB_KEYS[e.key]);
});

$('banner-area')?.addEventListener('click', (e) => {
  const act = e.target.closest('[data-tunnel-action]');
  if (act?.dataset.tunnelAction === 'restart') {
    runTunnelAction('/admin/api/tunnel/restart', 'Túnel reiniciado');
  }
});

// Console filters
document.querySelectorAll('.filter-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    logFilter = pill.dataset.logFilter || 'all';
    document.querySelectorAll('.filter-pill').forEach((p) => p.classList.toggle('active', p === pill));
    renderLogs(allLogs, { filter: logFilter, search: logSearch });
  });
});
$('input-log-search')?.addEventListener('input', (e) => {
  logSearch = e.target.value || '';
  renderLogs(allLogs, { filter: logFilter, search: logSearch });
});

// Mode cards & copy actions
document.querySelectorAll('.mode-option').forEach((card) => {
  card.addEventListener('click', () => updateModeCards(card.dataset.mode));
});
document.querySelectorAll('[data-copy-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = $(btn.dataset.copyTarget);
    if (target) copyText(target.textContent.trim());
  });
});
$('sidebar-copy-mcp').addEventListener('click', () => {
  copyText($('sidebar-mcp-url').textContent.trim(), 'URL MCP copiada');
});

$('btn-toggle-pin').addEventListener('click', () => {
  pinVisible = !pinVisible;
  if (state) renderState(state);
});
$('btn-copy-pin').addEventListener('click', () => {
  if (state?.auth?.pin) copyText(state.auth.pin, 'PIN copiado');
});
$('btn-toggle-secret').addEventListener('click', () => {
  secretVisible = !secretVisible;
  if (state) renderState(state);
});
$('btn-copy-secret').addEventListener('click', () => {
  if (state?.auth?.staticClient?.client_secret) {
    copyText(state.auth.staticClient.client_secret, 'Secreto OAuth copiado');
  }
});
$('btn-copy-oauth-bundle').addEventListener('click', () => {
  if (!state?.auth?.staticClient) return;
  const c = state.auth.staticClient;
  copyText(`ID de cliente: ${c.client_id}\nSecreto de cliente: ${c.client_secret}`, 'Credenciales OAuth copiadas');
});

// Tunnel & network
$('btn-tunnel-start').addEventListener('click', () => runTunnelAction('/admin/api/tunnel/start', 'Túnel iniciado'));
$('btn-tunnel-restart').addEventListener('click', () => runTunnelAction('/admin/api/tunnel/restart', 'Túnel reiniciado'));
$('btn-tunnel-stop').addEventListener('click', () => runTunnelAction('/admin/api/tunnel/stop', 'Túnel detenido'));
$('btn-detect-tailscale').addEventListener('click', () => detectTailscale(false));
$('btn-use-ts-url').addEventListener('click', () => detectTailscale(true));
$('btn-detect-in-domain').addEventListener('click', () => detectTailscale(true));

$('form-tunnel').addEventListener('submit', (e) => {
  e.preventDefault();
  saveTunnelConfig(true);
});
$('btn-save-tunnel-only').addEventListener('click', () => saveTunnelConfig(false));

// Auth & server config
$('form-oauth-origins').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const lines = $('input-oauth-origins').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const res = await api('/admin/api/config/oauth', 'POST', { allowedRedirectOrigins: lines });
    renderState(res.state, { forceForms: true });
    toast('Orígenes OAuth personalizados guardados');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-create-apikey').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = $('input-apikey-name').value.trim() || 'Conector Personalizado';
    const res = await api('/admin/api/auth/api-keys', 'POST', { name });
    $('input-apikey-name').value = '';
    if (res.createdKey?.token) {
      lastCreatedApiKeyToken = res.createdKey.token;
      $('new-apikey-name').textContent = res.createdKey.name;
      $('new-apikey-token').textContent = res.createdKey.token;
      $('new-apikey-banner').classList.remove('hidden');
    }
    renderState(res.state);
    toast('API Key generada');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-copy-new-apikey').addEventListener('click', () => {
  if (lastCreatedApiKeyToken) copyText(lastCreatedApiKeyToken, 'API Key copiada al portapapeles');
});

$('apikeys-list').addEventListener('click', async (e) => {
  const rev = e.target.closest('[data-revoke-apikey]');
  if (!rev) return;
  try {
    const res = await api(`/admin/api/auth/api-keys/${encodeURIComponent(rev.dataset.revokeApikey)}`, 'DELETE');
    renderState(res.state);
    toast('API Key revocada');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-server').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/admin/api/config/server', 'POST', {
      port: Number($('input-port').value),
      pin: $('input-pin').value.trim()
    });
    renderState(res.state, { forceForms: true });
    toast(res.portChanged ? 'Puerto y PIN guardados (reinicia el daemon para cambiar puerto)' : 'Parámetros guardados');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-regen-pin').addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/config/server', 'POST', { regeneratePin: true });
    renderState(res.state, { forceForms: true });
    toast(`Nuevo PIN generado: ${res.state.auth.pin}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-regen-client').addEventListener('click', async () => {
  if (!confirm('¿Regenerar ID y Secreto OAuth estático? Tendrás que actualizarlos en los clientes donde los hayas pegado.')) return;
  try {
    const res = await api('/admin/api/config/server', 'POST', { regenerateStaticClient: true });
    renderState(res.state, { forceForms: true });
    toast('Credenciales OAuth regeneradas');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-revoke-sessions').addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/auth/revoke-all', 'POST', {});
    renderState(res.state);
    toast('Sesiones OAuth revocadas');
  } catch (err) {
    toast(err.message, 'err');
  }
});

// Operator & Daemons
$('form-operator').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/admin/api/config/operator', 'POST', {
      enabled: $('op-enabled').checked,
      serverPath: $('op-server-path').value.trim(),
      connectNow: $('op-enabled').checked
    });
    renderState(res.state, { forceForms: true });
    toast('Configuración de Antigravity Operator aplicada');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-op-restart').addEventListener('click', restartOperatorBridge);
$('btn-dash-test-op').addEventListener('click', restartOperatorBridge);

$('btn-op-stop').addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/operator/stop', 'POST', {});
    renderState(res.state);
    toast('Antigravity Operator puesto en espera');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('parallel-sessions-list')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-stop-op-session]');
  if (!btn) return;
  try {
    const res = await api(`/admin/api/operator/sessions/${encodeURIComponent(btn.dataset.stopOpSession)}/stop`, 'POST', {});
    renderState(res.state);
    toast('Bridge aislado cerrado (otros clientes siguen intactos)');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-full-control')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await saveFullControlFromForm(); } catch (err) { toast(err.message, 'err'); }
});
$('fc-enabled')?.addEventListener('change', async () => {
  try { await saveFullControlFromForm(); } catch (err) { toast(err.message, 'err'); }
});

$('btn-daemons-stop-all')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/processes/stop-all', 'POST', {});
    renderState(res.state);
    toast(`Procesos detenidos: ${res.stopped || 0}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-daemons-clear')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/processes/clear-exited', 'POST', {});
    renderState(res.state);
    toast(`Procesos terminados limpiados: ${res.removed || 0}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-launch-daemon')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cmd = $('input-daemon-cmd').value.trim();
  const name = $('input-daemon-name').value.trim();
  if (!cmd) return;
  try {
    const res = await api('/admin/api/processes/start', 'POST', { command: cmd, name: name || undefined });
    $('input-daemon-cmd').value = '';
    $('input-daemon-name').value = '';
    openDaemonLogId = res.process?.id || null;
    if (res.process?.id) daemonLogCache.set(res.process.id, res.process.tailPreview || '');
    renderState(res.state);
    toast(`Demonio lanzado (PID ${res.process?.pid || '?'})`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('daemons-list')?.addEventListener('click', async (e) => {
  const logBtn = e.target.closest('[data-proc-logs]');
  if (logBtn) {
    const id = logBtn.dataset.procLogs;
    if (openDaemonLogId === id) {
      openDaemonLogId = null;
      if (state) renderDaemonsList(state, { openDaemonLogId, daemonLogCache });
    } else {
      openDaemonLogId = id;
      try { await refreshDaemonLogs(id); } catch (err) { toast(err.message, 'err'); }
    }
    return;
  }
  const refBtn = e.target.closest('[data-proc-refresh]');
  if (refBtn) {
    try { await refreshDaemonLogs(refBtn.dataset.procRefresh); } catch (err) { toast(err.message, 'err'); }
    return;
  }
  const sendBtn = e.target.closest('[data-proc-send]');
  if (sendBtn) {
    const id = sendBtn.dataset.procSend;
    const inp = $(`daemon-stdin-${id}`);
    try {
      await api(`/admin/api/processes/${encodeURIComponent(id)}/input`, 'POST', { input: inp ? inp.value : '', appendNewline: true });
      if (inp) inp.value = '';
      await refreshDaemonLogs(id);
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const stopBtn = e.target.closest('[data-proc-stop]');
  if (stopBtn) {
    try {
      const res = await api(`/admin/api/processes/${encodeURIComponent(stopBtn.dataset.procStop)}/stop`, 'POST', {});
      renderState(res.state);
      toast('Proceso detenido');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

// Cross-Model Handoff actions
$('btn-handoff-clear-resumed')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/handoffs/delete', 'POST', { action: 'clear_resumed' });
    renderState(res.state);
    const n = res.pruned?.removedCheckpoints || 0;
    toast(n > 0 ? `Checkpoints retomados limpiados (${n})` : 'No había checkpoints retomados');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('handoff-trails-list')?.addEventListener('click', async (e) => {
  const detailBtn = e.target.closest('[data-handoff-detail]');
  if (detailBtn) {
    const key = detailBtn.dataset.handoffDetail;
    openHandoffTrailKey = openHandoffTrailKey === key ? null : key;
    if (state) renderHandoffs(state, { openTrailKey: openHandoffTrailKey });
    return;
  }
  const freezeBtn = e.target.closest('[data-handoff-freeze]');
  if (freezeBtn) {
    try {
      const noteInput = $('input-handoff-note');
      const notes = noteInput ? noteInput.value.trim() : '';
      const res = await api('/admin/api/handoffs/freeze', 'POST', {
        trailKey: freezeBtn.dataset.handoffFreeze,
        notes
      });
      if (noteInput) noteInput.value = '';
      renderState(res.state);
      if (res.prompt) await copyText(res.prompt, 'Checkpoint creado y prompt copiado');
      else toast('Checkpoint de handoff creado');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const copyBtn = e.target.closest('[data-handoff-copy-trail]');
  if (copyBtn) {
    try {
      const res = await api('/admin/api/handoffs/prompt', 'POST', { trailKey: copyBtn.dataset.handoffCopyTrail });
      await copyText(res.prompt, 'Prompt de relevo copiado al portapapeles');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const clearBtn = e.target.closest('[data-handoff-clear-trail]');
  if (clearBtn) {
    try {
      const key = clearBtn.dataset.handoffClearTrail;
      const res = await api('/admin/api/handoffs/delete', 'POST', { trailKey: key });
      if (openHandoffTrailKey === key) openHandoffTrailKey = null;
      renderState(res.state);
      toast('Rastro limpiado');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

$('handoff-checkpoints-list')?.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-handoff-copy-id]');
  if (copyBtn) {
    try {
      const res = await api('/admin/api/handoffs/prompt', 'POST', { id: copyBtn.dataset.handoffCopyId });
      await copyText(res.prompt, 'Prompt de handoff copiado al portapapeles');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const delBtn = e.target.closest('[data-handoff-delete-id]');
  if (delBtn) {
    try {
      const res = await api('/admin/api/handoffs/delete', 'POST', { id: delBtn.dataset.handoffDeleteId });
      renderState(res.state);
      toast('Checkpoint eliminado');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

// Workspaces & Permissions
$('form-permissions').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/admin/api/config/permissions', 'POST', {
      allowWrite: $('perm-write').checked,
      allowDelete: $('perm-delete').checked,
      allowCommands: $('perm-commands').checked,
      protectSensitiveFiles: $('perm-sensitive').checked,
      commandTimeoutMs: Number($('perm-timeout').value),
      maxReadBytes: Number($('perm-max-read').value)
    });
    renderState(res.state, { forceForms: true });
    toast('Permisos y límites guardados');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-add-ws').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = $('input-ws-path').value.trim();
  if (!p) return;
  try {
    const res = await api('/admin/api/workspaces/add', 'POST', { path: p });
    $('input-ws-path').value = '';
    renderState(res.state);
    toast(`Workspace activado: ${res.workspace}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-pick-folder').addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/workspaces/pick', 'POST', {});
    renderState(res.state);
    toast(res.cancelled ? 'Selección cancelada' : `Workspace activado: ${res.workspace}`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('input-ws-filter')?.addEventListener('input', (e) => {
  wsFilterText = e.target.value || '';
  if (state) renderWorkspacesList(state, wsFilterText);
});

$('btn-ws-reset-sessions')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/workspaces/reset-sessions', 'POST', {});
    renderState(res.state);
    toast(`Sesiones sincronizadas al workspace global (${res.cleared || 0} restablecidas)`);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('ws-list').addEventListener('click', async (e) => {
  const openBtn = e.target.closest('[data-ws-open]');
  if (openBtn) {
    try {
      await api('/admin/api/workspaces/open', 'POST', { path: openBtn.dataset.wsOpen });
      toast('Abierto en Explorador de Windows');
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const copyBtn = e.target.closest('[data-ws-copy]');
  if (copyBtn) {
    copyText(copyBtn.dataset.wsCopy, 'Ruta del workspace copiada');
    return;
  }
  const sel = e.target.closest('[data-ws-select]');
  if (sel) {
    try {
      const res = await api('/admin/api/workspaces/select', 'POST', { path: sel.dataset.wsSelect });
      renderState(res.state);
      toast(`Workspace activo: ${res.workspace}`);
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const rem = e.target.closest('[data-ws-remove]');
  if (rem) {
    try {
      const res = await api('/admin/api/workspaces/remove', 'POST', { path: rem.dataset.wsRemove });
      renderState(res.state);
      toast('Workspace quitado');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

$('btn-clear-logs').addEventListener('click', async () => {
  await api('/admin/api/logs/clear', 'POST', {}).catch(() => {});
  allLogs = [];
  $('console-box').innerHTML = '';
});

$('btn-shutdown-daemon').addEventListener('click', async () => {
  if (!confirm('¿Apagar el servidor MCP, cerrar el túnel y quitar el icono de la bandeja?')) return;
  try {
    await api('/admin/api/daemon/shutdown', 'POST', {});
    toast('Daemon apagándose...');
    setTimeout(() => window.close(), 500);
  } catch (err) {
    toast(err.message, 'err');
  }
});

// Uptime + Full Control countdown ticker
setInterval(() => {
  if (localUptimeBase !== null) {
    const elapsed = Math.floor((Date.now() - localUptimeSyncAt) / 1000);
    $('uptime-text').textContent = formatUptime(localUptimeBase + elapsed);
  }
  if (state?.daemons?.fullControl?.enabled) {
    updateFullControlCountdown(state);
  }
}, 1000);

function connectSse() {
  const sseEl = $('sse-indicator');
  const sseText = $('sse-text');
  const es = new EventSource('/admin/api/events');

  es.onopen = () => {
    sseEl.classList.add('connected');
    sseText.textContent = 'Daemon conectado · Tray activo';
  };

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'init' && msg.state) {
        allLogs = [...(msg.state.tunnel?.logs || [])];
        renderState(msg.state, { forceForms: !formHydrated });
        renderLogs(allLogs, { filter: logFilter, search: logSearch });
      } else if (msg.type === 'state' && msg.full) {
        renderState(msg.full);
      } else if (msg.type === 'log' && msg.entry) {
        appendLogEntry(msg.entry);
      } else if (msg.type === 'logs_cleared') {
        allLogs = [];
        $('console-box').innerHTML = '';
      }
    } catch {
      // Ignore malformed SSE payload.
    }
  };

  es.onerror = () => {
    sseEl.classList.remove('connected');
    sseText.textContent = 'Reconectando...';
  };
}

api('/admin/api/state')
  .then((s) => {
    allLogs = [...(s.tunnel?.logs || [])];
    renderState(s, { forceForms: true });
    renderLogs(allLogs, { filter: logFilter, search: logSearch });
    connectSse();
  })
  .catch((err) => {
    toast(err.message, 'err');
    connectSse();
  });
