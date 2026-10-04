// Gerador local (sem IA) de identidade para destinos fora do dicionário.
// Determinístico: mesmo destino/época/estilo/versão → mesma identidade. Não alega
// inspirações culturais que não conhece: as "fontes" descrevem a regra usada.
import { normalize } from '../format';
import { hexToOklch, oklchToHex } from './contrast';
import { HEXAGON, starPolygon } from './shapes';
import type { DestinationIdentity } from './types';
import { ALLOWED_FONTS, FONT_WEIGHTS, validateIdentity, type IdentityInput } from './validate';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const oklch = (L: number, C: number, hDeg: number) => oklchToHex([L, C, (((hDeg % 360) + 360) % 360) * (Math.PI / 180)]);

export function slugKey(dest: string): string {
  return `gen_${hashString(normalize(dest)).toString(36)}`;
}

interface GenInput {
  destination: string;
  departDate?: string | null; // yyyy-mm-dd
  style?: string;
  version?: number;
}

export function generateRulesIdentityInput({ destination, departDate, style = 'Mochilão', version = 1 }: GenInput): IdentityInput {
  const d = normalize(destination);
  const seed = hashString(`${d}|${style}|${version}`);
  const hue = seed % 360;
  const month = departDate ? Number(departDate.slice(5, 7)) - 1 : null;
  const polar = /\b(noruega|norway|finlandia|lapon|lapland|alasca|alaska|groenlandia|greenland|svalbard|tromso|antartica|patagonia)\b/.test(d);
  const dark = polar || (month != null && [10, 11, 0, 1].includes(month) && /\b(canada|suecia|sweden|escocia|scotland)\b/.test(d));

  const palette = dark
    ? {
        bg: oklch(0.18, 0.025, hue + 200), ink: oklch(0.95, 0.015, hue + 160), mute: oklch(0.75, 0.03, hue + 180),
        acc: oklch(0.86, 0.17, hue), acc2: oklch(0.8, 0.11, hue + 70), acc3: oklch(0.68, 0.16, hue + 150),
        deep: oklch(0.26, 0.03, hue + 200), onDeep: oklch(0.95, 0.015, hue + 160), routeLine: oklch(0.86, 0.17, hue),
      }
    : {
        bg: oklch(0.94, 0.03, hue + 40), ink: oklch(0.22, 0.04, hue + 20), mute: oklch(0.46, 0.04, hue + 20),
        acc: oklch(0.56, 0.17, hue), acc2: oklch(0.78, 0.13, hue + 45), acc3: oklch(0.48, 0.15, hue - 70),
        deep: oklch(0.34, 0.07, hue + 170), onDeep: oklch(0.96, 0.02, hue + 40), routeLine: oklch(0.8, 0.13, hue + 45),
      };

  const serifStyles = style === 'Cultural' || style === 'Conforto';
  const pool = ALLOWED_FONTS.filter((f) =>
    serifStyles ? /Serif|Mincho|Gloock|Playfair|Abril/.test(f) : !/Serif|Mincho|Gloock|Playfair|Abril/.test(f),
  );
  const family = pool[seed % pool.length];
  const weights = FONT_WEIGHTS[family];
  const weight = weights.includes(800) ? 800 : weights[weights.length - 1];

  const points = [4, 5, 6, 8][(seed >> 4) % 4];
  const motif = (seed >> 6) % 5 === 0 ? 'circle(50% at 50% 50%)' : starPolygon(points, 50, points === 4 ? 22 : 34);

  const slit = (['diamond', 'lens', 'arch', 'band'] as const)[(seed >> 8) % 4];

  const ridgeStyle = /\b(praia|beach|ilha|island|caribe|mar|costa|bahia|nordeste|maldivas|havai|hawaii)\b/.test(d)
    ? 'waves'
    : /\b(deserto|desert|dunas|atacama|dubai|egito|egypt|jordania|namibia)\b/.test(d)
      ? 'dunes'
      : /\b(montanha|serra|chapada|alpes|alps|himalaia|nepal|patagonia|andes|suica|switzerland)\b/.test(d)
        ? 'peaks'
        : /\b(nova york|new york|londres|london|paris|berlim|berlin|cidade|city|seul|seoul|hong kong)\b/.test(d)
          ? 'city'
          : 'hills';

  const tile = 36 + ((seed >> 10) % 4) * 6;
  return {
    idName: `${destination.split(/[,+]/)[0].trim().split(/\s+/).slice(0, 2).join(' ')} ${['Aberto', 'Solar', 'Ritmo', 'Trilha'][(seed >> 12) % 4]}`.slice(0, 40),
    palette,
    display: { family, weight },
    motif,
    pattern: {
      w: tile,
      h: tile,
      shapes: [
        { t: 'poly', points: [[tile / 2, 4], [tile - 4, tile / 2], [tile / 2, tile - 4], [4, tile / 2]], fill: 'none', stroke: 'acc', sw: 2.4 },
        { t: 'circle', cx: tile / 2, cy: tile / 2, r: tile / 9, fill: 'acc3' },
        { t: 'rect', x: 0, y: 0, w: 4, h: 4, fill: 'deep' },
      ],
    },
    slit,
    landscape: {
      sky: dark ? [palette.deep, palette.bg] : [oklch(0.86, 0.06, hue + 30), palette.bg],
      sun: dark ? null : { cx: 980 + (seed % 200), cy: 260, r: 100, color: 'acc2' },
      layers: [
        { style: ridgeStyle, color: 'acc3', base: 560, amp: 220, seed: seed & 0xffff },
        { style: ridgeStyle === 'city' ? 'hills' : ridgeStyle, color: 'acc', base: 680, amp: 160, seed: (seed >> 3) & 0xffff },
        { style: 'hills', color: 'deep', base: 800, amp: 90, seed: (seed >> 7) & 0xffff },
      ],
    },
    sources: [
      `Destino: ${destination}`.slice(0, 48),
      month != null ? `Época: ${MONTHS[month]}` : 'Época: a definir',
      `Estilo ${style.toLowerCase()}`,
      `Variação ${version} por regras`,
    ],
  };
}

/** Identidade local validada. Nunca falha: se a validação recusar, usa o hexágono/fallbacks. */
export function generateRulesIdentity(input: GenInput): DestinationIdentity {
  const raw = generateRulesIdentityInput(input);
  const res = validateIdentity(raw, { key: slugKey(input.destination), generatedBy: 'rules', version: input.version ?? 1 });
  if (res.ok && res.identity) return res.identity;
  // Último recurso: troca o motif por hexágono e tenta de novo.
  const res2 = validateIdentity({ ...raw, motif: HEXAGON }, { key: slugKey(input.destination), generatedBy: 'rules', version: input.version ?? 1 });
  if (res2.ok && res2.identity) return res2.identity;
  throw new Error(`Gerador local produziu identidade inválida: ${res2.problems.join('; ')}`);
}

export function accHueOf(hex: string): number {
  return (hexToOklch(hex)[2] * 180) / Math.PI;
}
