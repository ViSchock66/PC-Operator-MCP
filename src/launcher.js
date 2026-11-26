import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ConfigManager } from './config.js';
import { parseCliArgs, pickWorkspaceDialogSync, printStartupBanner } from './index.js';
import { createMcpAppServer } from './server.js';
import { TrayCompanion } from './tray.js';

function openPanelAppWindow(url) {
  if (process.platform !== 'win32') return;
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = fs.existsSync(edge) ? edge : (fs.existsSync(chrome) ? chrome : null);
  if (browser) {
    spawn(browser, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

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

let trayCompanion = null;
let shuttingDown = false;
let instance = null;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  trayCompanion?.stop();
  await instance?.tunnelManager?.stop().catch(() => {});
  await instance?.close().catch(() => {});
  process.exit(0);
};

instance = await createMcpAppServer({
  configManager,
  port: cli.port,
  onShutdown: shutdown
});

const { tunnelManager } = instance;
await tunnelManager.inspectEnvironment();

if (!cli.noTunnel && configManager.get().tunnel?.autoStart !== false) {
  const state = await tunnelManager.start();
  printStartupBanner({ ...instance, tunnelUrl: state.activeUrl || state.configuredUrl || null });
  if (state.status === 'needs_action' && state.actionUrl) {
    console.log(`[!] Tailscale requiere habilitar Funnel una vez: ${state.actionUrl}`);
  } else if (state.lastError) {
    console.log(`[!] Aviso de túnel: ${state.lastError}`);
  }
} else {
  printStartupBanner({ ...instance, tunnelUrl: configManager.get().tunnel?.publicUrl || null });
}

if (!cli.noTray) {
  trayCompanion = new TrayCompanion({
    host: instance.host,
    port: instance.port,
    trayToken: instance.trayToken,
    logger: (level, source, msg) => tunnelManager.log(level, source, msg)
  });
  trayCompanion.start();
}

console.log(`Panel GUI: http://${instance.host}:${instance.port}/admin`);
console.log('Mantén este daemon activo mientras trabajas con Gemini.\n');

if (cli.openGui) {
  openPanelAppWindow(`http://${instance.host}:${instance.port}/admin`);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
