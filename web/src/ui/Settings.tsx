import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { Icon, type FluentIconName } from './Icon';

export function SettingsGroup({
  title,
  action,
  children,
  class: className = '',
}: {
  title?: string;
  action?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <section class={`mt-7 first:mt-0 ${className}`}>
      {(title || action) && (
        <div class="mb-2 flex items-center justify-between gap-3">
          {title ? <h2 class="text-[14px] leading-5 font-semibold text-fg">{title}</h2> : <span />}
          {action}
        </div>
      )}
      <div class="flex flex-col gap-1">{children}</div>
    </section>
  );
}

export interface SettingsCardProps {
  icon?: FluentIconName;
  iconSlot?: ComponentChildren;
  title: ComponentChildren;
  description?: ComponentChildren;
  descriptionMono?: boolean;
  action?: ComponentChildren;
  href?: string;
  onClick?: () => void;
  clickable?: boolean;
  class?: string;
}

export function SettingsCard({
  icon,
  iconSlot,
  title,
  description,
  descriptionMono = false,
  action,
  href,
  onClick,
  clickable = false,
  class: className = '',
}: SettingsCardProps) {
  const isInteractive = Boolean(href || onClick || clickable);
  const minHeight = description ? 'min-h-[68px]' : 'min-h-[48px]';
  const baseClass = `flex w-full items-center justify-between gap-4 rounded border border-stroke-card bg-card px-4 py-3 text-left transition-[background-color] duration-[83ms] ease-[var(--ease-fluent)] ${minHeight} ${
    isInteractive ? 'hover:bg-card-hover cursor-pointer' : ''
  } ${className}`;

  const body = (
    <>
      <div class="flex min-w-0 flex-1 items-center gap-4">
        {iconSlot ?? (icon ? <Icon name={icon} size={20} class="text-fg-2" /> : null)}
        <div class="min-w-0 flex-1">
          <div class="text-[14px] leading-5 text-fg truncate">{title}</div>
          {description ? (
            <div
              class={`text-[12px] leading-4 text-fg-3 truncate ${descriptionMono ? 'font-mono' : ''}`}
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {action}
        {isInteractive && !action ? (
          <Icon name="chevron_right" size={16} class="text-fg-3" />
        ) : isInteractive && href ? (
          <Icon name="chevron_right" size={16} class="text-fg-3" />
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} class={`${baseClass} no-underline`}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} class={baseClass}>
        {body}
      </button>
    );
  }
  return <div class={baseClass}>{body}</div>;
}

export function Expander({
  icon,
  title,
  description,
  defaultOpen = false,
  action,
  children,
}: {
  icon?: FluentIconName;
  title: ComponentChildren;
  description?: ComponentChildren;
  defaultOpen?: boolean;
  action?: ComponentChildren;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const minHeight = description ? 'min-h-[68px]' : 'min-h-[48px]';

  return (
    <div class="rounded border border-stroke-card bg-card overflow-hidden">
      <div class={`flex items-center justify-between gap-3 px-4 py-3 ${minHeight}`}>
        <button
          type="button"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          class="flex min-w-0 flex-1 items-center gap-4 text-left cursor-pointer bg-transparent border-0 p-0"
        >
          {icon ? <Icon name={icon} size={20} class="text-fg-2" /> : null}
          <div class="min-w-0 flex-1">
            <div class="text-[14px] leading-5 text-fg truncate">{title}</div>
            {description ? (
              <div class="text-[12px] leading-4 text-fg-3 truncate">{description}</div>
            ) : null}
          </div>
          <Icon
            name={open ? 'chevron_down' : 'chevron_right'}
            size={16}
            class="text-fg-2 shrink-0"
          />
        </button>
        {action ? <div class="shrink-0">{action}</div> : null}
      </div>
      {open ? (
        <div id={panelId} class="border-t border-stroke-card bg-bg/40 px-4 py-3.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
