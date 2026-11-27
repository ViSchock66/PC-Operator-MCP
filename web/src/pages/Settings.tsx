import { useState } from 'preact/hooks';
import { logoutAdmin, saveUiConfig, shutdownDaemon } from '../api/endpoints';
import type { Language, ThemePreference } from '../api/types';
import { languageSignal, normalizeLang, setLanguage, t } from '../i18n';
import {
  hostVersionSignal,
  nativeHostSignal,
  normalizeBackdrop,
  setHostBackdrop,
  windowBackdropSignal,
  type WindowBackdrop,
} from '../state/nativeHost';
import { applyThemeVisual, normalizeThemePref, themeSignal } from '../state/prefs';
import { applyStateUpdate, sseSignal, stateSignal } from '../state/store';
import { Button } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { Select } from '../ui/FormControls';
import { PageHeader } from '../ui/NavView';
import { SettingsCard, SettingsGroup } from '../ui/Settings';
import { pushToast } from '../ui/Toast';

export function SettingsPage() {
  const s = stateSignal.value;
  const theme = themeSignal.value;
  const lang = languageSignal.value;
  const sse = sseSignal.value;
  const nativeHost = nativeHostSignal.value;
  const backdrop = windowBackdropSignal.value;
  const hostVersion = hostVersionSignal.value;
  const [confirmShutdown, setConfirmShutdown] = useState(false);

  const handleBackdropChange = (next: string) => {
    const normalized = normalizeBackdrop(next) as WindowBackdrop;
    setHostBackdrop(normalized);
  };

  const handleThemeChange = async (next: string) => {
    const normalized = normalizeThemePref(next) as ThemePreference;
    applyThemeVisual(normalized);
    try {
      const res = await saveUiConfig({ theme: normalized });
      applyStateUpdate(res.state, { syncUi: false });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleLanguageChange = async (next: string) => {
    const normalized = normalizeLang(next) as Language;
    setLanguage(normalized);
    try {
      const res = await saveUiConfig({ language: normalized });
      applyStateUpdate(res.state, { syncUi: false });
      pushToast(t('settings.toastLanguage'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleShutdown = async () => {
    try {
      await shutdownDaemon();
      pushToast(t('settings.toastShutdown'));
      setTimeout(() => window.close(), 450);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const sseLabel =
    sse === 'live'
      ? t('settings.sseLive')
      : sse === 'offline'
        ? t('settings.sseOffline')
        : t('settings.sseConnecting');

  return (
    <div>
      <PageHeader title={t('nav.settings')} />

      <SettingsGroup title={t('settings.groupAppearance')}>
        <SettingsCard
          title={t('settings.themeTitle')}
          description={t('settings.themeDesc')}
          action={
            <Select
              ariaLabel={t('settings.themeTitle')}
              value={theme}
              onValueChange={handleThemeChange}
              options={[
                { value: 'system', label: t('settings.themeSystem') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          }
        />
        {nativeHost ? (
          <SettingsCard
            title={t('settings.backdropTitle')}
            description={t('settings.backdropDesc')}
            action={
              <Select
                ariaLabel={t('settings.backdropTitle')}
                value={backdrop}
                onValueChange={handleBackdropChange}
                options={[
                  { value: 'mica', label: t('settings.backdropMica') },
                  { value: 'mica-alt', label: t('settings.backdropMicaAlt') },
                  { value: 'acrylic', label: t('settings.backdropAcrylic') },
                  { value: 'none', label: t('settings.backdropSolid') },
                ]}
              />
            }
          />
        ) : null}
        <SettingsCard
          title={t('settings.languageTitle')}
          description={t('settings.languageDesc')}
          action={
            <Select
              ariaLabel={t('settings.languageTitle')}
              value={lang}
              onValueChange={handleLanguageChange}
              options={[
                { value: 'es', label: t('settings.languageEs') },
                { value: 'en', label: t('settings.languageEn') },
              ]}
            />
          }
        />
      </SettingsGroup>

      {s ? (
        <SettingsGroup title={t('settings.groupAbout')}>
          <SettingsCard
            icon="info"
            title={t('settings.versionTitle')}
            action={<span class="font-mono text-[13px] text-fg-2">v{s.server.version}</span>}
          />
          <SettingsCard
            title={t('settings.pidTitle')}
            action={<span class="font-mono text-[13px] text-fg-2">{s.server.pid}</span>}
          />
          <SettingsCard
            title={t('settings.platformTitle')}
            action={<span class="font-mono text-[13px] text-fg-2">{s.server.platform}</span>}
          />
          <SettingsCard
            title={t('settings.containerTitle')}
            action={
              <span class="font-mono text-[13px] text-fg-2">
                {nativeHost
                  ? t('settings.containerNative', {
                      version: hostVersion || s.server.version,
                      backdrop,
                    })
                  : t('settings.containerWeb')}
              </span>
            }
          />
          <SettingsCard
            title={t('settings.localEndpointTitle')}
            action={
              <span class="font-mono text-[13px] text-fg-2">
                {s.tunnel.localMcpUrl || `http://${s.server.host}:${s.server.port}/mcp`}
              </span>
            }
          />
          <SettingsCard
            title={t('settings.sseTitle')}
            action={<span class="text-[13px] text-fg-2">{sseLabel}</span>}
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t('settings.groupSession')}>
        <SettingsCard
          icon="sign_out"
          title={t('settings.logoutTitle')}
          description={t('settings.logoutDesc')}
          action={<Button onClick={() => logoutAdmin()}>{t('settings.logoutBtn')}</Button>}
        />
        <SettingsCard
          icon="power"
          title={t('settings.shutdownTitle')}
          description={t('settings.shutdownDesc')}
          action={
            <Button
              onClick={() => setConfirmShutdown(true)}
              class="text-critical border-critical/30"
            >
              {t('settings.shutdownBtn')}
            </Button>
          }
        />
      </SettingsGroup>

      <ContentDialog
        open={confirmShutdown}
        title={t('settings.shutdownConfirmTitle')}
        onClose={() => setConfirmShutdown(false)}
        onConfirm={handleShutdown}
        confirmLabel={t('settings.shutdownBtn')}
      >
        {t('settings.shutdownConfirmBody')}
      </ContentDialog>
    </div>
  );
}
