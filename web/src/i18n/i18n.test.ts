import { describe, expect, it } from 'vitest';
import en from './en';
import es from './es';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenKeys(v as Record<string, unknown>, full));
    } else {
      out[full] = String(v ?? '');
    }
  }
  return out;
}

describe('i18n dictionaries', () => {
  it('es and en share identical keys and have no empty strings', () => {
    const esFlat = flattenKeys(es);
    const enFlat = flattenKeys(en);
    const esKeys = Object.keys(esFlat).sort();
    const enKeys = Object.keys(enFlat).sort();

    expect(esKeys).toEqual(enKeys);

    for (const k of esKeys) {
      expect(esFlat[k].trim().length, `empty es key: ${k}`).toBeGreaterThan(0);
      expect(enFlat[k].trim().length, `empty en key: ${k}`).toBeGreaterThan(0);
    }
  });
});
