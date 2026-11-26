import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWriteFileSync } from './config.js';

const execFileAsync = promisify(execFile);

const MAX_RECENT_ACTIONS = 25;
const MAX_MODIFIED_FILES = 25;
const MAX_READ_FILES = 15;
const MAX_RECENT_COMMANDS = 10;
const MAX_CHECKPOINTS = 25;
const MAX_TRAILS = 30;
const RECENT_DISAMBIGUATION_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Read-only discovery / plumbing tools that shouldn't pollute work trails or overwrite lastTool.
const HANDOFF_IGNORED_TOOLS = new Set([
  'handoff_resume',
  'handoff_list',
  'handoff_save',
  'workspace_info',
  'list_workspaces',
  'select_workspace',
  'list_dir',
  'process_list',
  'use_skill'
]);

const MUTATING_FILE_OPS = new Set(['write', 'edit', 'move', 'delete']);

export function redactSecrets(input) {
  return String(input ?? '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(gp_key_|sk-|ghp_|gho_|github_pat_|AIza)[A-Za-z0-9._-]{8,}/g, '$1[REDACTED]')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client_secret)\s*[:=]\s*)(["']?)[^\s"'`&;|]+(\2)/gi, '$1$2[REDACTED]$3');
}

function truncateStr(val, maxLen = 220) {
  const s = String(val ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function safeRedactTruncate(val, maxLen = 220) {
  return truncateStr(redactSecrets(val), maxLen);
}

function normalizeList(input, maxItems = 20) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => safeRedactTruncate(item, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeWorkspaceKey(workspacePath) {
  return String(workspacePath || '').trim().replace(/[\\/]+$/, '').toLowerCase();
}

export function makeTrailKey(sessionKey, workspacePath) {
  const cleanSess = String(sessionKey || 'default').trim() || 'default';
  const normWs = normalizeWorkspaceKey(workspacePath);
  const hash = crypto.createHash('sha1').update(normWs || 'default').digest('hex').slice(0, 8);
  return `${cleanSess}::${hash}`;
}

function computeAgeMinutes(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 60000));
}

function matchesWorkspaceFilter(workspacePath, filter) {
  const q = String(filter || '').trim().toLowerCase();
  if (!q) return true;
  const full = normalizeWorkspaceKey(workspacePath);
  const base = path.basename(workspacePath || '').toLowerCase();
  return full === q || base === q || full.includes(q);
}

function matchesClientFilter(clientLabel, sessionKey, filter) {
  const q = String(filter || '').trim().toLowerCase();
  if (!q) return true;
  return String(clientLabel || '').toLowerCase().includes(q)
    || String(sessionKey || '').toLowerCase().includes(q);
}

function summarizeToolArgs(toolName, args = {}) {
  const safe = args && typeof args === 'object' ? args : {};
  switch (toolName) {
    case 'read_file':
      return {
        target: safe.path || '',
        fileOp: 'read',
        summary: safe.renderPages
          ? `read_file(${safe.path || '?'}, renderPages=true${safe.pages ? `, pages=${safe.pages}` : ''})`
          : `read_file(${safe.path || '?'}${safe.startLine ? `:${safe.startLine}-${safe.endLine || ''}` : ''})`
      };
    case 'read_files': {
      const paths = Array.isArray(safe.paths) ? safe.paths : [];
      return {
        target: paths.join(', '),
        fileOps: paths.map((p) => ({ path: String(p), op: 'read' })),
        summary: `read_files(${paths.length} archivos: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? '…' : ''})`
      };
    }
    case 'write_file':
      return {
        target: safe.path || '',
        fileOp: 'write',
        summary: `write_file(${safe.path || '?'}, ${Buffer.byteLength(String(safe.content || ''), 'utf8')}B${safe.append ? ', append' : ''})`
      };
    case 'edit_file':
      return {
        target: safe.path || '',
        fileOp: 'edit',
        summary: `edit_file(${safe.path || '?'}${safe.replaceAll ? ', replaceAll' : ''})`
      };
    case 'move_path':
      return {
        target: `${safe.source || '?'} -> ${safe.destination || '?'}`,
        fileOp: 'move',
        filePath: safe.destination || safe.source || '',
        summary: `move_path(${safe.source || '?'} -> ${safe.destination || '?'})`
      };
    case 'delete_path':
      return {
        target: safe.path || '',
        fileOp: 'delete',
        summary: `delete_path(${safe.path || '?'}${safe.recursive ? ', recursive' : ''})`
      };
    case 'run_command': {
      const cmd = safeRedactTruncate(safe.command || '', 240);
      return {
        target: truncateStr(cmd, 180),
        command: cmd,
        cwd: safe.cwd || '.',
        summary: `run_command("${truncateStr(cmd, 120)}"${safe.cwd && safe.cwd !== '.' ? ` en ${safe.cwd}` : ''})`
      };
    }
    case 'find_files':
      return {
        target: safe.pattern || '*',
        summary: `find_files(${safe.pattern || '*'} en ${safe.path || '.'})`
      };
    case 'search_text': {
      const q = safeRedactTruncate(safe.query || '', 100);
      return {
        target: q,
        summary: `search_text("${truncateStr(q, 80)}")`
      };
    }
    case 'git_harness':
      return {
        target: safe.action || 'status',
        summary: `git_harness(${safe.action || 'status'}${safe.path ? `, ${safe.path}` : ''})`
      };
    case 'process_start': {
      const cmd = safeRedactTruncate(safe.command || '', 240);
      return {
        target: safeRedactTruncate(safe.name || cmd, 160),
        command: cmd,
        cwd: safe.cwd || '.',
        summary: `process_start("${truncateStr(cmd, 120)}")`
      };
    }
    case 'process_send': {
      const inp = safeRedactTruncate(safe.input || '', 80);
      return {
        target: safe.id || '',
        summary: `process_send(${safe.id || '?'}, "${truncateStr(inp, 60)}")`
      };
    }
    case 'process_stop':
      return {
        target: safe.id || '',
        summary: `process_stop(${safe.id || '?'})`
      };
    default: {
      const interesting = safe.url || safe.path || safe.tab_id || safe.hwnd || safe.title || '';
      const clean = safeRedactTruncate(interesting, 160);
      return {
        target: clean,
        summary: clean ? `${toolName}(${truncateStr(clean, 100)})` : toolName
      };
    }
  }
}

async function readGitSnapshot(workspacePath) {
  if (!workspacePath || !fs.existsSync(path.join(workspacePath, '.git'))) {
    return null;
  }
  try {
    const [branchOut, statusOut, diffStatOut] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath, timeout: 3000 }),
      execFileAsync('git', ['status', '--short'], { cwd: workspacePath, timeout: 3000 }),
      execFileAsync('git', ['diff', '--stat'], { cwd: workspacePath, timeout: 3000 }).catch(() => ({ stdout: '' }))
    ]);
    const statusLines = statusOut.stdout.trim() ? statusOut.stdout.trim().split(/\r?\n/) : [];
    const diffStatLines = diffStatOut.stdout.trim() ? diffStatOut.stdout.trim().split(/\r?\n/) : [];
    return {
      branch: branchOut.stdout.trim(),
      dirtyCount: statusLines.length,
      statusPreview: statusLines.slice(0, 25),
      diffStat: diffStatLines.slice(0, 20)
    };
  } catch {
    return null;
  }
}

/**
 * Persists automatic work trails partitioned by (sessionKey, activeWorkspace) and
 * explicit cross-model checkpoints to disk (`data/handoffs.json`).
 *
 * Strictly pull-only: never injects hints or state into unrelated chats automatically.
 */
export class HandoffManager {
  constructor({ dataDir, configManager, processManager = null, logger = null } = {}) {
    this.configManager = configManager;
    this.processManager = processManager;
    this.logger = logger;
    const resolvedDataDir = dataDir || configManager?.dataDir;
    this.stateFile = resolvedDataDir ? path.join(path.resolve(resolvedDataDir), 'handoffs.json') : null;
    this.state = this.#load();
  }

  #load() {
    if (this.stateFile && fs.existsSync(this.stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        const checkpoints = Array.isArray(parsed?.checkpoints) ? parsed.checkpoints : [];
        let trails = {};

        if (parsed?.trails && typeof parsed.trails === 'object') {
          trails = parsed.trails;
        } else if (parsed?.sessions && typeof parsed.sessions === 'object') {
          // Migrate legacy v1 `sessions` structure transparently into workspace-partitioned `trails`.
          for (const legacy of Object.values(parsed.sessions)) {
            if (!legacy || typeof legacy !== 'object') continue;
            const ws = String(legacy.activeWorkspace || '');
            const tKey = makeTrailKey(legacy.sessionKey, ws);
            const touched = Array.isArray(legacy.touchedFiles) ? legacy.touchedFiles : [];
            trails[tKey] = {
              trailKey: tKey,
              sessionKey: String(legacy.sessionKey || 'default'),
              clientLabel: String(legacy.clientLabel || legacy.sessionKey || 'MCP'),
              activeWorkspace: ws,
              workspaceName: ws ? path.basename(ws) : '',
              createdAt: legacy.createdAt || legacy.updatedAt || new Date().toISOString(),
              updatedAt: legacy.updatedAt || new Date().toISOString(),
              toolCalls: Number(legacy.toolCalls || 0),
              lastTool: legacy.lastTool || null,
              lastError: legacy.lastError ? safeRedactTruncate(legacy.lastError, 260) : null,
              modifiedFiles: touched.filter((f) => MUTATING_FILE_OPS.has(f.op)).slice(0, MAX_MODIFIED_FILES),
              readFiles: touched.filter((f) => !MUTATING_FILE_OPS.has(f.op)).slice(0, MAX_READ_FILES),
              recentCommands: Array.isArray(legacy.recentCommands) ? legacy.recentCommands.slice(0, MAX_RECENT_COMMANDS) : [],
              recentActions: Array.isArray(legacy.recentActions) ? legacy.recentActions.slice(0, MAX_RECENT_ACTIONS) : []
            };
          }
        }

        return { version: 2, trails, checkpoints };
      } catch {
        // Fall through to clean state on corrupt JSON.
      }
    }
    return { version: 2, trails: {}, checkpoints: [] };
  }

  #save() {
    if (!this.stateFile) return;
    const entries = Object.entries(this.state.trails || {});
    if (entries.length > MAX_TRAILS) {
      entries.sort((a, b) => String(b[1]?.updatedAt || '').localeCompare(String(a[1]?.updatedAt || '')));
      this.state.trails = Object.fromEntries(entries.slice(0, MAX_TRAILS));
    }
    if (this.state.checkpoints.length > MAX_CHECKPOINTS) {
      this.state.checkpoints = this.state.checkpoints.slice(0, MAX_CHECKPOINTS);
    }
    atomicWriteFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  #ensureTrail(sessionKey, { clientLabel, activeWorkspace } = {}) {
    const cleanSess = String(sessionKey || 'default');
    const ws = String(activeWorkspace || this.configManager?.get?.().activeWorkspace || '');
    const tKey = makeTrailKey(cleanSess, ws);
    let rec = this.state.trails[tKey];
    const now = new Date().toISOString();

    if (!rec) {
      rec = {
        trailKey: tKey,
        sessionKey: cleanSess,
        clientLabel: clientLabel || cleanSess,
        activeWorkspace: ws,
        workspaceName: ws ? path.basename(ws) : '',
        createdAt: now,
        updatedAt: now,
        toolCalls: 0,
        lastTool: null,
        lastError: null,
        modifiedFiles: [],
        readFiles: [],
        recentCommands: [],
        recentActions: []
      };
      this.state.trails[tKey] = rec;
    }

    if (clientLabel && clientLabel !== 'MCP') {
      rec.clientLabel = String(clientLabel);
    }
    if (ws) {
      rec.activeWorkspace = ws;
      rec.workspaceName = path.basename(ws);
    }
    rec.updatedAt = now;
    return rec;
  }

  #recordFileOp(rec, filePath, op, ok, ts) {
    const clean = String(filePath || '').trim();
    if (!clean) return;
    if (MUTATING_FILE_OPS.has(op)) {
      rec.modifiedFiles = [
        { path: clean, op, ok: Boolean(ok), ts },
        ...(rec.modifiedFiles || []).filter((f) => f.path !== clean)
      ].slice(0, MAX_MODIFIED_FILES);
    } else {
      rec.readFiles = [
        { path: clean, op, ok: Boolean(ok), ts },
        ...(rec.readFiles || []).filter((f) => f.path !== clean)
      ].slice(0, MAX_READ_FILES);
    }
  }

  /**
   * Silently records real work tool calls to disk, partitioned by (sessionKey, activeWorkspace),
   * with secret redaction. Never injects anything into tool responses.
   */
  recordToolCall({ sessionKey, clientLabel, activeWorkspace, tool, args, ok, durationMs, error } = {}) {
    if (!tool || HANDOFF_IGNORED_TOOLS.has(tool)) {
      return null;
    }

    const ts = new Date().toISOString();
    const rec = this.#ensureTrail(sessionKey, { clientLabel, activeWorkspace });
    const meta = summarizeToolArgs(tool, args);
    const cleanError = ok ? null : safeRedactTruncate(error || 'Error desconocido', 260);

    rec.toolCalls = Number(rec.toolCalls || 0) + 1;
    rec.lastTool = tool;
    rec.lastError = cleanError;
    rec.updatedAt = ts;

    if (meta.fileOp) {
      this.#recordFileOp(rec, meta.filePath || meta.target, meta.fileOp, ok, ts);
    } else if (Array.isArray(meta.fileOps)) {
      for (const fo of meta.fileOps) {
        this.#recordFileOp(rec, fo.path, fo.op, ok, ts);
      }
    }

    if (meta.command) {
      rec.recentCommands = [
        {
          command: meta.command,
          cwd: meta.cwd || '.',
          ok: Boolean(ok),
          ts,
          ...(ok ? {} : { error: safeRedactTruncate(error || '', 200) })
        },
        ...(rec.recentCommands || [])
      ].slice(0, MAX_RECENT_COMMANDS);
    }

    rec.recentActions = [
      {
        ts,
        tool,
        ok: Boolean(ok),
        durationMs: Number(durationMs || 0),
        summary: meta.summary,
        ...(meta.target ? { target: meta.target } : {}),
        ...(ok ? {} : { error: safeRedactTruncate(error || '', 220) })
      },
      ...(rec.recentActions || [])
    ].slice(0, MAX_RECENT_ACTIONS);

    this.#save();
    return rec;
  }

  #getRunningProcessesSummary(workspacePath = '') {
    if (!this.processManager || typeof this.processManager.listProcesses !== 'function') {
      return [];
    }
    try {
      const res = this.processManager.listProcesses({ includeExited: false });
      const normWs = normalizeWorkspaceKey(workspacePath);
      return (res?.processes || [])
        .map((p) => ({
          id: p.id,
          name: p.name,
          command: safeRedactTruncate(p.command, 200),
          cwd: p.cwd,
          pid: p.pid,
          status: p.status,
          sessionKey: p.sessionKey,
          clientLabel: p.clientLabel,
          inWorkspace: Boolean(normWs && normalizeWorkspaceKey(p.cwd).startsWith(normWs))
        }))
        .sort((a, b) => Number(b.inWorkspace) - Number(a.inWorkspace));
    } catch {
      return [];
    }
  }

  #findTrailByKeyOrSession({ trailKey, sourceSessionKey, activeWorkspace }) {
    if (trailKey && this.state.trails[String(trailKey)]) {
      return this.state.trails[String(trailKey)];
    }
    if (sourceSessionKey && activeWorkspace) {
      const exactKey = makeTrailKey(sourceSessionKey, activeWorkspace);
      if (this.state.trails[exactKey]) return this.state.trails[exactKey];
    }
    if (sourceSessionKey) {
      const matches = Object.values(this.state.trails || {})
        .filter((t) => t.sessionKey === String(sourceSessionKey))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return matches[0] || null;
    }
    return null;
  }

  /**
   * Saves an explicit handoff checkpoint (requested by user via `handoff_save` or
   * frozen from `/admin` with an optional quick human note).
   */
  saveCheckpoint({
    sessionKey = 'local-admin',
    clientLabel = 'Panel Admin',
    activeWorkspace = '',
    trailKey = '',
    sourceSessionKey = null,
    title = '',
    summary = '',
    currentGoal = '',
    completedSteps = [],
    pendingTasks = [],
    relevantFiles = [],
    notes = '',
    targetClient = ''
  } = {}) {
    const trail = this.#findTrailByKeyOrSession({
      trailKey,
      sourceSessionKey: sourceSessionKey || sessionKey,
      activeWorkspace
    });

    const ws = activeWorkspace || trail?.activeWorkspace || this.configManager?.get?.().activeWorkspace || '';
    const wsName = ws ? path.basename(ws) : '';
    const now = new Date().toISOString();

    const cleanSummary = safeRedactTruncate(summary, 2000);
    const cleanGoal = safeRedactTruncate(currentGoal, 500);
    const cleanNotes = safeRedactTruncate(notes, 1500);
    const cleanTitle = safeRedactTruncate(title, 160)
      || cleanGoal
      || (cleanNotes ? truncateStr(cleanNotes, 90) : '')
      || (trail ? `Relevo ${trail.clientLabel} · ${wsName || trail.lastTool || 'sesión'}` : `Relevo ${wsName || 'sesión'}`);

    const resolvedFromSession = trail?.sessionKey || String(sourceSessionKey || sessionKey || 'default');
    const resolvedFromClient = trail?.clientLabel || String(clientLabel || 'MCP');
    const resolvedTrailKey = trail?.trailKey || makeTrailKey(resolvedFromSession, ws);

    const checkpoint = {
      id: `hoff_${crypto.randomBytes(4).toString('hex')}`,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      fromTrailKey: resolvedTrailKey,
      fromSessionKey: resolvedFromSession,
      fromClientLabel: resolvedFromClient,
      targetClient: truncateStr(targetClient, 80),
      activeWorkspace: ws,
      workspaceName: wsName,
      title: cleanTitle,
      summary: cleanSummary,
      currentGoal: cleanGoal,
      completedSteps: normalizeList(completedSteps, 20),
      pendingTasks: normalizeList(pendingTasks, 20),
      relevantFiles: normalizeList(relevantFiles, 30),
      notes: cleanNotes,
      autoTrailSnapshot: trail
        ? {
            trailKey: trail.trailKey,
            toolCalls: trail.toolCalls,
            lastTool: trail.lastTool,
            lastError: trail.lastError,
            updatedAt: trail.updatedAt,
            modifiedFiles: (trail.modifiedFiles || []).slice(0, 15),
            readFiles: (trail.readFiles || []).slice(0, 10),
            recentCommands: (trail.recentCommands || []).slice(0, 8),
            recentActions: (trail.recentActions || []).slice(0, 15)
          }
        : null,
      runningProcesses: this.#getRunningProcessesSummary(ws),
      resumedAt: null,
      resumedBySessionKey: null,
      resumedByClientLabel: null
    };

    this.state.checkpoints = [checkpoint, ...(this.state.checkpoints || [])].slice(0, MAX_CHECKPOINTS);
    this.#save();
    this.logger?.('info', 'handoff', `Checkpoint guardado: ${checkpoint.id} (${checkpoint.fromClientLabel} · ${wsName || '?'}) -> ${checkpoint.title}`);
    return checkpoint;
  }

  listHandoffs({ includeResumed = true, workspace = '' } = {}) {
    const checkpoints = (this.state.checkpoints || [])
      .filter((c) => (includeResumed || c.status === 'pending') && matchesWorkspaceFilter(c.activeWorkspace, workspace))
      .map((c) => ({
        id: c.id,
        status: c.status,
        title: c.title,
        fromTrailKey: c.fromTrailKey || makeTrailKey(c.fromSessionKey, c.activeWorkspace),
        fromSessionKey: c.fromSessionKey,
        fromClientLabel: c.fromClientLabel,
        targetClient: c.targetClient || null,
        activeWorkspace: c.activeWorkspace,
        workspaceName: c.workspaceName || path.basename(c.activeWorkspace || ''),
        createdAt: c.createdAt,
        ageMinutes: computeAgeMinutes(c.createdAt),
        resumedAt: c.resumedAt,
        resumedByClientLabel: c.resumedByClientLabel,
        summaryPreview: truncateStr(c.summary || c.notes || c.currentGoal || '', 180)
      }));

    const trails = Object.values(this.state.trails || {})
      .filter((t) => Number(t.toolCalls || 0) > 0 && matchesWorkspaceFilter(t.activeWorkspace, workspace))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .map((t) => ({
        trailKey: t.trailKey,
        sessionKey: t.sessionKey,
        clientLabel: t.clientLabel,
        activeWorkspace: t.activeWorkspace,
        workspaceName: t.workspaceName || path.basename(t.activeWorkspace || ''),
        updatedAt: t.updatedAt,
        ageMinutes: computeAgeMinutes(t.updatedAt),
        toolCalls: t.toolCalls,
        lastTool: t.lastTool,
        lastError: t.lastError,
        modifiedFilesCount: (t.modifiedFiles || []).length,
        readFilesCount: (t.readFiles || []).length,
        recentCommandsCount: (t.recentCommands || []).length
      }));

    return {
      checkpointsCount: checkpoints.length,
      trailsCount: trails.length,
      checkpoints,
      trails
    };
  }

  /**
   * Resumes a handoff strictly on explicit user request.
   *
   * Guarantees:
   * - Never mixes a checkpoint from one (session, workspace) with a trail from another.
   * - Never guesses blindly or changes workspace if multiple distinct recent workspaces
   *   are ambiguous; returns `needsSelection: true` with candidates instead.
   */
  async resumeHandoff({
    id = '',
    trailKey = '',
    sessionKey: targetSessionKey = '',
    workspace = '',
    fromClient = '',
    currentSessionKey = 'default',
    currentClientLabel = 'MCP',
    harness = null,
    autoSelectWorkspace = true,
    consume = true
  } = {}) {
    const cleanId = String(id || '').trim();
    const cleanTrailKey = String(trailKey || '').trim();
    const cleanSessionKey = String(targetSessionKey || '').trim();
    const cleanWorkspace = String(workspace || '').trim();
    const cleanClient = String(fromClient || '').trim();

    let checkpoint = null;
    let sourceTrail = null;

    if (cleanId) {
      checkpoint = (this.state.checkpoints || []).find((c) => c.id === cleanId) || null;
      if (!checkpoint) {
        throw new Error(`No se encontró el checkpoint "${cleanId}". Usa handoff_list() para ver disponibles.`);
      }
      // Strictly attach ONLY the matching (fromSessionKey, activeWorkspace) trail — never another project/session.
      const exactKey = checkpoint.fromTrailKey || makeTrailKey(checkpoint.fromSessionKey, checkpoint.activeWorkspace);
      const candidateTrail = this.state.trails[exactKey] || null;
      if (
        candidateTrail
        && candidateTrail.sessionKey === checkpoint.fromSessionKey
        && normalizeWorkspaceKey(candidateTrail.activeWorkspace) === normalizeWorkspaceKey(checkpoint.activeWorkspace)
      ) {
        sourceTrail = candidateTrail;
      }
    } else if (cleanTrailKey) {
      sourceTrail = this.state.trails[cleanTrailKey] || null;
      if (!sourceTrail) {
        throw new Error(`No se encontró rastro automático para trailKey "${cleanTrailKey}".`);
      }
      checkpoint = (this.state.checkpoints || []).find(
        (c) => c.status === 'pending'
          && c.fromSessionKey === sourceTrail.sessionKey
          && normalizeWorkspaceKey(c.activeWorkspace) === normalizeWorkspaceKey(sourceTrail.activeWorkspace)
      ) || null;
    } else if (cleanSessionKey || cleanWorkspace || cleanClient) {
      // Filtered lookup: match checkpoints first, then trails
      const matchingCheckpoints = (this.state.checkpoints || []).filter(
        (c) => c.status === 'pending'
          && (!cleanSessionKey || c.fromSessionKey === cleanSessionKey)
          && matchesWorkspaceFilter(c.activeWorkspace, cleanWorkspace)
          && matchesClientFilter(c.fromClientLabel, c.fromSessionKey, cleanClient)
      );
      const matchingTrails = Object.values(this.state.trails || {})
        .filter(
          (t) => Number(t.toolCalls || 0) > 0
            && (!cleanSessionKey || t.sessionKey === cleanSessionKey)
            && matchesWorkspaceFilter(t.activeWorkspace, cleanWorkspace)
            && matchesClientFilter(t.clientLabel, t.sessionKey, cleanClient)
        )
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

      if (matchingCheckpoints.length > 0) {
        const distinctWs = new Set(matchingCheckpoints.map((c) => normalizeWorkspaceKey(c.activeWorkspace)));
        if (distinctWs.size > 1) {
          return {
            found: false,
            needsSelection: true,
            reason: 'multiple_matching_checkpoints',
            message: 'Hay varios checkpoints pendientes en workspaces distintos que coinciden con el filtro. Pregunta al usuario cuál retomar o pasa id/workspace.',
            candidates: matchingCheckpoints.slice(0, 8).map((c) => ({
              type: 'checkpoint',
              id: c.id,
              title: c.title,
              fromClientLabel: c.fromClientLabel,
              activeWorkspace: c.activeWorkspace,
              workspaceName: c.workspaceName,
              ageMinutes: computeAgeMinutes(c.createdAt)
            }))
          };
        }
        checkpoint = matchingCheckpoints[0];
        const exactKey = checkpoint.fromTrailKey || makeTrailKey(checkpoint.fromSessionKey, checkpoint.activeWorkspace);
        sourceTrail = this.state.trails[exactKey] || null;
      } else if (matchingTrails.length > 0) {
        const distinctWs = new Set(matchingTrails.map((t) => normalizeWorkspaceKey(t.activeWorkspace)));
        if (distinctWs.size > 1) {
          return {
            found: false,
            needsSelection: true,
            reason: 'multiple_matching_trails',
            message: 'Hay actividad reciente en varios workspaces distintos que coinciden con el filtro. Pregunta al usuario cuál retomar o pasa trailKey/workspace.',
            candidates: matchingTrails.slice(0, 8).map((t) => ({
              type: 'trail',
              trailKey: t.trailKey,
              clientLabel: t.clientLabel,
              activeWorkspace: t.activeWorkspace,
              workspaceName: t.workspaceName,
              lastTool: t.lastTool,
              ageMinutes: computeAgeMinutes(t.updatedAt)
            }))
          };
        }
        sourceTrail = matchingTrails[0];
      }
    } else {
      // Unfiltered auto-select: safe disambiguation — NEVER mix or guess across unrelated workspaces.
      const pending = (this.state.checkpoints || []).filter((c) => c.status === 'pending');
      if (pending.length > 0) {
        const distinctWs = new Set(pending.map((c) => normalizeWorkspaceKey(c.activeWorkspace)));
        if (distinctWs.size > 1) {
          return {
            found: false,
            needsSelection: true,
            reason: 'multiple_pending_checkpoints',
            message: 'Hay checkpoints pendientes en varios proyectos distintos. No se cambió el workspace; pide al usuario confirmar cuál retomar y llama handoff_resume({ id }).',
            candidates: pending.slice(0, 8).map((c) => ({
              type: 'checkpoint',
              id: c.id,
              title: c.title,
              fromClientLabel: c.fromClientLabel,
              activeWorkspace: c.activeWorkspace,
              workspaceName: c.workspaceName,
              ageMinutes: computeAgeMinutes(c.createdAt)
            }))
          };
        }
        checkpoint = pending[0];
        const exactKey = checkpoint.fromTrailKey || makeTrailKey(checkpoint.fromSessionKey, checkpoint.activeWorkspace);
        const matchingTrail = this.state.trails[exactKey] || null;
        if (
          matchingTrail
          && matchingTrail.sessionKey === checkpoint.fromSessionKey
          && normalizeWorkspaceKey(matchingTrail.activeWorkspace) === normalizeWorkspaceKey(checkpoint.activeWorkspace)
        ) {
          sourceTrail = matchingTrail;
        }
      } else {
        const allTrails = Object.values(this.state.trails || {})
          .filter((t) => Number(t.toolCalls || 0) > 0)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const otherTrails = allTrails.filter((t) => t.sessionKey !== currentSessionKey);
        const pool = otherTrails.length > 0 ? otherTrails : allTrails;

        const nowMs = Date.now();
        const recentPool = pool.filter((t) => {
          const ts = Date.parse(t.updatedAt || '');
          return Number.isFinite(ts) && (nowMs - ts) <= RECENT_DISAMBIGUATION_WINDOW_MS;
        });
        const activePool = recentPool.length > 0 ? recentPool : pool;

        const distinctWs = new Set(activePool.map((t) => normalizeWorkspaceKey(t.activeWorkspace)));
        if (distinctWs.size > 1) {
          return {
            found: false,
            needsSelection: true,
            reason: 'multiple_active_trails',
            message: 'Hay rastros recientes en varios proyectos distintos. No se cambió el workspace; pregunta al usuario cuál retomar y llama handoff_resume({ trailKey }) o handoff_resume({ workspace }).',
            candidates: activePool.slice(0, 8).map((t) => ({
              type: 'trail',
              trailKey: t.trailKey,
              clientLabel: t.clientLabel,
              activeWorkspace: t.activeWorkspace,
              workspaceName: t.workspaceName,
              lastTool: t.lastTool,
              modifiedFiles: (t.modifiedFiles || []).slice(0, 4).map((f) => f.path),
              ageMinutes: computeAgeMinutes(t.updatedAt)
            }))
          };
        }

        if (activePool.length > 0) {
          sourceTrail = activePool[0];
        } else {
          checkpoint = (this.state.checkpoints || [])[0] || null;
        }
      }
    }

    if (!checkpoint && !sourceTrail) {
      return {
        found: false,
        message: 'No hay checkpoints ni actividad previa que coincida con tu solicitud.'
      };
    }

    const targetWorkspace = checkpoint?.activeWorkspace || sourceTrail?.activeWorkspace || '';

    let workspaceAligned = false;
    let workspaceAlignmentNote = '';
    if (autoSelectWorkspace && targetWorkspace && harness && typeof harness.selectWorkspace === 'function') {
      try {
        harness.selectWorkspace(targetWorkspace);
        workspaceAligned = true;
        workspaceAlignmentNote = `Workspace de tu sesión alineado a: ${targetWorkspace}`;
      } catch (err) {
        workspaceAlignmentNote = `No se pudo alinear automáticamente el workspace (${err.message}).`;
      }
    }

    if (consume && checkpoint && checkpoint.status === 'pending') {
      checkpoint.status = 'resumed';
      checkpoint.resumedAt = new Date().toISOString();
      checkpoint.resumedBySessionKey = String(currentSessionKey || 'default');
      checkpoint.resumedByClientLabel = String(currentClientLabel || 'MCP');
      checkpoint.updatedAt = checkpoint.resumedAt;
      this.#save();
    }

    const effectiveWorkspace = targetWorkspace || harness?.getActiveRoot?.() || '';
    const git = await readGitSnapshot(effectiveWorkspace);
    const runningProcesses = this.#getRunningProcessesSummary(effectiveWorkspace);

    const liveAutoTrail = sourceTrail
      ? {
          trailKey: sourceTrail.trailKey,
          sessionKey: sourceTrail.sessionKey,
          clientLabel: sourceTrail.clientLabel,
          activeWorkspace: sourceTrail.activeWorkspace,
          workspaceName: sourceTrail.workspaceName,
          updatedAt: sourceTrail.updatedAt,
          ageMinutes: computeAgeMinutes(sourceTrail.updatedAt),
          toolCalls: sourceTrail.toolCalls,
          lastTool: sourceTrail.lastTool,
          lastError: sourceTrail.lastError,
          modifiedFiles: sourceTrail.modifiedFiles || [],
          readFiles: sourceTrail.readFiles || [],
          recentCommands: sourceTrail.recentCommands || [],
          recentActions: sourceTrail.recentActions || []
        }
      : null;

    this.logger?.(
      'ok',
      'handoff',
      `[${currentClientLabel}] retomó handoff${checkpoint ? ` ${checkpoint.id}` : ''} (origen: ${checkpoint?.fromClientLabel || sourceTrail?.clientLabel || '?'} · ${path.basename(effectiveWorkspace || '') || '?'})`
    );

    return {
      found: true,
      mode: checkpoint && liveAutoTrail
        ? 'checkpoint+auto_trail'
        : (checkpoint ? 'checkpoint' : 'auto_trail_only'),
      workspaceAligned,
      workspaceAlignmentNote,
      activeWorkspace: effectiveWorkspace,
      checkpoint: checkpoint
        ? {
            id: checkpoint.id,
            title: checkpoint.title,
            fromClientLabel: checkpoint.fromClientLabel,
            fromSessionKey: checkpoint.fromSessionKey,
            createdAt: checkpoint.createdAt,
            ageMinutes: computeAgeMinutes(checkpoint.createdAt),
            summary: checkpoint.summary,
            currentGoal: checkpoint.currentGoal,
            completedSteps: checkpoint.completedSteps,
            pendingTasks: checkpoint.pendingTasks,
            relevantFiles: checkpoint.relevantFiles,
            notes: checkpoint.notes,
            autoTrailSnapshot: checkpoint.autoTrailSnapshot
          }
        : null,
      liveAutoTrail,
      git,
      runningProcesses
    };
  }

  deleteCheckpoint(id) {
    const cleanId = String(id || '').trim();
    const before = this.state.checkpoints.length;
    this.state.checkpoints = this.state.checkpoints.filter((c) => c.id !== cleanId);
    if (this.state.checkpoints.length === before) return false;
    this.#save();
    return true;
  }

  clearTrail(trailKey) {
    const key = String(trailKey || '').trim();
    if (!key) return false;
    if (this.state.trails[key]) {
      delete this.state.trails[key];
      this.#save();
      return true;
    }
    // Fallback: if a legacy sessionKey was passed, remove all trails for that sessionKey
    const matchingKeys = Object.keys(this.state.trails || {}).filter(
      (k) => this.state.trails[k]?.sessionKey === key
    );
    if (matchingKeys.length === 0) return false;
    for (const k of matchingKeys) delete this.state.trails[k];
    this.#save();
    return true;
  }

  prune({ clearResumed = false, clearAllTrails = false, olderThanHours = 0 } = {}) {
    let removedCheckpoints = 0;
    let removedTrails = 0;

    if (clearResumed) {
      const before = this.state.checkpoints.length;
      this.state.checkpoints = this.state.checkpoints.filter((c) => c.status !== 'resumed');
      removedCheckpoints += before - this.state.checkpoints.length;
    }

    if (clearAllTrails) {
      removedTrails += Object.keys(this.state.trails || {}).length;
      this.state.trails = {};
    } else if (Number(olderThanHours) > 0) {
      const cutoffMs = Date.now() - Number(olderThanHours) * 3600 * 1000;
      for (const [k, t] of Object.entries(this.state.trails || {})) {
        const ts = Date.parse(t?.updatedAt || '');
        if (Number.isFinite(ts) && ts < cutoffMs) {
          delete this.state.trails[k];
          removedTrails += 1;
        }
      }
    }

    if (removedCheckpoints > 0 || removedTrails > 0) {
      this.#save();
    }
    return { removedCheckpoints, removedTrails };
  }

  /**
   * Builds a crisp, ready-to-paste resume prompt for another chat/model.
   */
  buildResumePrompt({ id = '', trailKey = '', sessionKey = '' } = {}) {
    const cp = id ? this.state.checkpoints.find((c) => c.id === id) : null;
    const trail = trailKey
      ? this.state.trails[trailKey]
      : (cp
          ? this.state.trails[cp.fromTrailKey || makeTrailKey(cp.fromSessionKey, cp.activeWorkspace)] || null
          : this.#findTrailByKeyOrSession({ sourceSessionKey: sessionKey }));

    if (!cp && !trail) {
      throw new Error('No se encontró el handoff o rastro solicitado.');
    }

    const ws = cp?.activeWorkspace || trail?.activeWorkspace || '';
    const wsName = path.basename(ws || '') || ws;
    const lines = [
      `Retoma mi trabajo anterior en **${wsName || 'el workspace'}** usando el servidor MCP:`,
      cp
        ? `- Llama primero a \`handoff_resume({ id: "${cp.id}" })\`.`
        : `- Llama primero a \`handoff_resume({ trailKey: "${trail.trailKey}" })\`.`
    ];
    if (cp?.title) lines.push(`- Tarea: ${cp.title}`);
    if (cp?.currentGoal) lines.push(`- Objetivo: ${cp.currentGoal}`);
    if (cp?.summary) lines.push(`- Resumen: ${cp.summary}`);
    if (cp?.notes) lines.push(`- Nota: ${cp.notes}`);
    if (cp?.pendingTasks?.length) {
      lines.push('- Pendiente:');
      for (const task of cp.pendingTasks) lines.push(`  - ${task}`);
    }

    const modFiles = cp?.relevantFiles?.length
      ? cp.relevantFiles
      : (trail?.modifiedFiles || []).slice(0, 6).map((f) => `${f.path} (${f.op})`);
    if (modFiles.length) {
      lines.push(`- Archivos modificados/clave: ${modFiles.join(', ')}`);
    }
    if (trail?.lastError) {
      lines.push(`- Último error visto: ${trail.lastError}`);
    }
    return lines.join('\n');
  }

  getAdminState() {
    const listing = this.listHandoffs({ includeResumed: true });
    return {
      ...listing,
      trailsDetailed: Object.values(this.state.trails || {})
        .filter((t) => Number(t.toolCalls || 0) > 0)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map((t) => ({
          trailKey: t.trailKey,
          sessionKey: t.sessionKey,
          clientLabel: t.clientLabel,
          activeWorkspace: t.activeWorkspace,
          workspaceName: t.workspaceName || path.basename(t.activeWorkspace || ''),
          updatedAt: t.updatedAt,
          ageMinutes: computeAgeMinutes(t.updatedAt),
          toolCalls: t.toolCalls,
          lastTool: t.lastTool,
          lastError: t.lastError,
          modifiedFiles: (t.modifiedFiles || []).slice(0, 10),
          readFiles: (t.readFiles || []).slice(0, 6),
          recentCommands: (t.recentCommands || []).slice(0, 6),
          recentActions: (t.recentActions || []).slice(0, 8)
        })),
      checkpointsDetailed: (this.state.checkpoints || []).map((c) => ({
        ...c,
        ageMinutes: computeAgeMinutes(c.createdAt)
      }))
    };
  }
}
