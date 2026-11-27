import { getServerMessages, normalizeLanguage, normalizeTheme } from '../i18n.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ICON_SUN = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 3a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 10 3m0 11.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5M3 10a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 3 10m11.5 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5m-9.15-4.65a.5.5 0 0 1 .7 0l.71.7a.5.5 0 1 1-.7.71l-.71-.7a.5.5 0 0 1 0-.71m8.59 8.59a.5.5 0 0 1 .71 0l.7.7a.5.5 0 0 1-.7.71l-.71-.7a.5.5 0 0 1 0-.71m.71-8.59a.5.5 0 0 1 0 .71l-.71.7a.5.5 0 1 1-.7-.7l.7-.71a.5.5 0 0 1 .71 0m-8.6 8.59a.5.5 0 0 1 0 .7l-.7.71a.5.5 0 0 1-.71-.7l.7-.71a.5.5 0 0 1 .71 0M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7m-2.5 3.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0"/></svg>';
const ICON_MOON = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M16.38 13.06a.5.5 0 0 0-.59-.18 6 6 0 0 1-7.67-7.67.5.5 0 0 0-.64-.64 7.5 7.5 0 1 0 9.08 9.08.5.5 0 0 0-.18-.59M10 16.5a6.5 6.5 0 0 1-3.17-12.17A7 7 0 0 0 15.67 13.17 6.5 6.5 0 0 1 10 16.5"/></svg>';
const ICON_MONITOR = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M4.5 4A2.5 2.5 0 0 0 2 6.5v6A2.5 2.5 0 0 0 4.5 15h5v1.5h-2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-2V15h5a2.5 2.5 0 0 0 2.5-2.5v-6A2.5 2.5 0 0 0 15.5 4zM3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 12.5z"/></svg>';

export function renderLoginHtml({ lang = 'en', theme = 'system', errorMessage = '' } = {}) {
  const activeLang = normalizeLanguage(lang);
  const activeTheme = normalizeTheme(theme);
  const msg = getServerMessages(activeLang).login;
  const enActive = activeLang === 'en';
  const esActive = activeLang === 'es';
  const metaContent = activeTheme === 'light' || activeTheme === 'dark' ? activeTheme : 'light dark';

  return `<!doctype html>
<html lang="${msg.htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="${metaContent}" />
  <script>
    (function () {
      var stored = null;
      try { stored = localStorage.getItem('color-scheme'); } catch (e) {}
      var content = (stored === 'light' || stored === 'dark') ? stored : '${metaContent}';
      var csMeta = document.querySelector('meta[name="color-scheme"]');
      if (csMeta) csMeta.setAttribute('content', content);
      if (content === 'light' || content === 'dark') {
        document.documentElement.dataset.theme = content;
      }
      var isDark = content === 'dark' || (content === 'light dark' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var tc = document.createElement('meta');
      tc.name = 'theme-color';
      tc.id = 'meta-theme-color';
      tc.content = isDark ? '#202020' : '#f3f3f3';
      document.head.appendChild(tc);
    })();
  </script>
  <title>${escapeHtml(msg.title)}</title>
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon.svg?v=4" />
  <link rel="icon" type="image/png" sizes="32x32" href="/admin/assets/icon-32.png?v=4" />
  <link rel="manifest" href="/admin/assets/manifest.webmanifest?v=4" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: light-dark(#f3f3f3, #202020);
      --card: light-dark(#fbfbfb, #2b2b2b);
      --control: light-dark(rgba(255,255,255,0.7), rgba(255,255,255,0.061));
      --control-hover: light-dark(#f9f9f9, rgba(255,255,255,0.084));
      --stroke-card: light-dark(rgba(0,0,0,0.0578), rgba(0,0,0,0.2));
      --stroke-control: light-dark(rgba(0,0,0,0.0578), rgba(255,255,255,0.093));
      --fg: light-dark(#1b1b1b, #ffffff);
      --fg-2: light-dark(#616161, rgba(255,255,255,0.786));
      --fg-3: light-dark(#8a8a8a, rgba(255,255,255,0.544));
      --accent: light-dark(#005fb8, #60cdff);
      --accent-hover: light-dark(#196ebf, #52bfe8);
      --on-accent: light-dark(#ffffff, #000000);
      --err-bg: light-dark(#fde7e9, #442726);
      --err-fg: light-dark(#c42b1c, #ff99a4);
    }
    :root[data-theme="light"] { color-scheme: light; }
    :root[data-theme="dark"] { color-scheme: dark; }
    :root[data-native-host="webview2"]:not([data-backdrop="none"]) {
      --bg: transparent;
      --card: light-dark(rgba(255,255,255,0.78), rgba(255,255,255,0.065));
      --stroke-card: light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.1));
    }
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      color: var(--fg);
      font-family: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      line-height: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .native-bar {
      display: none;
      height: 40px;
      flex-shrink: 0;
      align-items: center;
      justify-content: space-between;
      padding-left: 14px;
      app-region: drag;
      -webkit-app-region: drag;
      user-select: none;
    }
    :root[data-native-host="webview2"] .native-bar { display: flex; }
    .native-bar-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--fg-2);
    }
    .native-bar-actions {
      display: flex;
      height: 100%;
      app-region: no-drag;
      -webkit-app-region: no-drag;
    }
    .native-cap-btn {
      width: 46px;
      height: 100%;
      border: 0;
      background: transparent;
      color: var(--fg-2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }
    .native-cap-btn:hover { background: rgba(128,128,128,0.14); color: var(--fg); }
    .native-cap-btn.close:hover { background: #c42b1c; color: #fff; }
    .stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    :where(a, button, input):focus-visible {
      outline: 2px solid var(--fg);
      outline-offset: 1px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card);
      border: 1px solid var(--stroke-card);
      box-shadow: inset 0 1px 0 light-dark(rgba(255,255,255,0.85), rgba(255,255,255,0.1)), 0 8px 28px rgba(0,0,0,0.18);
      border-radius: 10px;
      padding: 24px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .brand img {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }
    .brand-title {
      font-family: "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      font-size: 18px;
      line-height: 24px;
      font-weight: 600;
      color: var(--fg);
    }
    .controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .icon-btn {
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: 1px solid var(--stroke-control);
      background: var(--control);
      color: var(--fg-2);
      cursor: pointer;
    }
    .icon-btn:hover { background: var(--control-hover); color: var(--fg); }
    .lang-group {
      display: inline-flex;
      border-radius: 4px;
      border: 1px solid var(--stroke-control);
      background: var(--control);
      overflow: hidden;
    }
    .lang-group a {
      padding: 5px 9px;
      font-size: 12px;
      line-height: 20px;
      text-decoration: none;
      color: var(--fg-2);
    }
    .lang-group a:hover { color: var(--fg); background: var(--control-hover); }
    .lang-group a.active { color: var(--fg); font-weight: 600; background: var(--bg); }
    .desc {
      margin: 0 0 16px;
      color: var(--fg-2);
      font-size: 14px;
      line-height: 20px;
    }
    .err {
      margin: 0 0 14px;
      padding: 10px 12px;
      border-radius: 4px;
      border: 1px solid var(--stroke-card);
      background: var(--err-bg);
      color: var(--err-fg);
      font-size: 13px;
      line-height: 18px;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--fg-2);
    }
    code {
      font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      color: var(--fg);
    }
    input[type="password"] {
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
      margin-bottom: 16px;
    }
    input[type="password"]:focus {
      outline: none;
      background: var(--card);
      border-bottom: 2px solid var(--accent);
    }
    .submit-btn {
      width: 100%;
      height: 32px;
      border-radius: 4px;
      border: 0;
      background: var(--accent);
      color: var(--on-accent);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .submit-btn:hover { background: var(--accent-hover); }
  </style>
</head>
<body>
  <header class="native-bar">
    <span class="native-bar-title">
      <img src="/admin/assets/favicon.svg?v=4" alt="" width="16" height="16" />
      <span>PC-Operator-MCP</span>
    </span>
    <div class="native-bar-actions">
      <button type="button" id="native-min-btn" class="native-cap-btn" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0" y="4.5" width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button type="button" id="native-close-btn" class="native-cap-btn close" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>
      </button>
    </div>
  </header>
  <div class="stage">
  <main class="card">
    <div class="top">
      <div class="brand">
        <img src="/admin/assets/favicon.svg?v=4" alt="" width="24" height="24" />
        <span class="brand-title">PC-Operator-MCP</span>
      </div>
      <div class="controls">
        <button type="button" id="login-theme-btn" class="icon-btn" title="${escapeHtml(msg.themeToggleTitle)}" aria-label="${escapeHtml(msg.themeToggleTitle)}">
          <span id="login-theme-icon">${ICON_MONITOR}</span>
        </button>
        <nav class="lang-group" aria-label="Language">
          <a href="/admin?lang=en" class="${enActive ? 'active' : ''}">EN</a>
          <a href="/admin?lang=es" class="${esActive ? 'active' : ''}">ES</a>
        </nav>
      </div>
    </div>
    <p class="desc">${escapeHtml(msg.description)}</p>
    ${errorMessage ? `<div class="err" role="alert">${escapeHtml(errorMessage)}</div>` : ''}
    <form method="POST" action="/admin/login">
      <input type="hidden" name="lang" value="${escapeHtml(activeLang)}" />
      <label for="pin-input">${msg.pinLabelHtml}</label>
      <input id="pin-input" type="password" name="pin" placeholder="${escapeHtml(msg.pinPlaceholder)}" autofocus required />
      <button class="submit-btn" type="submit">${escapeHtml(msg.submit)}</button>
    </form>
  </main>
  </div>
  <script>
    (function () {
      var btn = document.getElementById('login-theme-btn');
      var iconWrap = document.getElementById('login-theme-icon');
      var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      var postHost = function (payload) {
        try {
          if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
            window.chrome.webview.postMessage(payload);
          }
        } catch (e) {}
      };
      var minBtn = document.getElementById('native-min-btn');
      var closeBtn = document.getElementById('native-close-btn');
      if (minBtn) minBtn.addEventListener('click', function () { postHost({ type: 'window:minimize' }); });
      if (closeBtn) closeBtn.addEventListener('click', function () { postHost({ type: 'window:close' }); });
      var icons = {
        light: ${JSON.stringify(ICON_SUN)},
        dark: ${JSON.stringify(ICON_MOON)},
        system: ${JSON.stringify(ICON_MONITOR)}
      };
      function getCurrent() {
        var meta = document.querySelector('meta[name="color-scheme"]');
        var c = meta ? meta.getAttribute('content') : 'light dark';
        return (c === 'light' || c === 'dark') ? c : 'system';
      }
      function syncIcon(pref) {
        if (iconWrap) iconWrap.innerHTML = icons[pref] || icons.system;
        var resolvedDark = pref === 'dark' || (pref === 'system' && Boolean(mql && mql.matches));
        postHost({ type: 'theme:sync', theme: pref, isDark: resolvedDark });
      }
      syncIcon(getCurrent());
      if (mql) {
        mql.addEventListener('change', function () {
          if (getCurrent() === 'system') syncIcon('system');
        });
      }
      if (btn) {
        btn.addEventListener('click', function () {
          var resolvedDark = getCurrent() === 'dark' || (getCurrent() === 'system' && mql && mql.matches);
          var target = resolvedDark ? 'light' : 'dark';
          var sysDark = Boolean(mql && mql.matches);
          var csMeta = document.querySelector('meta[name="color-scheme"]');
          var tcMeta = document.getElementById('meta-theme-color');
          if ((target === 'dark') === sysDark) {
            try { localStorage.removeItem('color-scheme'); } catch (e) {}
            if (csMeta) csMeta.setAttribute('content', 'light dark');
            delete document.documentElement.dataset.theme;
            syncIcon('system');
          } else {
            try { localStorage.setItem('color-scheme', target); } catch (e) {}
            if (csMeta) csMeta.setAttribute('content', target);
            document.documentElement.dataset.theme = target;
            syncIcon(target);
          }
          if (tcMeta) tcMeta.setAttribute('content', target === 'dark' ? '#202020' : '#f3f3f3');
        });
      }
    })();
  </script>
</body>
</html>`;
}
