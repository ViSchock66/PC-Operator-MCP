import type { Language } from '../api/types';

export function formatClock(ts?: number | string): string {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatHms(sec?: number | null): string {
  const total = Math.max(0, Math.floor(sec ?? 0));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function formatDurationHuman(sec?: number | null, lang: Language = 'es'): string {
  const total = Math.max(0, Math.floor(sec ?? 0));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (lang === 'es') {
    if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
    if (mins > 0) return `${mins} min`;
    return `${secs} s`;
  }
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
}

export function formatRelativeTime(iso?: string, lang: Language = 'es'): string {
  if (!iso) return '--';
  const diffMin = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (Number.isNaN(diffMin)) return '--';
  if (lang === 'es') {
    if (diffMin < 1) return 'ahora';
    if (diffMin < 60) return `hace ${diffMin} min`;
    const h = Math.round(diffMin / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  }
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function baseName(filePath?: string | null): string {
  if (!filePath || filePath === '--') return '--';
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}
