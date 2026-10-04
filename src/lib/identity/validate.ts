// Validação e correção de identidades (SPEC §9.3, passo 4).
import { z } from 'zod';
import { contrast, fgOn, fixContrast, isDark } from './contrast';
import { CIRCLE, HEXAGON, isValidMotif, MINI_CLIP, motifArea, SLIT_LABEL } from './shapes';
import type { DestinationIdentity, Palette } from './types';

export const ALLOWED_FONTS = [
  'Bricolage Grotesque', 'Shippori Mincho B1', 'Gloock', 'Big Shoulders Display', 'Abril Fatface',
  'DM Serif Display', 'Unbounded', 'Rubik', 'Space Grotesk', 'Playfair Display', 'Archivo Black',
  'Familjen Grotesk', 'Young Serif', 'Instrument Serif',
] as const;
export const FORBIDDEN_FONTS = ['Syne', 'Inter', 'Roboto', 'Arial', 'Fraunces'];

/** Pesos disponíveis no Google Fonts para cada fonte permitida. */
export const FONT_WEIGHTS: Record<(typeof ALLOWED_FONTS)[number], number[]> = {
  'Bricolage Grotesque': [400, 500, 600, 700, 800],
  'Shippori Mincho B1': [400, 500, 600, 700, 800],
  Gloock: [400],
  'Big Shoulders Display': [400, 500, 600, 700, 800, 900],
  'Abril Fatface': [400],
  'DM Serif Display': [400],
  Unbounded: [400, 500, 600, 700, 800, 900],
  Rubik: [400, 500, 600, 700, 800, 900],
  'Space Grotesk': [400, 500, 600, 700],
  'Playfair Display': [400, 500, 600, 700, 800, 900],
  'Archivo Black': [400],
  'Familjen Grotesk': [400, 500, 600, 700],
  'Young Serif': [400],
  'Instrument Serif': [400],
};

/** Família com fallback para o caso de a fonte não carregar. */
export function fallbackFor(family: string): string {
  const serif = ['Shippori Mincho B1', 'Gloock', 'Abril Fatface', 'DM Serif Display', 'Playfair Display', 'Young Serif', 'Instrument Serif'];
  if (family === 'Big Shoulders Display') return 'Impact, sans-serif';
  if (serif.includes(family)) return 'Georgia, serif';
  return "'Arial Black', sans-serif";
}

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const rgbaOrHex = z.string().regex(/^(#[0-9A-Fa-f]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0?\.\d+|1|0)\s*\))$/);
const token = z.enum(['bg', 'ink', 'acc', 'acc2', 'acc3', 'deep']);
const num = z.number().finite();

const patternShape = z.discriminatedUnion('t', [
  z.object({ t: z.literal('circle'), cx: num, cy: num, r: num.min(0).max(120), fill: token.or(z.literal('none')).optional(), stroke: token.optional(), sw: num.min(0).max(8).optional() }),
  z.object({ t: z.literal('rect'), x: num, y: num, w: num.min(0).max(120), h: num.min(0).max(120), rot: num.optional(), fill: token.or(z.literal('none')).optional(), stroke: token.optional(), sw: num.min(0).max(8).optional() }),
  z.object({ t: z.literal('poly'), points: z.array(z.tuple([num, num])).min(3).max(24), fill: token.or(z.literal('none')).optional(), stroke: token.optional(), sw: num.min(0).max(8).optional() }),
  z.object({ t: z.literal('wave'), y: num, amp: num.min(0).max(60), stroke: token, sw: num.min(0).max(8).optional() }),
]);

export const identitySchema = z.object({
  idName: z.string().min(3).max(40),
  palette: z.object({
    bg: hex, ink: hex, mute: hex, line: rgbaOrHex.optional(), acc: hex, acc2: hex, acc3: hex,
    deep: hex, onDeep: hex, onAcc: hex.optional(), routeLine: hex,
  }),
  display: z.object({ family: z.string().min(2).max(40), weight: z.number().int().min(100).max(900) }),
  motif: z.string().max(600),
  motifSolid: z.string().max(600).optional(),
  pattern: z.object({ w: num.min(8).max(120), h: num.min(8).max(120), shapes: z.array(patternShape).min(1).max(16) }),
  slit: z.enum(['diamond', 'lens', 'arch', 'band']),
  split: z.enum(['v', 'h']).optional(),
  landscape: z.object({
    sky: z.tuple([hex, hex]),
    sun: z.object({ cx: num.min(0).max(1440), cy: num.min(0).max(900), r: num.min(10).max(260), color: token }).nullable(),
    layers: z.array(z.object({
      style: z.enum(['peaks', 'hills', 'dunes', 'waves', 'mesas', 'city']),
      color: token, base: num.min(300).max(900), amp: num.min(10).max(400), seed: z.number().int(),
    })).min(1).max(3),
  }),
  sources: z.array(z.string().min(2).max(48)).length(4),
});

export type IdentityInput = z.infer<typeof identitySchema>;

export interface ValidationResult {
  ok: boolean;
  identity: DestinationIdentity | null;
  problems: string[];
}

function rgbaFromHex(h: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

/** Corrige contrastes da paleta. Retorna null se alguma regra não passar em 20 passos. */
export function repairPalette(p: Palette, problems: string[]): Palette | null {
  const out = { ...p };
  const ink = fixContrast(out.ink, out.bg, 7);
  if (!ink) return null;
  if (ink !== out.ink) problems.push('ink ajustado para contraste 7:1');
  out.ink = ink;
  const mute = fixContrast(out.mute, out.bg, 4.5);
  if (!mute) return null;
  if (mute !== out.mute) problems.push('mute ajustado para 4.5:1');
  out.mute = mute;
  const onDeep = fixContrast(out.onDeep, out.deep, 4.5);
  if (!onDeep) return null;
  out.onDeep = onDeep;
  // texto sobre acc é fgOn(acc): ajusta o próprio acento
  const acc = fixContrast(out.acc, fgOn(out.acc), 4.5, (c) => contrast(fgOn(c), c));
  if (!acc) return null;
  if (acc !== out.acc) problems.push('acc ajustado para texto legível');
  out.acc = acc;
  const route = fixContrast(out.routeLine, out.deep, 3);
  if (!route) return null;
  out.routeLine = route;
  out.onAcc = fgOn(out.acc);
  return out;
}

export function checkContrasts(p: Palette): string[] {
  const fails: string[] = [];
  if (contrast(p.ink, p.bg) < 7) fails.push('ink/bg < 7');
  if (contrast(p.mute, p.bg) < 4.5) fails.push('mute/bg < 4.5');
  if (contrast(p.onDeep, p.deep) < 4.5) fails.push('onDeep/deep < 4.5');
  if (contrast(fgOn(p.acc), p.acc) < 4.5) fails.push('fgOn(acc)/acc < 4.5');
  if (contrast(p.routeLine, p.deep) < 3) fails.push('routeLine/deep < 3');
  return fails;
}

/** Fonte permitida mais parecida (serifada ↔ serifada, grotesca ↔ grotesca). */
export function closestAllowedFont(family: string): (typeof ALLOWED_FONTS)[number] {
  const exact = ALLOWED_FONTS.find((f) => f.toLowerCase() === family.trim().toLowerCase());
  if (exact) return exact;
  const f = family.toLowerCase();
  if (/serif|mincho|garamond|didot|bodoni|times|georgia|fraunces/.test(f) && !/sans/.test(f)) return 'DM Serif Display';
  if (/condensed|narrow|oswald|bebas|impact|league|anton/.test(f)) return 'Big Shoulders Display';
  if (/mono|code/.test(f)) return 'Space Grotesk';
  return 'Bricolage Grotesque';
}

/**
 * Valida saída (de IA ou do gerador) e devolve uma DestinationIdentity pronta, aplicando
 * as correções da SPEC. Formas inválidas são rejeitadas (o chamador pede de novo ou cai
 * para a identidade do dicionário mais próxima).
 */
export function validateIdentity(
  raw: unknown,
  meta: { key: string; generatedBy: DestinationIdentity['generatedBy']; version: number; model?: string },
): ValidationResult {
  const problems: string[] = [];
  const parsed = identitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, identity: null, problems: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const v = parsed.data;
  if (!isValidMotif(v.motif)) return { ok: false, identity: null, problems: ['motif deve ser circle() ou polygon() com até 24 pontos'] };

  const basePalette: Palette = {
    ...v.palette,
    line: v.palette.line ?? rgbaFromHex(v.palette.ink, isDark(v.palette.bg) ? 0.16 : 0.18),
    onAcc: v.palette.onAcc ?? fgOn(v.palette.acc),
  };
  const palette = repairPalette(basePalette, problems);
  if (!palette) return { ok: false, identity: null, problems: ['contraste não corrigível em 20 passos', ...checkContrasts(basePalette)] };

  let family = v.display.family.trim();
  if (FORBIDDEN_FONTS.some((f) => f.toLowerCase() === family.toLowerCase()) || !ALLOWED_FONTS.includes(family as never)) {
    const repl = closestAllowedFont(family);
    problems.push(`fonte ${family} trocada por ${repl}`);
    family = repl;
  }
  const weights = FONT_WEIGHTS[family as (typeof ALLOWED_FONTS)[number]];
  const weight = (weights.includes(v.display.weight) ? v.display.weight : weights.reduce((a, b) => (Math.abs(b - v.display.weight) < Math.abs(a - v.display.weight) ? b : a))) as DestinationIdentity['display']['weight'];

  let motifSolid = v.motifSolid && isValidMotif(v.motifSolid) ? v.motifSolid : v.motif;
  const area = motifArea(v.motif) ?? 0;
  if (area < 0.55 && motifSolid === v.motif) {
    motifSolid = /^circle/i.test(v.motif) ? CIRCLE : HEXAGON;
    problems.push('motif fino: motifSolid gerado');
  }
  if ((motifArea(motifSolid) ?? 0) < 0.55) motifSolid = HEXAGON;

  const split = v.slit === 'band' ? 'h' : 'v';

  const identity: DestinationIdentity = {
    key: meta.key,
    idName: v.idName,
    palette,
    display: { family, googleFont: family, weight },
    motif: v.motif,
    motifSolid,
    pattern: { kind: 'tiles', w: v.pattern.w, h: v.pattern.h, shapes: v.pattern.shapes },
    slit: v.slit,
    split,
    landscape: { kind: 'layers', sky: v.landscape.sky, sun: v.landscape.sun, layers: v.landscape.layers },
    sources: v.sources,
    generatedBy: meta.generatedBy,
    version: meta.version,
    shapeName: SLIT_LABEL[v.slit],
    miniClip: MINI_CLIP[v.slit],
    ...(meta.model ? { model: meta.model } : {}),
  };
  return { ok: true, identity, problems };
}
