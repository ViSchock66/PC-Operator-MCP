import { signal } from '@preact/signals';
import { getState } from '../api/endpoints';
import type { AdminState, LogEntry } from '../api/types';
import { normalizeLang, setLanguage } from '../i18n';
import { applyThemeVisual, normalizeThemePref } from './prefs';

export type SseStatus = 'connecting' | 'live' | 'offline';

export const stateSignal = signal<AdminState | null>(null);
export const logsSignal = signal<LogEntry[]>([]);
export const sseSignal = signal<SseStatus>('connecting');
export const tickSignal = signal<number>(Date.now());
export const uptimeSyncSignal = signal<{ baseSec: number; syncedAt: number }>({
  baseSec: 0,
  syncedAt: Date.now(),
});

let uiHydrated = false;
let esInstance: EventSource | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

export function applyStateUpdate(next: AdminState, { syncUi = true }: { syncUi?: boolean } = {}): void {
  stateSignal.value = next;
  uptimeSyncSignal.value = {
    baseSec: next.tunnel?.uptimeSec ?? 0,
    syncedAt: Date.now(),
  };

  if (syncUi && !uiHydrated) {
    uiHydrated = true;
    if (next.ui?.language) {
      setLanguage(normalizeLang(next.ui.language));
    }
    if (next.ui?.theme) {
      applyThemeVisual(normalizeThemePref(next.ui.theme));
    }
  }
}

export function appendLogEntry(entry: LogEntry): void {
  const prev = logsSignal.value;
  const next = prev.length >= 300 ? [...prev.slice(prev.length - 299), entry] : [...prev, entry];
  logsSignal.value = next;
}

export function connectSse(): void {
  if (esInstance) {
    esInstance.close();
  }
  sseSignal.value = 'connecting';
  const es = new EventSource('/admin/api/events');
  esInstance = es;

  es.onopen = () => {
    sseSignal.value = 'live';
  };

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as {
        type?: string;
        state?: AdminState;
        full?: AdminState;
        entry?: LogEntry;
      };
      if (msg.type === 'init' && msg.state) {
        logsSignal.value = [...(msg.state.tunnel?.logs || [])];
        applyStateUpdate(msg.state);
      } else if (msg.type === 'state' && msg.full) {
        applyStateUpdate(msg.full);
      } else if (msg.type === 'log' && msg.entry) {
        appendLogEntry(msg.entry);
      } else if (msg.type === 'logs_cleared') {
        logsSignal.value = [];
      }
    } catch {
      // Ignore malformed SSE payload.
    }
  };

  es.onerror = () => {
    sseSignal.value = 'offline';
  };
}

export async function bootstrapStore(): Promise<void> {
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      tickSignal.value = Date.now();
    }, 1000);
  }

  try {
    const initial = await getState();
    logsSignal.value = [...(initial.tunnel?.logs || [])];
    applyStateUpdate(initial);
  } catch {
    // Error handled or retried via SSE.
  }

  connectSse();
}
