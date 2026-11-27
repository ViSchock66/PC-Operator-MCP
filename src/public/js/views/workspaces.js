import { t } from '../../i18n/index.js';
import { $, escapeHtml, icon } from '../api.js';

export function renderWorkspacesList(s, wsFilterText = '') {
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

  const navBadge = $('nav-badge-ws');
  if (navBadge) navBadge.textContent = String(details.length);

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
    wsList.innerHTML = `<div class="empty-state">${escapeHtml(t('workspaces.emptyFilter'))}</div>`;
    return;
  }

  wsList.innerHTML = filtered.map((d) => {
    const gitBadge = d.isGit
      ? `<span class="badge badge-blue">${icon('git-branch', 'icon-xs')} ${escapeHtml(d.gitBranch || 'repo')}</span>`
      : '';
    const missingBadge = !d.exists
      ? `<span class="badge badge-danger">${escapeHtml(t('workspaces.missingBadge'))}</span>`
      : '';
    const usedBadges = (d.usedBy || []).map((u) =>
      `<span class="badge badge-ok" title="${escapeHtml(t('workspaces.usedByTitle'))}">${escapeHtml(u)}</span>`
    ).join('');

    return `
      <div class="list-row ${d.isActive ? 'is-active' : ''}">
        <div class="list-row-main">
          <div class="row-head">
            <span class="row-title">${icon('folder', 'icon-sm')} ${escapeHtml(d.name)}</span>
            ${d.isActive ? `<span class="badge badge-ok">${escapeHtml(t('workspaces.globalActive'))}</span>` : ''}
            ${gitBadge}
            ${missingBadge}
            ${usedBadges}
          </div>
          <div class="row-path mono">${escapeHtml(d.path)}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-sm btn-ghost" data-ws-open="${escapeHtml(d.path)}" title="${escapeHtml(t('workspaces.openExplorerTitle'))}">${escapeHtml(t('common.open'))}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-ws-copy="${escapeHtml(d.path)}" title="${escapeHtml(t('workspaces.copyPathTitle'))}">${escapeHtml(t('common.copy'))}</button>
          ${d.isActive
            ? ''
            : `<button type="button" class="btn btn-sm btn-primary" data-ws-select="${escapeHtml(d.path)}">${escapeHtml(t('common.activate'))}</button>`}
          ${details.length > 1
            ? `<button type="button" class="btn btn-sm btn-ghost" data-ws-remove="${escapeHtml(d.path)}">${escapeHtml(t('common.remove'))}</button>`
            : ''}
        </div>
      </div>
    `;
  }).join('');
}
