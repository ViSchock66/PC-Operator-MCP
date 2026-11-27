import { signal } from '@preact/signals';
import type { ThemePreference } from '../api/types';

export const themeSignal = signal<ThemePreference>('system');

const themeMql =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function normalizeThemePref(raw?: string | null): ThemePreference {
  const v = String(raw || '').trim().toLowerCase();
  return v === 'light' || v === 'dark' ? v : 'system';
}

function updateThemeColorMeta(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const isDark = pref === 'dark' || (pref === 'system' && Boolean(themeMql?.matches));
  const metaTc = document.getElementById('meta-theme-color');
  if (metaTc) metaTc.setAttribute('content', isDark ? '#202020' : '#f3f3f3');
}

export function applyThemeVisual(
  pref: ThemePreference,
  { updateStorage = true }: { updateStorage?: boolean } = {},
): void {
  const normalized = normalizeThemePref(pref);
  themeSignal.value = normalized;

  if (typeof document !== 'undefined') {
    const csMeta = document.querySelector('meta[name="color-scheme"]');
    if (csMeta) {
      csMeta.setAttribute('content', normalized === 'system' ? 'light dark' : normalized);
    }
    if (normalized === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = normalized;
    }
  }

  if (updateStorage && typeof localStorage !== 'undefined') {
    try {
      if (normalized === 'system') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', normalized);
    } catch {
      // Ignore storage failures.
    }
  }

  updateThemeColorMeta(normalized);
}

export function initThemeSync(): void {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('color-scheme') : null;
    applyThemeVisual(normalizeThemePref(stored), { updateStorage: false });
  } catch {
    applyThemeVisual('system', { updateStorage: false });
  }

  if (themeMql) {
    const onChange = () => {
      if (themeSignal.value === 'system') updateThemeColorMeta('system');
    };
    themeMql.addEventListener('change', onChange);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'color-scheme') {
        applyThemeVisual(normalizeThemePref(e.newValue), { updateStorage: false });
      }
    });
  }
}
