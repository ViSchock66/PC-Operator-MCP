import { getServerMessages, normalizeLanguage } from '../i18n.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLoginHtml({ lang = 'en', errorMessage = '' } = {}) {
  const activeLang = normalizeLanguage(lang);
  const msg = getServerMessages(activeLang).login;
  const enActive = activeLang === 'en';
  const esActive = activeLang === 'es';

  return `<!doctype html>
<html lang="${msg.htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(msg.title)}</title>
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/admin/assets/icon-32.png" />
  <link rel="manifest" href="/admin/assets/manifest.webmanifest" />
  <link rel="stylesheet" href="/admin/assets/styles.css" />
  <style>
    .login-top-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:0 0 12px}
    .lang-pill{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:#090b10;border:1px solid #232834;flex-shrink:0}
    .lang-pill a{padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;color:#7c8598;text-decoration:none;transition:background .12s,color .12s}
    .lang-pill a:hover{color:#f4f4f5}
    .lang-pill a.active{background:#181c24;color:#f4f4f5}
  </style>
</head>
<body class="login-body">
  <div class="login-card">
    <div class="login-top-row">
      <div class="brand" style="padding:0">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="#0d1017" stroke="#2a3244" stroke-width="1.3"/>
            <path d="M8.5 13.5V9.8C8.5 9.1 9.1 8.5 9.8 8.5H22.2C22.9 8.5 23.5 9.1 23.5 9.8V13.5" stroke="#f4f4f5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8.5 18.5V22.2C8.5 22.9 9.1 23.5 9.8 23.5H22.2C22.9 23.5 23.5 22.9 23.5 22.2V18.5" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="10.8" y1="16" x2="21.2" y2="16" stroke="#94a3b8" stroke-width="1.7" stroke-linecap="round"/>
            <circle cx="8.5" cy="16" r="2.3" fill="#181c24" stroke="#f4f4f5" stroke-width="1.7"/>
            <circle cx="23.5" cy="16" r="2.3" fill="#181c24" stroke="#f4f4f5" stroke-width="1.7"/>
            <circle cx="16" cy="16" r="3.4" fill="#0d1017"/>
            <circle cx="16" cy="16" r="2.6" fill="#22c55e"/>
          </svg>
        </div>
        <div class="brand-meta">
          <div class="brand-title-row">
            <span class="brand-name">PC-Operator-MCP</span>
            <span class="version-chip">${escapeHtml(msg.badge)}</span>
          </div>
          <span class="brand-sub">${escapeHtml(msg.subtitle)}</span>
        </div>
      </div>
      <div class="lang-pill" role="navigation" aria-label="Language">
        <a href="/admin?lang=en" class="${enActive ? 'active' : ''}">EN</a>
        <a href="/admin?lang=es" class="${esActive ? 'active' : ''}">ES</a>
      </div>
    </div>
    <p class="muted-copy">${escapeHtml(msg.description)}</p>
    ${errorMessage ? `<div class="alert alert-danger" style="margin-top:12px">${escapeHtml(errorMessage)}</div>` : ''}
    <form method="POST" action="/admin/login" class="login-form">
      <input type="hidden" name="lang" value="${escapeHtml(activeLang)}" />
      <label class="field-label" for="pin-input">${msg.pinLabelHtml}</label>
      <input id="pin-input" class="input mono" type="password" name="pin" placeholder="${escapeHtml(msg.pinPlaceholder)}" autofocus required />
      <button class="btn btn-primary btn-full" type="submit">${escapeHtml(msg.submit)}</button>
    </form>
  </div>
</body>
</html>`;
}
