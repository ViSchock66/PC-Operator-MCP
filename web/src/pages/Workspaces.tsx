import { useEffect, useState } from 'preact/hooks';
import {
  addWorkspace,
  openWorkspace,
  pickWorkspace,
  removeWorkspace,
  resetWorkspaceSessions,
  savePermissions,
  selectWorkspace,
} from '../api/endpoints';
import { t } from '../i18n';
import { copyToClipboard } from '../lib/clipboard';
import { applyStateUpdate, stateSignal } from '../state/store';
import { Button, IconButton } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { TextField } from '../ui/FormControls';
import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/NavView';
import { Expander, SettingsCard, SettingsGroup } from '../ui/Settings';
import { pushToast } from '../ui/Toast';
import { ToggleSwitch } from '../ui/ToggleSwitch';

export function WorkspacesPage() {
  const s = stateSignal.value;
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [allowWrite, setAllowWrite] = useState(false);
  const [allowDelete, setAllowDelete] = useState(false);
  const [allowCommands, setAllowCommands] = useState(false);
  const [protectSensitive, setProtectSensitive] = useState(true);
  const [filterSensitiveEnv, setFilterSensitiveEnv] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState('30000');
  const [maxReadBytes, setMaxReadBytes] = useState('131072');
  const [envAllowlist, setEnvAllowlist] = useState('');
  const [envBlocklist, setEnvBlocklist] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (s && !hydrated) {
      const p = s.permissions;
      setAllowWrite(Boolean(p.allowWrite));
      setAllowDelete(Boolean(p.allowDelete));
      setAllowCommands(Boolean(p.allowCommands));
      setProtectSensitive(Boolean(p.protectSensitiveFiles));
      setFilterSensitiveEnv(p.filterSensitiveEnv !== false);
      setTimeoutMs(String(p.commandTimeoutMs || 30000));
      setMaxReadBytes(String(p.maxReadBytes || 131072));
      setEnvAllowlist((p.envAllowlist || []).join(', '));
      setEnvBlocklist((p.envBlocklist || []).join(', '));
      setHydrated(true);
    }
  }, [s, hydrated]);

  if (!s) {
    return (
      <div>
        <PageHeader title={t('nav.workspaces')} />
      </div>
    );
  }

  const details = s.workspaces.details || [];
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? details.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.path.toLowerCase().includes(q) ||
          (d.gitBranch || '').toLowerCase().includes(q) ||
          (d.usedBy || []).some((u) => u.toLowerCase().includes(q)),
      )
    : details;

  const handleAdd = async (e: Event) => {
    e.preventDefault();
    const p = newPath.trim();
    if (!p) return;
    setBusy(true);
    try {
      const res = await addWorkspace(p);
      setNewPath('');
      applyStateUpdate(res.state);
      pushToast(t('workspaces.toastActivated'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async () => {
    setBusy(true);
    try {
      const res = await pickWorkspace();
      applyStateUpdate(res.state);
      pushToast(res.cancelled ? t('workspaces.toastCancelled') : t('workspaces.toastActivated'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncSessions = async () => {
    setBusy(true);
    try {
      const res = await resetWorkspaceSessions();
      applyStateUpdate(res.state);
      pushToast(t('workspaces.toastSynced', { count: res.cleared || 0 }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSelect = async (wsPath: string) => {
    setBusy(true);
    try {
      const res = await selectWorkspace(wsPath);
      applyStateUpdate(res.state);
      pushToast(t('workspaces.toastActivated'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      const res = await removeWorkspace(removeTarget);
      applyStateUpdate(res.state);
      pushToast(t('workspaces.toastRemoved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (wsPath: string) => {
    try {
      await openWorkspace(wsPath);
      pushToast(t('workspaces.toastOpened'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleSavePermissions = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await savePermissions({
        allowWrite,
        allowDelete,
        allowCommands,
        protectSensitiveFiles: protectSensitive,
        filterSensitiveEnv,
        envAllowlist,
        envBlocklist,
        commandTimeoutMs: Number(timeoutMs),
        maxReadBytes: Number(maxReadBytes),
      });
      applyStateUpdate(res.state);
      pushToast(t('workspaces.toastPermissionsSaved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('nav.workspaces')} />

      <SettingsGroup
        title={t('workspaces.groupList')}
        action={
          <div class="flex items-center gap-2">
            <Button onClick={handleSyncSessions} disabled={busy}>
              {t('workspaces.syncSessionsBtn')}
            </Button>
            <Button variant="accent" onClick={handlePick} disabled={busy}>
              {t('workspaces.pickFolderBtn')}
            </Button>
          </div>
        }
      >
        <div class="flex flex-col sm:flex-row gap-2 mb-1">
          <TextField
            type="search"
            value={filter}
            onValueChange={setFilter}
            placeholder={t('workspaces.filterPlaceholder')}
          />
          <form onSubmit={handleAdd} class="flex gap-2 shrink-0 sm:w-[440px]">
            <TextField
              mono
              value={newPath}
              onValueChange={setNewPath}
              placeholder={t('workspaces.addPlaceholder')}
            />
            <Button type="submit" disabled={busy || !newPath.trim()}>
              {t('workspaces.addBtn')}
            </Button>
          </form>
        </div>

        {filtered.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('workspaces.emptyFilter')}
          </div>
        ) : (
          filtered.map((ws) => {
            const metaParts = [ws.path];
            if (!ws.exists) metaParts.push(t('workspaces.missingFolder'));
            if (ws.usedBy.length > 0) {
              metaParts.push(t('workspaces.usedBy', { clients: ws.usedBy.join(', ') }));
            }

            return (
              <SettingsCard
                key={ws.path}
                icon="folder"
                title={
                  <span class="flex items-center gap-2.5 min-w-0">
                    <span class="truncate">{ws.name}</span>
                    {ws.isGit ? (
                      <span class="inline-flex items-center gap-1 text-[12px] font-normal text-fg-3 shrink-0">
                        <Icon name="branch" size={14} />
                        <span>{ws.gitBranch || 'git'}</span>
                      </span>
                    ) : null}
                    {ws.isActive ? (
                      <span class="text-[12px] font-semibold text-accent-text shrink-0">
                        {t('common.active')}
                      </span>
                    ) : null}
                  </span>
                }
                description={metaParts.join(' · ')}
                descriptionMono
                action={
                  <div class="flex items-center gap-1">
                    {!ws.isActive ? (
                      <Button onClick={() => handleSelect(ws.path)} disabled={busy}>
                        {t('common.activate')}
                      </Button>
                    ) : null}
                    <IconButton
                      icon="open"
                      label={t('workspaces.openFolder')}
                      onClick={() => handleOpen(ws.path)}
                    />
                    <IconButton
                      icon="copy"
                      label={t('workspaces.copyPath')}
                      onClick={() => copyToClipboard(ws.path, t('workspaces.toastPathCopied'))}
                    />
                    {details.length > 1 ? (
                      <IconButton
                        icon="delete"
                        label={t('common.remove')}
                        onClick={() => setRemoveTarget(ws.path)}
                      />
                    ) : null}
                  </div>
                }
              />
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title={t('workspaces.groupPermissions')}>
        <form onSubmit={handleSavePermissions} class="flex flex-col gap-1">
          <SettingsCard
            title={t('workspaces.allowWriteTitle')}
            description={t('workspaces.allowWriteDesc')}
            action={
              <ToggleSwitch
                checked={allowWrite}
                onChange={setAllowWrite}
                label={t('workspaces.allowWriteTitle')}
              />
            }
          />
          <SettingsCard
            title={t('workspaces.allowDeleteTitle')}
            description={t('workspaces.allowDeleteDesc')}
            action={
              <ToggleSwitch
                checked={allowDelete}
                onChange={setAllowDelete}
                label={t('workspaces.allowDeleteTitle')}
              />
            }
          />
          <SettingsCard
            title={t('workspaces.allowCommandsTitle')}
            description={t('workspaces.allowCommandsDesc')}
            action={
              <ToggleSwitch
                checked={allowCommands}
                onChange={setAllowCommands}
                label={t('workspaces.allowCommandsTitle')}
              />
            }
          />
          <SettingsCard
            title={t('workspaces.protectSensitiveTitle')}
            description={t('workspaces.protectSensitiveDesc')}
            action={
              <ToggleSwitch
                checked={protectSensitive}
                onChange={setProtectSensitive}
                label={t('workspaces.protectSensitiveTitle')}
              />
            }
          />
          <SettingsCard
            title={t('workspaces.filterEnvTitle')}
            description={t('workspaces.filterEnvDesc')}
            action={
              <ToggleSwitch
                checked={filterSensitiveEnv}
                onChange={setFilterSensitiveEnv}
                label={t('workspaces.filterEnvTitle')}
              />
            }
          />

          <Expander title={t('workspaces.advancedLimitsTitle')}>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="perm-timeout" class="block text-[13px] text-fg-2 mb-1">
                  {t('workspaces.timeoutLabel')}
                </label>
                <TextField
                  id="perm-timeout"
                  type="number"
                  mono
                  min={1000}
                  max={300000}
                  step={1000}
                  value={timeoutMs}
                  onValueChange={setTimeoutMs}
                />
              </div>
              <div>
                <label for="perm-max-read" class="block text-[13px] text-fg-2 mb-1">
                  {t('workspaces.maxReadLabel')}
                </label>
                <TextField
                  id="perm-max-read"
                  type="number"
                  mono
                  min={1024}
                  max={10485760}
                  step={1024}
                  value={maxReadBytes}
                  onValueChange={setMaxReadBytes}
                />
              </div>
              <div>
                <label for="perm-env-allow" class="block text-[13px] text-fg-2 mb-1">
                  {t('workspaces.envAllowlistLabel')}
                </label>
                <TextField
                  id="perm-env-allow"
                  mono
                  value={envAllowlist}
                  onValueChange={setEnvAllowlist}
                  placeholder={t('workspaces.envAllowlistPlaceholder')}
                />
              </div>
              <div>
                <label for="perm-env-block" class="block text-[13px] text-fg-2 mb-1">
                  {t('workspaces.envBlocklistLabel')}
                </label>
                <TextField
                  id="perm-env-block"
                  mono
                  value={envBlocklist}
                  onValueChange={setEnvBlocklist}
                  placeholder={t('workspaces.envBlocklistPlaceholder')}
                />
              </div>
            </div>
          </Expander>

          <div class="mt-2 flex justify-end">
            <Button type="submit" variant="accent" disabled={busy}>
              {t('workspaces.savePermissionsBtn')}
            </Button>
          </div>
        </form>
      </SettingsGroup>

      <ContentDialog
        open={Boolean(removeTarget)}
        title={t('workspaces.removeConfirmTitle')}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        confirmLabel={t('common.remove')}
      >
        {t('workspaces.removeConfirmBody', { path: removeTarget || '' })}
      </ContentDialog>
    </div>
  );
}
