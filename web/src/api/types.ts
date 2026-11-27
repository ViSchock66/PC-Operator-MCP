export type TunnelMode = 'tailscale' | 'cloudflare-named' | 'cloudflare-quick' | 'local';
export type TunnelStatus = 'running' | 'starting' | 'needs_action' | 'error' | 'stopped';
export type OperatorStatus = 'connected' | 'standby' | 'connecting' | 'missing' | 'error' | 'disabled';
export type Language = 'es' | 'en';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface LogEntry {
  ts?: number | string;
  level?: 'info' | 'ok' | 'warn' | 'error';
  source?: string;
  message: string;
}

export interface TailscaleEnv {
  installed: boolean;
  binaryPath?: string | null;
  online?: boolean;
  dnsName?: string | null;
  tailnetIp?: string | null;
  funnelActive?: boolean;
  suggestedUrl?: string | null;
}

export interface CloudflaredEnv {
  installed: boolean;
  binaryPath?: string | null;
}

export interface TunnelEnv {
  tailscale?: TailscaleEnv;
  cloudflared?: CloudflaredEnv;
}

export interface TunnelState {
  pid?: number;
  uptimeSec?: number;
  status: TunnelStatus;
  mode: TunnelMode;
  activeUrl?: string | null;
  configuredUrl?: string;
  mcpUrl?: string;
  geminiMcpUrl?: string;
  localMcpUrl?: string;
  localGeminiMcpUrl?: string;
  adminUrl?: string;
  actionUrl?: string | null;
  lastError?: string | null;
  startedAt?: string | null;
  env?: TunnelEnv | null;
  logs?: LogEntry[];
}

export interface TunnelConfig {
  mode: TunnelMode;
  publicUrl: string;
  customDomain: string;
  hasCloudflareToken: boolean;
  cloudflareTokenPreview: string;
  autoStart: boolean;
}

export interface ApiKeyMasked {
  id: string;
  name: string;
  preview: string;
  createdAt?: string;
}

export interface BuiltinOAuthProvider {
  name: string;
  origin: string;
}

export interface AuthState {
  pin: string;
  staticClient: {
    client_id: string;
    client_secret: string;
  };
  activeSessions: number;
  builtinProviders: BuiltinOAuthProvider[];
  allowedRedirectOrigins: string[];
  apiKeys: ApiKeyMasked[];
}

export interface OperatorSession {
  sessionKey: string;
  clientLabel: string;
  status: OperatorStatus;
  pid?: number | null;
  activeCalls?: number;
  totalCalls?: number;
  lastUsedAt?: string;
  connectedAt?: string;
}

export interface OperatorState {
  enabled: boolean;
  exists: boolean;
  serverPath: string;
  status: OperatorStatus;
  isolationMode?: string;
  pid?: number | null;
  activeSessionCount: number;
  sessions: OperatorSession[];
  toolCount: number;
  tools?: unknown[];
  connectedAt?: string | null;
  lastError?: string | null;
}

export interface ParallelSession {
  sessionKey: string;
  clientLabel: string;
  activeWorkspace: string;
  workspaceScope: 'session' | 'global' | string;
  lastSeenAt?: string;
  lastTool?: string | null;
  toolCalls?: number;
  operatorStatus: OperatorStatus | string;
  operatorPid?: number | null;
  operatorActiveCalls?: number;
}

export interface FullControlConfig {
  enabled: boolean;
  ttlMinutes: number;
  expiresAt?: string | null;
  remainingSec?: number | null;
  allowUnrestrictedCwd: boolean;
  stopProcessesOnDisable: boolean;
}

export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  cwd: string;
  status: 'running' | 'exited' | string;
  pid?: number | null;
  exitCode?: number | null;
  uptimeSec?: number;
  clientLabel?: string;
  tailPreview?: string;
}

export interface DaemonsState {
  fullControl: FullControlConfig;
  runningCount: number;
  totalCount: number;
  processes: ManagedProcess[];
}

export interface WorkspaceDetail {
  path: string;
  name: string;
  exists: boolean;
  isActive: boolean;
  isGit: boolean;
  gitBranch: string;
  usedBy: string[];
}

export interface WorkspacesState {
  active: string;
  allowed: string[];
  details: WorkspaceDetail[];
}

export interface PermissionsConfig {
  allowWrite: boolean;
  allowDelete: boolean;
  allowCommands: boolean;
  protectSensitiveFiles: boolean;
  filterSensitiveEnv: boolean;
  envAllowlist?: string[];
  envBlocklist?: string[];
  commandTimeoutMs: number;
  maxReadBytes: number;
}

export interface HandoffFileRef {
  path: string;
  op?: string;
}

export interface HandoffTrail {
  trailKey: string;
  sessionKey?: string;
  clientLabel: string;
  activeWorkspace: string;
  workspaceName?: string;
  updatedAt?: string;
  ageMinutes?: number;
  toolCalls?: number;
  lastTool?: string | null;
  lastError?: string | null;
  modifiedFiles?: HandoffFileRef[];
  readFiles?: HandoffFileRef[];
  recentCommands?: Array<{ ok: boolean; command: string }>;
  recentActions?: Array<{ ok: boolean; summary: string }>;
}

export interface HandoffCheckpoint {
  id: string;
  title?: string;
  status: 'pending' | 'resumed' | string;
  createdAt?: string;
  ageMinutes?: number;
  fromClientLabel?: string;
  workspaceName?: string;
  activeWorkspace?: string;
  resumedByClientLabel?: string | null;
  summary?: string;
  notes?: string;
}

export interface HandoffsState {
  checkpointsCount: number;
  trailsCount: number;
  trailsDetailed: HandoffTrail[];
  checkpointsDetailed: HandoffCheckpoint[];
}

export interface ServerInfo {
  pid: number;
  version: string;
  port: number;
  host: string;
  portRestartRequired: boolean;
  platform: string;
}

export interface AdminState {
  server: ServerInfo;
  ui: {
    language: Language;
    theme: ThemePreference;
  };
  auth: AuthState;
  operator: OperatorState;
  parallelSessions: ParallelSession[];
  daemons: DaemonsState;
  handoffs: HandoffsState;
  workspaces: WorkspacesState;
  permissions: PermissionsConfig;
  tunnelConfig: TunnelConfig;
  tunnel: TunnelState;
}
