import en from './en.js';
import es from './es.js';

const DICTS = { en, es };
let currentLang = 'en';

export function normalizeLang(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'es' || s.startsWith('es-') ? 'es' : 'en';
}

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  currentLang = normalizeLang(lang);
  return currentLang;
}

function lookup(dict, key) {
  const parts = String(key || '').split('.');
  let cur = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function t(key, vars = null) {
  const raw = lookup(DICTS[currentLang], key) ?? lookup(DICTS.en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

export function applyTranslations(root = document) {
  document.documentElement.lang = currentLang;
  document.title = t('meta.pageTitle');

  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });

  root.querySelectorAll('[data-lang-btn]').forEach((btn) => {
    const active = btn.dataset.langBtn === currentLang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function formatRelativeTime(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return t('common.none');
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return t('time.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t('time.hoursAgo', { n: diffH });
  const diffD = Math.floor(diffH / 24);
  return t('time.daysAgo', { n: diffD });
}

export function formatLogTime(ts) {
  if (!ts) return '--:--:--';
  const locale = currentLang === 'es' ? 'es-ES' : 'en-GB';
  try {
    return new Date(ts).toLocaleTimeString(locale, { hour12: false });
  } catch {
    return '--:--:--';
  }
}
