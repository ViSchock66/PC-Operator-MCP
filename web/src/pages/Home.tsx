import { useEffect, useRef, useState } from 'preact/hooks';
import { restartTunnel, startTunnel, stopTunnel } from '../api/endpoints';
import { languageSignal, t } from '../i18n';
import { baseName, formatClock, formatDurationHuman, formatHms } from '../lib/format';
import { deriveTunnelStatus, modeLabelKey } from '../lib/status';
import { logsSignal, stateSignal, tickSignal, uptimeSyncSignal } from '../state/store';
import { Button, IconButton } from '../ui/Button';
import { CopyValue } from '../ui/CopyValue';
import { BrandIcon, Icon } from '../ui/Icon';
import { PageHeader } from '../ui/NavView';
import { SettingsCard, SettingsGroup } from '../ui/Settings';
import { InfoBar, StatusGlyph } from '../ui/Status';
import { pushToast } from '../ui/Toast';
import { ToggleSwitch } from '../ui/ToggleSwitch';

// Cantidad de eventos que muestra la tarjeta "Actividad reciente" (con scroll interno).
const RECENT_LOGS_LIMIT = 10;

export function HomePage() {
  const s = stateSignal.value;
  const lang = languageSignal.value;
  const now = tickSignal.value;
  const [busyTunnel, setBusyTunnel] = useState(false);

  // Actividad reciente: se queda pegada a lo más nuevo mientras la persona no haya subido
  // con el scroll (mismo criterio que la pestaña Actividad).
  const recentBoxRef = useRef<HTMLDivElement>(null);
  const stickToNewestRef = useRef(true);
  const lastLog = logsSignal.value[logsSignal.value.length - 1];
  useEffect(() => {
    const el = recentBoxRef.current;
    if (el && stickToNewestRef.current) el.scrollTop = el.scrollHeight;
  }, [lastLog, Boolean(s)]);

  if (!s) {
    return (
      <div>
        <PageHeader title={t('nav.home')} />
      </div>
    );
  }

  const tun = s.tunnel;
  const derived = deriveTunnelStatus(tun);
  const mode = tun.mode || s.tunnelConfig.mode;
  const mcpUrl = tun.mcpUrl || tun.localMcpUrl || '--';
  const geminiUrl = tun.geminiMcpUrl || (mcpUrl !== '--' ? `${mcpUrl}/gemini` : '--');
  const wsActive = s.workspaces?.active || '--';

  const uptimeSync = uptimeSyncSignal.value;
  const liveUptimeSec =
    uptimeSync.baseSec + Math.max(0, Math.floor((now - uptimeSync.syncedAt) / 1000));

  const subtitle =
    tun.status === 'running' && mode !== 'local'
      ? t('home.viaModeUptime', {
          mode: t(modeLabelKey(mode)),
          uptime: formatDurationHuman(liveUptimeSec, lang),
        })
      : t('home.localOnlySub', { url: tun.localMcpUrl || mcpUrl });

  const handleToggleTunnel = async (next: boolean) => {
    setBusyTunnel(true);
    try {
      await (next ? startTunnel() : stopTunnel());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyTunnel(false);
    }
  };

  const handleRestartTunnel = async () => {
    setBusyTunnel(true);
    try {
      await restartTunnel();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyTunnel(false);
    }
  };

  const ts = tun.env?.tailscale;
  let tsText = t('home.tailscalePending');
  if (ts) {
    if (!ts.installed) tsText = t('home.tailscaleNotInstalled');
    else if (ts.online) tsText = t('home.tailscaleConnected', { ip: ts.tailnetIp || 'OK' });
    else tsText = t('home.tailscaleDisconnected');
  }

  const sessionsCount = s.parallelSessions?.length ?? 0;
  const clientsText =
    sessionsCount === 0
      ? t('home.clientsZero')
      : sessionsCount === 1
        ? t('home.clientsOne')
        : t('home.clientsMany', { count: sessionsCount });

  const op = s.operator;
  const opTools = op.toolCount || 17;
  let opText = t('home.operatorDisabled');
  if (op.status === 'connected') {
    opText =
      op.activeSessionCount > 1
        ? t('home.operatorConnectedMany', { count: op.activeSessionCount })
        : t('home.operatorConnectedOne', { tools: opTools });
  } else if (op.status === 'standby' || op.enabled) {
    opText = t('home.operatorStandby', { tools: opTools });
  } else if (op.status === 'connecting') {
    opText = t('home.operatorStarting');
  } else if (op.status === 'missing') {
    opText = t('home.operatorMissing');
  } else if (op.status === 'error') {
    opText = t('home.operatorError');
  }

  const fc = s.daemons?.fullControl;
  let fcText = '';
  if (fc?.enabled) {
    if (fc.expiresAt) {
      const rem = Math.max(0, Math.ceil((Date.parse(fc.expiresAt) - now) / 1000));
      fcText = t('home.fullControlTimed', { time: formatHms(rem) });
    } else {
      fcText = t('home.fullControlManual');
    }
  }

  const recentLogs = logsSignal.value.slice(-RECENT_LOGS_LIMIT);

  return (
    <div>
      <PageHeader title={t('nav.home')} />

      <div class="flex flex-col gap-2 mb-4 empty:hidden">
        {tun.status === 'needs_action' && tun.actionUrl ? (
          <InfoBar
            severity="caution"
            title={t('home.bannerTailscaleTitle')}
            message={tun.lastError || t('home.bannerTailscaleFallback')}
            actions={
              <>
                <a
                  href={tun.actionUrl}
                  target="_blank"
                  rel="noopener"
                  class="inline-flex h-8 items-center rounded bg-accent px-3 text-[14px] font-semibold text-on-accent no-underline hover:bg-accent-hover"
                >
                  {t('home.bannerOpenTailscale')}
                </a>
                <Button onClick={handleRestartTunnel} disabled={busyTunnel}>
                  {t('common.retry')}
                </Button>
              </>
            }
          />
        ) : null}

        {tun.status === 'error' && tun.lastError ? (
          <InfoBar
            severity="critical"
            title={t('home.bannerTunnelErrorTitle')}
            message={tun.lastError}
            actions={
              <Button onClick={handleRestartTunnel} disabled={busyTunnel}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : null}

        {s.server.portRestartRequired ? (
          <InfoBar
            severity="caution"
            title={t('home.bannerPortTitle', { port: s.server.port })}
            message={t('home.bannerPortBody')}
          />
        ) : null}
      </div>

      {/* Hero status card */}
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-stroke-card bg-card p-5">
        <div class="flex min-w-0 items-center gap-4">
          <StatusGlyph severity={derived.severity} size={32} />
          <div class="min-w-0">
            <div class="font-display text-[20px] leading-7 font-semibold text-fg">
              {t(derived.titleKey)}
            </div>
            <div class="text-[14px] leading-5 text-fg-2 truncate">{subtitle}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <ToggleSwitch
            checked={derived.isActive}
            disabled={busyTunnel || derived.isBusy}
            label={t('home.tunnelSwitchLabel')}
            onChange={handleToggleTunnel}
          />
          <IconButton
            icon="arrow_clockwise"
            label={t('home.restartTunnelLabel')}
            disabled={busyTunnel || tun.status === 'stopped'}
            onClick={handleRestartTunnel}
          />
        </div>
      </div>

      <SettingsGroup title={t('home.groupConnect')}>
        <SettingsCard
          icon="globe"
          title={t('home.mcpUrlTitle')}
          description={t('home.mcpUrlDesc')}
          action={<CopyValue value={mcpUrl} class="max-w-[380px] min-[1180px]:max-w-[540px]" />}
        />
        <SettingsCard
          iconSlot={<BrandIcon name="gemini" size={20} class="text-fg-2" />}
          title={t('home.geminiUrlTitle')}
          action={<CopyValue value={geminiUrl} class="max-w-[380px] min-[1180px]:max-w-[540px]" />}
        />
        <SettingsCard
          icon="key"
          title={t('home.pinTitle')}
          description={t('home.pinDesc')}
          action={
            <CopyValue
              value={s.auth.pin}
              secret
              toastMessage={t('home.pinCopied')}
            />
          }
        />
        <SettingsCard
          icon="info"
          title={t('home.setupGuideTitle')}
          description={t('home.setupGuideDesc')}
          href="#/connection/setup"
        />
      </SettingsGroup>

      <SettingsGroup title={t('home.groupStatus')}>
        <SettingsCard
          iconSlot={<BrandIcon name="tailscale" size={20} class="text-fg-2" />}
          title={t('home.tailscaleTitle')}
          description={tsText}
          href="#/connection"
        />
        <SettingsCard
          icon="plug_connected"
          title={t('home.clientsTitle')}
          description={clientsText}
          href="#/processes"
        />
        <SettingsCard
          icon="options"
          title={t('home.operatorTitle')}
          description={opText}
          href="#/processes"
        />
        <SettingsCard
          icon="folder"
          title={`${t('home.activeWorkspaceTitle')}: ${baseName(wsActive)}`}
          description={wsActive}
          descriptionMono
          href="#/workspaces"
        />
        {fc?.enabled ? (
          <SettingsCard
            icon="shield_lock"
            title={t('home.fullControlTitle')}
            description={fcText}
            href="#/processes"
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={t('home.recentActivityTitle')}
        action={
          <a
            href="#/activity"
            class="inline-flex items-center gap-1 text-[13px] text-accent hover:underline no-underline"
          >
            <span>{t('home.viewAll')}</span>
            <Icon name="chevron_right" size={14} />
          </a>
        }
      >
        <div
          ref={recentBoxRef}
          role="region"
          tabIndex={0}
          aria-label={t('home.recentActivityTitle')}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToNewestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          class="max-h-[164px] overflow-y-auto rounded border border-stroke-card bg-card px-4 py-3 font-mono text-[12px] leading-5"
        >
          {recentLogs.length === 0 ? (
            <div class="font-sans text-[13px] text-fg-3">{t('home.noRecentActivity')}</div>
          ) : (
            <div class="flex flex-col gap-0.5">
              {recentLogs.map((entry, idx) => (
                <div key={`${entry.ts ?? idx}-${idx}`} class="flex gap-3 truncate">
                  <span class="shrink-0 text-fg-3">{formatClock(entry.ts)}</span>
                  <span class="w-24 shrink-0 truncate text-fg-2">
                    [{entry.source || 'app'}]
                  </span>
                  <span
                    class={`min-w-0 truncate ${
                      entry.level === 'error'
                        ? 'text-critical'
                        : entry.level === 'warn'
                          ? 'text-caution'
                          : 'text-fg'
                    }`}
                  >
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
