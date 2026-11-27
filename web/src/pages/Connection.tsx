import { useEffect, useState } from 'preact/hooks';
import {
  createApiKey,
  detectTunnel,
  revokeAllSessions,
  revokeApiKey,
  saveOAuthOrigins,
  saveServerConfig,
  saveTunnelConfig,
} from '../api/endpoints';
import type { AdminState, TunnelMode } from '../api/types';
import { t } from '../i18n';
import { copyToClipboard } from '../lib/clipboard';
import { applyStateUpdate, stateSignal } from '../state/store';
import { navigate, routeSignal, type ConnectionSubtab } from '../state/router';
import { Button } from '../ui/Button';
import { ContentDialog } from '../ui/ContentDialog';
import { CopyValue } from '../ui/CopyValue';
import { Select, TextField } from '../ui/FormControls';
import { BrandIcon } from '../ui/Icon';
import { PageHeader } from '../ui/NavView';
import { Expander, SettingsCard, SettingsGroup } from '../ui/Settings';
import { InfoBar, StatusGlyph } from '../ui/Status';
import { pushToast } from '../ui/Toast';
import { ToggleSwitch } from '../ui/ToggleSwitch';

type SnippetId = 'claude-code' | 'cursor' | 'vscode' | 'http';

function buildSnippets(mcpUrl: string): Record<SnippetId, string> {
  const url = mcpUrl && mcpUrl !== '--' ? mcpUrl : 'http://127.0.0.1:3333/mcp';
  return {
    'claude-code': [
      `claude mcp add --transport http pc-operator "${url}"`,
      '',
      JSON.stringify(
        {
          mcpServers: {
            'pc-operator': {
              type: 'http',
              url,
              headers: { Authorization: 'Bearer <YOUR_API_KEY>' },
            },
          },
        },
        null,
        2,
      ),
    ].join('\n'),
    cursor: JSON.stringify(
      {
        mcpServers: {
          'pc-operator': {
            url,
            headers: { Authorization: 'Bearer <YOUR_API_KEY>' },
          },
        },
      },
      null,
      2,
    ),
    vscode: JSON.stringify(
      {
        servers: {
          'pc-operator': {
            type: 'http',
            url,
            headers: { Authorization: 'Bearer <YOUR_API_KEY>' },
          },
        },
      },
      null,
      2,
    ),
    http: [
      `curl -X POST "${url}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Accept: application/json, text/event-stream" \\`,
      `  -H "Authorization: Bearer <YOUR_API_KEY>" \\`,
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    ].join('\n'),
  };
}

export function ConnectionPage() {
  const s = stateSignal.value;
  const subtab = routeSignal.value.subtab;

  if (!s) {
    return (
      <div>
        <PageHeader title={t('nav.connection')} />
      </div>
    );
  }

  const tabs: Array<{ id: ConnectionSubtab; label: string }> = [
    { id: 'tunnel', label: t('connection.tabTunnel') },
    { id: 'auth', label: t('connection.tabAuth') },
    { id: 'setup', label: t('connection.tabSetup') },
  ];

  return (
    <div>
      <PageHeader title={t('nav.connection')} />

      {/* Win11 Pivot bar */}
      <div role="tablist" class="mb-6 flex items-center gap-6 border-b border-stroke-card">
        {tabs.map((tab) => {
          const active = subtab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active ? 'true' : 'false'}
              onClick={() => navigate('connection', tab.id)}
              class={`relative pb-2.5 text-[14px] leading-5 transition-colors duration-[83ms] cursor-pointer bg-transparent border-0 ${
                active ? 'font-semibold text-fg' : 'text-fg-2 hover:text-fg'
              }`}
            >
              {tab.label}
              {active ? (
                <span
                  aria-hidden="true"
                  class="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {subtab === 'tunnel' ? <TunnelSubtab state={s} /> : null}
      {subtab === 'auth' ? <AuthSubtab state={s} /> : null}
      {subtab === 'setup' ? <SetupSubtab state={s} /> : null}
    </div>
  );
}

function TunnelSubtab({ state: s }: { state: AdminState }) {
  const [mode, setMode] = useState<TunnelMode>(s.tunnelConfig.mode || 'tailscale');
  const [publicUrl, setPublicUrl] = useState(s.tunnelConfig.publicUrl || '');
  const [customDomain, setCustomDomain] = useState(s.tunnelConfig.customDomain || '');
  const [cfToken, setCfToken] = useState(
    s.tunnelConfig.hasCloudflareToken ? s.tunnelConfig.cloudflareTokenPreview : '',
  );
  const [autoStart, setAutoStart] = useState(Boolean(s.tunnelConfig.autoStart));
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      setMode(s.tunnelConfig.mode || 'tailscale');
      setPublicUrl(s.tunnelConfig.publicUrl || '');
      setCustomDomain(s.tunnelConfig.customDomain || '');
      setCfToken(s.tunnelConfig.hasCloudflareToken ? s.tunnelConfig.cloudflareTokenPreview : '');
      setAutoStart(Boolean(s.tunnelConfig.autoStart));
      setHydrated(true);
    }
  }, [s, hydrated]);

  const syncFromResponse = (next: AdminState) => {
    applyStateUpdate(next);
    setMode(next.tunnelConfig.mode || 'tailscale');
    setPublicUrl(next.tunnelConfig.publicUrl || '');
    setCustomDomain(next.tunnelConfig.customDomain || '');
    setCfToken(next.tunnelConfig.hasCloudflareToken ? next.tunnelConfig.cloudflareTokenPreview : '');
    setAutoStart(Boolean(next.tunnelConfig.autoStart));
  };

  const handleSave = async (applyNow: boolean) => {
    setBusy(true);
    try {
      const res = await saveTunnelConfig({
        mode,
        publicUrl: publicUrl.trim(),
        customDomain: customDomain.trim(),
        cloudflareToken: cfToken.trim(),
        autoStart,
        applyNow,
      });
      syncFromResponse(res.state);
      pushToast(t(applyNow ? 'connection.toastTunnelApplied' : 'connection.toastTunnelSaved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDetect = async (applySuggested: boolean) => {
    setBusy(true);
    try {
      const res = await detectTunnel(applySuggested);
      if (applySuggested) syncFromResponse(res.state);
      else applyStateUpdate(res.state);
      const url = res.env?.tailscale?.suggestedUrl;
      if (applySuggested && url) pushToast(t('connection.toastDetectedUrlApplied', { url }));
      else if (url) pushToast(t('connection.toastTailscaleDetected', { url }));
      else pushToast(t('connection.toastDetectDone'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const modes: Array<{ id: TunnelMode; title: string; desc: string; brand?: 'tailscale' | 'cloudflare' }> = [
    {
      id: 'tailscale',
      title: t('connection.modeTailscaleTitle'),
      desc: t('connection.modeTailscaleDesc'),
      brand: 'tailscale',
    },
    {
      id: 'cloudflare-named',
      title: t('connection.modeCfNamedTitle'),
      desc: t('connection.modeCfNamedDesc'),
      brand: 'cloudflare',
    },
    {
      id: 'cloudflare-quick',
      title: t('connection.modeCfQuickTitle'),
      desc: t('connection.modeCfQuickDesc'),
      brand: 'cloudflare',
    },
    {
      id: 'local',
      title: t('connection.modeLocalTitle'),
      desc: t('connection.modeLocalDesc'),
    },
  ];

  const ts = s.tunnel.env?.tailscale;
  const cf = s.tunnel.env?.cloudflared;

  return (
    <div>
      <SettingsGroup
        title={t('connection.tunnelGroup')}
        action={
          <Button onClick={() => handleDetect(false)} disabled={busy}>
            {t('connection.detectTailscale')}
          </Button>
        }
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {modes.map((m) => {
            const selected = mode === m.id;
            return (
              <label
                key={m.id}
                class={`flex cursor-pointer items-start gap-3 rounded border p-3.5 transition-[background-color,border-color] duration-[83ms] ${
                  selected
                    ? 'border-accent bg-card-hover'
                    : 'border-stroke-card bg-card hover:bg-card-hover'
                }`}
              >
                <input
                  type="radio"
                  name="tunnel-mode"
                  value={m.id}
                  checked={selected}
                  onChange={() => setMode(m.id)}
                  class="mt-1 accent-accent cursor-pointer"
                />
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-[14px] font-semibold text-fg">
                    {m.brand ? <BrandIcon name={m.brand} size={15} class="text-fg-2" /> : null}
                    <span>{m.title}</span>
                  </div>
                  <div class="mt-0.5 text-[12px] leading-4 text-fg-3">{m.desc}</div>
                </div>
              </label>
            );
          })}
        </div>

        {mode === 'tailscale' ? (
          <div class="rounded border border-stroke-card bg-card p-4">
            <label for="input-public-url" class="block text-[14px] text-fg mb-1.5">
              {t('connection.publicUrlLabel')}
            </label>
            <TextField
              id="input-public-url"
              mono
              value={publicUrl}
              onValueChange={setPublicUrl}
              placeholder="https://my-pc.tailnet.ts.net"
            />
            <div class="mt-1.5 text-[12px] text-fg-3">{t('connection.publicUrlHint')}</div>
          </div>
        ) : null}

        {mode === 'cloudflare-named' ? (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded border border-stroke-card bg-card p-4">
            <div>
              <label for="input-custom-domain" class="block text-[14px] text-fg mb-1.5">
                {t('connection.customDomainLabel')}
              </label>
              <TextField
                id="input-custom-domain"
                mono
                value={customDomain}
                onValueChange={setCustomDomain}
                placeholder="https://mcp.example.com"
              />
            </div>
            <div>
              <label for="input-cf-token" class="block text-[14px] text-fg mb-1.5">
                {t('connection.cfTokenLabel')}
              </label>
              <TextField
                id="input-cf-token"
                type="password"
                mono
                value={cfToken}
                onValueChange={setCfToken}
                placeholder={t('connection.cfTokenPlaceholder')}
              />
            </div>
          </div>
        ) : null}

        <SettingsCard
          title={t('connection.autoStartTitle')}
          action={<ToggleSwitch checked={autoStart} onChange={setAutoStart} label={t('connection.autoStartTitle')} />}
        />

        <div class="flex items-center justify-end gap-2 pt-2">
          <Button onClick={() => handleSave(false)} disabled={busy}>
            {t('connection.saveOnly')}
          </Button>
          <Button variant="accent" onClick={() => handleSave(true)} disabled={busy}>
            {t('connection.saveAndApply')}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('connection.envGroup')}>
        <SettingsCard
          title={t('connection.envTailscaleCli')}
          description={
            !ts
              ? t('home.tailscalePending')
              : !ts.installed
                ? t('connection.envNotInstalled')
                : ts.online
                  ? t('connection.envConnectedDns', { dns: ts.dnsName || 'OK' })
                  : t('home.tailscaleDisconnected')
          }
          action={
            ts?.suggestedUrl && s.tunnelConfig.publicUrl !== ts.suggestedUrl ? (
              <Button onClick={() => handleDetect(true)} disabled={busy}>
                {t('connection.applyDetectedUrl')}
              </Button>
            ) : undefined
          }
        />
        <SettingsCard
          title={t('connection.envTailnetIp')}
          description={
            ts?.tailnetIp
              ? `${ts.tailnetIp} · ${ts.funnelActive ? t('connection.envFunnelOn') : t('connection.envFunnelOff')}`
              : t('common.none')
          }
          descriptionMono={Boolean(ts?.tailnetIp)}
        />
        <SettingsCard
          title={t('connection.envCloudflared')}
          description={
            !cf
              ? t('home.tailscalePending')
              : cf.installed
                ? `${t('connection.envInstalled')} · ${cf.binaryPath}`
                : t('connection.envNotInstalled')
          }
          descriptionMono={Boolean(cf?.installed)}
        />
      </SettingsGroup>
    </div>
  );
}

function AuthSubtab({ state: s }: { state: AdminState }) {
  const [port, setPort] = useState(String(s.server.port));
  const [pin, setPin] = useState(s.auth.pin);
  const [keyName, setKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<{ name: string; token: string } | null>(null);
  const [originsText, setOriginsText] = useState((s.auth.allowedRedirectOrigins || []).join('\n'));
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      setPort(String(s.server.port));
      setPin(s.auth.pin);
      setOriginsText((s.auth.allowedRedirectOrigins || []).join('\n'));
      setHydrated(true);
    }
  }, [s, hydrated]);

  const handleSaveServer = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await saveServerConfig({ port: Number(port), pin: pin.trim() });
      applyStateUpdate(res.state);
      setPort(String(res.state.server.port));
      setPin(res.state.auth.pin);
      pushToast(t(res.portChanged ? 'connection.toastPortRestart' : 'connection.toastServerSaved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenPin = async () => {
    setBusy(true);
    try {
      const res = await saveServerConfig({ regeneratePin: true });
      applyStateUpdate(res.state);
      setPin(res.state.auth.pin);
      pushToast(t('connection.toastPinRegenerated', { pin: res.state.auth.pin }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenClient = async () => {
    setBusy(true);
    try {
      const res = await saveServerConfig({ regenerateStaticClient: true });
      applyStateUpdate(res.state);
      pushToast(t('connection.toastClientRegenerated'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeAll = async () => {
    setBusy(true);
    try {
      const res = await revokeAllSessions();
      applyStateUpdate(res.state);
      pushToast(t('connection.toastSessionsRevoked'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateKey = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await createApiKey(keyName.trim() || t('connection.defaultKeyName'));
      setKeyName('');
      if (res.createdKey?.token) {
        setCreatedKey({ name: res.createdKey.name, token: res.createdKey.token });
      }
      applyStateUpdate(res.state);
      pushToast(t('connection.toastKeyCreated'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    setBusy(true);
    try {
      const res = await revokeApiKey(id);
      applyStateUpdate(res.state);
      pushToast(t('connection.toastKeyRevoked'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOrigins = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const list = originsText
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      const res = await saveOAuthOrigins(list);
      applyStateUpdate(res.state);
      setOriginsText((res.state.auth.allowedRedirectOrigins || []).join('\n'));
      pushToast(t('connection.toastOriginsSaved'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SettingsGroup title={t('connection.authServerGroup')}>
        <form onSubmit={handleSaveServer} class="rounded border border-stroke-card bg-card p-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="input-server-port" class="block text-[14px] text-fg mb-1.5">
                {t('connection.portFieldLabel')}
              </label>
              <TextField
                id="input-server-port"
                type="number"
                mono
                min={1024}
                max={65535}
                value={port}
                onValueChange={setPort}
              />
              <div class="mt-1 text-[12px] text-fg-3">{t('connection.portHint')}</div>
            </div>
            <div>
              <label for="input-server-pin" class="block text-[14px] text-fg mb-1.5">
                {t('connection.pinFieldLabel')}
              </label>
              <div class="flex gap-2">
                <TextField
                  id="input-server-pin"
                  mono
                  minLength={4}
                  maxLength={64}
                  value={pin}
                  onValueChange={setPin}
                />
                <Button onClick={handleRegenPin} disabled={busy}>
                  {t('common.regenerate')}
                </Button>
              </div>
            </div>
          </div>
          <div class="mt-4 flex justify-end">
            <Button type="submit" variant="accent" disabled={busy}>
              {t('connection.saveServerBtn')}
            </Button>
          </div>
        </form>

        <Expander
          title={t('connection.oauthStaticTitle')}
          description={t('connection.oauthStaticDesc')}
        >
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-[13px] text-fg-2">{t('connection.clientIdLabel')}</span>
              <CopyValue value={s.auth.staticClient.client_id} />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-[13px] text-fg-2">{t('connection.clientSecretLabel')}</span>
              <CopyValue
                value={s.auth.staticClient.client_secret}
                secret
                toastMessage={t('connection.secretCopied')}
              />
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button
                onClick={() =>
                  copyToClipboard(
                    `Client ID: ${s.auth.staticClient.client_id}\nClient Secret: ${s.auth.staticClient.client_secret}`,
                    t('connection.bundleCopied'),
                  )
                }
              >
                {t('connection.copyBundle')}
              </Button>
              <Button onClick={() => setConfirmRegen(true)} disabled={busy}>
                {t('connection.regenClientBtn')}
              </Button>
            </div>
          </div>
        </Expander>

        <SettingsCard
          title={t('connection.revokeSessionsBtn', { count: s.auth.activeSessions })}
          action={
            <Button onClick={() => setConfirmRevokeAll(true)} disabled={busy}>
              {t('common.revoke')}
            </Button>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('connection.apiKeysGroup')}>
        {createdKey ? (
          <InfoBar
            severity="caution"
            title={t('connection.newKeyTitle', { name: createdKey.name })}
            message={t('connection.newKeyHint')}
            actions={<CopyValue value={createdKey.token} />}
          />
        ) : null}

        <form onSubmit={handleCreateKey} class="flex gap-2">
          <TextField
            value={keyName}
            onValueChange={setKeyName}
            placeholder={t('connection.apiKeyPlaceholder')}
          />
          <Button type="submit" variant="accent" disabled={busy}>
            {t('connection.generateKeyBtn')}
          </Button>
        </form>

        {s.auth.apiKeys.length === 0 ? (
          <div class="rounded border border-stroke-card bg-card px-4 py-3 text-[13px] text-fg-3">
            {t('connection.apiKeysEmpty')}
          </div>
        ) : (
          s.auth.apiKeys.map((k) => (
            <SettingsCard
              key={k.id}
              icon="key"
              title={k.name}
              description={k.preview}
              descriptionMono
              action={
                <Button onClick={() => handleRevokeKey(k.id)} disabled={busy}>
                  {t('common.revoke')}
                </Button>
              }
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title={t('connection.oauthProvidersGroup')}>
        <SettingsCard
          title={s.auth.builtinProviders.map((p) => p.name).join(' · ') || t('common.none')}
          description={s.auth.builtinProviders.map((p) => p.origin).join(', ')}
          descriptionMono
        />
        <Expander
          title={t('connection.customOriginsTitle')}
          description={t('connection.customOriginsDesc')}
        >
          <form onSubmit={handleSaveOrigins} class="flex flex-col gap-3">
            <textarea
              rows={3}
              value={originsText}
              onInput={(e) => setOriginsText((e.currentTarget as HTMLTextAreaElement).value)}
              placeholder="https://example.com/oauth/callback"
              class="fluent-textarea w-full font-mono"
            />
            <div class="flex justify-end">
              <Button type="submit" variant="accent" disabled={busy}>
                {t('connection.saveOriginsBtn')}
              </Button>
            </div>
          </form>
        </Expander>
      </SettingsGroup>

      <ContentDialog
        open={confirmRegen}
        title={t('connection.regenClientConfirmTitle')}
        onClose={() => setConfirmRegen(false)}
        onConfirm={handleRegenClient}
        confirmLabel={t('common.regenerate')}
      >
        {t('connection.regenClientConfirmBody')}
      </ContentDialog>

      <ContentDialog
        open={confirmRevokeAll}
        title={t('connection.revokeSessionsConfirmTitle')}
        onClose={() => setConfirmRevokeAll(false)}
        onConfirm={handleRevokeAll}
        confirmLabel={t('common.revoke')}
      >
        {t('connection.revokeSessionsConfirmBody')}
      </ContentDialog>
    </div>
  );
}

function SetupSubtab({ state: s }: { state: AdminState }) {
  const [snippetTab, setSnippetTab] = useState<SnippetId>('claude-code');
  const mcpUrl = s.tunnel.mcpUrl || s.tunnel.localMcpUrl || '--';
  const geminiUrl = s.tunnel.geminiMcpUrl || (mcpUrl !== '--' ? `${mcpUrl}/gemini` : '--');
  const snippets = buildSnippets(mcpUrl);

  const hasFixedUrl = Boolean(
    s.tunnelConfig.publicUrl &&
      (s.tunnelConfig.mode === 'tailscale' || s.tunnelConfig.mode === 'cloudflare-named'),
  );

  const checks = [
    {
      label: t('connection.checkLocalServer'),
      ok: true,
      detail: s.tunnel.localMcpUrl || '--',
    },
    {
      label: t('connection.checkPublicTunnel'),
      ok: s.tunnel.status === 'running' && s.tunnel.mode !== 'local',
      detail: s.tunnel.activeUrl || s.tunnel.status,
    },
    {
      label: t('connection.checkFixedUrl'),
      ok: hasFixedUrl,
      detail: s.tunnelConfig.publicUrl || t('connection.checkFixedUrlMissing'),
    },
    {
      label: t('connection.checkAuth'),
      ok: true,
      detail: t('connection.checkAuthDetail', {
        providers: s.auth.builtinProviders.length,
        keys: s.auth.apiKeys.length,
      }),
    },
    {
      label: t('connection.checkOperator'),
      ok: Boolean(s.operator.enabled && s.operator.exists),
      detail: s.operator.serverPath || t('common.none'),
    },
    {
      label: t('connection.checkWorkspace'),
      ok: Boolean(s.workspaces.active),
      detail: s.workspaces.active || '--',
    },
  ];

  const snippetOptions = [
    { value: 'claude-code', label: t('connection.snippetClaudeCode') },
    { value: 'cursor', label: t('connection.snippetCursor') },
    { value: 'vscode', label: t('connection.snippetVscode') },
    { value: 'http', label: t('connection.snippetHttp') },
  ];

  const hintByTab: Record<SnippetId, string> = {
    'claude-code': t('connection.snippetHintClaudeCode'),
    cursor: t('connection.snippetHintCursor'),
    vscode: t('connection.snippetHintVscode'),
    http: t('connection.snippetHintHttp'),
  };

  return (
    <div>
      <SettingsGroup title={t('connection.checklistGroup')}>
        {checks.map((c) => (
          <SettingsCard
            key={c.label}
            title={c.label}
            description={c.detail}
            descriptionMono
            action={
              <StatusGlyph
                severity={c.ok ? 'success' : 'neutral'}
                label={c.ok ? t('common.ready') : t('common.pending')}
              />
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title={t('connection.snippetsGroup')}
        action={
          <div class="flex items-center gap-2">
            <Select
              ariaLabel={t('connection.snippetsGroup')}
              value={snippetTab}
              onValueChange={(v) => setSnippetTab(v as SnippetId)}
              options={snippetOptions}
            />
            <Button
              variant="accent"
              onClick={() => copyToClipboard(snippets[snippetTab], t('connection.snippetCopied'))}
            >
              {t('connection.copyConfigBtn')}
            </Button>
          </div>
        }
      >
        <div class="rounded border border-stroke-card bg-card p-4">
          <div class="mb-2 text-[13px] text-fg-2">{hintByTab[snippetTab]}</div>
          <pre class="overflow-x-auto rounded border border-stroke-card bg-bg p-3 font-mono text-[12px] leading-5 text-fg select-all">
            {snippets[snippetTab]}
          </pre>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('connection.webConnectorsGroup')}>
        <SettingsCard
          icon="globe"
          title={t('home.mcpUrlTitle')}
          action={<CopyValue value={mcpUrl} class="max-w-[460px]" />}
        />
        <SettingsCard
          iconSlot={<BrandIcon name="gemini" size={20} class="text-fg-2" />}
          title={t('home.geminiUrlTitle')}
          action={<CopyValue value={geminiUrl} class="max-w-[460px]" />}
        />
        <SettingsCard
          iconSlot={<BrandIcon name="claude" size={20} class="text-fg-2" />}
          title={t('connection.claudeWebTitle')}
          description={t('connection.claudeWebSteps')}
        />
        <SettingsCard
          iconSlot={<BrandIcon name="gemini" size={20} class="text-fg-2" />}
          title={t('connection.geminiWebTitle')}
          description={t('connection.geminiWebSteps')}
        />
        <SettingsCard
          iconSlot={<BrandIcon name="chatgpt" size={20} class="text-fg-2" />}
          title={t('connection.chatgptWebTitle')}
          description={t('connection.chatgptWebSteps')}
        />
      </SettingsGroup>
    </div>
  );
}
