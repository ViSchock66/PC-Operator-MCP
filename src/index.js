import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigManager } from './config.js';
import { createMcpAppServer } from './server.js';

export function parseCliArgs(argv) {
  const args = { pickWorkspace: false, openGui: false, noTunnel: false, noTray: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (a === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i];
    } else if (a === '--pick' || a === '--pick-workspace') {
      args.pickWorkspace = true;
    } else if (a === '--gui') {
      args.openGui = true;
    } else if (a === '--no-tunnel') {
      args.noTunnel = true;
    } else if (a === '--no-tray') {
      args.noTray = true;
    }
  }
  return args;
}

export function pickWorkspaceDialogSync() {
  if (process.platform !== 'win32') return null;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = "Elige el workspace inicial para Gemini MCP"
$dlg.UseDescriptionForTitle = $true
$dlg.ShowNewFolderButton = $true
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Sta', '-Command', script], {
    encoding: 'utf8'
  });
  return out.trim() || null;
}

export function printStartupBanner({ port, host, configManager, tunnelUrl }) {
  const cfg = configManager.get();
  console.log('\n============================================================');
  console.log('  PC Operator MCP Server — ACTIVO');
  console.log('============================================================');
  console.log(`  Local MCP       : http://${host}:${port}/mcp (Gemini: /mcp/gemini)`);
  if (tunnelUrl) {
    console.log(`  URL MCP General : ${tunnelUrl}/mcp`);
    console.log(`  URL solo Gemini : ${tunnelUrl}/mcp/gemini`);
  }
  console.log(`  Panel Local     : http://${host}:${port}/admin`);
  console.log(`  Workspace activo: ${cfg.activeWorkspace}`);
  console.log(`  PIN autorización: ${cfg.pin}`);
  console.log('  --- Opcional (Ajustes adicionales -> OAuth estático) ---');
  console.log(`  ID de cliente   : ${cfg.staticClient.client_id}`);
  console.log(`  Secreto cliente : ${cfg.staticClient.client_secret}`);
  console.log('============================================================\n');
}

const isDirectRun = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isDirectRun) {
  const cli = parseCliArgs(process.argv.slice(2));
  let initialWorkspace = cli.workspace;
  if (cli.pickWorkspace && !initialWorkspace) {
    initialWorkspace = pickWorkspaceDialogSync() || undefined;
  }

  const configManager = new ConfigManager({
    port: cli.port,
    initialWorkspace
  });
  if (initialWorkspace) {
    configManager.addWorkspace(initialWorkspace, { activate: true });
  }

  const instance = await createMcpAppServer({ configManager, port: cli.port });
  printStartupBanner(instance);
}
