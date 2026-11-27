import { t } from '../i18n';
import { deriveTunnelStatus, modeLabelKey } from '../lib/status';
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  windowFocusedSignal,
  windowMaximizedSignal,
} from '../state/nativeHost';
import { sseSignal, stateSignal } from '../state/store';

export function TitleBar() {
  const s = stateSignal.value;
  const sse = sseSignal.value;
  const maximized = windowMaximizedSignal.value;
  const focused = windowFocusedSignal.value;
  const derived = deriveTunnelStatus(s?.tunnel);
  const mode = s?.tunnel?.mode || s?.tunnelConfig?.mode || 'local';
  const sessions = s?.parallelSessions?.length ?? 0;

  const dotClass =
    derived.severity === 'success'
      ? 'bg-success'
      : derived.severity === 'critical'
        ? 'bg-critical'
        : derived.severity === 'caution'
          ? 'bg-caution'
          : 'bg-fg-3';

  return (
    <header
      class={`titlebar-drag flex h-10 shrink-0 items-center justify-between select-none pl-3.5 transition-opacity duration-150 ${
        focused ? 'opacity-100' : 'opacity-70'
      }`}
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <img
          src="/admin/assets/favicon.svg?v=4"
          alt=""
          width={16}
          height={16}
          class="h-4 w-4 shrink-0"
        />
        <span class="text-[12px] leading-4 font-semibold text-fg truncate">
          {t('app.brandFull')}
        </span>
        {s?.server?.version ? (
          <span class="hidden sm:inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] leading-3 text-fg-3 bg-control border border-stroke-control">
            v{s.server.version}
          </span>
        ) : null}

        {s ? (
          <a
            href="#/connection"
            class="titlebar-no-drag ml-1 inline-flex h-6 items-center gap-1.5 rounded-full border border-stroke-control bg-control px-2.5 text-[11px] leading-4 text-fg-2 no-underline hover:bg-control-hover hover:text-fg transition-[background-color,color] duration-[83ms]"
            title={t(derived.titleKey)}
          >
            <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
            <span class="truncate max-w-[140px]">{t(modeLabelKey(mode))}</span>
            {sessions > 0 ? (
              <span class="border-l border-stroke-control pl-1.5 font-mono text-[10px] text-fg-3">
                {sessions}
              </span>
            ) : null}
          </a>
        ) : null}

        {sse === 'offline' ? (
          <span class="titlebar-no-drag inline-flex items-center gap-1 rounded-full bg-infobar-caution px-2 py-0.5 text-[11px] text-caution">
            {t('settings.sseOffline')}
          </span>
        ) : null}
      </div>

      <div class="titlebar-no-drag flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={minimizeWindow}
          aria-label={t('window.minimize')}
          title={t('window.minimize')}
          class="inline-flex h-full w-[46px] items-center justify-center bg-transparent border-0 text-fg-2 hover:bg-subtle-hover hover:text-fg transition-[background-color,color] duration-[83ms] cursor-default"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          onClick={toggleMaximizeWindow}
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          title={maximized ? t('window.restore') : t('window.maximize')}
          class="inline-flex h-full w-[46px] items-center justify-center bg-transparent border-0 text-fg-2 hover:bg-subtle-hover hover:text-fg transition-[background-color,color] duration-[83ms] cursor-default"
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path
                d="M2.5 2.5V0.5H9.5V7.5H7.5M0.5 2.5H7.5V9.5H0.5V2.5Z"
                stroke="currentColor"
                stroke-width="1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={closeWindow}
          aria-label={t('window.close')}
          title={t('window.close')}
          class="inline-flex h-full w-[46px] items-center justify-center bg-transparent border-0 text-fg-2 hover:bg-[#c42b1c] hover:text-white transition-[background-color,color] duration-[83ms] cursor-default"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M1 1L9 9M9 1L1 9"
              stroke="currentColor"
              stroke-width="1.15"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
