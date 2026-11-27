import { t } from './i18n';
import { deriveTunnelStatus } from './lib/status';
import { ActivityPage } from './pages/Activity';
import { ConnectionPage } from './pages/Connection';
import { HandoffPage } from './pages/Handoff';
import { HomePage } from './pages/Home';
import { ProcessesPage } from './pages/Processes';
import { SettingsPage } from './pages/Settings';
import { WorkspacesPage } from './pages/Workspaces';
import { routeSignal } from './state/router';
import { stateSignal } from './state/store';
import { NavView, type NavItemDef } from './ui/NavView';
import { ToastHost } from './ui/Toast';

export function App() {
  const { page } = routeSignal.value;
  const s = stateSignal.value;
  const derived = deriveTunnelStatus(s?.tunnel);

  const navItems: NavItemDef[] = [
    {
      id: 'home',
      label: t('nav.home'),
      icon: 'home',
      attentionSeverity: derived.attentionSeverity,
    },
    { id: 'connection', label: t('nav.connection'), icon: 'globe' },
    { id: 'workspaces', label: t('nav.workspaces'), icon: 'folder' },
    { id: 'processes', label: t('nav.processes'), icon: 'window_console' },
    { id: 'handoff', label: t('nav.handoff'), icon: 'arrow_bidirectional_up_down' },
    { id: 'activity', label: t('nav.activity'), icon: 'pulse' },
  ];

  const footerItem: NavItemDef = {
    id: 'settings',
    label: t('nav.settings'),
    icon: 'settings',
  };

  return (
    <div class="flex h-screen overflow-hidden bg-bg text-fg">
      <NavView activePage={page} items={navItems} footerItem={footerItem} />

      <main class="min-w-0 flex-1 overflow-y-auto px-6 min-[1008px]:px-10 py-8">
        <div class="mx-auto max-w-[1000px]">
          {page === 'home' ? <HomePage /> : null}
          {page === 'connection' ? <ConnectionPage /> : null}
          {page === 'workspaces' ? <WorkspacesPage /> : null}
          {page === 'processes' ? <ProcessesPage /> : null}
          {page === 'handoff' ? <HandoffPage /> : null}
          {page === 'activity' ? <ActivityPage /> : null}
          {page === 'settings' ? <SettingsPage /> : null}
        </div>
      </main>

      <ToastHost />
    </div>
  );
}
