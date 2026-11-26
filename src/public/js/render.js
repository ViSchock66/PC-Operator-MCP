import { $, escapeHtml, formatUptime, modeLabel, operatorStatusLabel } from './api.js';

export function renderBanner(s) {
  const area = $('banner-area');
  if (!area) return;
  const alerts = [];
  const t = s.tunnel || {};

  if (t.status === 'needs_action' && t.actionUrl) {
    alerts.push(`
      <div class="alert alert-warn">
        <div>
          <strong>Acción requerida en Tailscale:</strong> ${escapeHtml(t.lastError || 'Habilita Funnel en tu tailnet para exponer la URL fija.')}
        </div>
        <div class="btn-row">
          <a class="btn btn-warn btn-sm" href="${escapeHtml(t.actionUrl)}" target="_blank" rel="noopener">Abrir enlace de Tailscale</a>
          <button type="button" class="btn btn-sm btn-primary" data-tunnel-action="restart">Ya lo activé · Reintentar</button>
        </div>
      </div>
    `);
  } else if (t.status === 'error' && t.lastError) {
    alerts.push(`
      <div class="alert alert-danger">
        <div><strong>Error de túnel:</strong> ${escapeHtml(t.lastError)}</div>
        <button type="button" class="btn btn-sm" data-tunnel-action="restart">Reintentar</button>
      </div>
    `);
  }

  if (s.server?.portRestartRequired) {
    alerts.push(`
      <div class="alert alert-warn">
        <div><strong>Puerto modificado (${escapeHtml(s.server.port)}):</strong> Apaga el daemon y vuelve a abrir <code>Abrir-Panel.bat</code> para aplicar el nuevo puerto.</div>
      </div>
    `);
  }

  area.innerHTML = alerts.join('');
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
  const time = entry.ts ? new Date(entry.ts).toLocaleTimeString('es-CL', { hour12: false }) : '--:--:--';
  row.innerHTML = `<span class="log-ts">${escapeHtml(time)}</span><span class="log-src">[${escapeHtml(entry.source || 'app')}]</span><span class="log-msg">${escapeHtml(entry.message)}</span>`;
  return row;
}

export function renderLogs(logs, { filter = 'all', search = '' } = {}) {
  const box = $('console-box');
  if (!box) return;
  box.innerHTML = '';
  const visible = (logs || []).filter((e) => matchesLogFilter(e, filter, search));
  for (const entry of visible.slice(-300)) {
    box.appendChild(createLogRow(entry));
  }
  box.scrollTop = box.scrollHeight;
}

export function updateFullControlCountdown(state) {
  const fc = state?.daemons?.fullControl;
  const badge = $('fc-status-badge');
  const hint = $('fc-countdown-hint');
  const kpiFcVal = $('kpi-fc-val');
  const kpiFcBadge = $('kpi-fc-badge');
  const kpiFcSub = $('kpi-fc-sub');
  if (!fc || !badge || !hint) return;

  const runningCount = state?.daemons?.runningCount || 0;

  if (!fc.enabled) {
    badge.textContent = 'APAGADO';
    badge.className = 'nav-badge';
    hint.innerHTML = 'Apagado: las tools <code>process_*</code> quedan bloqueadas hasta que actives este switch.';
    if (kpiFcVal) kpiFcVal.textContent = `${runningCount} activo${runningCount === 1 ? '' : 's'}`;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = 'Control OFF';
      kpiFcBadge.className = 'nav-badge';
    }
    if (kpiFcSub) kpiFcSub.textContent = 'Consolas persistentes bloqueadas';
    return;
  }

  if (fc.expiresAt) {
    const remSec = Math.max(0, Math.ceil((Date.parse(fc.expiresAt) - Date.now()) / 1000));
    const remStr = formatUptime(remSec);
    badge.textContent = `ACTIVO · ${remStr}`;
    badge.className = 'nav-badge badge-warn';
    hint.textContent = `Control Total encendido${fc.allowUnrestrictedCwd ? ' (cwd libre)' : ' (en workspace)'}. Se apagará solo en ${remStr}.`;
    if (kpiFcVal) kpiFcVal.textContent = `${runningCount} activo${runningCount === 1 ? '' : 's'}`;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = `ON · ${remStr}`;
      kpiFcBadge.className = 'nav-badge badge-warn';
    }
    if (kpiFcSub) kpiFcSub.textContent = fc.allowUnrestrictedCwd ? 'cwd libre habilitado' : 'limitado a workspace';
  } else {
    badge.textContent = 'ACTIVO · SIN LÍMITE';
    badge.className = 'nav-badge badge-warn';
    hint.textContent = `Control Total encendido sin temporizador${fc.allowUnrestrictedCwd ? ' (cwd libre)' : ' (en workspace)'}. Recuerda apagarlo al terminar.`;
    if (kpiFcVal) kpiFcVal.textContent = `${runningCount} activo${runningCount === 1 ? '' : 's'}`;
    if (kpiFcBadge) {
      kpiFcBadge.textContent = 'ON · Manual';
      kpiFcBadge.className = 'nav-badge badge-warn';
    }
    if (kpiFcSub) kpiFcSub.textContent = fc.allowUnrestrictedCwd ? 'cwd libre habilitado' : 'limitado a workspace';
  }
}

export function renderWorkspacesList(s, wsFilterText) {
  const allowed = s.workspaces?.allowed || [];
  const details = s.workspaces?.details || allowed.map((p) => ({
    path: p,
    name: p.split(/[\\/]/).pop() || p,
    exists: true,
    isActive: p.toLowerCase() === (s.workspaces?.active || '').toLowerCase(),
    isGit: false,
    gitBranch: '',
    usedBy: []
  }));
  $('nav-badge-ws').textContent = String(details.length);

  const q = wsFilterText.trim().toLowerCase();
  const filtered = q
    ? details.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        (d.gitBranch || '').toLowerCase().includes(q) ||
        (d.usedBy || []).some((u) => u.toLowerCase().includes(q))
      )
    : details;

  const wsList = $('ws-list');
  if (!wsList) return;
  if (filtered.length === 0) {
    wsList.innerHTML = '<div class="field-hint">Ningún workspace coincide con el filtro.</div>';
    return;
  }

  wsList.innerHTML = filtered.map((d) => {
    const gitBadge = d.isGit
      ? `<span class="nav-badge badge-blue">git:${escapeHtml(d.gitBranch || 'repo')}</span>`
      : '';
    const missingBadge = !d.exists
      ? '<span class="nav-badge badge-danger">No existe</span>'
      : '';
    const usedBadges = (d.usedBy || []).map((u) =>
      `<span class="nav-badge badge-ok" title="En uso por este cliente">${escapeHtml(u)}</span>`
    ).join('');

    return `
      <div class="ws-item ${d.isActive ? 'active' : ''}">
        <div style="min-width:0;flex:1">
          <div class="ws-head-row">
            <span class="ws-title">${escapeHtml(d.name)}</span>
            ${d.isActive ? '<span class="nav-badge badge-ok">Global Activo</span>' : ''}
            ${gitBadge}
            ${missingBadge}
            ${usedBadges}
          </div>
          <div class="ws-path">${escapeHtml(d.path)}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-sm btn-ghost" data-ws-open="${escapeHtml(d.path)}" title="Abrir carpeta en el Explorador">Abrir</button>
          <button type="button" class="btn btn-sm btn-ghost" data-ws-copy="${escapeHtml(d.path)}" title="Copiar ruta absoluta">Copiar</button>
          ${d.isActive
            ? ''
            : `<button type="button" class="btn btn-sm btn-primary" data-ws-select="${escapeHtml(d.path)}">Activar</button>`}
          ${details.length > 1
            ? `<button type="button" class="btn btn-sm btn-ghost" data-ws-remove="${escapeHtml(d.path)}">Quitar</button>`
            : ''}
        </div>
      </div>
    `;
  }).join('');
}

export function renderDaemonsList(s, { openDaemonLogId, daemonLogCache }) {
  const dState = s.daemons || { runningCount: 0, processes: [], fullControl: {} };
  const procs = dState.processes || [];
  const runningCount = dState.runningCount || 0;

  const countBadge = $('daemons-count-badge');
  if (countBadge) {
    countBadge.textContent = `${runningCount} activo${runningCount === 1 ? '' : 's'}`;
    countBadge.className = `nav-badge ${runningCount > 0 ? 'badge-ok' : ''}`;
  }
  const navDaemons = $('nav-badge-daemons');
  if (navDaemons) {
    navDaemons.textContent = String(runningCount);
    navDaemons.className = `nav-badge ${runningCount > 0 ? 'badge-ok' : ''}`;
  }

  const listEl = $('daemons-list');
  if (!listEl) return;
  if (procs.length === 0) {
    listEl.innerHTML = '<div class="field-hint">No hay procesos/demonios persistentes en ejecución. Cuando un modelo (o tú arriba) lance un proceso con <code>process_start</code>, aparecerá aquí con logs y botón de detención.</div>';
    return;
  }

  listEl.innerHTML = procs.map((p) => {
    const running = p.status === 'running';
    const isLogOpen = openDaemonLogId === p.id;
    const logText = daemonLogCache.get(p.id) ?? p.tailPreview ?? '(sin salida todavía)';
    return `
      <div class="ws-item daemon-card ${running ? 'active' : ''}">
        <div class="daemon-card-top">
          <div style="min-width:0;flex:1">
            <div class="ws-head-row">
              <span class="ws-title">${escapeHtml(p.name)}</span>
              <span class="nav-badge ${running ? 'badge-ok' : ''}">${running ? `CORRIENDO · PID ${p.pid || '?'}` : `EXIT ${p.exitCode ?? '?'}`}</span>
              <span class="nav-badge badge-blue">${escapeHtml(p.clientLabel || 'MCP')}</span>
              <span class="ws-sub-meta mono">${escapeHtml(p.id)} · ${formatUptime(p.uptimeSec)}</span>
            </div>
            <div class="ws-path">${escapeHtml(p.command)}</div>
            <div class="ws-sub-meta mono">cwd: ${escapeHtml(p.cwd)}</div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-sm" data-proc-logs="${escapeHtml(p.id)}">${isLogOpen ? 'Ocultar logs' : 'Ver logs'}</button>
            ${running
              ? `<button type="button" class="btn btn-sm btn-danger" data-proc-stop="${escapeHtml(p.id)}">Detener</button>`
              : ''}
          </div>
        </div>
        ${isLogOpen ? `
          <div class="daemon-log-drawer">
            <pre class="daemon-log-pre" id="daemon-log-pre-${escapeHtml(p.id)}">${escapeHtml(logText || '(sin salida)')}</pre>
            ${running ? `
              <div class="btn-row">
                <input type="text" class="input mono" id="daemon-stdin-${escapeHtml(p.id)}" placeholder="Enviar texto/comando a stdin..." style="flex:1" />
                <button type="button" class="btn btn-sm btn-primary" data-proc-send="${escapeHtml(p.id)}">Enviar</button>
                <button type="button" class="btn btn-sm btn-ghost" data-proc-refresh="${escapeHtml(p.id)}">Refrescar</button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

export function renderKpiStrip(s, opInfo) {
  const t = s.tunnel || {};
  const kpiTunnelVal = $('kpi-tunnel-val');
  const kpiTunnelBadge = $('kpi-tunnel-badge');
  const kpiTunnelSub = $('kpi-tunnel-sub');
  if (kpiTunnelVal) {
    kpiTunnelVal.textContent = modeLabel(t.mode || s.tunnelConfig?.mode);
    kpiTunnelBadge.textContent = t.status === 'running' ? 'Online' : (t.status === 'stopped' ? 'Detenido' : t.status);
    kpiTunnelBadge.className = `nav-badge ${t.status === 'running' ? 'badge-ok' : (t.status === 'error' ? 'badge-danger' : 'badge-warn')}`;
    kpiTunnelSub.textContent = t.activeUrl || t.localMcpUrl || '--';
  }

  const pSessions = s.parallelSessions || [];
  const oauthCount = s.auth?.activeSessions ?? 0;
  const kpiSessVal = $('kpi-sessions-val');
  const kpiSessBadge = $('kpi-sessions-badge');
  const kpiSessSub = $('kpi-sessions-sub');
  if (kpiSessVal) {
    kpiSessVal.textContent = String(pSessions.length);
    kpiSessBadge.textContent = `${oauthCount} OAuth`;
    kpiSessBadge.className = `nav-badge ${oauthCount > 0 ? 'badge-ok' : ''}`;
    kpiSessSub.textContent = pSessions.length
      ? pSessions.map((x) => x.clientLabel).slice(0, 3).join(', ')
      : 'Esperando conexión LLM';
  }

  const kpiOpVal = $('kpi-op-val');
  const kpiOpBadge = $('kpi-op-badge');
  const kpiOpSub = $('kpi-op-sub');
  if (kpiOpVal) {
    const tools = s.operator?.toolCount || (s.operator?.enabled ? 17 : 0);
    kpiOpVal.textContent = `${tools} tools`;
    kpiOpBadge.textContent = s.operator?.status === 'connected' ? 'Conectado' : (s.operator?.enabled ? 'Standby' : 'Off');
    kpiOpBadge.className = `nav-badge ${opInfo.cls}`;
    kpiOpSub.textContent = opInfo.text;
  }
}

export function renderNetworkDetails(s) {
  const ts = s.tunnel?.env?.tailscale;
  const cf = s.tunnel?.env?.cloudflared;
  const netTsStatus = $('net-ts-status');
  const netTsIp = $('net-ts-ip');
  const netCfStatus = $('net-cf-status');

  if (netTsStatus) {
    netTsStatus.textContent = !ts
      ? 'Pendiente de detección'
      : (!ts.installed ? 'No instalado' : (ts.online ? `Conectado · ${ts.dnsName || 'OK'}` : 'Instalado (Desconectado)'));
  }
  if (netTsIp) {
    netTsIp.textContent = ts?.tailnetIp ? `${ts.tailnetIp} · Funnel ${ts.funnelActive ? 'ON' : 'OFF'}` : '--';
  }
  if (netCfStatus) {
    netCfStatus.textContent = !cf
      ? 'Pendiente de detección'
      : (cf.installed ? `Instalado (${cf.binaryPath})` : 'No instalado');
  }
}

export function renderAuthSection(s) {
  const sessCount = s.auth?.activeSessions ?? 0;
  $('oauth-sessions-badge').textContent = `${sessCount} ${sessCount === 1 ? 'sesión' : 'sesiones'}`;
  $('param-sessions-count').textContent = String(sessCount);

  const builtinList = $('builtin-providers-list');
  builtinList.innerHTML = (s.auth?.builtinProviders || []).map((p) => `
    <span class="nav-badge badge-ok" title="${escapeHtml(p.origin)}">${escapeHtml(p.name)}</span>
  `).join('');

  const apiKeysList = $('apikeys-list');
  const keys = s.auth?.apiKeys || [];
  if (keys.length === 0) {
    apiKeysList.innerHTML = '<div class="field-hint">No hay API Keys creadas. Usa OAuth 2.1 o genera una key arriba para clientes custom.</div>';
  } else {
    apiKeysList.innerHTML = keys.map((k) => `
      <div class="ws-item">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">${escapeHtml(k.name)}</div>
          <div class="ws-path">${escapeHtml(k.preview)}</div>
        </div>
        <button type="button" class="btn btn-sm btn-danger" data-revoke-apikey="${escapeHtml(k.id)}">Revocar</button>
      </div>
    `).join('');
  }
}

export function renderParallelSessions(s) {
  const psList = $('parallel-sessions-list');
  if (!psList) return;
  const pSessions = s.parallelSessions || [];
  if (pSessions.length === 0) {
    psList.innerHTML = '<div class="field-hint">Aún no hay modelos activos en esta ejecución. Cuando conectes Claude, Gemini o ChatGPT aparecerán aquí con su workspace y bridge aislado.</div>';
    return;
  }
  psList.innerHTML = pSessions.map((ps) => `
    <div class="ws-item ${ps.operatorStatus === 'connected' ? 'active' : ''}">
      <div style="min-width:0;flex:1">
        <div style="font-weight:600">${escapeHtml(ps.clientLabel)} <span class="nav-badge ${ps.operatorStatus === 'connected' ? 'badge-ok' : ''}">${escapeHtml(ps.operatorPid ? `PID ${ps.operatorPid}` : ps.operatorStatus)}</span></div>
        <div class="ws-path">${escapeHtml(ps.activeWorkspace)} (${ps.workspaceScope === 'session' ? 'sesión propia' : 'global'})${ps.lastTool ? ` · última tool: ${escapeHtml(ps.lastTool)}` : ''}</div>
      </div>
      <div class="btn-row">
        ${ps.operatorPid
          ? `<button type="button" class="btn btn-sm btn-ghost" data-stop-op-session="${escapeHtml(ps.sessionKey)}">Cerrar bridge</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

function formatRelativeTime(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '--';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return 'ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD} d`;
}

export function renderHandoffs(s, { openTrailKey = null } = {}) {
  const navBadge = $('nav-badge-handoffs');
  const badge = $('handoff-badge');
  const cpBadge = $('handoff-cp-badge');
  const trailsList = $('handoff-trails-list');
  const cpList = $('handoff-checkpoints-list');
  if (!trailsList || !cpList) return;

  const h = s.handoffs || {};
  const trails = h.trailsDetailed || [];
  const checkpoints = h.checkpointsDetailed || [];
  const pendingCount = checkpoints.filter((c) => c.status === 'pending').length;

  if (navBadge) {
    navBadge.textContent = pendingCount > 0 ? String(pendingCount) : String(trails.length);
    navBadge.className = `nav-badge ${pendingCount > 0 ? 'badge-ok' : ''}`;
  }
  if (badge) {
    badge.textContent = `${trails.length} rastro${trails.length === 1 ? '' : 's'}`;
    badge.className = `nav-badge ${trails.length > 0 ? 'badge-ok' : ''}`;
  }
  if (cpBadge) {
    cpBadge.textContent = pendingCount > 0
      ? `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'} / ${checkpoints.length}`
      : `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`;
    cpBadge.className = `nav-badge ${pendingCount > 0 ? 'badge-ok' : ''}`;
  }

  if (trails.length === 0) {
    trailsList.innerHTML = '<div class="field-hint">Aún no hay actividad registrada. Cuando Claude, Gemini o ChatGPT editen archivos o ejecuten comandos, cada proyecto aparecerá aquí separado automáticamente.</div>';
  } else {
    trailsList.innerHTML = trails.map((t) => {
      const modFiles = (t.modifiedFiles || []).slice(0, 4).map((f) => `${f.path} (${f.op})`).join(', ');
      const readFiles = (t.readFiles || []).slice(0, 3).map((f) => f.path).join(', ');
      const isOpen = openTrailKey === t.trailKey;
      const detailHtml = isOpen
        ? `
          <div style="margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--terminal);border:1px solid var(--border);font-size:11.5px;display:flex;flex-direction:column;gap:5px">
            <div class="mono" style="color:var(--text-soft)"><strong>trailKey:</strong> ${escapeHtml(t.trailKey)}</div>
            ${(t.recentCommands || []).length
              ? `<div><strong>Últimos comandos:</strong><ul style="margin:4px 0 0 16px;padding:0">${t.recentCommands.map((c) => `<li class="mono">${c.ok ? '[OK]' : '[ERR]'} ${escapeHtml(c.command)}</li>`).join('')}</ul></div>`
              : ''}
            ${(t.recentActions || []).length
              ? `<div><strong>Últimas acciones:</strong><ul style="margin:4px 0 0 16px;padding:0">${t.recentActions.map((a) => `<li class="mono">${a.ok ? '[OK]' : '[ERR]'} ${escapeHtml(a.summary)}</li>`).join('')}</ul></div>`
              : ''}
          </div>
        `
        : '';

      return `
        <div class="ws-item" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="min-width:0;flex:1">
              <div style="font-weight:600">
                ${escapeHtml(t.clientLabel)}
                <span class="nav-badge badge-ok">${escapeHtml(t.workspaceName || 'workspace')}</span>
                <span class="nav-badge">${escapeHtml(t.toolCalls || 0)} ops · ${escapeHtml(formatRelativeTime(t.updatedAt))}</span>
              </div>
              <div class="ws-path">${escapeHtml(t.activeWorkspace || '--')}${t.lastTool ? ` · última: ${escapeHtml(t.lastTool)}` : ''}</div>
              ${modFiles ? `<div class="field-hint mono">Modificados: ${escapeHtml(modFiles)}</div>` : ''}
              ${!modFiles && readFiles ? `<div class="field-hint mono">Leídos: ${escapeHtml(readFiles)}</div>` : ''}
              ${t.lastError ? `<div class="field-hint" style="color:var(--danger,#ef4444)">Último error: ${escapeHtml(t.lastError)}</div>` : ''}
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-sm btn-primary" data-handoff-copy-trail="${escapeHtml(t.trailKey)}">Copiar Relevo</button>
              <button type="button" class="btn btn-sm" data-handoff-freeze="${escapeHtml(t.trailKey)}">Congelar + Copiar</button>
              <button type="button" class="btn btn-sm btn-ghost" data-handoff-detail="${escapeHtml(t.trailKey)}">${isOpen ? 'Ocultar' : 'Detalle'}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-handoff-clear-trail="${escapeHtml(t.trailKey)}">Limpiar</button>
            </div>
          </div>
          ${detailHtml}
        </div>
      `;
    }).join('');
  }

  if (checkpoints.length === 0) {
    cpList.innerHTML = '<div class="field-hint">Sin checkpoints guardados. Usa "Congelar + Copiar" arriba (con nota opcional) o pídele al chat <code>handoff_save</code>.</div>';
  } else {
    cpList.innerHTML = checkpoints.map((cp) => `
      <div class="ws-item ${cp.status === 'pending' ? 'active' : ''}">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">
            ${escapeHtml(cp.title || cp.id)}
            <span class="nav-badge ${cp.status === 'pending' ? 'badge-ok' : ''}">${escapeHtml(cp.status)}</span>
            <span class="nav-badge">${escapeHtml(formatRelativeTime(cp.createdAt))}</span>
          </div>
          <div class="ws-path">Origen: ${escapeHtml(cp.fromClientLabel)} · ${escapeHtml(cp.workspaceName || cp.activeWorkspace || '--')}${cp.resumedByClientLabel ? ` · retomado por ${escapeHtml(cp.resumedByClientLabel)}` : ''}</div>
          ${cp.summary ? `<div class="field-hint">${escapeHtml(cp.summary)}</div>` : ''}
          ${cp.notes ? `<div class="field-hint mono">Nota: ${escapeHtml(cp.notes)}</div>` : ''}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-sm btn-primary" data-handoff-copy-id="${escapeHtml(cp.id)}">Copiar Prompt</button>
          <button type="button" class="btn btn-sm btn-danger" data-handoff-delete-id="${escapeHtml(cp.id)}">Eliminar</button>
        </div>
      </div>
    `).join('');
  }
}

export function renderChecklist(s, opInfo) {
  const t = s.tunnel || {};
  const keys = s.auth?.apiKeys || [];
  const hasFixedUrl = Boolean(s.tunnelConfig?.publicUrl && (s.tunnelConfig?.mode === 'tailscale' || s.tunnelConfig?.mode === 'cloudflare-named'));
  const ready = t.status === 'running' && Boolean(s.workspaces?.active);
  $('nav-badge-ready').textContent = ready ? 'OK' : '!';
  $('nav-badge-ready').className = `nav-badge ${ready ? 'badge-ok' : ''}`;
  $('guide-oauth-summary').textContent = `ID: ${s.auth?.staticClient?.client_id || '--'} | Secreto: ${s.auth?.staticClient?.client_secret || '--'}`;

  const checks = [
    { label: 'Servidor MCP local escuchando', ok: true, detail: t.localMcpUrl },
    { label: 'Túnel público HTTPS activo', ok: t.status === 'running' && t.mode !== 'local', detail: t.activeUrl || t.status },
    { label: 'URL fija configurada para no repetir registro', ok: hasFixedUrl, detail: s.tunnelConfig?.publicUrl || 'Sin URL fija' },
    { label: 'Auth agnóstico listo (Gemini, Claude, ChatGPT + API Keys)', ok: true, detail: `${(s.auth?.builtinProviders || []).length} proveedores OAuth + ${keys.length} API Keys` },
    { label: 'Antigravity Operator Bridge (Chrome / Firefox / Desktop)', ok: Boolean(s.operator?.enabled && s.operator?.exists), detail: opInfo.text },
    { label: 'Workspace activo autorizado', ok: Boolean(s.workspaces?.active), detail: s.workspaces?.active || '--' }
  ];
  $('guide-checklist').innerHTML = checks.map((c) => `
    <div class="check-item">
      <div>
        <div style="font-weight:600">${escapeHtml(c.label)}</div>
        <div class="field-hint mono">${escapeHtml(c.detail)}</div>
      </div>
      <span class="check-status ${c.ok ? 'check-ok' : 'check-pending'}">${c.ok ? '[LISTO]' : '[PENDIENTE]'}</span>
    </div>
  `).join('');
}
