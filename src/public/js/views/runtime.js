import { t } from '../../i18n/index.js';
import { $, escapeHtml, formatUptime } from '../api.js';

export function renderOperatorHeader(opInfo) {
  const badge = $('op-tab-badge');
  if (badge) {
    badge.textContent = opInfo.badge;
    badge.className = `badge ${opInfo.cls}`;
  }
}

export function renderParallelSessions(s) {
  const psList = $('parallel-sessions-list');
  const psBadge = $('parallel-sessions-badge');
  const pSessions = s.parallelSessions || [];

  if (psBadge) {
    psBadge.textContent = String(pSessions.length);
    psBadge.className = `badge ${pSessions.length > 0 ? 'badge-ok' : ''}`;
  }

  if (!psList) return;
  if (pSessions.length === 0) {
    psList.innerHTML = `<div class="empty-state">${escapeHtml(t('runtime.sessionsEmpty'))}</div>`;
    return;
  }

  psList.innerHTML = pSessions.map((ps) => `
    <div class="list-row ${ps.operatorStatus === 'connected' ? 'is-active' : ''}">
      <div class="list-row-main">
        <div class="row-head">
          <span class="row-title">${escapeHtml(ps.clientLabel)}</span>
          <span class="badge ${ps.operatorStatus === 'connected' ? 'badge-ok' : ''}">${escapeHtml(ps.operatorPid ? `PID ${ps.operatorPid}` : ps.operatorStatus)}</span>
          <span class="badge">${escapeHtml(ps.workspaceScope === 'session' ? t('runtime.scopeSession') : t('runtime.scopeGlobal'))}</span>
        </div>
        <div class="row-path mono">
          ${escapeHtml(ps.activeWorkspace)}${ps.lastTool ? ` · ${escapeHtml(t('runtime.lastTool', { tool: ps.lastTool }))}` : ''}
        </div>
      </div>
      <div class="btn-row">
        ${ps.operatorPid
          ? `<button type="button" class="btn btn-sm btn-ghost" data-stop-op-session="${escapeHtml(ps.sessionKey)}">${escapeHtml(t('runtime.closeBridge'))}</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

export function updateFullControlCountdown(state) {
  const fc = state?.daemons?.fullControl;
  const card = $('card-full-control');
  const badge = $('fc-status-badge');
  const hint = $('fc-countdown-hint');
  const kpiFcVal = $('kpi-fc-val');
  const kpiFcBadge = $('kpi-fc-badge');
  const kpiFcSub = $('kpi-fc-sub');
  const navDaemons = $('nav-badge-daemons');
  if (!fc || !badge || !hint) return;

  const runningCount = state?.daemons?.runningCount || 0;
  const activeCountText = t('overview.kpiDaemonsActive', { count: runningCount });

  if (card) {
    card.classList.toggle('card-armed', Boolean(fc.enabled));
  }

  if (!fc.enabled) {
    badge.textContent = t('runtime.fcBadgeOff');
    badge.className = 'badge';
    hint.innerHTML = t('runtime.fcHintOff');
    if (kpiFcVal) kpiFcVal.textContent = activeCountText;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = t('overview.kpiControlOff');
      kpiFcBadge.className = 'badge';
    }
    if (kpiFcSub) kpiFcSub.textContent = t('overview.kpiControlLocked');
    if (navDaemons) {
      navDaemons.textContent = String(runningCount);
      navDaemons.className = `badge ${runningCount > 0 ? 'badge-ok' : ''}`;
    }
    return;
  }

  const scopeLabel = fc.allowUnrestrictedCwd ? t('runtime.fcScopeFree') : t('runtime.fcScopeWorkspace');
  const kpiSubLabel = fc.allowUnrestrictedCwd
    ? t('overview.kpiControlFreeCwd')
    : t('overview.kpiControlWorkspaceCwd');

  if (fc.expiresAt) {
    const remSec = Math.max(0, Math.ceil((Date.parse(fc.expiresAt) - Date.now()) / 1000));
    const remStr = formatUptime(remSec);
    badge.textContent = t('runtime.fcBadgeTimed', { time: remStr });
    badge.className = 'badge badge-warn';
    hint.textContent = t('runtime.fcHintTimed', { scope: scopeLabel, time: remStr });
    if (kpiFcVal) kpiFcVal.textContent = activeCountText;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = t('overview.kpiControlOnTimer', { time: remStr });
      kpiFcBadge.className = 'badge badge-warn';
    }
    if (kpiFcSub) kpiFcSub.textContent = kpiSubLabel;
  } else {
    badge.textContent = t('runtime.fcBadgeManual');
    badge.className = 'badge badge-warn';
    hint.textContent = t('runtime.fcHintManual', { scope: scopeLabel });
    if (kpiFcVal) kpiFcVal.textContent = activeCountText;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = t('overview.kpiControlOnManual');
      kpiFcBadge.className = 'badge badge-warn';
    }
    if (kpiFcSub) kpiFcSub.textContent = kpiSubLabel;
  }

  if (navDaemons) {
    navDaemons.textContent = runningCount > 0 ? String(runningCount) : t('common.on');
    navDaemons.className = 'badge badge-warn';
  }
}

export function renderDaemonsList(s, { openDaemonLogId, daemonLogCache }) {
  const dState = s.daemons || { runningCount: 0, processes: [], fullControl: {} };
  const procs = dState.processes || [];
  const runningCount = dState.runningCount || 0;

  const countBadge = $('daemons-count-badge');
  if (countBadge) {
    countBadge.textContent = t('runtime.daemonsCount', { count: runningCount });
    countBadge.className = `badge ${runningCount > 0 ? 'badge-ok' : ''}`;
  }

  const listEl = $('daemons-list');
  if (!listEl) return;
  if (procs.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('runtime.daemonsEmpty')}</div>`;
    return;
  }

  listEl.innerHTML = procs.map((p) => {
    const running = p.status === 'running';
    const isLogOpen = openDaemonLogId === p.id;
    const logText = daemonLogCache.get(p.id) ?? p.tailPreview ?? t('runtime.noOutputYet');
    return `
      <div class="list-row list-row-col ${running ? 'is-active' : ''}">
        <div class="list-row-top">
          <div class="list-row-main">
            <div class="row-head">
              <span class="row-title">${escapeHtml(p.name)}</span>
              <span class="badge ${running ? 'badge-ok' : ''}">${escapeHtml(running ? t('runtime.daemonRunningBadge', { pid: p.pid || '?' }) : t('runtime.daemonExitBadge', { code: p.exitCode ?? '?' }))}</span>
              <span class="badge badge-blue">${escapeHtml(p.clientLabel || 'MCP')}</span>
              <span class="row-meta mono">${escapeHtml(p.id)} · ${formatUptime(p.uptimeSec)}</span>
            </div>
            <div class="row-path mono">${escapeHtml(p.command)}</div>
            <div class="row-sub mono">cwd: ${escapeHtml(p.cwd)}</div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-sm" data-proc-logs="${escapeHtml(p.id)}">${escapeHtml(isLogOpen ? t('runtime.hideLogs') : t('runtime.showLogs'))}</button>
            ${running
              ? `<button type="button" class="btn btn-sm btn-danger" data-proc-stop="${escapeHtml(p.id)}">${escapeHtml(t('common.stop'))}</button>`
              : ''}
          </div>
        </div>
        ${isLogOpen ? `
          <div class="log-drawer">
            <pre class="log-drawer-pre" id="daemon-log-pre-${escapeHtml(p.id)}">${escapeHtml(logText || t('runtime.noOutput'))}</pre>
            ${running ? `
              <div class="btn-row">
                <input type="text" class="input mono" id="daemon-stdin-${escapeHtml(p.id)}" placeholder="${escapeHtml(t('runtime.stdinPlaceholder'))}" style="flex:1" />
                <button type="button" class="btn btn-sm btn-primary" data-proc-send="${escapeHtml(p.id)}">${escapeHtml(t('common.send'))}</button>
                <button type="button" class="btn btn-sm btn-ghost" data-proc-refresh="${escapeHtml(p.id)}">${escapeHtml(t('common.refresh'))}</button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}
