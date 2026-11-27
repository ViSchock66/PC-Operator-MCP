import { t } from '../../i18n/index.js';
import { $, escapeHtml, icon } from '../api.js';

export function buildClientSnippets(mcpUrl) {
  const url = mcpUrl && mcpUrl !== '--' ? mcpUrl : 'http://127.0.0.1:3333/mcp';

  const claudeCode = [
    `# CLI (OAuth 2.1 or Bearer token)`,
    `claude mcp add --transport http pc-operator "${url}"`,
    ``,
    `// Or save in .mcp.json at your project root:`,
    JSON.stringify({
      mcpServers: {
        'pc-operator': {
          type: 'http',
          url,
          headers: {
            Authorization: 'Bearer <YOUR_API_KEY>'
          }
        }
      }
    }, null, 2)
  ].join('\n');

  const cursor = JSON.stringify({
    mcpServers: {
      'pc-operator': {
        url,
        headers: {
          Authorization: 'Bearer <YOUR_API_KEY>'
        }
      }
    }
  }, null, 2);

  const vscode = JSON.stringify({
    servers: {
      'pc-operator': {
        type: 'http',
        url,
        headers: {
          Authorization: 'Bearer <YOUR_API_KEY>'
        }
      }
    }
  }, null, 2);

  const httpCurl = [
    `curl -X POST "${url}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
    `  -H "Authorization: Bearer <YOUR_API_KEY>" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
  ].join('\n');

  return {
    'claude-code': claudeCode,
    cursor,
    vscode,
    http: httpCurl
  };
}

export function renderNetworkDetails(s) {
  const ts = s.tunnel?.env?.tailscale;
  const cf = s.tunnel?.env?.cloudflared;
  const netTsStatus = $('net-ts-status');
  const netTsIp = $('net-ts-ip');
  const netCfStatus = $('net-cf-status');

  if (netTsStatus) {
    netTsStatus.textContent = !ts
      ? t('connections.envPending')
      : (!ts.installed
          ? t('connections.envNotInstalled')
          : (ts.online
              ? t('connections.envTsConnected', { dns: ts.dnsName || 'OK' })
              : t('connections.envTsDisconnected')));
  }
  if (netTsIp) {
    netTsIp.textContent = ts?.tailnetIp
      ? `${ts.tailnetIp} · ${ts.funnelActive ? t('overview.funnelOn') : t('overview.funnelOff')}`
      : '--';
  }
  if (netCfStatus) {
    netCfStatus.textContent = !cf
      ? t('connections.envPending')
      : (cf.installed ? t('connections.envInstalledPath', { path: cf.binaryPath }) : t('connections.envNotInstalled'));
  }
}

export function renderAuthSection(s) {
  const sessCount = s.auth?.activeSessions ?? 0;
  const revokeBtn = $('btn-revoke-sessions');
  if (revokeBtn) {
    revokeBtn.textContent = t('connections.revokeSessions', { count: sessCount });
  }

  const builtinList = $('builtin-providers-list');
  if (builtinList) {
    builtinList.innerHTML = (s.auth?.builtinProviders || []).map((p) => `
      <span class="badge" title="${escapeHtml(p.origin)}"><span class="status-dot" style="background:var(--ok-dot)"></span>${escapeHtml(p.name)}</span>
    `).join('');
  }

  const apiKeysList = $('apikeys-list');
  if (!apiKeysList) return;
  const keys = s.auth?.apiKeys || [];
  if (keys.length === 0) {
    apiKeysList.innerHTML = `<div class="empty-state">${escapeHtml(t('connections.apiKeysEmpty'))}</div>`;
  } else {
    apiKeysList.innerHTML = keys.map((k) => `
      <div class="list-row">
        <div class="list-row-main">
          <div class="row-title">${escapeHtml(k.name)}</div>
          <div class="row-path mono">${escapeHtml(k.preview)}</div>
        </div>
        <button type="button" class="btn btn-sm btn-danger" data-revoke-apikey="${escapeHtml(k.id)}">${escapeHtml(t('common.revoke'))}</button>
      </div>
    `).join('');
  }
}

export function renderSetupGuide(s, opInfo, activeSnippet = 'claude-code') {
  const tun = s.tunnel || {};
  const keys = s.auth?.apiKeys || [];
  const mcpUrl = tun.mcpUrl || tun.localMcpUrl || '--';
  const geminiMcpUrl = tun.geminiMcpUrl || (mcpUrl !== '--' ? `${mcpUrl}/gemini` : '--');

  const hasFixedUrl = Boolean(
    s.tunnelConfig?.publicUrl &&
    (s.tunnelConfig?.mode === 'tailscale' || s.tunnelConfig?.mode === 'cloudflare-named')
  );
  const ready = tun.status === 'running' && Boolean(s.workspaces?.active);

  const navBadge = $('nav-badge-connections');
  if (navBadge) {
    navBadge.textContent = ready ? t('common.ready') : '!';
    navBadge.className = `badge ${ready ? 'badge-ok' : 'badge-warn'}`;
  }

  if ($('guide-mcp-url')) $('guide-mcp-url').textContent = mcpUrl;
  if ($('guide-gemini-mcp-url')) $('guide-gemini-mcp-url').textContent = geminiMcpUrl;
  if ($('guide-oauth-summary')) {
    $('guide-oauth-summary').textContent = t('connections.staticSummaryVal', {
      id: s.auth?.staticClient?.client_id || '--',
      secret: s.auth?.staticClient?.client_secret || '--'
    });
  }

  const checklistEl = $('guide-checklist');
  if (checklistEl) {
    const checks = [
      { label: t('connections.checkLocalServer'), ok: true, detail: tun.localMcpUrl || '--' },
      {
        label: t('connections.checkPublicTunnel'),
        ok: tun.status === 'running' && tun.mode !== 'local',
        detail: tun.activeUrl || tun.status || '--'
      },
      {
        label: t('connections.checkFixedUrl'),
        ok: hasFixedUrl,
        detail: s.tunnelConfig?.publicUrl || t('connections.checkFixedUrlMissing')
      },
      {
        label: t('connections.checkAuthReady'),
        ok: true,
        detail: t('connections.checkAuthDetail', {
          providers: (s.auth?.builtinProviders || []).length,
          keys: keys.length
        })
      },
      {
        label: t('connections.checkOperator'),
        ok: Boolean(s.operator?.enabled && s.operator?.exists),
        detail: opInfo.text
      },
      {
        label: t('connections.checkWorkspace'),
        ok: Boolean(s.workspaces?.active),
        detail: s.workspaces?.active || '--'
      }
    ];
    checklistEl.innerHTML = checks.map((c) => `
      <div class="check-row">
        <div class="list-row-main">
          <div class="row-title">${escapeHtml(c.label)}</div>
          <div class="row-sub mono">${escapeHtml(c.detail)}</div>
        </div>
        <span class="check-status ${c.ok ? 'check-ok' : 'check-pending'}">
          ${icon(c.ok ? 'circle-check' : 'clock', 'icon-xs')}
          <span>${escapeHtml(c.ok ? t('common.ready') : t('common.pending'))}</span>
        </span>
      </div>
    `).join('');
  }

  renderSnippetBlock(mcpUrl, activeSnippet);
}

export function renderSnippetBlock(mcpUrl, activeSnippet = 'claude-code') {
  const snippets = buildClientSnippets(mcpUrl);
  const codeEl = $('snippet-code');
  const hintEl = $('snippet-hint');
  if (codeEl) {
    codeEl.textContent = snippets[activeSnippet] || snippets['claude-code'];
  }
  const hintKeyMap = {
    'claude-code': 'connections.snippetHintClaudeCode',
    cursor: 'connections.snippetHintCursor',
    vscode: 'connections.snippetHintVscode',
    http: 'connections.snippetHintHttp'
  };
  if (hintEl) {
    hintEl.innerHTML = t(hintKeyMap[activeSnippet] || 'connections.snippetHintClaudeCode');
  }
  document.querySelectorAll('[data-snippet-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.snippetTab === activeSnippet);
  });
}
