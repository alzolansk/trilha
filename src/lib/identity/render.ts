// Renderiza padrão e paisagem como string SVG. O SVG "raw" só existe no dicionário curado;
// especificações geradas são convertidas aqui a partir de números e tokens de cor validados.
import type { DestinationIdentity, PaletteToken, PatternShape, RidgeStyle } from './types';

const n = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(2)) : 0);

function color(id: DestinationIdentity, t: PaletteToken | 'none' | undefined): string {
  if (!t || t === 'none') return 'none';
  return id.palette[t] ?? 'none';
}

/** Torna únicos os ids internos (várias cópias do mesmo SVG na página). */
function uniquify(svg: string, suffix: string): string {
  return svg.replace(/id="([\w-]+)"/g, `id="$1-${suffix}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1-${suffix})`);
}

function shapeSvg(id: DestinationIdentity, s: PatternShape, w: number): string {
  const stroke = 'stroke' in s && s.stroke ? ` stroke="${color(id, s.stroke)}" stroke-width="${n(s.sw ?? 2)}"` : '';
  switch (s.t) {
    case 'circle':
      return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" fill="${color(id, s.fill)}"${stroke}/>`;
    case 'rect': {
      const rot = s.rot ? ` transform="rotate(${n(s.rot)} ${n(s.x + s.w / 2)} ${n(s.y + s.h / 2)})"` : '';
      return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="${color(id, s.fill)}"${stroke}${rot}/>`;
    }
    case 'poly':
      return `<polygon points="${s.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${color(id, s.fill)}"${stroke}/>`;
    case 'wave': {
      const q = w / 4;
      return `<path d="M0 ${n(s.y)} Q${n(q)} ${n(s.y - s.amp)} ${n(w / 2)} ${n(s.y)} T${n(w)} ${n(s.y)}" fill="none" stroke="${color(id, s.stroke)}" stroke-width="${n(s.sw ?? 1.4)}"/>`;
    }
  }
}

/** Conteúdo de <defs> com um <pattern id="pat-{uid}">. */
export function patternDefs(id: DestinationIdentity, uid: string): string {
  if (id.pattern.kind === 'raw') {
    return id.pattern.svg.replace(/id="pat-[\w-]+"/, `id="pat-${uid}"`);
  }
  const { w, h, shapes } = id.pattern;
  return `<pattern id="pat-${uid}" width="${n(w)}" height="${n(h)}" patternUnits="userSpaceOnUse">${shapes.map((s) => shapeSvg(id, s, w)).join('')}</pattern>`;
}

export function patternSvg(id: DestinationIdentity, uid: string): string {
  return `<svg aria-hidden="true" width="100%" height="100%" style="display:block"><defs>${patternDefs(id, uid)}</defs><rect width="100%" height="100%" fill="url(#pat-${uid})"></rect></svg>`;
}

// ───── Paisagem ─────

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ridge(style: RidgeStyle, base: number, amp: number, seed: number): string {
  const r = rand(seed);
  const W = 1440;
  if (style === 'peaks' || style === 'mesas' || style === 'city') {
    const pts: string[] = [`M0 ${n(base)}`];
    let x = 0;
    while (x < W) {
      const step = 90 + r() * 120;
      const y = base - amp * (0.3 + r() * 0.7);
      if (style === 'peaks') pts.push(`L${n(x + step / 2)} ${n(y)} L${n(x + step)} ${n(base - amp * r() * 0.3)}`);
      else if (style === 'mesas') pts.push(`L${n(x + step * 0.2)} ${n(y)} L${n(x + step * 0.8)} ${n(y)} L${n(x + step)} ${n(base)}`);
      else pts.push(`L${n(x)} ${n(y)} L${n(x + step * 0.7)} ${n(y)} L${n(x + step * 0.7)} ${n(base - amp * 0.2)} L${n(x + step)} ${n(base - amp * 0.2)}`);
      x += step;
    }
    pts.push(`L${W} ${n(base)} L${W} 900 L0 900Z`);
    return pts.join(' ');
  }
  const segs = style === 'waves' ? 12 : style === 'dunes' ? 5 : 4;
  const step = W / segs;
  let d = `M0 ${n(base)}`;
  for (let i = 0; i < segs; i++) {
    const x1 = i * step;
    const peak = base - amp * (style === 'waves' ? 0.4 + r() * 0.2 : 0.4 + r() * 0.6);
    const cx = style === 'dunes' ? x1 + step * (0.6 + r() * 0.2) : x1 + step / 2;
    d += ` Q${n(cx)} ${n(peak)} ${n(x1 + step)} ${n(base + (r() - 0.5) * amp * 0.2)}`;
  }
  return `${d} L${W} 900 L0 900Z`;
}

/** Conteúdo interno de <svg viewBox="0 0 1440 900">, com camadas data-par (parallax). */
export function landscapeInner(id: DestinationIdentity, uid: string): string {
  const L = id.landscape;
  if (L.kind === 'raw') return uniquify(L.svg, uid);
  const sky = `<defs><linearGradient id="sk-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.sky[0]}"/><stop offset="1" stop-color="${L.sky[1]}"/></linearGradient></defs><rect width="1440" height="900" fill="url(#sk-${uid})"/>`;
  const sun = L.sun ? `<g data-par="0"><circle cx="${n(L.sun.cx)}" cy="${n(L.sun.cy)}" r="${n(L.sun.r)}" fill="${color(id, L.sun.color)}"/></g>` : '<g data-par="0"></g>';
  const layers = L.layers
    .slice(0, 3)
    .map((l, i) => `<g data-par="${i + 1}"><path d="${ridge(l.style, l.base, l.amp, l.seed)}" fill="${color(id, l.color)}"/></g>`)
    .join('');
  return sky + sun + layers;
}
