import { getServerMessages, normalizeLanguage } from '../i18n.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLangSwitchHref(baseQueryString, targetLang) {
  const params = new URLSearchParams(baseQueryString || '');
  params.set('lang', targetLang);
  return `?${params.toString()}`;
}

export function renderConsentPage({
  lang = 'en',
  requestId,
  client,
  providerLabel,
  redirectUri,
  activeWorkspace,
  permissions = {},
  operatorEnabled = false,
  errorMessage = '',
  langSwitchQuery = ''
} = {}) {
  const activeLang = normalizeLanguage(lang);
  const msg = getServerMessages(activeLang).consent;
  const caps = msg.capabilities;

  let redirectHost = redirectUri;
  try {
    redirectHost = new URL(redirectUri).host;
  } catch {
    redirectHost = redirectUri;
  }

  const perms = [
    caps.read,
    permissions.allowWrite ? caps.write : null,
    permissions.allowDelete ? caps.delete : null,
    permissions.allowCommands ? caps.commands : null,
    operatorEnabled ? caps.operator : null
  ].filter(Boolean);

  const showLangSwitcher = Boolean(langSwitchQuery);
  const enHref = showLangSwitcher ? buildLangSwitchHref(langSwitchQuery, 'en') : '';
  const esHref = showLangSwitcher ? buildLangSwitchHref(langSwitchQuery, 'es') : '';

  return `<!doctype html>
<html lang="${msg.htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(msg.title)}</title>
  <style>
    body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 50% 15%,rgba(34,197,94,.06),transparent 55%),#08090c;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
    .card{background:#12151c;border:1px solid #323949;border-radius:12px;max-width:460px;width:100%;padding:24px;box-shadow:0 20px 48px rgba(0,0,0,.55)}
    .top-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
    .head{display:flex;align-items:center;gap:12px}
    .logo{width:34px;height:34px;flex-shrink:0}
    .lang-pill{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:#090b10;border:1px solid #232834;flex-shrink:0}
    .lang-pill a{padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;color:#7c8598;text-decoration:none}
    .lang-pill a:hover{color:#f4f4f5}
    .lang-pill a.active{background:#181c24;color:#f4f4f5}
    h1{font-size:1.12rem;margin:0;letter-spacing:-.02em}
    .sub{font-size:.78rem;color:#7c8598;margin-top:2px}
    p{color:#b4bccb;font-size:.88rem;line-height:1.5;margin:10px 0}
    .box{background:#090b10;border:1px solid #232834;border-radius:8px;padding:12px 14px;margin:14px 0;font-size:.84rem}
    .box strong{color:#f4f4f5}
    code{font-family:'JetBrains Mono','Cascadia Code',Consolas,monospace;font-size:.8rem;background:#181c24;border:1px solid #232834;padding:1.5px 5px;border-radius:4px;color:#86efac}
    ul{margin:8px 0 0;padding-left:18px;color:#b4bccb}
    li{margin:3px 0}
    label{display:block;font-size:.82rem;font-weight:500;margin:14px 0 6px;color:#b4bccb}
    input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:7px;border:1px solid #323949;background:#090b10;color:#fff;font-family:'JetBrains Mono',Consolas,monospace;font-size:.95rem;letter-spacing:.1em;outline:none}
    input[type=password]:focus{border-color:#22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.14)}
    .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.45);color:#fecaca;border-radius:7px;padding:9px 12px;font-size:.84rem;margin:12px 0}
    .actions{display:flex;gap:10px;margin-top:16px}
    button{flex:1;padding:10px 14px;border-radius:7px;border:1px solid transparent;font-weight:600;cursor:pointer;font-size:.88rem}
    .allow{background:#16a34a;border-color:#22c55e;color:#fff}
    .allow:hover{background:#15803d}
    .deny{background:#181c24;color:#b4bccb;border-color:#323949}
    .deny:hover{background:#1e232e;color:#f4f4f5}
  </style>
</head>
<body>
  <div class="card">
    <div class="top-bar">
      <div class="head">
        <svg class="logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="#0d1017" stroke="#2a3244" stroke-width="1.3"/>
          <path d="M8.5 13.5V9.8C8.5 9.1 9.1 8.5 9.8 8.5H22.2C22.9 8.5 23.5 9.1 23.5 9.8V13.5" stroke="#f4f4f5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8.5 18.5V22.2C8.5 22.9 9.1 23.5 9.8 23.5H22.2C22.9 23.5 23.5 22.9 23.5 22.2V18.5" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="10.8" y1="16" x2="21.2" y2="16" stroke="#94a3b8" stroke-width="1.7" stroke-linecap="round"/>
          <circle cx="8.5" cy="16" r="2.3" fill="#181c24" stroke="#f4f4f5" stroke-width="1.7"/>
          <circle cx="23.5" cy="16" r="2.3" fill="#181c24" stroke="#f4f4f5" stroke-width="1.7"/>
          <circle cx="16" cy="16" r="3.4" fill="#0d1017"/>
          <circle cx="16" cy="16" r="2.6" fill="#22c55e"/>
        </svg>
        <div>
          <h1>${escapeHtml(msg.heading)}</h1>
          <div class="sub">${escapeHtml(msg.subtitle)}</div>
        </div>
      </div>
      ${showLangSwitcher ? `
      <div class="lang-pill" role="navigation" aria-label="Language">
        <a href="${escapeHtml(enHref)}" class="${activeLang === 'en' ? 'active' : ''}">EN</a>
        <a href="${escapeHtml(esHref)}" class="${activeLang === 'es' ? 'active' : ''}">ES</a>
      </div>` : ''}
    </div>
    <p><strong>${escapeHtml(providerLabel)}</strong> (${escapeHtml(client?.client_name || client?.client_id || '')}) ${escapeHtml(msg.requestIntroPrefix)} <code>${escapeHtml(redirectHost)}</code>${escapeHtml(msg.requestIntroSuffix)}</p>
    <div class="box">
      <div><strong>${escapeHtml(msg.activeWorkspace)}</strong><br/><code>${escapeHtml(activeWorkspace)}</code></div>
      <div style="margin-top:10px"><strong>${escapeHtml(msg.enabledCapabilities)}</strong>
        <ul>${perms.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </div>
    ${errorMessage ? `<div class="err">${escapeHtml(errorMessage)}</div>` : ''}
    <form method="POST" action="/authorize/confirm">
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}" />
      <input type="hidden" name="lang" value="${escapeHtml(activeLang)}" />
      <label for="pin">${escapeHtml(msg.pinLabel)}</label>
      <input id="pin" name="pin" type="password" autocomplete="off" autofocus placeholder="${escapeHtml(msg.pinPlaceholder)}" />
      <div class="actions">
        <button class="deny" type="submit" name="decision" value="deny">${escapeHtml(msg.deny)}</button>
        <button class="allow" type="submit" name="decision" value="allow">${escapeHtml(msg.allow)}</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
