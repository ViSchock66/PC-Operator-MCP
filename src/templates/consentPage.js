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
  <meta name="color-scheme" content="light dark" />
  <script>
    (function () {
      var stored = null;
      try { stored = localStorage.getItem('color-scheme'); } catch (e) {}
      var content = (stored === 'light' || stored === 'dark') ? stored : 'light dark';
      var csMeta = document.querySelector('meta[name="color-scheme"]');
      if (csMeta) csMeta.setAttribute('content', content);
      if (content === 'light' || content === 'dark') {
        document.documentElement.dataset.theme = content;
      }
    })();
  </script>
  <title>${escapeHtml(msg.title)}</title>
  <style>
    :root{
      color-scheme:light dark;
      --bg-light:#f6f6f4;--surface-light:#ffffff;--subtle-light:#f1f1ee;--border-light:#d1d1cb;--hair-light:#e4e4e0;
      --text-light:#18181b;--soft-light:#52525b;--muted-light:#63636b;--cta-bg-light:#18181b;--cta-tx-light:#fafafa;--cta-hv-light:#27272a;
      --accent-light:#4338ca;--accent-soft-light:rgba(67,56,202,.09);--ok-light:#059669;--err-bg-light:rgba(220,38,38,.08);--err-bd-light:rgba(220,38,38,.28);--err-tx-light:#991b1b;
      --bg-dark:#111113;--surface-dark:#19191c;--subtle-dark:#121214;--border-dark:#333339;--hair-dark:#252529;
      --text-dark:#ededef;--soft-dark:#a1a1aa;--muted-dark:#868690;--cta-bg-dark:#ededef;--cta-tx-dark:#141416;--cta-hv-dark:#ffffff;
      --accent-dark:#818cf8;--accent-soft-dark:rgba(129,140,248,.13);--ok-dark:#10b981;--err-bg-dark:rgba(239,68,68,.11);--err-bd-dark:rgba(239,68,68,.3);--err-tx-dark:#fca5a5;
      --bg:var(--bg-light);--surface:var(--surface-light);--subtle:var(--subtle-light);--border:var(--border-light);--hair:var(--hair-light);
      --text:var(--text-light);--soft:var(--soft-light);--muted:var(--muted-light);--cta-bg:var(--cta-bg-light);--cta-tx:var(--cta-tx-light);--cta-hv:var(--cta-hv-light);
      --accent:var(--accent-light);--accent-soft:var(--accent-soft-light);--ok:var(--ok-light);--err-bg:var(--err-bg-light);--err-bd:var(--err-bd-light);--err-tx:var(--err-tx-light);
    }
    @media (prefers-color-scheme:dark){
      :root{
        --bg:var(--bg-dark);--surface:var(--surface-dark);--subtle:var(--subtle-dark);--border:var(--border-dark);--hair:var(--hair-dark);
        --text:var(--text-dark);--soft:var(--soft-dark);--muted:var(--muted-dark);--cta-bg:var(--cta-bg-dark);--cta-tx:var(--cta-tx-dark);--cta-hv:var(--cta-hv-dark);
        --accent:var(--accent-dark);--accent-soft:var(--accent-soft-dark);--ok:var(--ok-dark);--err-bg:var(--err-bg-dark);--err-bd:var(--err-bd-dark);--err-tx:var(--err-tx-dark);
      }
    }
    @supports (color:light-dark(white,black)){
      :root{
        --bg:light-dark(var(--bg-light),var(--bg-dark));--surface:light-dark(var(--surface-light),var(--surface-dark));
        --subtle:light-dark(var(--subtle-light),var(--subtle-dark));--border:light-dark(var(--border-light),var(--border-dark));
        --hair:light-dark(var(--hair-light),var(--hair-dark));--text:light-dark(var(--text-light),var(--text-dark));
        --soft:light-dark(var(--soft-light),var(--soft-dark));--muted:light-dark(var(--muted-light),var(--muted-dark));
        --cta-bg:light-dark(var(--cta-bg-light),var(--cta-bg-dark));--cta-tx:light-dark(var(--cta-tx-light),var(--cta-tx-dark));
        --cta-hv:light-dark(var(--cta-hv-light),var(--cta-hv-dark));--accent:light-dark(var(--accent-light),var(--accent-dark));
        --accent-soft:light-dark(var(--accent-soft-light),var(--accent-soft-dark));--ok:light-dark(var(--ok-light),var(--ok-dark));
        --err-bg:light-dark(var(--err-bg-light),var(--err-bg-dark));--err-bd:light-dark(var(--err-bd-light),var(--err-bd-dark));
        --err-tx:light-dark(var(--err-tx-light),var(--err-tx-dark));
      }
    }
    :root[data-theme="dark"],:root:has(> head > meta[name="color-scheme"][content="dark"]){
      color-scheme:dark;
      --bg:var(--bg-dark);--surface:var(--surface-dark);--subtle:var(--subtle-dark);--border:var(--border-dark);--hair:var(--hair-dark);
      --text:var(--text-dark);--soft:var(--soft-dark);--muted:var(--muted-dark);--cta-bg:var(--cta-bg-dark);--cta-tx:var(--cta-tx-dark);--cta-hv:var(--cta-hv-dark);
      --accent:var(--accent-dark);--accent-soft:var(--accent-soft-dark);--ok:var(--ok-dark);--err-bg:var(--err-bg-dark);--err-bd:var(--err-bd-dark);--err-tx:var(--err-tx-dark);
    }
    :root[data-theme="light"],:root:has(> head > meta[name="color-scheme"][content="light"]){
      color-scheme:light;
      --bg:var(--bg-light);--surface:var(--surface-light);--subtle:var(--subtle-light);--border:var(--border-light);--hair:var(--hair-light);
      --text:var(--text-light);--soft:var(--soft-light);--muted:var(--muted-light);--cta-bg:var(--cta-bg-light);--cta-tx:var(--cta-tx-light);--cta-hv:var(--cta-hv-light);
      --accent:var(--accent-light);--accent-soft:var(--accent-soft-light);--ok:var(--ok-light);--err-bg:var(--err-bg-light);--err-bd:var(--err-bd-light);--err-tx:var(--err-tx-light);
    }
    *{box-sizing:border-box}
    body{font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;-webkit-font-smoothing:antialiased}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;max-width:484px;width:100%;padding:22px 24px;box-shadow:0 12px 32px rgba(0,0,0,.14)}
    .top-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--hair);margin-bottom:14px}
    .head{display:flex;align-items:center;gap:11px;min-width:0}
    .logo{width:30px;height:30px;flex-shrink:0}
    .controls{display:inline-flex;align-items:center;gap:6px;flex-shrink:0}
    .seg{display:inline-flex;align-items:center;gap:1px;padding:2px;border-radius:6px;background:var(--subtle);border:1px solid var(--hair)}
    .seg a,.seg button,.icon-btn{border:0;background:transparent;padding:3px 7px;border-radius:4px;font-size:11px;font-weight:600;color:var(--muted);text-decoration:none;cursor:pointer;font-family:ui-monospace,Consolas,monospace;line-height:1.3}
    .seg a:hover,.seg button:hover,.icon-btn:hover{color:var(--text)}
    .seg a.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
    .icon-btn{border:1px solid var(--hair);background:var(--subtle);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;padding:4px 7px}
    h1{font-size:15px;font-weight:600;margin:0;letter-spacing:-.02em;color:var(--text)}
    .sub{font-size:11.5px;color:var(--muted);margin-top:2px}
    p{color:var(--soft);font-size:13px;line-height:1.52;margin:0 0 12px}
    p strong{color:var(--text)}
    .box{background:var(--subtle);border:1px solid var(--hair);border-radius:6px;padding:12px 14px;margin:12px 0 14px;font-size:12.5px}
    .box-label{font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;display:block}
    code{font-family:'Cascadia Code',ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface);border:1px solid var(--hair);padding:1.5px 5.5px;border-radius:4px;color:var(--text);overflow-wrap:anywhere}
    .perm-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;color:var(--soft)}
    .perm-list li{display:flex;align-items:flex-start;gap:7px;line-height:1.4}
    .perm-list svg{width:14px;height:14px;color:var(--ok);flex-shrink:0;margin-top:2px}
    label{display:block;font-size:12px;font-weight:500;margin:12px 0 5px;color:var(--soft)}
    input[type=password]{width:100%;padding:8.5px 11px;border-radius:6px;border:1px solid var(--border);background:var(--subtle);color:var(--text);font-family:'Cascadia Code',ui-monospace,Consolas,monospace;font-size:14px;letter-spacing:.08em;outline:none}
    input[type=password]:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
    .err{background:var(--err-bg);border:1px solid var(--err-bd);color:var(--err-tx);border-radius:6px;padding:9px 12px;font-size:12.5px;margin:10px 0}
    .actions{display:flex;gap:8px;margin-top:16px}
    .actions button{flex:1;padding:8.5px 14px;border-radius:6px;border:1px solid transparent;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit}
    .allow{background:var(--cta-bg);color:var(--cta-tx)}
    .allow:hover{background:var(--cta-hv)}
    .deny{background:var(--surface);color:var(--soft);border-color:var(--border) !important}
    .deny:hover{color:var(--text);background:var(--subtle)}
  </style>
</head>
<body>
  <div class="card">
    <div class="top-bar">
      <div class="head">
        <svg class="logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#18181b" stroke="#3f3f46" stroke-width="1.3"/>
          <path d="M9.5 13V9.8C9.5 9.1 10.1 8.5 10.8 8.5H21.2C21.9 8.5 22.5 9.1 22.5 9.8V13" stroke="#f4f4f5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9.5 19V22.2C9.5 22.9 10.1 23.5 10.8 23.5H21.2C21.9 23.5 22.5 22.9 22.5 22.2V19" stroke="#a1a1aa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="11.8" y1="16" x2="20.2" y2="16" stroke="#f4f4f5" stroke-width="1.8" stroke-linecap="round"/>
          <rect x="7.5" y="14" width="4" height="4" rx="1.2" fill="#f4f4f5"/>
          <rect x="20.5" y="14" width="4" height="4" rx="1.2" fill="#f4f4f5"/>
        </svg>
        <div>
          <h1>${escapeHtml(msg.heading)}</h1>
          <div class="sub">${escapeHtml(msg.subtitle)}</div>
        </div>
      </div>
      <div class="controls">
        <button type="button" id="consent-theme-btn" class="icon-btn" title="${escapeHtml(msg.themeToggleTitle)}" aria-label="${escapeHtml(msg.themeToggleTitle)}">
          <span id="consent-theme-label">Auto</span>
        </button>
        ${showLangSwitcher ? `
        <div class="seg" role="navigation" aria-label="Language">
          <a href="${escapeHtml(enHref)}" class="${activeLang === 'en' ? 'active' : ''}">EN</a>
          <a href="${escapeHtml(esHref)}" class="${activeLang === 'es' ? 'active' : ''}">ES</a>
        </div>` : ''}
      </div>
    </div>
    <p><strong>${escapeHtml(providerLabel)}</strong> (${escapeHtml(client?.client_name || client?.client_id || '')}) ${escapeHtml(msg.requestIntroPrefix)} <code>${escapeHtml(redirectHost)}</code>${escapeHtml(msg.requestIntroSuffix)}</p>
    <div class="box">
      <div><span class="box-label">${escapeHtml(msg.activeWorkspace)}</span><code>${escapeHtml(activeWorkspace)}</code></div>
      <div style="margin-top:11px"><span class="box-label">${escapeHtml(msg.enabledCapabilities)}</span>
        <ul class="perm-list">${perms.map((item) => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>${escapeHtml(item)}</span></li>`).join('')}</ul>
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
  <script>
    (function () {
      var btn = document.getElementById('consent-theme-btn');
      var lbl = document.getElementById('consent-theme-label');
      var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      var labels = {
        light: '${escapeHtml(msg.themeLight)}',
        dark: '${escapeHtml(msg.themeDark)}',
        system: '${escapeHtml(msg.themeSystem)}'
      };
      function getCurrent() {
        var meta = document.querySelector('meta[name="color-scheme"]');
        var c = meta ? meta.getAttribute('content') : 'light dark';
        return (c === 'light' || c === 'dark') ? c : 'system';
      }
      function syncLabel(pref) {
        if (lbl) lbl.textContent = labels[pref] || labels.system;
      }
      syncLabel(getCurrent());
      if (btn) {
        btn.addEventListener('click', function () {
          var cur = getCurrent();
          var sysDark = Boolean(mql && mql.matches);
          var resolvedDark = cur === 'dark' || (cur === 'system' && sysDark);
          var target = resolvedDark ? 'light' : 'dark';
          var csMeta = document.querySelector('meta[name="color-scheme"]');
          if ((target === 'dark') === sysDark) {
            try { localStorage.removeItem('color-scheme'); } catch (e) {}
            if (csMeta) csMeta.setAttribute('content', 'light dark');
            delete document.documentElement.dataset.theme;
            syncLabel('system');
          } else {
            try { localStorage.setItem('color-scheme', target); } catch (e) {}
            if (csMeta) csMeta.setAttribute('content', target);
            document.documentElement.dataset.theme = target;
            syncLabel(target);
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}
