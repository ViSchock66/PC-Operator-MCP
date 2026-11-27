import { signal } from '@preact/signals';
import type { ThemePreference } from '../api/types';

export type WindowBackdrop = 'mica' | 'mica-alt' | 'acrylic' | 'none';

interface NativeHostBootstrap {
  host?: string;
  version?: string;
  backdrop?: string;
  maximized?: boolean;
  focused?: boolean;
}

interface HostStateMessage {
  type?: string;
  host?: string;
  version?: string;
  backdrop?: string;
  maximized?: boolean;
  focused?: boolean;
}

interface WebView2Bridge {
  postMessage: (message: unknown) => void;
  addEventListener?: (type: 'message', listener: (ev: { data?: unknown }) => void) => void;
}

declare global {
  interface Window {
    __PCOP_NATIVE_HOST__?: NativeHostBootstrap;
    chrome?: {
      webview?: WebView2Bridge;
    };
  }
}

export const nativeHostSignal = signal<boolean>(false);
export const windowMaximizedSignal = signal<boolean>(false);
export const windowFocusedSignal = signal<boolean>(true);
export const windowBackdropSignal = signal<WindowBackdrop>('mica');
export const hostVersionSignal = signal<string>('');

let bridgeInitialized = false;

export function normalizeBackdrop(raw?: string | null): WindowBackdrop {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'mica-alt' || v === 'acrylic' || v === 'none') return v;
  return 'mica';
}

export function isNativeHost(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return (
    document.documentElement.dataset.nativeHost === 'webview2' ||
    window.__PCOP_NATIVE_HOST__?.host === 'webview2' ||
    Boolean(window.chrome?.webview?.postMessage)
  );
}

function postToHost(payload: Record<string, unknown>): boolean {
  if (typeof window === 'undefined') return false;
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return false;
  try {
    webview.postMessage(payload);
    return true;
  } catch {
    return false;
  }
}

function applyBackdropDataset(backdrop: WindowBackdrop): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.backdrop = backdrop;
}

function handleHostState(msg: HostStateMessage): void {
  if (msg.host === 'webview2') {
    nativeHostSignal.value = true;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.nativeHost = 'webview2';
    }
  }
  if (typeof msg.maximized === 'boolean') {
    windowMaximizedSignal.value = msg.maximized;
  }
  if (typeof msg.focused === 'boolean') {
    windowFocusedSignal.value = msg.focused;
  }
  if (typeof msg.backdrop === 'string') {
    const normalized = normalizeBackdrop(msg.backdrop);
    windowBackdropSignal.value = normalized;
    applyBackdropDataset(normalized);
  }
  if (typeof msg.version === 'string' && msg.version) {
    hostVersionSignal.value = msg.version;
  }
}

export function initNativeHostBridge(): void {
  if (bridgeInitialized || typeof window === 'undefined') return;
  bridgeInitialized = true;

  const native = isNativeHost();
  nativeHostSignal.value = native;
  if (!native) return;

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.nativeHost = 'webview2';
  }

  const boot = window.__PCOP_NATIVE_HOST__;
  if (boot) {
    handleHostState({
      host: boot.host || 'webview2',
      version: boot.version,
      backdrop: boot.backdrop,
      maximized: boot.maximized,
      focused: boot.focused,
    });
  }

  window.chrome?.webview?.addEventListener?.('message', (ev) => {
    const raw = ev?.data;
    const msg =
      typeof raw === 'string'
        ? (() => {
            try {
              return JSON.parse(raw) as HostStateMessage;
            } catch {
              return null;
            }
          })()
        : (raw as HostStateMessage | null);
    if (msg && msg.type === 'host:state') {
      handleHostState(msg);
    }
  });

  postToHost({ type: 'host:ready' });
}

export function minimizeWindow(): void {
  postToHost({ type: 'window:minimize' });
}

export function toggleMaximizeWindow(): void {
  postToHost({ type: 'window:toggleMaximize' });
}

export function closeWindow(): void {
  postToHost({ type: 'window:close' });
}

export function syncHostTheme(theme: ThemePreference, isDark: boolean): void {
  if (!isNativeHost()) return;
  postToHost({ type: 'theme:sync', theme, isDark });
}

export function setHostBackdrop(backdrop: WindowBackdrop): void {
  const normalized = normalizeBackdrop(backdrop);
  windowBackdropSignal.value = normalized;
  applyBackdropDataset(normalized);
  postToHost({ type: 'backdrop:set', backdrop: normalized });
}
