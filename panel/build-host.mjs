import { ensurePanelHostExecutable } from '../src/panelHost.js';

const exe = ensurePanelHostExecutable({
  buildIfMissing: true,
  logger: (_lvl, _src, msg) => console.log(msg)
});

if (exe) {
  console.log(`[panel] Native WebView2 host ready: ${exe}`);
} else {
  console.log('[panel] .NET 8 SDK not found; browser fallback (/admin) remains active.');
}
