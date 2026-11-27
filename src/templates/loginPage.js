import { getServerMessages, normalizeLanguage, normalizeTheme } from '../i18n.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
      tc.content = isDark ? '#151517' : '#efefec';
      document.head.appendChild(tc);
    })();
  </script>
  <title>${escapeHtml(msg.title)}</title>
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/admin/assets/icon-32.png" />
  <link rel="manifest" href="/admin/assets/manifest.webmanifest" />
  <link rel="preload" href="/admin/assets/fonts/geist-sans.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/admin/assets/fonts/geist-mono.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="/admin/assets/styles.css" />
</head>
<body class="login-body">
  <div class="login-card">
    <div class="login-top-row">
      <div class="brand" style="padding:0">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#18181b" stroke="#3f3f46" stroke-width="1.3"/>
            <path d="M9.5 13V9.8C9.5 9.1 10.1 8.5 10.8 8.5H21.2C21.9 8.5 22.5 9.1 22.5 9.8V13" stroke="#f4f4f5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9.5 19V22.2C9.5 22.9 10.1 23.5 10.8 23.5H21.2C21.9 23.5 22.5 22.9 22.5 22.2V19" stroke="#a1a1aa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="11.8" y1="16" x2="20.2" y2="16" stroke="#f4f4f5" stroke-width="1.8" stroke-linecap="round"/>
            <rect x="7.5" y="14" width="4" height="4" rx="1.2" fill="#f4f4f5"/>
            <rect x="20.5" y="14" width="4" height="4" rx="1.2" fill="#f4f4f5"/>
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
      <div class="login-controls">
        <button type="button" id="login-theme-btn" class="seg-btn" title="${escapeHtml(msg.themeToggleTitle)}" aria-label="${escapeHtml(msg.themeToggleTitle)}" style="border:1px solid var(--border-hairline);background:var(--bg-subtle);padding:3px 7px">
          <svg class="icon-xs" aria-hidden="true"><use id="login-theme-icon" href="/admin/assets/icons.svg#i-monitor"></use></svg>
        </button>
        <div class="segmented-mini" role="navigation" aria-label="Language">
          <a href="/admin?lang=en" class="seg-btn ${enActive ? 'active' : ''}">EN</a>
          <a href="/admin?lang=es" class="seg-btn ${esActive ? 'active' : ''}">ES</a>
        </div>
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
  <script>
    (function () {
      var btn = document.getElementById('login-theme-btn');
      var useEl = document.getElementById('login-theme-icon');
      var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      function getCurrent() {
        var meta = document.querySelector('meta[name="color-scheme"]');
        var c = meta ? meta.getAttribute('content') : 'light dark';
        return (c === 'light' || c === 'dark') ? c : 'system';
      }
      function syncIcon(pref) {
        if (!useEl) return;
        var icon = pref === 'light' ? 'sun' : (pref === 'dark' ? 'moon' : 'monitor');
        useEl.setAttribute('href', '/admin/assets/icons.svg#i-' + icon);
      }
      syncIcon(getCurrent());
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
          if (tcMeta) tcMeta.setAttribute('content', target === 'dark' ? '#151517' : '#efefec');
        });
      }
    })();
  </script>
</body>
</html>`;
}
