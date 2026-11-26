export const $ = (id) => document.getElementById(id);

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toast(msg, kind = 'ok') {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export async function copyText(text, label = 'Copiado al portapapeles') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(label, 'ok');
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
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error HTTP ${res.status}`);
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
    case 'tailscale': return 'Tailscale';
    case 'cloudflare-named': return 'CF Fijo';
    case 'cloudflare-quick': return 'CF Rápido';
    case 'local': return 'Local';
    default: return mode || '--';
  }
}

export function operatorStatusLabel(op) {
  if (!op) return { badge: '--', cls: '', text: '--' };
  const sessCount = Number(op.activeSessionCount || 0);
  switch (op.status) {
    case 'connected':
      return {
        badge: `${op.toolCount || 17} tools · ${sessCount || 1} aislada${sessCount === 1 ? '' : 's'}`,
        cls: 'badge-ok',
        text: sessCount > 1
          ? `Conectado (${sessCount} bridges paralelos aislados)`
          : `Conectado (PID ${op.pid || '?'} · aislado por cliente)`
      };
    case 'standby':
      return {
        badge: op.toolCount ? `${op.toolCount} tools · Lazy` : 'Listo (Lazy)',
        cls: 'badge-ok',
        text: 'Habilitado · 1 bridge aislado por modelo (arranca al primer uso)'
      };
    case 'connecting':
      return { badge: 'Iniciando', cls: '', text: 'Conectando con pipe-broker...' };
    case 'missing':
      return { badge: 'No hallado', cls: '', text: 'No se encontró server/index.mjs en la ruta' };
    case 'error':
      return { badge: 'Error', cls: '', text: op.lastError || 'Error al iniciar Operator' };
    default:
      return { badge: 'Inactivo', cls: '', text: 'Deshabilitado' };
  }
}
