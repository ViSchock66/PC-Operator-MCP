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
    :root {
      color-scheme: light dark;
      --bg: light-dark(#f3f3f3, #202020);
      --card: light-dark(#fbfbfb, #2b2b2b);
      --control: light-dark(rgba(255,255,255,0.7), rgba(255,255,255,0.061));
      --control-hover: light-dark(#f9f9f9, rgba(255,255,255,0.084));
      --stroke-card: light-dark(rgba(0,0,0,0.0578), rgba(0,0,0,0.2));
      --stroke-control: light-dark(rgba(0,0,0,0.0578), rgba(255,255,255,0.093));
      --stroke-bottom: light-dark(rgba(0,0,0,0.1622), rgba(255,255,255,0.093));
      --fg: light-dark(#1b1b1b, #ffffff);
      --fg-2: light-dark(#616161, rgba(255,255,255,0.786));
      --fg-3: light-dark(#8a8a8a, rgba(255,255,255,0.544));
      --accent: light-dark(#005fb8, #60cdff);
      --accent-hover: light-dark(#196ebf, #52bfe8);
      --on-accent: light-dark(#ffffff, #000000);
      --ok: light-dark(#0f7b0f, #6ccb5f);
      --err-bg: light-dark(#fde7e9, #442726);
      --err-fg: light-dark(#c42b1c, #ff99a4);
    }
    :root[data-theme="light"] { color-scheme: light; }
    :root[data-theme="dark"] { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: var(--bg);
      color: var(--fg);
      font-family: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      line-height: 20px;
      -webkit-font-smoothing: antialiased;
    }
    :where(a, button, input):focus-visible {
      outline: 2px solid var(--fg);
      outline-offset: 1px;
    }
    .card {
      width: 100%;
      max-width: 480px;
      background: var(--card);
      border: 1px solid var(--stroke-card);
      border-radius: 8px;
      padding: 24px;
    }
    .top-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--stroke-card);
      margin-bottom: 14px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .logo {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }
    .controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .icon-btn, .seg a {
      height: 28px;
      padding: 0 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: 1px solid var(--stroke-control);
      background: var(--control);
      color: var(--fg-2);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
    }
    .icon-btn:hover, .seg a:hover { color: var(--fg); background: var(--control-hover); }
    .seg {
      display: inline-flex;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--stroke-control);
    }
    .seg a { border: 0; border-radius: 0; }
    .seg a.active { color: var(--fg); font-weight: 600; background: var(--bg); }
    h1 {
      margin: 0;
      font-family: "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      font-size: 18px;
      line-height: 24px;
      font-weight: 600;
      color: var(--fg);
    }
    .sub { font-size: 12px; color: var(--fg-3); margin-top: 2px; }
    p { color: var(--fg-2); font-size: 14px; line-height: 20px; margin: 0 0 12px; }
    p strong { color: var(--fg); }
    .box {
      background: var(--bg);
      border: 1px solid var(--stroke-card);
      border-radius: 4px;
      padding: 12px 14px;
      margin: 12px 0 14px;
      font-size: 13px;
    }
    .box-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg-3);
      margin-bottom: 4px;
      display: block;
    }
    code {
      font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      color: var(--fg);
      overflow-wrap: anywhere;
    }
    .perm-list {
      list-style: none;
      margin: 6px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--fg-2);
    }
    .perm-list li { display: flex; align-items: flex-start; gap: 8px; line-height: 18px; }
    .perm-list svg { width: 14px; height: 14px; color: var(--ok); flex-shrink: 0; margin-top: 2px; }
    label { display: block; font-size: 13px; margin: 12px 0 6px; color: var(--fg-2); }
    input[type=password] {
      width: 100%;
      height: 32px;
      padding: 0 10px;
      border-radius: 4px;
      border: 1px solid var(--stroke-control);
      border-bottom: 1px solid var(--fg-3);
      background: var(--control);
      color: var(--fg);
      font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace;
      font-size: 14px;
    }
    input[type=password]:focus {
      outline: none;
      background: var(--card);
      border-bottom: 2px solid var(--accent);
    }
    .err {
      background: var(--err-bg);
      border: 1px solid var(--stroke-card);
      color: var(--err-fg);
      border-radius: 4px;
      padding: 9px 12px;
      font-size: 13px;
      margin: 10px 0;
    }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .actions button {
      min-width: 112px;
      height: 32px;
      padding: 0 14px;
      border-radius: 4px;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
    }
    .allow {
      border: 0;
      background: var(--accent);
      color: var(--on-accent);
      font-weight: 600;
    }
    .allow:hover { background: var(--accent-hover); }
    .deny {
      background: var(--control);
      color: var(--fg);
      border: 1px solid var(--stroke-control);
      border-bottom-color: var(--stroke-bottom);
    }
    .deny:hover { background: var(--control-hover); }
  </style>
</head>
<body>
  <main class="card">
    <div class="top-bar">
      <div class="head">
        <img class="logo" src="/admin/assets/favicon.svg" alt="" width="24" height="24" />
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
        <nav class="seg" aria-label="Language">
          <a href="${escapeHtml(enHref)}" class="${activeLang === 'en' ? 'active' : ''}">EN</a>
          <a href="${escapeHtml(esHref)}" class="${activeLang === 'es' ? 'active' : ''}">ES</a>
        </nav>` : ''}
      </div>
    </div>
    <p><strong>${escapeHtml(providerLabel)}</strong> (${escapeHtml(client?.client_name || client?.client_id || '')}) ${escapeHtml(msg.requestIntroPrefix)} <code>${escapeHtml(redirectHost)}</code>${escapeHtml(msg.requestIntroSuffix)}</p>
    <div class="box">
      <div><span class="box-label">${escapeHtml(msg.activeWorkspace)}</span><code>${escapeHtml(activeWorkspace)}</code></div>
      <div style="margin-top:11px"><span class="box-label">${escapeHtml(msg.enabledCapabilities)}</span>
        <ul class="perm-list">${perms.map((item) => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>${escapeHtml(item)}</span></li>`).join('')}</ul>
      </div>
    </div>
    ${errorMessage ? `<div class="err" role="alert">${escapeHtml(errorMessage)}</div>` : ''}
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
  </main>
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
