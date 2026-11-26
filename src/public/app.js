import { applyTranslations, getLanguage, normalizeLang, setLanguage, t } from './i18n/index.js';
import { $, api, copyText, formatUptime, modeLabel, operatorStatusLabel, toast } from './js/api.js';
import {
  buildClientSnippets,
  createLogRow,
  matchesLogFilter,
  renderAuthSection,
  renderBanner,
  renderDaemonsList,
  renderHandoffs,
  renderKpiStrip,
  renderLogs,
  renderNetworkDetails,
  renderOperatorHeader,
  renderOverviewCards,
  renderOverviewHero,
  renderParallelSessions,
  renderSetupGuide,
  renderSnippetBlock,
  renderWorkspacesList,
  updateFullControlCountdown
} from './js/render.js';

let state = null;
let activeTab = 'overview';
let activeConnSubtab = 'tunnel';
let activeSnippet = 'claude-code';
let pinVisible = false;
let secretVisible = false;
let selectedMode = 'tailscale';
let formHydrated = false;
let localUptimeBase = null;
let localUptimeSyncAt = 0;
let lastCreatedApiKeyToken = '';
let lastCreatedApiKeyName = '';
let wsFilterText = '';
let openDaemonLogId = null;
let openHandoffTrailKey = null;
let logFilter = 'all';
let logSearch = '';
let allLogs = [];
let sseStatus = 'connecting';
const daemonLogCache = new Map();

const TAB_META = {
  overview: { titleKey: 'nav.overview', subKey: 'nav.overviewSub' },
  workspaces: { titleKey: 'nav.workspaces', subKey: 'nav.workspacesSub' },
  connections: { titleKey: 'nav.connections', subKey: 'nav.connectionsSub' },
  runtime: { titleKey: 'nav.runtime', subKey: 'nav.runtimeSub' },
  handoff: { titleKey: 'nav.handoff', subKey: 'nav.handoffSub' }
};

function updateTopbarHeader() {
  const meta = TAB_META[activeTab] || TAB_META.overview;
  if ($('topbar-title')) $('topbar-title').textContent = t(meta.titleKey);
  if ($('topbar-sub')) $('topbar-sub').textContent = t(meta.subKey);
}

function updateSseLabel() {
  const sseEl = $('sse-indicator');
  const sseText = $('sse-text');
  if (!sseEl || !sseText) return;
  sseEl.classList.toggle('connected', sseStatus === 'connected');
  if (sseStatus === 'connected') sseText.textContent = t('sidebar.sseConnected');
  else if (sseStatus === 'reconnecting') sseText.textContent = t('sidebar.sseReconnecting');
  else sseText.textContent = t('sidebar.sseConnecting');
}

function switchTab(tabId) {
  if (!TAB_META[tabId]) return;
  activeTab = tabId;
  document.querySelectorAll('.tab').forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
  updateTopbarHeader();
}

function switchConnectionsSubtab(subtabId) {
  activeConnSubtab = subtabId;
  document.querySelectorAll('[data-subtab]').forEach((btn) => {
    const active = btn.dataset.subtab === subtabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.subtab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `subtab-${subtabId}`);
  });
}

function updateModeCards(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-option').forEach((card) => {
    const isSelected = card.dataset.mode === mode;
    card.classList.toggle('selected', isSelected);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = isSelected;
  });

  const isCfNamed = mode === 'cloudflare-named';
  const isLocal = mode === 'local';
  const isQuick = mode === 'cloudflare-quick';
  $('field-public-url')?.classList.toggle('hidden', isCfNamed || isLocal || isQuick);
  $('field-custom-domain')?.classList.toggle('hidden', !isCfNamed);
  $('field-cf-token')?.classList.toggle('hidden', !isCfNamed);
}

function syncFormsFromState(s, force = false) {
  if (formHydrated && !force) return;
  formHydrated = true;

  const tc = s.tunnelConfig || {};
  updateModeCards(tc.mode || 'tailscale');
  if ($('input-public-url')) $('input-public-url').value = tc.publicUrl || '';
  if ($('input-custom-domain')) $('input-custom-domain').value = tc.customDomain || '';
  if ($('input-cf-token')) $('input-cf-token').value = tc.hasCloudflareToken ? (tc.cloudflareTokenPreview || '') : '';
  if ($('chk-autostart')) $('chk-autostart').checked = Boolean(tc.autoStart);

  if ($('input-oauth-origins')) $('input-oauth-origins').value = (s.auth?.allowedRedirectOrigins || []).join('\n');
  if ($('input-port')) $('input-port').value = s.server?.port ?? 3333;
  if ($('input-pin')) $('input-pin').value = s.auth?.pin || '';

  const op = s.operator || {};
  if ($('op-enabled')) $('op-enabled').checked = Boolean(op.enabled);
  if ($('op-server-path')) $('op-server-path').value = op.serverPath || '';

  const p = s.permissions || {};
  if ($('perm-write')) $('perm-write').checked = Boolean(p.allowWrite);
  if ($('perm-delete')) $('perm-delete').checked = Boolean(p.allowDelete);
  if ($('perm-commands')) $('perm-commands').checked = Boolean(p.allowCommands);
  if ($('perm-sensitive')) $('perm-sensitive').checked = Boolean(p.protectSensitiveFiles);
  if ($('perm-timeout')) $('perm-timeout').value = p.commandTimeoutMs || 30000;
  if ($('perm-max-read')) $('perm-max-read').value = p.maxReadBytes || 131072;

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
  const emptyEl = box.querySelector('.console-empty');
  if (emptyEl) emptyEl.remove();
  const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  box.appendChild(createLogRow(entry));
  while (box.children.length > 300) {
    box.removeChild(box.firstChild);
  }
  if (wasNearBottom) {
    box.scrollTop = box.scrollHeight;
  }
}

function updateTopbarTunnelButtons(tun) {
  const startBtn = $('btn-tunnel-start');
  const restartBtn = $('btn-tunnel-restart');
  const stopBtn = $('btn-tunnel-stop');
  const isRunning = tun.status === 'running';
  const isStarting = tun.status === 'starting';
  const isStopped = tun.status === 'stopped';

  if (startBtn) {
    startBtn.classList.toggle('hidden', isRunning || isStarting);
    startBtn.disabled = isRunning || isStarting;
  }
  if (restartBtn) {
    restartBtn.classList.toggle('hidden', isStopped);
    restartBtn.disabled = isStarting;
  }
  if (stopBtn) {
    stopBtn.classList.toggle('hidden', isStopped);
    stopBtn.disabled = isStopped;
  }
}

function applyLanguageLive(lang) {
  const normalized = normalizeLang(lang);
  setLanguage(normalized);
  applyTranslations(document);
  updateTopbarHeader();
  updateSseLabel();
  if (lastCreatedApiKeyName && $('new-apikey-title')) {
    $('new-apikey-title').textContent = t('connections.newKeyBannerTitle', { name: lastCreatedApiKeyName });
  }
  if (state) {
    renderState(state, { skipLangSync: true });
    renderLogs(allLogs, { filter: logFilter, search: logSearch });
  }
}

function renderState(s, { forceForms = false, skipLangSync = false } = {}) {
  state = s;

  if (!skipLangSync && s.ui?.language) {
    const serverLang = normalizeLang(s.ui.language);
    if (serverLang !== getLanguage()) {
      setLanguage(serverLang);
      applyTranslations(document);
      updateTopbarHeader();
      updateSseLabel();
    }
  }

  localUptimeBase = s.tunnel?.uptimeSec ?? 0;
  localUptimeSyncAt = Date.now();

  if ($('app-version-chip') && s.server?.version) {
    $('app-version-chip').textContent = `v${s.server.version}`;
  }

  const tun = s.tunnel || {};
  const statusPill = $('status-pill');
  const statusText = $('status-pill-text');
  if (statusPill && statusText) {
    statusPill.className = 'pill';
    if (tun.status === 'running') {
      statusPill.classList.add('pill-running');
      statusText.textContent = t('status.running');
    } else if (tun.status === 'starting' || tun.status === 'needs_action') {
      statusPill.classList.add('pill-warn');
      statusText.textContent = tun.status === 'starting' ? t('status.starting') : t('status.needsAction');
    } else if (tun.status === 'error') {
      statusPill.classList.add('pill-error');
      statusText.textContent = t('status.error');
    } else {
      statusText.textContent = t('status.stopped');
    }
  }

  if ($('pid-badge')) $('pid-badge').textContent = `PID ${s.server?.pid || '--'}`;
  if ($('uptime-text')) $('uptime-text').textContent = formatUptime(localUptimeBase);
  if ($('sidebar-mode-val')) $('sidebar-mode-val').textContent = modeLabel(tun.mode || s.tunnelConfig?.mode);

  const mcpUrl = tun.mcpUrl || tun.localMcpUrl || '--';
  if ($('sidebar-mcp-url')) $('sidebar-mcp-url').textContent = mcpUrl;

  updateTopbarTunnelButtons(tun);

  const opInfo = operatorStatusLabel(s.operator);

  renderBanner(s);
  renderOverviewHero(s);
  renderKpiStrip(s, opInfo);
  renderOverviewCards(s, opInfo, { pinVisible, secretVisible });
  renderWorkspacesList(s, wsFilterText);
  renderNetworkDetails(s);
  renderAuthSection(s);
  renderSetupGuide(s, opInfo, activeSnippet);
  renderOperatorHeader(opInfo);
  renderParallelSessions(s);
  updateFullControlCountdown(s);
  renderDaemonsList(s, { openDaemonLogId, daemonLogCache });
  renderHandoffs(s, { openTrailKey: openHandoffTrailKey });
  syncFormsFromState(s, forceForms);
}

async function switchLanguage(lang) {
  const target = normalizeLang(lang);
  if (target === getLanguage()) return;
  applyLanguageLive(target);
  try {
    const res = await api('/admin/api/config/ui', 'POST', { language: target });
    if (res.state) renderState(res.state, { skipLangSync: true });
    toast(t('langToast.switched'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runTunnelAction(endpoint, toastKey) {
  try {
    const res = await api(endpoint, 'POST', {});
    renderState(res.state);
    toast(t(toastKey));
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
      toast(t('connections.toastFixedUrlApplied', { url }));
    } else if (url) {
      toast(t('connections.toastTsDetected', { url }));
    } else {
      toast(t('connections.toastDetectDone'));
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
    toast(t(applyNow ? 'connections.toastTunnelApplied' : 'connections.toastTunnelSaved'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function restartOperatorBridge() {
  try {
    const res = await api('/admin/api/operator/restart', 'POST', {});
    renderState(res.state);
    toast(t('runtime.toastOpConnected'));
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
  toast(t(res.fullControl?.enabled ? 'runtime.toastFcOn' : 'runtime.toastFcOff'));
}

async function refreshDaemonLogs(id) {
  const res = await api(`/admin/api/processes/${encodeURIComponent(id)}/output?tailLines=150`);
  daemonLogCache.set(id, res.output || t('runtime.noOutput'));
  if (state) renderDaemonsList(state, { openDaemonLogId, daemonLogCache });
}

// Primary navigation & keyboard shortcuts (1-5)
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-jump-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.jumpTab);
    if (btn.dataset.jumpSubtab) switchConnectionsSubtab(btn.dataset.jumpSubtab);
  });
});

document.querySelectorAll('[data-subtab]').forEach((btn) => {
  btn.addEventListener('click', () => switchConnectionsSubtab(btn.dataset.subtab));
});

document.querySelectorAll('[data-snippet-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeSnippet = btn.dataset.snippetTab || 'claude-code';
    const mcpUrl = state?.tunnel?.mcpUrl || state?.tunnel?.localMcpUrl || '--';
    renderSnippetBlock(mcpUrl, activeSnippet);
  });
});

$('btn-copy-snippet')?.addEventListener('click', () => {
  const mcpUrl = state?.tunnel?.mcpUrl || state?.tunnel?.localMcpUrl || '--';
  const snippets = buildClientSnippets(mcpUrl);
  copyText(snippets[activeSnippet] || '', t('connections.snippetCopied'));
});

// Live EN | ES switcher
document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
  btn.addEventListener('click', () => switchLanguage(btn.dataset.langBtn));
});

const TAB_KEYS = {
  '1': 'overview',
  '2': 'workspaces',
  '3': 'connections',
  '4': 'runtime',
  '5': 'handoff'
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (TAB_KEYS[e.key]) switchTab(TAB_KEYS[e.key]);
});

$('banner-area')?.addEventListener('click', (e) => {
  const act = e.target.closest('[data-tunnel-action]');
  if (act?.dataset.tunnelAction === 'restart') {
    runTunnelAction('/admin/api/tunnel/restart', 'topbar.tunnelRestarted');
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
$('sidebar-copy-mcp')?.addEventListener('click', () => {
  copyText($('sidebar-mcp-url')?.textContent.trim(), t('sidebar.copyMcpToast'));
});
$('btn-hero-copy')?.addEventListener('click', () => {
  copyText($('hero-url-pill')?.textContent.trim(), t('sidebar.copyMcpToast'));
});

$('btn-toggle-pin')?.addEventListener('click', () => {
  pinVisible = !pinVisible;
  if (state) renderState(state, { skipLangSync: true });
});
$('btn-copy-pin')?.addEventListener('click', () => {
  if (state?.auth?.pin) copyText(state.auth.pin, t('overview.pinCopied'));
});
$('btn-toggle-secret')?.addEventListener('click', () => {
  secretVisible = !secretVisible;
  if (state) renderState(state, { skipLangSync: true });
});
$('btn-copy-secret')?.addEventListener('click', () => {
  if (state?.auth?.staticClient?.client_secret) {
    copyText(state.auth.staticClient.client_secret, t('overview.secretCopied'));
  }
});
document.querySelectorAll('[data-copy-oauth-bundle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!state?.auth?.staticClient) return;
    const c = state.auth.staticClient;
    copyText(
      `Client ID: ${c.client_id}\nClient Secret: ${c.client_secret}`,
      t('overview.oauthBundleCopied')
    );
  });
});

// Tunnel & network
$('btn-tunnel-start')?.addEventListener('click', () => runTunnelAction('/admin/api/tunnel/start', 'topbar.tunnelStarted'));
$('btn-tunnel-restart')?.addEventListener('click', () => runTunnelAction('/admin/api/tunnel/restart', 'topbar.tunnelRestarted'));
$('btn-tunnel-stop')?.addEventListener('click', () => runTunnelAction('/admin/api/tunnel/stop', 'topbar.tunnelStopped'));
$('btn-detect-tailscale')?.addEventListener('click', () => detectTailscale(false));
$('btn-use-ts-url')?.addEventListener('click', () => detectTailscale(true));
$('btn-detect-in-domain')?.addEventListener('click', () => detectTailscale(true));

$('form-tunnel')?.addEventListener('submit', (e) => {
  e.preventDefault();
  saveTunnelConfig(true);
});
$('btn-save-tunnel-only')?.addEventListener('click', () => saveTunnelConfig(false));

// Auth & server config
$('form-oauth-origins')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const lines = $('input-oauth-origins').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const res = await api('/admin/api/config/oauth', 'POST', { allowedRedirectOrigins: lines });
    renderState(res.state, { forceForms: true });
    toast(t('connections.toastOriginsSaved'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-create-apikey')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = $('input-apikey-name').value.trim() || t('connections.defaultKeyName');
    const res = await api('/admin/api/auth/api-keys', 'POST', { name });
    $('input-apikey-name').value = '';
    if (res.createdKey?.token) {
      lastCreatedApiKeyToken = res.createdKey.token;
      lastCreatedApiKeyName = res.createdKey.name;
      $('new-apikey-title').textContent = t('connections.newKeyBannerTitle', { name: res.createdKey.name });
      $('new-apikey-token').textContent = res.createdKey.token;
      $('new-apikey-banner').classList.remove('hidden');
    }
    renderState(res.state);
    toast(t('connections.toastKeyCreated'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-copy-new-apikey')?.addEventListener('click', () => {
  if (lastCreatedApiKeyToken) copyText(lastCreatedApiKeyToken, t('connections.toastKeyCopied'));
});

$('apikeys-list')?.addEventListener('click', async (e) => {
  const rev = e.target.closest('[data-revoke-apikey]');
  if (!rev) return;
  try {
    const res = await api(`/admin/api/auth/api-keys/${encodeURIComponent(rev.dataset.revokeApikey)}`, 'DELETE');
    renderState(res.state);
    toast(t('connections.toastKeyRevoked'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-server')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/admin/api/config/server', 'POST', {
      port: Number($('input-port').value),
      pin: $('input-pin').value.trim()
    });
    renderState(res.state, { forceForms: true });
    toast(t(res.portChanged ? 'connections.toastPortPinRestart' : 'connections.toastServerSaved'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-regen-pin')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/config/server', 'POST', { regeneratePin: true });
    renderState(res.state, { forceForms: true });
    toast(t('connections.toastNewPin', { pin: res.state.auth.pin }));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-regen-client')?.addEventListener('click', async () => {
  if (!confirm(t('connections.confirmRegenClient'))) return;
  try {
    const res = await api('/admin/api/config/server', 'POST', { regenerateStaticClient: true });
    renderState(res.state, { forceForms: true });
    toast(t('connections.toastClientRegen'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-revoke-sessions')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/auth/revoke-all', 'POST', {});
    renderState(res.state);
    toast(t('connections.toastSessionsRevoked'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

// Runtime: Operator & Daemons
$('form-operator')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/admin/api/config/operator', 'POST', {
      enabled: $('op-enabled').checked,
      serverPath: $('op-server-path').value.trim(),
      connectNow: $('op-enabled').checked
    });
    renderState(res.state, { forceForms: true });
    toast(t('runtime.toastOpSaved'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-op-restart')?.addEventListener('click', restartOperatorBridge);
$('btn-dash-test-op')?.addEventListener('click', restartOperatorBridge);

$('btn-op-stop')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/operator/stop', 'POST', {});
    renderState(res.state);
    toast(t('runtime.toastOpStandby'));
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
    toast(t('runtime.toastBridgeClosed'));
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
    toast(t('runtime.toastStoppedAll', { count: res.stopped || 0 }));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-daemons-clear')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/processes/clear-exited', 'POST', {});
    renderState(res.state);
    toast(t('runtime.toastClearedExited', { count: res.removed || 0 }));
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
    toast(t('runtime.toastDaemonLaunched', { pid: res.process?.pid || '?' }));
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
      await api(`/admin/api/processes/${encodeURIComponent(id)}/input`, 'POST', {
        input: inp ? inp.value : '',
        appendNewline: true
      });
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
      toast(t('runtime.toastProcessStopped'));
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

// Handoff actions
$('btn-handoff-clear-resumed')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/handoffs/delete', 'POST', { action: 'clear_resumed' });
    renderState(res.state);
    const n = res.pruned?.removedCheckpoints || 0;
    toast(n > 0 ? t('handoff.toastClearedResumed', { count: n }) : t('handoff.toastNoneResumed'));
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
      if (res.prompt) await copyText(res.prompt, t('handoff.toastFrozenCopied'));
      else toast(t('handoff.toastFrozen'));
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const copyBtn = e.target.closest('[data-handoff-copy-trail]');
  if (copyBtn) {
    try {
      const res = await api('/admin/api/handoffs/prompt', 'POST', { trailKey: copyBtn.dataset.handoffCopyTrail });
      await copyText(res.prompt, t('handoff.toastTrailPromptCopied'));
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
      toast(t('handoff.toastTrailCleared'));
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
      await copyText(res.prompt, t('handoff.toastCpPromptCopied'));
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
      toast(t('handoff.toastCpDeleted'));
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

// Workspaces & Permissions
$('form-permissions')?.addEventListener('submit', async (e) => {
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
    toast(t('workspaces.toastSaved'));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('form-add-ws')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = $('input-ws-path').value.trim();
  if (!p) return;
  try {
    const res = await api('/admin/api/workspaces/add', 'POST', { path: p });
    $('input-ws-path').value = '';
    renderState(res.state);
    toast(t('workspaces.toastActivated', { path: res.workspace }));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('btn-pick-folder')?.addEventListener('click', async () => {
  try {
    const res = await api('/admin/api/workspaces/pick', 'POST', {});
    renderState(res.state);
    toast(res.cancelled ? t('workspaces.toastCancelled') : t('workspaces.toastActivated', { path: res.workspace }));
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
    toast(t('workspaces.toastSynced', { count: res.cleared || 0 }));
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('ws-list')?.addEventListener('click', async (e) => {
  const openBtn = e.target.closest('[data-ws-open]');
  if (openBtn) {
    try {
      await api('/admin/api/workspaces/open', 'POST', { path: openBtn.dataset.wsOpen });
      toast(t('workspaces.toastOpened'));
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const copyBtn = e.target.closest('[data-ws-copy]');
  if (copyBtn) {
    copyText(copyBtn.dataset.wsCopy, t('workspaces.toastPathCopied'));
    return;
  }
  const sel = e.target.closest('[data-ws-select]');
  if (sel) {
    try {
      const res = await api('/admin/api/workspaces/select', 'POST', { path: sel.dataset.wsSelect });
      renderState(res.state);
      toast(t('workspaces.toastSelected', { path: res.workspace }));
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
      toast(t('workspaces.toastRemoved'));
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

$('btn-clear-logs')?.addEventListener('click', async () => {
  await api('/admin/api/logs/clear', 'POST', {}).catch(() => {});
  allLogs = [];
  renderLogs(allLogs, { filter: logFilter, search: logSearch });
});

$('btn-shutdown-daemon')?.addEventListener('click', async () => {
  if (!confirm(t('nav.shutdownConfirm'))) return;
  try {
    await api('/admin/api/daemon/shutdown', 'POST', {});
    toast(t('nav.shutdownToast'));
    setTimeout(() => window.close(), 500);
  } catch (err) {
    toast(err.message, 'err');
  }
});

// Uptime + Full Control countdown ticker
setInterval(() => {
  if (localUptimeBase !== null && $('uptime-text')) {
    const elapsed = Math.floor((Date.now() - localUptimeSyncAt) / 1000);
    $('uptime-text').textContent = formatUptime(localUptimeBase + elapsed);
  }
  if (state?.daemons?.fullControl?.enabled) {
    updateFullControlCountdown(state);
  }
}, 1000);

function connectSse() {
  const es = new EventSource('/admin/api/events');

  es.onopen = () => {
    sseStatus = 'connected';
    updateSseLabel();
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
        renderLogs(allLogs, { filter: logFilter, search: logSearch });
      }
    } catch {
      // Ignore malformed SSE payload.
    }
  };

  es.onerror = () => {
    sseStatus = 'reconnecting';
    updateSseLabel();
  };
}

// Initial bootstrap
applyTranslations(document);
updateTopbarHeader();
updateSseLabel();

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
