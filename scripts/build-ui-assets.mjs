import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'src', 'public');
const FONTS_DIR = path.join(PUBLIC_DIR, 'fonts');

function findWoff2(pkgDir, preferredNames) {
  const filesDir = path.join(ROOT, 'node_modules', pkgDir, 'files');
  if (!fs.existsSync(filesDir)) {
    throw new Error(`Missing font package directory: ${filesDir}`);
  }
  const files = fs.readdirSync(filesDir);
  for (const name of preferredNames) {
    if (files.includes(name)) return path.join(filesDir, name);
  }
  const fallback = files.find((f) => f.includes('latin') && f.endsWith('.woff2'))
    || files.find((f) => f.endsWith('.woff2'));
  if (!fallback) {
    throw new Error(`No .woff2 file found in ${filesDir}`);
  }
  return path.join(filesDir, fallback);
}

fs.mkdirSync(FONTS_DIR, { recursive: true });

const geistSansSrc = findWoff2('@fontsource-variable/geist', [
  'geist-latin-wght-normal.woff2',
  'geist-latin-standard-normal.woff2'
]);
const geistMonoSrc = findWoff2('@fontsource-variable/geist-mono', [
  'geist-mono-latin-wght-normal.woff2',
  'geist-mono-latin-standard-normal.woff2'
]);

fs.copyFileSync(geistSansSrc, path.join(FONTS_DIR, 'geist-sans.woff2'));
fs.copyFileSync(geistMonoSrc, path.join(FONTS_DIR, 'geist-mono.woff2'));

const LUCIDE_ICONS = [
  'layout-dashboard',
  'folder',
  'folder-open',
  'git-branch',
  'globe',
  'cpu',
  'arrow-left-right',
  'copy',
  'check',
  'eye',
  'eye-off',
  'sun',
  'moon',
  'monitor',
  'power',
  'terminal',
  'shield',
  'key-round',
  'refresh-cw',
  'play',
  'square',
  'rotate-cw',
  'search',
  'trash-2',
  'external-link',
  'chevron-right',
  'alert-triangle',
  'circle-check',
  'clock',
  'plus',
  'x',
  'send',
  'sliders-horizontal',
  'link',
  'lock',
  'unlock'
];

const symbols = [];
const lucideDir = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
for (const name of LUCIDE_ICONS) {
  const filePath = path.join(lucideDir, `${name}.svg`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing Lucide icon: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) {
    throw new Error(`Invalid SVG markup in ${filePath}`);
  }
  const inner = match[1].replace(/\s+/g, ' ').trim();
  symbols.push(
    `  <symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`
  );
}

const simpleIcons = await import('simple-icons');
const BRAND_EXPORTS = [
  { id: 'brand-tailscale', keys: ['siTailscale'] },
  { id: 'brand-cloudflare', keys: ['siCloudflare'] },
  { id: 'brand-claude', keys: ['siClaude', 'siAnthropic'] },
  { id: 'brand-gemini', keys: ['siGooglegemini'] },
  { id: 'brand-openai', keys: ['siOpenai'] },
  { id: 'brand-git', keys: ['siGit'] }
];

const FALLBACK_BRAND_PATH = 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z';

for (const brand of BRAND_EXPORTS) {
  let iconObj = null;
  for (const key of brand.keys) {
    if (simpleIcons[key]?.path) {
      iconObj = simpleIcons[key];
      break;
    }
  }
  const d = iconObj?.path || FALLBACK_BRAND_PATH;
  symbols.push(
    `  <symbol id="i-${brand.id}" viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></symbol>`
  );
}

const sprite = [
  '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
  ...symbols,
  '</svg>',
  ''
].join('\n');

fs.writeFileSync(path.join(PUBLIC_DIR, 'icons.svg'), sprite, 'utf8');
console.log(`UI assets synced: geist-sans.woff2, geist-mono.woff2, icons.svg (${symbols.length} symbols)`);
