import { api } from './client';
import type {
  AdminState,
  FullControlConfig,
  Language,
  ManagedProcess,
  ThemePreference,
  TunnelEnv,
  TunnelMode,
} from './types';

export interface StateResponse {
  ok: boolean;
  state: AdminState;
}

export const getState = () => api<AdminState>('/admin/api/state');

export const detectTunnel = (applySuggested = false) =>
  api<{ ok: boolean; env: TunnelEnv; state: AdminState }>('/admin/api/tunnel/detect', {
    method: 'POST',
    body: { applySuggested },
  });

export const startTunnel = () =>
  api<StateResponse>('/admin/api/tunnel/start', { method: 'POST', body: {} });

export const stopTunnel = () =>
  api<StateResponse>('/admin/api/tunnel/stop', { method: 'POST', body: {} });

export const restartTunnel = () =>
  api<StateResponse>('/admin/api/tunnel/restart', { method: 'POST', body: {} });

export interface TunnelConfigPayload {
  mode: TunnelMode;
  publicUrl: string;
  customDomain: string;
  cloudflareToken: string;
  autoStart: boolean;
  applyNow: boolean;
}

export const saveTunnelConfig = (payload: TunnelConfigPayload) =>
  api<StateResponse>('/admin/api/config/tunnel', { method: 'POST', body: payload });

export interface PermissionsPayload {
  allowWrite: boolean;
  allowDelete: boolean;
  allowCommands: boolean;
  protectSensitiveFiles: boolean;
  filterSensitiveEnv: boolean;
  envAllowlist: string;
  envBlocklist: string;
  commandTimeoutMs: number;
  maxReadBytes: number;
}

export const savePermissions = (payload: PermissionsPayload) =>
  api<StateResponse>('/admin/api/config/permissions', { method: 'POST', body: payload });

export interface ServerConfigPayload {
  port?: number;
  pin?: string;
  regeneratePin?: boolean;
  regenerateStaticClient?: boolean;
}

export const saveServerConfig = (payload: ServerConfigPayload) =>
  api<{ ok: boolean; portChanged?: boolean; state: AdminState }>('/admin/api/config/server', {
    method: 'POST',
    body: payload,
  });

export const saveUiConfig = (payload: { language?: Language; theme?: ThemePreference }) =>
  api<{ ok: boolean; ui: { language: Language; theme: ThemePreference }; state: AdminState }>(
    '/admin/api/config/ui',
    { method: 'POST', body: payload },
  );

export const saveOAuthOrigins = (allowedRedirectOrigins: string[]) =>
  api<StateResponse>('/admin/api/config/oauth', {
    method: 'POST',
    body: { allowedRedirectOrigins },
  });

export const createApiKey = (name: string) =>
  api<{
    ok: boolean;
    createdKey: { id: string; name: string; token: string; preview: string };
    state: AdminState;
  }>('/admin/api/auth/api-keys', { method: 'POST', body: { name } });

export const revokeApiKey = (id: string) =>
  api<StateResponse>(`/admin/api/auth/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const revokeAllSessions = () =>
  api<StateResponse>('/admin/api/auth/revoke-all', { method: 'POST', body: {} });

export const saveOperatorConfig = (payload: {
  enabled: boolean;
  serverPath: string;
  connectNow: boolean;
}) => api<StateResponse>('/admin/api/config/operator', { method: 'POST', body: payload });

export const restartOperator = () =>
  api<StateResponse>('/admin/api/operator/restart', { method: 'POST', body: {} });

export const stopOperator = () =>
  api<StateResponse>('/admin/api/operator/stop', { method: 'POST', body: {} });

export const stopOperatorSession = (sessionKey: string) =>
  api<{ ok: boolean; stopped: boolean; state: AdminState }>(
    `/admin/api/operator/sessions/${encodeURIComponent(sessionKey)}/stop`,
    { method: 'POST', body: {} },
  );

export const addWorkspace = (wsPath: string) =>
  api<{ ok: boolean; workspace: string; state: AdminState }>('/admin/api/workspaces/add', {
    method: 'POST',
    body: { path: wsPath },
  });

export const selectWorkspace = (wsPath: string) =>
  api<{ ok: boolean; workspace: string; state: AdminState }>('/admin/api/workspaces/select', {
    method: 'POST',
    body: { path: wsPath },
  });

export const removeWorkspace = (wsPath: string) =>
  api<{ ok: boolean; workspace: string; state: AdminState }>('/admin/api/workspaces/remove', {
    method: 'POST',
    body: { path: wsPath },
  });

export const pickWorkspace = () =>
  api<{ ok: boolean; cancelled?: boolean; workspace?: string; state: AdminState }>(
    '/admin/api/workspaces/pick',
    { method: 'POST', body: {} },
  );

export const openWorkspace = (wsPath: string) =>
  api<{ ok: boolean; opened: string }>('/admin/api/workspaces/open', {
    method: 'POST',
    body: { path: wsPath },
  });

export const resetWorkspaceSessions = () =>
  api<{ ok: boolean; cleared: number; state: AdminState }>('/admin/api/workspaces/reset-sessions', {
    method: 'POST',
    body: {},
  });

export const saveFullControl = (payload: {
  enabled: boolean;
  ttlMinutes: number;
  allowUnrestrictedCwd: boolean;
  stopProcessesOnDisable: boolean;
}) =>
  api<{ ok: boolean; fullControl: FullControlConfig; state: AdminState }>(
    '/admin/api/config/full-control',
    { method: 'POST', body: payload },
  );

export const startProcess = (payload: { command: string; name?: string }) =>
  api<{ ok: boolean; process: ManagedProcess; state: AdminState }>('/admin/api/processes/start', {
    method: 'POST',
    body: payload,
  });

export const getProcessOutput = (id: string, tailLines = 150) =>
  api<{ ok: boolean; output: string }>(
    `/admin/api/processes/${encodeURIComponent(id)}/output?tailLines=${tailLines}`,
  );

export const sendProcessInput = (id: string, input: string) =>
  api<{ ok: boolean; state: AdminState }>(
    `/admin/api/processes/${encodeURIComponent(id)}/input`,
    { method: 'POST', body: { input, appendNewline: true } },
  );

export const stopProcess = (id: string) =>
  api<{ ok: boolean; process: ManagedProcess; state: AdminState }>(
    `/admin/api/processes/${encodeURIComponent(id)}/stop`,
    { method: 'POST', body: {} },
  );

export const stopAllProcesses = () =>
  api<{ ok: boolean; stopped: number; state: AdminState }>('/admin/api/processes/stop-all', {
    method: 'POST',
    body: {},
  });

export const clearExitedProcesses = () =>
  api<{ ok: boolean; removed: number; state: AdminState }>('/admin/api/processes/clear-exited', {
    method: 'POST',
    body: {},
  });

export const freezeHandoff = (trailKey: string, notes: string) =>
  api<{ ok: boolean; prompt?: string; state: AdminState }>('/admin/api/handoffs/freeze', {
    method: 'POST',
    body: { trailKey, notes },
  });

export const getHandoffPrompt = (target: { trailKey?: string; id?: string }) =>
  api<{ ok: boolean; prompt: string }>('/admin/api/handoffs/prompt', {
    method: 'POST',
    body: target,
  });

export const deleteHandoff = (payload: {
  action?: 'clear_resumed' | 'clear_all_trails';
  trailKey?: string;
  id?: string;
}) =>
  api<{
    ok: boolean;
    removed: boolean;
    pruned?: { removedCheckpoints?: number; removedTrails?: number } | null;
    state: AdminState;
  }>('/admin/api/handoffs/delete', { method: 'POST', body: payload });

export const clearLogs = () =>
  api<{ ok: boolean }>('/admin/api/logs/clear', { method: 'POST', body: {} });

export const shutdownDaemon = () =>
  api<{ ok: boolean }>('/admin/api/daemon/shutdown', { method: 'POST', body: {} });

export const logoutAdmin = async () => {
  const res = await fetch('/admin/logout', { method: 'POST' });
  if (res.redirected) {
    window.location.href = res.url;
  } else {
    window.location.reload();
  }
};
