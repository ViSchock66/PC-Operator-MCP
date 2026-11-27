import type { ComponentChildren } from 'preact';
import type { Severity } from '../lib/status';
import { Icon, type FluentIconName } from './Icon';

const SEVERITY_ICON: Record<Severity, { icon: FluentIconName; colorClass: string }> = {
  success: { icon: 'checkmark_circle', colorClass: 'text-success' },
  caution: { icon: 'warning', colorClass: 'text-caution' },
  critical: { icon: 'dismiss_circle', colorClass: 'text-critical' },
  neutral: { icon: 'pause_circle', colorClass: 'text-fg-3' },
};

export function StatusGlyph({
  severity,
  size = 20,
  label,
}: {
  severity: Severity;
  size?: number;
  label?: string;
}) {
  const cfg = SEVERITY_ICON[severity];
  return (
    <span class="inline-flex items-center gap-2 shrink-0">
      <Icon name={cfg.icon} filled={severity !== 'neutral'} size={size} class={cfg.colorClass} />
      {label ? <span class="text-[14px] text-fg-2">{label}</span> : null}
    </span>
  );
}

const INFOBAR_BG: Record<Exclude<Severity, 'neutral'>, string> = {
  success: 'bg-infobar-success',
  caution: 'bg-infobar-caution',
  critical: 'bg-infobar-critical',
};

export function InfoBar({
  severity,
  title,
  message,
  actions,
}: {
  severity: Exclude<Severity, 'neutral'>;
  title: string;
  message?: string;
  actions?: ComponentChildren;
}) {
  const cfg = SEVERITY_ICON[severity];
  return (
    <div
      role="status"
      class={`flex flex-wrap items-center justify-between gap-3 rounded border border-stroke-card px-4 py-3 ${INFOBAR_BG[severity]}`}
    >
      <div class="flex min-w-0 flex-1 items-start gap-3">
        <Icon name={cfg.icon} filled size={18} class={`${cfg.colorClass} mt-0.5`} />
        <div class="min-w-0 text-[14px] leading-5 text-fg">
          <span class="font-semibold">{title}</span>
          {message ? <span class="ml-2 text-fg-2">{message}</span> : null}
        </div>
      </div>
      {actions ? <div class="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
