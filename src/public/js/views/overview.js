import { formatLogTime, t } from '../../i18n/index.js';
import { $, escapeHtml, modeLabel } from '../api.js';

export function renderBanner(s) {
  const area = $('banner-area');
  if (!area) return;
  const alerts = [];
  const tun = s.tunnel || {};

  if (tun.status === 'needs_action' && tun.actionUrl) {
    alerts.push(`
      <div class="alert alert-warn">
        <div>
          <strong>${escapeHtml(t('banner.tailscaleActionTitle'))}</strong>
          ${escapeHtml(tun.lastError || t('banner.tailscaleActionFallback'))}
        </div>
        <div class="btn-row">
          <a class="btn btn-warn btn-sm" href="${escapeHtml(tun.actionUrl)}" target="_blank" rel="noopener">${escapeHtml(t('banner.openTailscaleLink'))}</a>
          <button type="button" class="btn btn-sm btn-primary" data-tunnel-action="restart">${escapeHtml(t('banner.activatedRetry'))}</button>
        </div>
      </div>
    `);
  } else if (tun.status === 'error' && tun.lastError) {
    alerts.push(`
      <div class="alert alert-danger">
        <div><strong>${escapeHtml(t('banner.tunnelErrorTitle'))}</strong> ${escapeHtml(tun.lastError)}</div>
        <button type="button" class="btn btn-sm" data-tunnel-action="restart">${escapeHtml(t('common.retry'))}</button>
      </div>
    `);
  }

  if (s.server?.portRestartRequired) {
    alerts.push(`
      <div class="alert alert-warn">
        <div>
          <strong>${escapeHtml(t('banner.portChangedTitle', { port: s.server.port }))}</strong>
          ${escapeHtml(t('banner.portChangedBody'))}
        </div>
      </div>
    `);
  }

  area.innerHTML = alerts.join('');
}

export function renderOverviewHero(s) {
  const hero = $('overview-hero');
  if (!hero) return;
  const tun = s.tunnel || {};
  const mode = tun.mode || s.tunnelConfig?.mode || 'tailscale';
  const mcpUrl = tun.mcpUrl || tun.localMcpUrl || '--';
  const wsActive = s.workspaces?.active || '--';
  const wsName = wsActive !== '--' ? (wsActive.split(/[\\/]/).pop() || wsActive) : '--';

  hero.classList.remove('hero-online', 'hero-warn', 'hero-error', 'hero-idle');

  let titleKey = 'overview.heroTitleStopped';
  let statusCls = 'hero-idle';
  if (tun.status === 'running') {
    titleKey = 'overview.heroTitleRunning';
    statusCls = 'hero-online';
  } else if (tun.status === 'starting') {
    titleKey = 'overview.heroTitleStarting';
    statusCls = 'hero-warn';
  } else if (tun.status === 'needs_action') {
    titleKey = 'overview.heroTitleAction';
    statusCls = 'hero-warn';
  } else if (tun.status === 'error') {
    titleKey = 'overview.heroTitleError';
    statusCls = 'hero-error';
  }

  hero.classList.add(statusCls);

  const titleEl = $('hero-title');
  const subEl = $('hero-sub');
  const urlEl = $('hero-url-pill');

  if (titleEl) titleEl.textContent = t(titleKey);
  if (subEl) {
    subEl.textContent = tun.status === 'running' && mode !== 'local'
      ? t('overview.heroSubtitlePublic', { url: mcpUrl, mode: modeLabel(mode), workspace: wsName })
      : t('overview.heroSubtitleLocal', { url: tun.localMcpUrl || mcpUrl });
  }
  if (urlEl) urlEl.textContent = mcpUrl;
}

export function renderKpiStrip(s, opInfo) {
  const tun = s.tunnel || {};
  const kpiTunnelVal = $('kpi-tunnel-val');
  const kpiTunnelBadge = $('kpi-tunnel-badge');
  const kpiTunnelSub = $('kpi-tunnel-sub');
  if (kpiTunnelVal) {
    kpiTunnelVal.textContent = modeLabel(tun.mode || s.tunnelConfig?.mode);
    const badgeText = tun.status === 'running'
      ? t('status.onlineShort')
      : (tun.status === 'stopped' ? t('status.stoppedShort') : (tun.status || '--'));
    kpiTunnelBadge.textContent = badgeText;
    kpiTunnelBadge.className = `badge ${tun.status === 'running' ? 'badge-ok' : (tun.status === 'error' ? 'badge-danger' : 'badge-warn')}`;
    kpiTunnelSub.textContent = tun.activeUrl || tun.localMcpUrl || '--';
  }

  const pSessions = s.parallelSessions || [];
  const oauthCount = s.auth?.activeSessions ?? 0;
  const kpiSessVal = $('kpi-sessions-val');
  const kpiSessBadge = $('kpi-sessions-badge');
  const kpiSessSub = $('kpi-sessions-sub');
  if (kpiSessVal) {
    kpiSessVal.textContent = String(pSessions.length);
    kpiSessBadge.textContent = t('overview.kpiSessionsOAuth', { count: oauthCount });
    kpiSessBadge.className = `badge ${oauthCount > 0 ? 'badge-ok' : ''}`;
    kpiSessSub.textContent = pSessions.length
      ? pSessions.map((x) => x.clientLabel).slice(0, 3).join(', ')
      : t('overview.kpiSessionsWaiting');
  }

  const kpiOpVal = $('kpi-op-val');
  const kpiOpBadge = $('kpi-op-badge');
  const kpiOpSub = $('kpi-op-sub');
  if (kpiOpVal) {
    const tools = s.operator?.toolCount || (s.operator?.enabled ? 17 : 0);
    kpiOpVal.textContent = t('operator.toolsCount', { count: tools });
    kpiOpBadge.textContent = s.operator?.status === 'connected'
      ? t('operator.statusConnected')
      : (s.operator?.enabled ? t('operator.statusStandby') : t('operator.statusOff'));
    kpiOpBadge.className = `badge ${opInfo.cls}`;
    kpiOpSub.textContent = opInfo.text;
  }
}

export function renderOverviewCards(s, opInfo, { pinVisible, secretVisible }) {
  const tun = s.tunnel || {};
  const mcpUrl = tun.mcpUrl || tun.localMcpUrl || '--';
  const geminiMcpUrl = tun.geminiMcpUrl || (mcpUrl !== '--' ? `${mcpUrl}/gemini` : '--');

  if ($('dash-mcp-url')) $('dash-mcp-url').textContent = mcpUrl;
  if ($('dash-gemini-mcp-url')) $('dash-gemini-mcp-url').textContent = geminiMcpUrl;
  if ($('dash-local-url')) $('dash-local-url').textContent = tun.localMcpUrl || '--';
  if ($('dash-active-ws')) {
    $('dash-active-ws').textContent = t('overview.workspacePrefix', { path: s.workspaces?.active || '--' });
  }

  const sessCount = s.auth?.activeSessions ?? 0;
  if ($('oauth-sessions-badge')) {
    $('oauth-sessions-badge').textContent = sessCount === 1
      ? t('overview.oauthSessionsCount', { count: sessCount })
      : t('overview.oauthSessionsCountPlural', { count: sessCount });
  }

  if ($('dash-pin')) $('dash-pin').textContent = pinVisible ? (s.auth?.pin || '--') : '••••••••';
  if ($('btn-toggle-pin')) $('btn-toggle-pin').textContent = pinVisible ? t('common.hide') : t('common.show');

  if ($('dash-client-id')) $('dash-client-id').textContent = s.auth?.staticClient?.client_id || '--';
  if ($('dash-client-secret')) {
    $('dash-client-secret').textContent = secretVisible
      ? (s.auth?.staticClient?.client_secret || '--')
      : '••••••••••••••••••••';
  }
  if ($('btn-toggle-secret')) $('btn-toggle-secret').textContent = secretVisible ? t('common.hide') : t('common.show');

  if ($('dash-op-status')) $('dash-op-status').textContent = opInfo.text;
  if ($('dash-op-badge')) {
    $('dash-op-badge').textContent = opInfo.badge;
    $('dash-op-badge').className = `badge ${opInfo.cls}`;
  }

  const ts = tun.env?.tailscale;
  const tsStatusEl = $('ts-status-text');
  const tsFunnelEl = $('ts-funnel-badge');
  const tsDnsEl = $('ts-dns-text');
  const tsUseBtn = $('btn-use-ts-url');
  if (!ts) {
    if (tsStatusEl) tsStatusEl.textContent = t('overview.tailscaleClickDetect');
    if (tsFunnelEl) {
      tsFunnelEl.textContent = '--';
      tsFunnelEl.className = 'badge';
    }
    if (tsDnsEl) tsDnsEl.textContent = s.tunnelConfig?.publicUrl || '--';
    if (tsUseBtn) tsUseBtn.classList.add('hidden');
  } else if (!ts.installed) {
    if (tsStatusEl) tsStatusEl.textContent = t('overview.tailscaleNotInstalled');
    if (tsFunnelEl) {
      tsFunnelEl.textContent = 'N/A';
      tsFunnelEl.className = 'badge';
    }
    if (tsDnsEl) tsDnsEl.textContent = '--';
    if (tsUseBtn) tsUseBtn.classList.add('hidden');
  } else {
    if (tsStatusEl) {
      tsStatusEl.textContent = ts.online
        ? t('overview.tailscaleConnected', { ip: ts.tailnetIp || 'Tailnet OK' })
        : t('overview.tailscaleDisconnected');
    }
    if (tsFunnelEl) {
      tsFunnelEl.textContent = ts.funnelActive ? t('overview.funnelOn') : t('overview.funnelOff');
      tsFunnelEl.className = `badge ${ts.funnelActive ? 'badge-ok' : ''}`;
    }
    if (tsDnsEl) tsDnsEl.textContent = ts.suggestedUrl || ts.dnsName || '--';
    const needsApply = Boolean(ts.suggestedUrl && s.tunnelConfig?.publicUrl !== ts.suggestedUrl);
    if (tsUseBtn) tsUseBtn.classList.toggle('hidden', !needsApply);
  }
}

export function matchesLogFilter(entry, filter, search) {
  const lvl = entry.level || 'info';
  const src = String(entry.source || 'app').toLowerCase();
  if (filter === 'warn' && lvl !== 'warn' && lvl !== 'error') return false;
  if (filter === 'mcp' && src !== 'mcp') return false;
  if (filter === 'tunnel' && src !== 'tunnel' && src !== 'tailscale' && src !== 'cloudflared') return false;
  if (filter === 'operator' && src !== 'operator') return false;
  if (search) {
    const q = search.toLowerCase();
    const hay = `${src} ${entry.message || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function createLogRow(entry) {
  const row = document.createElement('div');
  row.className = `log-line lvl-${entry.level || 'info'}`;
  const time = formatLogTime(entry.ts);
  row.innerHTML = `<span class="log-ts">${escapeHtml(time)}</span><span class="log-src">[${escapeHtml(entry.source || 'app')}]</span><span class="log-msg">${escapeHtml(entry.message)}</span>`;
  return row;
}

export function renderLogs(logs, { filter = 'all', search = '' } = {}) {
  const box = $('console-box');
  if (!box) return;
  box.innerHTML = '';
  const visible = (logs || []).filter((e) => matchesLogFilter(e, filter, search));
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = t('overview.noLogsYet');
    box.appendChild(empty);
    return;
  }
  for (const entry of visible.slice(-300)) {
    box.appendChild(createLogRow(entry));
  }
  box.scrollTop = box.scrollHeight;
}
