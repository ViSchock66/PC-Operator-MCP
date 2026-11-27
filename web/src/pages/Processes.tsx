import { useEffect, useState } from 'preact/hooks';
import {
  clearExitedProcesses,
  getProcessOutput,
  restartOperator,
  saveFullControl,
  saveOperatorConfig,
  sendProcessInput,
  startProcess,
  stopAllProcesses,
  stopOperator,
  stopOperatorSession,
  stopProcess,
} from '../api/endpoints';
import type { ManagedProcess } from '../api/types';
import { t } from '../i18n';
import { formatHms } from '../lib/format';
import { applyStateUpdate, stateSignal, tickSignal } from '../state/store';
import { Button } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { Select, TextField } from '../ui/FormControls';
import { PageHeader } from '../ui/NavView';
import { Expander, SettingsCard, SettingsGroup } from '../ui/Settings';
import { StatusGlyph } from '../ui/Status';
import { pushToast } from '../ui/Toast';
import { ToggleSwitch } from '../ui/ToggleSwitch';

export function ProcessesPage() {
  const s = stateSignal.value;
  const now = tickSignal.value;

  const [opEnabled, setOpEnabled] = useState(false);
  const [opPath, setOpPath] = useState('');
  const [fcEnabled, setFcEnabled] = useState(false);
  const [fcTtl, setFcTtl] = useState('60');
  const [fcFreeCwd, setFcFreeCwd] = useState(false);
  const [fcStopOnOff, setFcStopOnOff] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const [procName, setProcName] = useState('');
  const [procCmd, setProcCmd] = useState('');
  const [outputProc, setOutputProc] = useState<ManagedProcess | null>(null);
  const [outputText, setOutputText] = useState('');
  const [stdinText, setStdinText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s && !hydrated) {
      setOpEnabled(Boolean(s.operator.enabled));
      setOpPath(s.operator.serverPath || '');
      const fc = s.daemons.fullControl;
      setFcEnabled(Boolean(fc.enabled));
      setFcTtl(String(fc.ttlMinutes ?? 60));
      setFcFreeCwd(Boolean(fc.allowUnrestrictedCwd));
      setFcStopOnOff(fc.stopProcessesOnDisable !== false);
      setHydrated(true);
    }
  }, [s, hydrated]);

  if (!s) {
    return (
      <div>
        <PageHeader title={t('nav.processes')} />
      </div>
    );
  }

  const handleSaveOperator = async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await saveOperatorConfig({
        enabled: opEnabled,
        serverPath: opPath.trim(),
        connectNow: opEnabled,
      });
      applyStateUpdate(res.state);
      pushToast(t('processes.toastOpSaved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpRestart = async () => {
    setBusy(true);
    try {
      const res = await restartOperator();
      applyStateUpdate(res.state);
      pushToast(t('processes.toastOpRestarted'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpStop = async () => {
    setBusy(true);
    try {
      const res = await stopOperator();
      applyStateUpdate(res.state);
      pushToast(t('processes.toastOpStopped'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCloseSessionBridge = async (key: string) => {
    setBusy(true);
    try {
      const res = await stopOperatorSession(key);
      applyStateUpdate(res.state);
      pushToast(t('processes.toastBridgeClosed'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const commitFullControl = async (nextEnabled = fcEnabled) => {
    setBusy(true);
    try {
      const res = await saveFullControl({
        enabled: nextEnabled,
        ttlMinutes: Number(fcTtl),
        allowUnrestrictedCwd: fcFreeCwd,
        stopProcessesOnDisable: fcStopOnOff,
      });
      applyStateUpdate(res.state);
      setFcEnabled(Boolean(res.state.daemons.fullControl.enabled));
      pushToast(t(res.fullControl?.enabled ? 'processes.toastFcOn' : 'processes.toastFcOff'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLaunch = async (e: Event) => {
    e.preventDefault();
    const cmd = procCmd.trim();
    if (!cmd) return;
    setBusy(true);
    try {
      const res = await startProcess({ command: cmd, name: procName.trim() || undefined });
      setProcCmd('');
      setProcName('');
      applyStateUpdate(res.state);
      pushToast(t('processes.toastLaunched', { pid: res.process?.pid || '?' }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openOutput = async (proc: ManagedProcess) => {
    setOutputProc(proc);
    setOutputText(proc.tailPreview || '');
    try {
      const res = await getProcessOutput(proc.id, 150);
      setOutputText(res.output || t('processes.noOutput'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const refreshOutput = async () => {
    if (!outputProc) return;
    try {
      const res = await getProcessOutput(outputProc.id, 150);
      setOutputText(res.output || t('processes.noOutput'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleSendInput = async (e: Event) => {
    e.preventDefault();
    if (!outputProc) return;
    try {
      await sendProcessInput(outputProc.id, stdinText);
      setStdinText('');
      await refreshOutput();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleStopProc = async (id: string) => {
    setBusy(true);
    try {
      const res = await stopProcess(id);
      applyStateUpdate(res.state);
      pushToast(t('processes.toastStopped'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStopAll = async () => {
    setBusy(true);
    try {
      const res = await stopAllProcesses();
      applyStateUpdate(res.state);
      pushToast(t('processes.toastStoppedAll', { count: res.stopped || 0 }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClearExited = async () => {
    setBusy(true);
    try {
      const res = await clearExitedProcesses();
      applyStateUpdate(res.state);
      pushToast(t('processes.toastClearedExited', { count: res.removed || 0 }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const fc = s.daemons.fullControl;
  let fcCountdown = '';
  if (fc.enabled) {
    if (fc.expiresAt) {
      const rem = Math.max(0, Math.ceil((Date.parse(fc.expiresAt) - now) / 1000));
      fcCountdown = t('home.fullControlTimed', { time: formatHms(rem) });
    } else {
      fcCountdown = t('home.fullControlManual');
    }
  }

  const ttlOptions = [
    { value: '30', label: t('processes.fcTtl30') },
    { value: '60', label: t('processes.fcTtl60') },
    { value: '120', label: t('processes.fcTtl120') },
    { value: '240', label: t('processes.fcTtl240') },
    { value: '0', label: t('processes.fcTtl0') },
  ];

  const liveOutputProc = outputProc
    ? s.daemons.processes.find((p) => p.id === outputProc.id) || outputProc
    : null;

  return (
    <div>
      <PageHeader title={t('nav.processes')} />

      <SettingsGroup title={t('processes.groupOperator')}>
        <form onSubmit={handleSaveOperator} class="flex flex-col gap-1">
          <SettingsCard
            icon="options"
            title={t('processes.opEnableTitle')}
            description={t('processes.opEnableDesc')}
            action={
              <ToggleSwitch
                checked={opEnabled}
                onChange={setOpEnabled}
                label={t('processes.opEnableTitle')}
              />
            }
          />
          <Expander title={t('processes.opPathTitle')}>
            <label for="op-path-input" class="block text-[13px] text-fg-2 mb-1">
              {t('processes.opPathLabel')}
            </label>
            <TextField
              id="op-path-input"
              mono
              value={opPath}
              onValueChange={setOpPath}
              placeholder="C:\Users\...\antigravity-operator\server\index.mjs"
            />
          </Expander>
          <div class="mt-2 flex flex-wrap justify-end gap-2">
            <Button onClick={handleOpStop} disabled={busy}>
              {t('processes.opStopBtn')}
            </Button>
            <Button onClick={handleOpRestart} disabled={busy}>
              {t('processes.opRestartBtn')}
            </Button>
            <Button type="submit" variant="accent" disabled={busy}>
              {t('processes.opSaveBtn')}
            </Button>
          </div>
        </form>
      </SettingsGroup>

      <SettingsGroup title={t('processes.groupSessions')}>
        {s.parallelSessions.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('processes.sessionsEmpty')}
          </div>
        ) : (
          s.parallelSessions.map((ps) => {
            const scope =
              ps.workspaceScope === 'session'
                ? t('processes.scopeSession')
                : t('processes.scopeGlobal');
            const detail = [
              scope,
              ps.activeWorkspace,
              ps.lastTool ? t('processes.lastTool', { tool: ps.lastTool }) : null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <SettingsCard
                key={ps.sessionKey}
                icon="plug_connected"
                title={
                  <span class="flex items-center gap-2">
                    <span>{ps.clientLabel}</span>
                    {ps.operatorPid ? (
                      <span class="font-mono text-[12px] text-fg-3">PID {ps.operatorPid}</span>
                    ) : null}
                  </span>
                }
                description={detail}
                descriptionMono
                action={
                  ps.operatorPid ? (
                    <Button onClick={() => handleCloseSessionBridge(ps.sessionKey)} disabled={busy}>
                      {t('processes.closeBridgeBtn')}
                    </Button>
                  ) : undefined
                }
              />
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title={t('processes.groupFullControl')}>
        <SettingsCard
          icon="shield_lock"
          title={t('processes.fcEnableTitle')}
          description={fcCountdown || t('processes.fcEnableDesc')}
          action={
            <ToggleSwitch
              checked={fcEnabled}
              disabled={busy}
              label={t('processes.fcEnableTitle')}
              onChange={(next) => {
                setFcEnabled(next);
                commitFullControl(next);
              }}
            />
          }
        />
        <SettingsCard
          title={t('processes.fcTtlLabel')}
          action={
            <Select
              ariaLabel={t('processes.fcTtlLabel')}
              value={fcTtl}
              onValueChange={setFcTtl}
              options={ttlOptions}
            />
          }
        />
        <Expander title={t('processes.fcPoliciesTitle')}>
          <div class="flex flex-col gap-1">
            <SettingsCard
              title={t('processes.fcFreeCwdTitle')}
              description={t('processes.fcFreeCwdDesc')}
              action={
                <ToggleSwitch
                  checked={fcFreeCwd}
                  onChange={setFcFreeCwd}
                  label={t('processes.fcFreeCwdTitle')}
                />
              }
            />
            <SettingsCard
              title={t('processes.fcStopOnOffTitle')}
              description={t('processes.fcStopOnOffDesc')}
              action={
                <ToggleSwitch
                  checked={fcStopOnOff}
                  onChange={setFcStopOnOff}
                  label={t('processes.fcStopOnOffTitle')}
                />
              }
            />
          </div>
        </Expander>
        <div class="mt-2 flex justify-end">
          <Button onClick={() => commitFullControl(fcEnabled)} disabled={busy}>
            {t('processes.fcSaveBtn')}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('processes.groupDaemons')}
        action={
          <div class="flex items-center gap-2">
            <Button onClick={handleClearExited} disabled={busy}>
              {t('processes.clearExitedBtn')}
            </Button>
            <Button onClick={handleStopAll} disabled={busy || s.daemons.runningCount === 0}>
              {t('processes.stopAllBtn')}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleLaunch} class="flex flex-col sm:flex-row gap-2 mb-1">
          <TextField
            value={procName}
            onValueChange={setProcName}
            placeholder={t('processes.daemonNamePlaceholder')}
            class="sm:max-w-[200px]"
          />
          <TextField
            mono
            value={procCmd}
            onValueChange={setProcCmd}
            placeholder={t('processes.daemonCmdPlaceholder')}
          />
          <Button type="submit" variant="accent" disabled={busy || !procCmd.trim()}>
            {t('processes.launchBtn')}
          </Button>
        </form>

        {s.daemons.processes.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('processes.daemonsEmpty')}
          </div>
        ) : (
          s.daemons.processes.map((proc) => {
            const running = proc.status === 'running';
            const statusText = running
              ? t('processes.runningStatus', { pid: proc.pid ?? '?' })
              : t('processes.exitedStatus', { code: proc.exitCode ?? '?' });

            return (
              <SettingsCard
                key={proc.id}
                iconSlot={<StatusGlyph severity={running ? 'success' : 'neutral'} size={18} />}
                title={
                  <span class="flex items-center gap-2.5">
                    <span>{proc.name}</span>
                    <span class="font-mono text-[12px] text-fg-3">{statusText}</span>
                  </span>
                }
                description={`${proc.command} · ${proc.cwd}`}
                descriptionMono
                action={
                  <div class="flex items-center gap-2">
                    <Button onClick={() => openOutput(proc)}>
                      {t('processes.viewOutputBtn')}
                    </Button>
                    {running ? (
                      <Button onClick={() => handleStopProc(proc.id)} disabled={busy}>
                        {t('common.stop')}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            );
          })
        )}
      </SettingsGroup>

      <ContentDialog
        open={Boolean(liveOutputProc)}
        wide
        title={t('processes.outputDialogTitle', { name: liveOutputProc?.name || '' })}
        onClose={() => setOutputProc(null)}
      >
        {liveOutputProc ? (
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2 text-[12px] font-mono text-fg-3">
              <span class="truncate">{liveOutputProc.command}</span>
              <Button onClick={refreshOutput}>{t('common.refresh')}</Button>
            </div>
            <pre class="max-h-72 overflow-y-auto rounded border border-stroke-card bg-bg p-3 font-mono text-[12px] leading-5 text-fg whitespace-pre-wrap">
              {outputText || t('processes.noOutput')}
            </pre>
            {liveOutputProc.status === 'running' ? (
              <form onSubmit={handleSendInput} class="flex gap-2">
                <TextField
                  mono
                  value={stdinText}
                  onValueChange={setStdinText}
                  placeholder={t('processes.stdinPlaceholder')}
                />
                <Button type="submit" variant="accent">
                  {t('common.send')}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </ContentDialog>
    </div>
  );
}
