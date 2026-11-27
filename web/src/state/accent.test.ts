import { describe, expect, it } from 'vitest';
import { computeTintedBgHex, mixSrgbHex } from './accent';
import type { AccentPalette } from '../api/endpoints';

const PURPLE_PALETTE: AccentPalette = {
  light3: '#f0c0f4',
  light2: '#db9ee5',
  light1: '#b763cb',
  base: '#a94dc1',
  dark1: '#8e3aa7',
  dark2: '#692782',
  dark3: '#400e59',
};

describe('accent theme-color tinting', () => {
  it('mixes sRGB hex values matching CSS color-mix(in srgb)', () => {
    expect(mixSrgbHex('#400e59', '#202020', 0.14)).toBe('#241d28');
    expect(mixSrgbHex('#f0c0f4', '#f3f3f3', 0.06)).toBe('#f3f0f3');
  });

  it('computes tinted background hex for dark and light themes', () => {
    expect(computeTintedBgHex(PURPLE_PALETTE, true)).toBe('#241d28');
    expect(computeTintedBgHex(PURPLE_PALETTE, false)).toBe('#f3f0f3');
  });

  it('falls back to neutral Fluent backgrounds without palette or invalid hex', () => {
    expect(computeTintedBgHex(null, true)).toBe('#202020');
    expect(computeTintedBgHex(null, false)).toBe('#f3f3f3');
    expect(mixSrgbHex('not-a-hex', '#202020', 0.14)).toBe('#202020');
  });
});
