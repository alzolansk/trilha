// Fendas (SPEC §6.3), motifs (§6.1) e utilitários geométricos.
import type { SlitShape } from './types';

/** clip-path da fenda para o progresso e (já com easing) e largura da viewport vw (px). */
export function clipFor(shape: SlitShape, e: number, vw: number): string {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const inv = 1 - e;
  if (shape === 'diamond') {
    const w = 1.4 + e * 104;
    const h = 24 + e * 82;
    return `polygon(50% ${r3(50 - h)}%, ${r3(50 + w)}% 50%, 50% ${r3(50 + h)}%, ${r3(50 - w)}% 50%)`;
  }
  if (shape === 'lens') return `ellipse(${r3(0.7 + e * 90)}% ${r3(24 + e * 66)}% at 50% 50%)`;
  if (shape === 'arch') {
    const L = r3(48.6 * inv);
    const T = r3(14 * inv);
    const r = Math.round(((100 - 2 * L) / 200) * vw * (1 - e * e));
    return `inset(${T}% ${L}% ${T}% ${L}% round ${r}px ${r}px 0 0)`;
  }
  return `inset(${r3(49.4 * inv)}% ${r3(6 * inv)}% ${r3(49.4 * inv)}% ${r3(6 * inv)}%)`;
}

export const SLIT_LABEL: Record<SlitShape, string> = {
  diamond: 'Losango',
  lens: 'Lente',
  arch: 'Arco',
  band: 'Faixa',
};

/** Miniatura estática (onboarding e galeria). */
export const MINI_CLIP: Record<SlitShape, string> = {
  diamond: 'polygon(50% 6%, 72% 50%, 50% 94%, 28% 50%)',
  lens: 'ellipse(16% 44% at 50% 50%)',
  arch: 'inset(8% 34% 0 34% round 80px 80px 0 0)',
  band: 'inset(42% 5% 42% 5%)',
};

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function starPolygon(n: number, outer = 50, inner = 36, rotDeg = -90): string {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotDeg + (180 * i) / n) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(1)}% ${(50 + r * Math.sin(a)).toFixed(1)}%`;
  });
  return `polygon(${pts.join(', ')})`;
}

export const HEXAGON = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';
export const CIRCLE = 'circle(50% at 50% 50%)';

/** Lê pontos de um polygon() em %; null se não for polígono válido. */
export function parsePolygon(clip: string): [number, number][] | null {
  const m = clip.trim().match(/^polygon\((.*)\)$/i);
  if (!m) return null;
  const pts = m[1].split(',').map((p) => {
    const [x, y] = p.trim().split(/\s+/).map((v) => parseFloat(v.replace('%', '')));
    return [x, y] as [number, number];
  });
  if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < -1 || x > 101 || y < -1 || y > 101)) return null;
  return pts;
}

/** Fração do quadrado coberta pelo motif (0..1). circle(50%) = π/4. */
export function motifArea(clip: string): number | null {
  const c = clip.trim().match(/^circle\(\s*(\d+(?:\.\d+)?)%\s*(?:at\s+50%\s+50%)?\s*\)$/i);
  if (c) {
    const r = parseFloat(c[1]) / 100;
    return Math.min(1, Math.PI * r * r);
  }
  const pts = parsePolygon(clip);
  if (!pts || pts.length < 3) return null;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2 / 10000;
}

export function isValidMotif(clip: string): boolean {
  if (/^circle\(\s*\d+(\.\d+)?%(\s+at\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%)?\s*\)$/i.test(clip.trim())) return true;
  const pts = parsePolygon(clip);
  return !!pts && pts.length >= 3 && pts.length <= 24;
}

// ───── Caminho da rota (Início, ato 2) ─────

/** Curva suave (Catmull-Rom → Bézier cúbica) passando por todos os pontos. */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * Fração do comprimento do caminho em que cada ponto está (0 no primeiro, 1 no último),
 * medindo as cúbicas por amostragem. As paradas acendem nessas frações.
 */
export function pathFractions(pts: [number, number][]): number[] {
  if (pts.length <= 1) return pts.map(() => 0);
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    let len = 0;
    let prev = p1 as number[];
    for (let s = 1; s <= 40; s++) {
      const t = s / 40;
      const mt = 1 - t;
      const x = mt ** 3 * p1[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p2[0];
      const y = mt ** 3 * p1[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p2[1];
      len += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
    }
    lens.push(len);
  }
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const out = [0];
  let acc = 0;
  for (const l of lens) {
    acc += l;
    out.push(Number((acc / total).toFixed(4)));
  }
  return out;
}

/**
 * Posições dos pontos da rota no viewBox 800×500: projeta lat/lng quando todas as paradas
 * têm coordenadas; senão usa um zigue-zague decorativo (não representa geografia).
 */
export function routePoints(stops: { lat: number | null; lng: number | null }[]): { pts: [number, number][]; geographic: boolean } {
  const n = stops.length;
  if (n === 0) return { pts: [], geographic: false };
  const geo = n > 1 && stops.every((s) => s.lat != null && s.lng != null);
  if (geo) {
    const xs = stops.map((s) => s.lng as number);
    const ys = stops.map((s) => -(s.lat as number));
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min(670 / spanX, 330 / spanY);
    const offX = 70 + (670 - spanX * scale) / 2;
    const offY = 90 + (330 - spanY * scale) / 2;
    return { pts: stops.map((_, i) => [Math.round(offX + (xs[i] - minX) * scale), Math.round(offY + (ys[i] - minY) * scale)]), geographic: true };
  }
  const left = 70;
  const right = 740;
  const step = n > 1 ? (right - left) / (n - 1) : 0;
  const ys = [420, 250, 380, 170, 300, 90];
  return {
    pts: stops.map((_, i) => [Math.round(left + step * i), n === 1 ? 260 : ys[i % ys.length]]),
    geographic: false,
  };
}
