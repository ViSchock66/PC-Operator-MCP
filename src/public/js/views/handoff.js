import { formatRelativeTime, t } from '../../i18n/index.js';
import { $, escapeHtml } from '../api.js';

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
    navBadge.className = `badge ${pendingCount > 0 ? 'badge-ok' : ''}`;
  }
  if (badge) {
    badge.textContent = trails.length === 1
      ? t('handoff.trailsBadge', { count: trails.length })
      : t('handoff.trailsBadgePlural', { count: trails.length });
    badge.className = `badge ${trails.length > 0 ? 'badge-ok' : ''}`;
  }
  if (cpBadge) {
    cpBadge.textContent = pendingCount > 0
      ? t('handoff.cpBadgePending', { pending: pendingCount, total: checkpoints.length })
      : (checkpoints.length === 1
          ? t('handoff.cpBadgeTotal', { count: checkpoints.length })
          : t('handoff.cpBadgeTotalPlural', { count: checkpoints.length }));
    cpBadge.className = `badge ${pendingCount > 0 ? 'badge-ok' : ''}`;
  }

  if (trails.length === 0) {
    trailsList.innerHTML = `<div class="empty-state">${escapeHtml(t('handoff.trailsEmpty'))}</div>`;
  } else {
    trailsList.innerHTML = trails.map((tr) => {
      const modFiles = (tr.modifiedFiles || []).slice(0, 4).map((f) => `${f.path} (${f.op})`).join(', ');
      const readFiles = (tr.readFiles || []).slice(0, 3).map((f) => f.path).join(', ');
      const isOpen = openTrailKey === tr.trailKey;
      const detailHtml = isOpen
        ? `
          <div class="log-drawer">
            <div class="mono row-sub"><strong>trailKey:</strong> ${escapeHtml(tr.trailKey)}</div>
            ${(tr.recentCommands || []).length
              ? `<div><strong>${escapeHtml(t('handoff.recentCommands'))}</strong><ul class="trail-detail-list">${tr.recentCommands.map((c) => `<li class="mono">${c.ok ? '[OK]' : '[ERR]'} ${escapeHtml(c.command)}</li>`).join('')}</ul></div>`
              : ''}
            ${(tr.recentActions || []).length
              ? `<div><strong>${escapeHtml(t('handoff.recentActions'))}</strong><ul class="trail-detail-list">${tr.recentActions.map((a) => `<li class="mono">${a.ok ? '[OK]' : '[ERR]'} ${escapeHtml(a.summary)}</li>`).join('')}</ul></div>`
              : ''}
          </div>
        `
        : '';

      return `
        <div class="list-row list-row-col">
          <div class="list-row-top">
            <div class="list-row-main">
              <div class="row-head">
                <span class="row-title">${escapeHtml(tr.clientLabel)}</span>
                <span class="badge badge-ok">${escapeHtml(tr.workspaceName || 'workspace')}</span>
                <span class="badge">${escapeHtml(t('handoff.opsCount', { count: tr.toolCalls || 0, time: formatRelativeTime(tr.updatedAt) }))}</span>
              </div>
              <div class="row-path mono">
                ${escapeHtml(tr.activeWorkspace || '--')}${tr.lastTool ? ` · ${escapeHtml(t('handoff.lastToolInline', { tool: tr.lastTool }))}` : ''}
              </div>
              ${modFiles ? `<div class="row-sub mono">${escapeHtml(t('handoff.modifiedFiles', { files: modFiles }))}</div>` : ''}
              ${!modFiles && readFiles ? `<div class="row-sub mono">${escapeHtml(t('handoff.readFiles', { files: readFiles }))}</div>` : ''}
              ${tr.lastError ? `<div class="row-sub text-danger">${escapeHtml(t('handoff.lastError', { error: tr.lastError }))}</div>` : ''}
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-sm btn-primary" data-handoff-copy-trail="${escapeHtml(tr.trailKey)}">${escapeHtml(t('handoff.copyHandoff'))}</button>
              <button type="button" class="btn btn-sm" data-handoff-freeze="${escapeHtml(tr.trailKey)}">${escapeHtml(t('handoff.freezeAndCopy'))}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-handoff-detail="${escapeHtml(tr.trailKey)}">${escapeHtml(isOpen ? t('common.hide') : t('common.details'))}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-handoff-clear-trail="${escapeHtml(tr.trailKey)}">${escapeHtml(t('common.clear'))}</button>
            </div>
          </div>
          ${detailHtml}
        </div>
      `;
    }).join('');
  }

  if (checkpoints.length === 0) {
    cpList.innerHTML = `<div class="empty-state">${t('handoff.checkpointsEmpty')}</div>`;
  } else {
    cpList.innerHTML = checkpoints.map((cp) => {
      const originLine = t('handoff.cpOrigin', {
        client: cp.fromClientLabel,
        workspace: cp.workspaceName || cp.activeWorkspace || '--'
      });
      const resumedSuffix = cp.resumedByClientLabel
        ? ` · ${t('handoff.cpResumedBy', { client: cp.resumedByClientLabel })}`
        : '';

      return `
        <div class="list-row ${cp.status === 'pending' ? 'is-active' : ''}">
          <div class="list-row-main">
            <div class="row-head">
              <span class="row-title">${escapeHtml(cp.title || cp.id)}</span>
              <span class="badge ${cp.status === 'pending' ? 'badge-ok' : ''}">${escapeHtml(cp.status)}</span>
              <span class="badge">${escapeHtml(formatRelativeTime(cp.createdAt))}</span>
            </div>
            <div class="row-path mono">${escapeHtml(originLine)}${escapeHtml(resumedSuffix)}</div>
            ${cp.summary ? `<div class="row-sub">${escapeHtml(cp.summary)}</div>` : ''}
            ${cp.notes ? `<div class="row-sub mono">${escapeHtml(t('handoff.cpNote', { note: cp.notes }))}</div>` : ''}
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-sm btn-primary" data-handoff-copy-id="${escapeHtml(cp.id)}">${escapeHtml(t('handoff.copyPrompt'))}</button>
            <button type="button" class="btn btn-sm btn-danger" data-handoff-delete-id="${escapeHtml(cp.id)}">${escapeHtml(t('common.delete'))}</button>
          </div>
        </div>
      `;
    }).join('');
  }
}
