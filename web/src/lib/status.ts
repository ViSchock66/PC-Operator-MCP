import type { LogEntry, TunnelMode, TunnelState } from '../api/types';

export type Severity = 'success' | 'caution' | 'critical' | 'neutral';

export interface DerivedTunnelStatus {
  severity: Severity;
  titleKey:
    | 'home.statusRunning'
    | 'home.statusStarting'
    | 'home.statusNeedsAction'
    | 'home.statusError'
    | 'home.statusStopped';
  needsAttention: boolean;
  attentionSeverity: 'caution' | 'critical' | null;
  isActive: boolean;
  isBusy: boolean;
}

export function deriveTunnelStatus(tunnel?: Partial<TunnelState> | null): DerivedTunnelStatus {
  const status = tunnel?.status ?? 'stopped';
  switch (status) {
    case 'running':
      return {
        severity: 'success',
        titleKey: 'home.statusRunning',
        needsAttention: false,
        attentionSeverity: null,
        isActive: true,
        isBusy: false,
      };
    case 'starting':
      return {
        severity: 'caution',
        titleKey: 'home.statusStarting',
        needsAttention: false,
        attentionSeverity: null,
        isActive: true,
        isBusy: true,
      };
    case 'needs_action':
      return {
        severity: 'caution',
        titleKey: 'home.statusNeedsAction',
        needsAttention: true,
        attentionSeverity: 'caution',
        isActive: false,
        isBusy: false,
      };
    case 'error':
      return {
        severity: 'critical',
        titleKey: 'home.statusError',
        needsAttention: true,
        attentionSeverity: 'critical',
        isActive: false,
        isBusy: false,
      };
    case 'stopped':
    default:
      return {
        severity: 'neutral',
        titleKey: 'home.statusStopped',
        needsAttention: false,
        attentionSeverity: null,
        isActive: false,
        isBusy: false,
      };
  }
}

export function modeLabelKey(mode?: TunnelMode | string):
  | 'modes.tailscale'
  | 'modes.cloudflareNamed'
  | 'modes.cloudflareQuick'
  | 'modes.local' {
  switch (mode) {
    case 'cloudflare-named':
      return 'modes.cloudflareNamed';
    case 'cloudflare-quick':
      return 'modes.cloudflareQuick';
    case 'local':
      return 'modes.local';
    case 'tailscale':
    default:
      return 'modes.tailscale';
  }
}

export type LogFilter = 'all' | 'mcp' | 'tunnel' | 'operator' | 'warn';

export function matchesLogFilter(entry: LogEntry, filter: LogFilter, search: string): boolean {
  const lvl = entry.level || 'info';
  const src = String(entry.source || 'app').toLowerCase();
  if (filter === 'warn' && lvl !== 'warn' && lvl !== 'error') return false;
  if (filter === 'mcp' && src !== 'mcp') return false;
  if (filter === 'tunnel' && src !== 'tunnel' && src !== 'tailscale' && src !== 'cloudflared') {
    return false;
  }
  if (filter === 'operator' && src !== 'operator') return false;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const hay = `${src} ${entry.message || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
