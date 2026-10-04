// Contraste WCAG (SPEC §4.2) e ajuste de luminosidade em OKLCH (SPEC §9.3).

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

export function luminance(hex: string): number {
  const c = parseHex(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export const fgOn = (hex: string) => (luminance(hex) > 0.22 ? '#141414' : '#FFFFFF');
export const isDark = (bg: string) => luminance(bg) < 0.2;

// ───── OKLab / OKLCH ─────
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

export function oklchToHex([L, C, h]: [number, number, number]): string {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707542331 * s;
  return toHex([r, g, b].map((v) => linearToSrgb(Math.max(0, Math.min(1, v))) * 255) as [number, number, number]);
}

/**
 * Ajusta a luminosidade (OKLCH L) de `color` em passos de 2% até atingir `min` de
 * contraste contra `against`. Retorna null se não passar em 20 passos (SPEC §9.3).
 */
export function fixContrast(color: string, against: string, min: number, test?: (c: string) => number): string | null {
  const score = test ?? ((c: string) => contrast(c, against));
  if (score(color) >= min) return color;
  const [L, C, h] = hexToOklch(color);
  // Afasta da luminosidade do fundo
  const dir = luminance(against) > 0.18 ? -1 : 1;
  for (let i = 1; i <= 20; i++) {
    const next = oklchToHex([Math.max(0, Math.min(1, L + dir * 0.02 * i)), C, h]);
    if (score(next) >= min) return next;
  }
  return null;
}
