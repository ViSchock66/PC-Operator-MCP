import { useState } from 'preact/hooks';
import { deleteHandoff, freezeHandoff, getHandoffPrompt } from '../api/endpoints';
import { languageSignal, t } from '../i18n';
import { copyToClipboard } from '../lib/clipboard';
import { formatRelativeTime } from '../lib/format';
import { applyStateUpdate, stateSignal } from '../state/store';
import { Button, IconButton } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { TextField } from '../ui/FormControls';
import { PageHeader } from '../ui/NavView';
import { SettingsCard, SettingsGroup } from '../ui/Settings';
import { StatusGlyph } from '../ui/Status';
import { pushToast } from '../ui/Toast';

export function HandoffPage() {
  const s = stateSignal.value;
  const lang = languageSignal.value;
  const [note, setNote] = useState('');
  const [openTrailKey, setOpenTrailKey] = useState<string | null>(null);
  const [confirmClearTrail, setConfirmClearTrail] = useState<{
    trailKey: string;
    client: string;
    workspace: string;
  } | null>(null);
  const [confirmDeleteCpId, setConfirmDeleteCpId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!s) {
    return (
      <div>
        <PageHeader title={t('nav.handoff')} />
      </div>
    );
  }

  const trails = s.handoffs.trailsDetailed || [];
  const checkpoints = s.handoffs.checkpointsDetailed || [];

  const handleCopyTrail = async (trailKey: string) => {
    try {
      const res = await getHandoffPrompt({ trailKey });
      await copyToClipboard(res.prompt, t('handoff.toastPromptCopied'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleFreeze = async (trailKey: string) => {
    setBusy(true);
    try {
      const res = await freezeHandoff(trailKey, note.trim());
      setNote('');
      applyStateUpdate(res.state);
      if (res.prompt) {
        await copyToClipboard(res.prompt, t('handoff.toastFrozenCopied'));
      } else {
        pushToast(t('handoff.toastFrozen'));
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClearResumed = async () => {
    setBusy(true);
    try {
      const res = await deleteHandoff({ action: 'clear_resumed' });
      applyStateUpdate(res.state);
      const count = res.pruned?.removedCheckpoints || 0;
      pushToast(
        count > 0 ? t('handoff.toastClearedResumed', { count }) : t('handoff.toastNoneResumed'),
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClearTrail = async () => {
    if (!confirmClearTrail) return;
    setBusy(true);
    try {
      const res = await deleteHandoff({ trailKey: confirmClearTrail.trailKey });
      if (openTrailKey === confirmClearTrail.trailKey) setOpenTrailKey(null);
      applyStateUpdate(res.state);
      pushToast(t('handoff.toastTrailCleared'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCp = async (id: string) => {
    try {
      const res = await getHandoffPrompt({ id });
      await copyToClipboard(res.prompt, t('handoff.toastPromptCopied'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteCp = async () => {
    if (!confirmDeleteCpId) return;
    setBusy(true);
    try {
      const res = await deleteHandoff({ id: confirmDeleteCpId });
      applyStateUpdate(res.state);
      pushToast(t('handoff.toastCpDeleted'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('nav.handoff')} />

      <SettingsGroup
        title={t('handoff.groupTrails')}
        action={
          <Button onClick={handleClearResumed} disabled={busy}>
            {t('handoff.clearResumedBtn')}
          </Button>
        }
      >
        <div class="mb-1">
          <TextField
            value={note}
            onValueChange={setNote}
            placeholder={t('handoff.notePlaceholder')}
          />
        </div>

        {trails.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('handoff.trailsEmpty')}
          </div>
        ) : (
          trails.map((tr) => {
            const isOpen = openTrailKey === tr.trailKey;
            const modFiles = (tr.modifiedFiles || [])
              .slice(0, 4)
              .map((f) => `${f.path} (${f.op})`)
              .join(', ');
            const readFiles = (tr.readFiles || [])
              .slice(0, 3)
              .map((f) => f.path)
              .join(', ');

            return (
              <div
                key={tr.trailKey}
                class="rounded border border-stroke-card bg-card overflow-hidden"
              >
                <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-[14px] font-semibold text-fg">{tr.clientLabel}</span>
                      <span class="text-[12px] text-fg-3">
                        {tr.workspaceName || tr.activeWorkspace}
                      </span>
                      <span class="text-[12px] text-fg-3">
                        · {t('handoff.opsTime', {
                          count: tr.toolCalls || 0,
                          time: formatRelativeTime(tr.updatedAt, lang),
                        })}
                      </span>
                    </div>
                    <div class="mt-0.5 truncate font-mono text-[12px] text-fg-3">
                      {tr.activeWorkspace}
                    </div>
                    {modFiles ? (
                      <div class="mt-0.5 truncate font-mono text-[12px] text-fg-2">
                        {t('handoff.modifiedFiles', { files: modFiles })}
                      </div>
                    ) : readFiles ? (
                      <div class="mt-0.5 truncate font-mono text-[12px] text-fg-2">
                        {t('handoff.readFiles', { files: readFiles })}
                      </div>
                    ) : null}
                    {tr.lastError ? (
                      <div class="mt-0.5 truncate text-[12px] text-critical">
                        {t('handoff.lastError', { error: tr.lastError })}
                      </div>
                    ) : null}
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <Button variant="accent" onClick={() => handleCopyTrail(tr.trailKey)}>
                      {t('handoff.copyPromptBtn')}
                    </Button>
                    <Button onClick={() => handleFreeze(tr.trailKey)} disabled={busy}>
                      {t('handoff.freezeBtn')}
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() => setOpenTrailKey(isOpen ? null : tr.trailKey)}
                    >
                      {isOpen ? t('common.hide') : t('common.details')}
                    </Button>
                    <IconButton
                      icon="delete"
                      label={t('common.clear')}
                      onClick={() =>
                        setConfirmClearTrail({
                          trailKey: tr.trailKey,
                          client: tr.clientLabel,
                          workspace: tr.workspaceName || tr.activeWorkspace,
                        })
                      }
                    />
                  </div>
                </div>

                {isOpen ? (
                  <div class="border-t border-stroke-card bg-bg/40 px-4 py-3 text-[12px]">
                    <div class="font-mono text-fg-3 mb-2">{tr.trailKey}</div>
                    {tr.recentCommands && tr.recentCommands.length > 0 ? (
                      <div class="mb-2">
                        <div class="font-semibold text-fg-2 mb-1">
                          {t('handoff.recentCommands')}
                        </div>
                        <ul class="flex flex-col gap-0.5 font-mono text-fg-2">
                          {tr.recentCommands.map((c, i) => (
                            <li key={i} class="truncate">
                              [{c.ok ? 'OK' : 'ERR'}] {c.command}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {tr.recentActions && tr.recentActions.length > 0 ? (
                      <div>
                        <div class="font-semibold text-fg-2 mb-1">
                          {t('handoff.recentActions')}
                        </div>
                        <ul class="flex flex-col gap-0.5 font-mono text-fg-2">
                          {tr.recentActions.map((a, i) => (
                            <li key={i} class="truncate">
                              [{a.ok ? 'OK' : 'ERR'}] {a.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title={t('handoff.groupCheckpoints')}>
        {checkpoints.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('handoff.checkpointsEmpty')}
          </div>
        ) : (
          checkpoints.map((cp) => {
            const isPending = cp.status === 'pending';
            const origin = t('handoff.cpOrigin', {
              client: cp.fromClientLabel || '--',
              workspace: cp.workspaceName || cp.activeWorkspace || '--',
            });
            const meta = [
              origin,
              formatRelativeTime(cp.createdAt, lang),
              cp.resumedByClientLabel
                ? t('handoff.cpResumedBy', { client: cp.resumedByClientLabel })
                : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <SettingsCard
                key={cp.id}
                iconSlot={
                  <StatusGlyph severity={isPending ? 'caution' : 'success'} size={18} />
                }
                title={cp.title || cp.id}
                description={cp.notes ? `${meta} · ${t('handoff.cpNote', { note: cp.notes })}` : meta}
                action={
                  <div class="flex items-center gap-1.5">
                    <Button variant="accent" onClick={() => handleCopyCp(cp.id)}>
                      {t('handoff.copyPromptBtn')}
                    </Button>
                    <IconButton
                      icon="delete"
                      label={t('common.delete')}
                      onClick={() => setConfirmDeleteCpId(cp.id)}
                    />
                  </div>
                }
              />
            );
          })
        )}
      </SettingsGroup>

      <ContentDialog
        open={Boolean(confirmClearTrail)}
        title={t('handoff.clearTrailTitle')}
        onClose={() => setConfirmClearTrail(null)}
        onConfirm={handleClearTrail}
        confirmLabel={t('common.clear')}
      >
        {confirmClearTrail
          ? t('handoff.clearTrailBody', {
              client: confirmClearTrail.client,
              workspace: confirmClearTrail.workspace,
            })
          : ''}
      </ContentDialog>

      <ContentDialog
        open={Boolean(confirmDeleteCpId)}
        title={t('handoff.deleteCpTitle')}
        onClose={() => setConfirmDeleteCpId(null)}
        onConfirm={handleDeleteCp}
        confirmLabel={t('common.delete')}
      >
        {t('handoff.deleteCpBody')}
      </ContentDialog>
    </div>
  );
}
