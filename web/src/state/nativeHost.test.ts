import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeWindow,
  isNativeHost,
  minimizeWindow,
  normalizeBackdrop,
  setHostBackdrop,
  syncHostTheme,
  toggleMaximizeWindow,
  windowBackdropSignal,
} from './nativeHost';

describe('nativeHost bridge', () => {
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  afterEach(() => {
    vi.restoreAllMocks();
    if (origWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      globalThis.window = origWindow;
    }
    if (origDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      globalThis.document = origDocument;
    }
  });

  it('normalizes valid backdrop modes and defaults unknown values to mica', () => {
    expect(normalizeBackdrop('mica')).toBe('mica');
    expect(normalizeBackdrop('mica-alt')).toBe('mica-alt');
    expect(normalizeBackdrop('ACRYLIC')).toBe('acrylic');
    expect(normalizeBackdrop('none')).toBe('none');
    expect(normalizeBackdrop('unknown')).toBe('mica');
    expect(normalizeBackdrop(undefined)).toBe('mica');
  });

  it('detects web browser fallback vs WebView2 native host and forwards window commands', () => {
    const postMessage = vi.fn();
    const dataset: Record<string, string> = {};

    (globalThis as Record<string, unknown>).document = {
      documentElement: { dataset },
    };
    (globalThis as Record<string, unknown>).window = {};

    expect(isNativeHost()).toBe(false);
    syncHostTheme('dark', true);
    expect(postMessage).not.toHaveBeenCalled();

    dataset.nativeHost = 'webview2';
    (globalThis as Record<string, unknown>).window = {
      chrome: { webview: { postMessage } },
    };

    expect(isNativeHost()).toBe(true);

    minimizeWindow();
    toggleMaximizeWindow();
    closeWindow();
    syncHostTheme('dark', true);
    setHostBackdrop('mica-alt');

    expect(dataset.backdrop).toBe('mica-alt');
    expect(windowBackdropSignal.value).toBe('mica-alt');
    expect(postMessage).toHaveBeenCalledWith({ type: 'window:minimize' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'window:toggleMaximize' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'window:close' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'theme:sync', theme: 'dark', isDark: true });
    expect(postMessage).toHaveBeenCalledWith({ type: 'backdrop:set', backdrop: 'mica-alt' });
  });
});
