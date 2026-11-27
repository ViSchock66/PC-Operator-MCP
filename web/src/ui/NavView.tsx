import { t } from '../i18n';
import { formatHash, type PageId } from '../state/router';
import { Icon, type FluentIconName } from './Icon';

export interface NavItemDef {
  id: PageId;
  label: string;
  icon: FluentIconName;
  attentionSeverity?: 'caution' | 'critical' | null;
}

export function NavView({
  activePage,
  items,
  footerItem,
}: {
  activePage: PageId;
  items: NavItemDef[];
  footerItem: NavItemDef;
}) {
  const renderLink = (item: NavItemDef) => {
    const active = activePage === item.id;
    const dotClass =
      item.attentionSeverity === 'critical'
        ? 'bg-critical'
        : item.attentionSeverity === 'caution'
          ? 'bg-caution'
          : '';

    return (
      <a
        key={item.id}
        href={formatHash(item.id)}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        title={item.label}
        class={`group relative flex h-9 items-center gap-3 rounded px-3 text-[14px] leading-5 no-underline transition-[background-color] duration-[83ms] ease-[var(--ease-fluent)] ${
          active
            ? 'bg-subtle-hover text-fg font-semibold'
            : 'text-fg-2 hover:bg-subtle-hover hover:text-fg'
        }`}
      >
        {active ? (
          <span
            aria-hidden="true"
            class="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent"
          />
        ) : null}
        <Icon name={item.icon} filled={active} size={16} />
        <span class="hidden min-[1008px]:inline truncate">{item.label}</span>
        {item.attentionSeverity ? (
          <span
            aria-label={t('app.attention')}
            class={`ml-auto h-2 w-2 rounded-full shrink-0 hidden min-[1008px]:inline-block ${dotClass}`}
          />
        ) : null}
      </a>
    );
  };

  return (
    <aside class="flex w-12 min-[1008px]:w-[280px] shrink-0 flex-col justify-between bg-bg px-1.5 min-[1008px]:px-3 py-3 select-none">
      <div>
        <div class="mb-4 flex h-9 items-center gap-2.5 px-2 min-[1008px]:px-3">
          <img
            src="/admin/assets/favicon.svg?v=3"
            alt=""
            width={18}
            height={18}
            class="h-[18px] w-[18px] shrink-0"
          />
          <span class="hidden min-[1008px]:inline text-[12px] leading-4 font-semibold text-fg-2 truncate">
            {t('app.brand')}
          </span>
        </div>

        <nav aria-label={t('app.navLabel')} class="flex flex-col gap-1">
          {items.map(renderLink)}
        </nav>
      </div>

      <div class="pt-2">{renderLink(footerItem)}</div>
    </aside>
  );
}

export function PageHeader({ title }: { title: string }) {
  return (
    <header class="mb-6">
      <h1 class="font-display text-[28px] leading-9 font-semibold text-fg tracking-[-0.01em]">
        {title}
      </h1>
    </header>
  );
}
