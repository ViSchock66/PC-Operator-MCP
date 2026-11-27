import { getSystemAccent, type AccentPalette } from '../api/endpoints';

const STORAGE_KEY = 'accent-palette';
const HEX = /^#[0-9a-f]{6}$/i;

let activePalette: AccentPalette | null = null;

// En tema claro Windows usa Dark1 para rellenos y Dark2 para texto; en oscuro, Light2 y Light3.
// El fondo se tiñe apenas con Light3 (claro) o Dark3 (oscuro).
function varsFor(p: AccentPalette): Record<string, string> {
  return {
    '--sys-accent-light': p.dark1,
    '--sys-accent-dark': p.light2,
    '--sys-accent-text-light': p.dark2,
    '--sys-accent-text-dark': p.light3,
    '--sys-tint-light': p.light3,
    '--sys-tint-dark': p.dark3,
  };
}

// Replica color-mix(in srgb, tintHex (ratio*100)%, baseHex) para sincronizar <meta name="theme-color">.
export function mixSrgbHex(tintHex: string, baseHex: string, tintRatio: number): string {
  if (!HEX.test(tintHex) || !HEX.test(baseHex)) return baseHex;
  const parse = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [tr, tg, tb] = parse(tintHex);
  const [br, bg, bb] = parse(baseHex);
  const mix = (a: number, b: number) =>
    Math.max(0, Math.min(255, Math.round(a * tintRatio + b * (1 - tintRatio))))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(tr, br)}${mix(tg, bg)}${mix(tb, bb)}`;
}

export function computeTintedBgHex(palette: AccentPalette | null, isDark: boolean): string {
  const base = isDark ? '#202020' : '#f3f3f3';
  if (!palette) return base;
  const tint = isDark ? palette.dark3 : palette.light3;
  return mixSrgbHex(tint, base, isDark ? 0.14 : 0.06);
}

function isDarkEffective(): boolean {
  if (typeof document === 'undefined') return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return Boolean(
    typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

export function syncThemeColorMeta(isDarkOverride?: boolean): void {
  if (typeof document === 'undefined') return;
  const isDark = typeof isDarkOverride === 'boolean' ? isDarkOverride : isDarkEffective();
  const metaTc = document.getElementById('meta-theme-color');
  if (metaTc) {
    metaTc.setAttribute('content', computeTintedBgHex(activePalette, isDark));
  }
}

function applyAccent(p: AccentPalette | null): void {
  const style = document.documentElement.style;
  const vars = p ? varsFor(p) : null;
  const valid = vars !== null && Object.values(vars).every((v) => HEX.test(v));
  activePalette = valid ? p : null;
  for (const key of Object.keys(
    varsFor({ light3: '', light2: '', light1: '', base: '', dark1: '', dark2: '', dark3: '' }),
  )) {
    if (valid && vars) style.setProperty(key, vars[key]);
    else style.removeProperty(key);
  }
  syncThemeColorMeta();
}

// Aplica de inmediato la última paleta conocida para evitar un parpadeo con el azul por defecto.
export function applyCachedAccent(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyAccent(JSON.parse(raw) as AccentPalette);
  } catch {
    // Sin caché o JSON inválido: se usa el acento por defecto hasta que llegue el del sistema.
  }
}

export async function refreshSystemAccent(): Promise<void> {
  try {
    const res = await getSystemAccent();
    applyAccent(res.palette);
    try {
      if (res.palette) localStorage.setItem(STORAGE_KEY, JSON.stringify(res.palette));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignorar fallos de almacenamiento.
    }
  } catch {
    // Si falla la consulta se conserva el acento actual.
  }
}

// Sigue el acento de Windows: se relee al abrir y cada vez que la ventana vuelve a tener foco.
export function initSystemAccent(): void {
  void refreshSystemAccent();
  window.addEventListener('focus', () => void refreshSystemAccent());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshSystemAccent();
  });
}
