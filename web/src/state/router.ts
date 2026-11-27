import { signal } from '@preact/signals';

export type PageId =
  | 'home'
  | 'connection'
  | 'workspaces'
  | 'processes'
  | 'handoff'
  | 'activity'
  | 'settings';

export type ConnectionSubtab = 'tunnel' | 'auth' | 'setup';

export interface RouteState {
  page: PageId;
  subtab: ConnectionSubtab;
}

const VALID_PAGES = new Set<PageId>([
  'home',
  'connection',
  'workspaces',
  'processes',
  'handoff',
  'activity',
  'settings',
]);

const VALID_SUBTABS = new Set<ConnectionSubtab>(['tunnel', 'auth', 'setup']);

export function parseHash(hash: string): RouteState {
  const cleaned = hash.replace(/^#\/?/, '').trim();
  const [seg0, seg1] = cleaned.split('/');
  const page: PageId = VALID_PAGES.has(seg0 as PageId) ? (seg0 as PageId) : 'home';
  const subtab: ConnectionSubtab = VALID_SUBTABS.has(seg1 as ConnectionSubtab)
    ? (seg1 as ConnectionSubtab)
    : 'tunnel';
  return { page, subtab };
}

export function formatHash(page: PageId, subtab?: ConnectionSubtab): string {
  if (page === 'connection' && subtab && subtab !== 'tunnel') {
    return `#/connection/${subtab}`;
  }
  return `#/${page}`;
}

export const routeSignal = signal<RouteState>(
  typeof window !== 'undefined' ? parseHash(window.location.hash) : { page: 'home', subtab: 'tunnel' },
);

export function navigate(page: PageId, subtab?: ConnectionSubtab): void {
  const targetHash = formatHash(page, subtab);
  if (typeof window !== 'undefined' && window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  routeSignal.value = {
    page,
    subtab: subtab ?? (page === 'connection' ? 'tunnel' : routeSignal.value.subtab),
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    routeSignal.value = parseHash(window.location.hash);
  });
}
