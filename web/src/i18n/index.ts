import { signal } from '@preact/signals';
import type { Language } from '../api/types';
import en from './en';
import es, { type TranslationSchema } from './es';

const DICTS: Record<Language, TranslationSchema> = { es, en };

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}.${P}`
    : never
  : never;

type Paths<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown> ? Join<K, Paths<T[K]>> : K;
}[keyof T];

export type TranslationKey = Paths<TranslationSchema>;

export const languageSignal = signal<Language>('es');

export function normalizeLang(raw?: string | null): Language {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'es';
}

export function setLanguage(lang: string): void {
  const normalized = normalizeLang(lang);
  languageSignal.value = normalized;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized;
    document.title = DICTS[normalized].app.title;
  }
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[languageSignal.value] || DICTS.es;
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      cur = undefined;
      break;
    }
  }
  let text = typeof cur === 'string' ? cur : key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (_, k: string) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
    );
  }
  return text;
}
