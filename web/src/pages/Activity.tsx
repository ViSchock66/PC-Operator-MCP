import { useEffect, useRef, useState } from 'preact/hooks';
import { clearLogs } from '../api/endpoints';
import { t } from '../i18n';
import { formatClock } from '../lib/format';
import { matchesLogFilter, type LogFilter } from '../lib/status';
import { logsSignal } from '../state/store';
import { Button } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { TextField } from '../ui/FormControls';
import { PageHeader } from '../ui/NavView';

export function ActivityPage() {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const visibleLogs = logsSignal.value.filter((e) => matchesLogFilter(e, filter, search));

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleLogs.length]);

  const filters: Array<{ id: LogFilter; label: string }> = [
    { id: 'all', label: t('activity.filterAll') },
    { id: 'mcp', label: t('activity.filterMcp') },
    { id: 'tunnel', label: t('activity.filterTunnel') },
    { id: 'operator', label: t('activity.filterOperator') },
    { id: 'warn', label: t('activity.filterWarn') },
  ];

  const handleClear = async () => {
    await clearLogs().catch(() => {});
    logsSignal.value = [];
  };

  return (
    <div class="flex h-[calc(100vh-64px)] min-h-[420px] flex-col">
      <PageHeader title={t('nav.activity')} />

      <div class="mb-3 flex flex-wrap items-center justify-between gap-4 border-b border-stroke-card pb-2">
        <div role="tablist" class="flex items-center gap-5">
          {filters.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active ? 'true' : 'false'}
                onClick={() => setFilter(f.id)}
                class={`relative pb-2 text-[14px] leading-5 cursor-pointer bg-transparent border-0 ${
                  active ? 'font-semibold text-fg' : 'text-fg-2 hover:text-fg'
                }`}
              >
                {f.label}
                {active ? (
                  <span
                    aria-hidden="true"
                    class="absolute inset-x-0 -bottom-[9px] h-[3px] rounded-full bg-accent"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div class="flex items-center gap-2">
          <TextField
            type="search"
            value={search}
            onValueChange={setSearch}
            placeholder={t('activity.searchPlaceholder')}
            class="w-48 sm:w-64"
          />
          <Button onClick={() => setConfirmClear(true)} disabled={logsSignal.value.length === 0}>
            {t('common.clear')}
          </Button>
        </div>
      </div>

      <div
        ref={boxRef}
        class="min-h-0 flex-1 overflow-y-auto rounded border border-stroke-card bg-card px-4 py-3 font-mono text-[12px] leading-5"
      >
        {visibleLogs.length === 0 ? (
          <div class="font-sans text-[13px] text-fg-3">{t('activity.empty')}</div>
        ) : (
          <div class="flex flex-col gap-0.5">
            {visibleLogs.map((entry, idx) => (
              <div key={`${entry.ts ?? idx}-${idx}`} class="flex items-baseline gap-3">
                <span class="shrink-0 text-fg-3">{formatClock(entry.ts)}</span>
                <span class="w-24 shrink-0 truncate text-fg-2">
                  [{entry.source || 'app'}]
                </span>
                <span
                  class={`min-w-0 break-words ${
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

      <ContentDialog
        open={confirmClear}
        title={t('activity.clearConfirmTitle')}
        onClose={() => setConfirmClear(false)}
        onConfirm={handleClear}
        confirmLabel={t('common.clear')}
      >
        {t('activity.clearConfirmBody')}
      </ContentDialog>
    </div>
  );
}
