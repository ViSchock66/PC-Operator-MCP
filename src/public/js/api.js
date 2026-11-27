import { t } from '../i18n/index.js';

export const $ = (id) => document.getElementById(id);

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(name, cls = 'icon-sm') {
  return `<svg class="${escapeHtml(cls)}" aria-hidden="true"><use href="/admin/assets/icons.svg#i-${escapeHtml(name)}"></use></svg>`;
}

export function toast(msg, kind = 'ok') {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 180);
  }, 3000);
}

export async function copyText(text, label = null, triggerBtn = null) {
  if (!text || text === '--') return;
  const msg = label || t('common.copied');
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(msg, 'ok');
  }
  if (triggerBtn && !triggerBtn.dataset.copyFlash) {
    triggerBtn.dataset.copyFlash = '1';
    triggerBtn.classList.add('is-copied');
    const useEl = triggerBtn.querySelector('use');
    const prevHref = useEl ? useEl.getAttribute('href') : null;
    if (useEl) useEl.setAttribute('href', '/admin/assets/icons.svg#i-check');
    setTimeout(() => {
      triggerBtn.classList.remove('is-copied');
      if (useEl && prevHref) useEl.setAttribute('href', prevHref);
      delete triggerBtn.dataset.copyFlash;
    }, 1200);
  }
}

export async function api(url, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.reload();
    throw new Error(t('common.sessionExpired'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || t('common.httpError', { status: res.status }));
  }
  return data;
}

export function formatUptime(sec) {
  const total = Math.max(0, Math.floor(sec || 0));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function modeLabel(mode) {
  switch (mode) {
    case 'tailscale': return t('status.modeTailscale');
    case 'cloudflare-named': return t('status.modeCfNamed');
    case 'cloudflare-quick': return t('status.modeCfQuick');
    case 'local': return t('status.modeLocal');
    default: return mode || t('common.none');
  }
}

export function operatorStatusLabel(op) {
  if (!op) return { badge: '--', cls: '', text: '--' };
  const sessCount = Number(op.activeSessionCount || 0);
  switch (op.status) {
    case 'connected':
      return {
        badge: t('operator.badgeToolsIsolated', { tools: op.toolCount || 17, count: sessCount || 1 }),
        cls: 'badge-ok',
        text: sessCount > 1
          ? t('operator.textMultiBridges', { count: sessCount })
          : t('operator.textSingleBridge', { pid: op.pid || '?' })
      };
    case 'standby':
      return {
        badge: op.toolCount
          ? t('operator.badgeLazy', { tools: op.toolCount })
          : t('operator.badgeReadyLazy'),
        cls: 'badge-ok',
        text: t('operator.textStandby')
      };
    case 'connecting':
      return { badge: t('operator.badgeStarting'), cls: '', text: t('operator.textStarting') };
    case 'missing':
      return { badge: t('operator.badgeMissing'), cls: '', text: t('operator.textMissing') };
    case 'error':
      return { badge: t('operator.badgeError'), cls: 'badge-danger', text: op.lastError || t('operator.textErrorFallback') };
    default:
      return { badge: t('operator.badgeOff'), cls: '', text: t('operator.textOff') };
  }
}
