// Janela do lugar e perfil da viagem: regras puras (sem rede e sem React), usadas pela tela /montar,
// pela rota de IA e pelos testes. Princípio: a janela encolhe em vez de inventar. Cada bloco só aparece
// com base para ele, e "por que combina com vocês" só cita o que a turma contou.
import type {
  BudgetPace, BudgetStyle, CostKind, PlaceCostLine, PlaceDetail, PlaceHighlight, PlaceType, PlaceVisitStep, TravelProfile, TravelTrait,
} from '../data/types';
import { VIBES } from './discover';
import { haversineKm } from './derive';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const opt = (s: unknown, max: number) => clip(s, max) || null;

export const PLACE_TYPES: PlaceType[] = ['cidade', 'regiao', 'bairro', 'atracao', 'experiencia'];
export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  cidade: 'Cidade', regiao: 'Região', bairro: 'Bairro', atracao: 'Atração', experiencia: 'Experiência',
};

export const asPlaceType = (v: unknown, fallback: PlaceType = 'cidade'): PlaceType => (PLACE_TYPES.includes(v as PlaceType) ? (v as PlaceType) : fallback);

/** Cidade e região pedem noites; bairro, atração e experiência acontecem dentro dos dias de uma cidade. */
export const takesNights = (t: PlaceType | null | undefined) => !t || t === 'cidade' || t === 'regiao';

/** Unidade de tempo da janela: noites (cidade/região), horas ou turnos (bairro) ou duração da visita (atração). */
export function timeUnitLabel(t: PlaceType): string {
  if (takesNights(t)) return 'Quanto tempo · em noites';
  if (t === 'bairro') return 'Quanto tempo · em horas ou turnos';
  return 'Duração da visita';
}

/**
 * Linha de localização sob o nome: bairro e atração mostram a cidade ("em Campinas, SP" / "no Cambuí, Campinas"),
 * nunca só o país; cidade e região mostram estado e país.
 */
export function placeLocation(p: { type?: PlaceType | null; parent?: string | null; region?: string | null; country?: string | null }): string {
  const t = p.type ?? 'cidade';
  const parent = p.parent?.trim();
  if ((t === 'bairro' || t === 'atracao') && parent) return `em ${[parent, p.region?.trim()].filter(Boolean).join(', ')}`;
  if (t === 'experiencia' && parent) return `sai de ${parent}`;
  return [p.region?.trim(), p.country?.trim()].filter(Boolean).join(', ');
}

// ───────────── Perfil da viagem ─────────────

const PACES: BudgetPace[] = ['leve', 'moderado', 'intenso'];
const STAYS: BudgetStyle[] = ['economico', 'equilibrado', 'conforto'];
const VIBE_IDS = new Set(VIBES.map((v) => v.id));

/** Lê o perfil com segurança (jsonb ou resposta da IA já validada pelo zod). null quando não há resumo. */
export function parseProfile(raw: unknown): TravelProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const summary = clip(o.summary, 320);
  if (!summary) return null;
  const traits: TravelTrait[] = (Array.isArray(o.traits) ? o.traits : [])
    .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
    .map((t) => ({ label: clip(t.label, 40), detail: opt(t.detail, 160), evidence: opt(t.evidence, 120) }))
    .filter((t, i, a) => t.label && a.findIndex((x) => fold(x.label) === fold(t.label)) === i)
    .slice(0, 6);
  return {
    summary,
    traits,
    avoid: (Array.isArray(o.avoid) ? o.avoid : []).map((x) => clip(x, 80)).filter(Boolean).slice(0, 4),
    group: opt(o.group, 40),
    vibes: (Array.isArray(o.vibes) ? o.vibes : []).filter((v): v is string => typeof v === 'string' && VIBE_IDS.has(v)).slice(0, 6),
    pace: PACES.includes(o.pace as BudgetPace) ? (o.pace as BudgetPace) : null,
    stay: STAYS.includes(o.stay as BudgetStyle) ? (o.stay as BudgetStyle) : null,
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : new Date().toISOString(),
  };
}

/**
 * Evidência honesta: o trecho citado precisa estar no texto da pessoa (sem acento, por palavras).
 * Se a IA "citou" algo que não foi escrito, a citação sai (o traço fica, sem aspas).
 */
export function keepRealEvidence(profile: TravelProfile, story: string): TravelProfile {
  const text = ` ${fold(story)} `;
  return {
    ...profile,
    traits: profile.traits.map((t) => (t.evidence && text.includes(` ${fold(t.evidence)} `) ? t : { ...t, evidence: null })),
  };
}

/** Rótulos que "por que combina com vocês" pode citar: traços do perfil e gostos marcados. */
export function fitLabels(profile: TravelProfile | null | undefined, vibes: string[] = []): string[] {
  const fromVibes = vibes.map((id) => VIBES.find((v) => v.id === id)?.label ?? '').filter(Boolean);
  const all = [...(profile?.traits ?? []).map((t) => t.label), ...fromVibes];
  return all.filter((l, i) => all.findIndex((x) => fold(x) === fold(l)) === i);
}

/** Texto do perfil para os prompts (o que a turma contou, sem inventar). Vazio quando não há perfil nem texto. */
export function profilePrompt(profile: TravelProfile | null | undefined, story?: string | null): string {
  const lines: string[] = [];
  if (story?.trim()) lines.push(`Como a turma descreveu a viagem, nas palavras dela: "${story.trim().replace(/"/g, "'").slice(0, 900)}".`);
  if (profile) {
    lines.push(`Perfil entendido: ${profile.summary}`);
    if (profile.traits.length) lines.push(`Traços (use estes rótulos exatos ao justificar): ${profile.traits.map((t) => `"${t.label}"${t.detail ? ` (${t.detail})` : ''}`).join('; ')}.`);
    if (profile.avoid.length) lines.push(`Querem evitar: ${profile.avoid.join('; ')}.`);
    if (profile.group) lines.push(`Quem vai: ${profile.group}.`);
  }
  return lines.join('\n');
}

// ───────────── Detalhe do lugar (normalização da resposta da IA) ─────────────

export interface RawDetail {
  name: string;
  type?: string | null;
  parent?: string | null;
  country: string;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  summary: string;
  why_go: string[];
  fit?: { trait: string; text: string }[];
  for_whom?: string | null;
  caveats?: string[];
  time: { label: string; options?: { label: string; text: string; suggested?: boolean | null }[]; why: string; stay_base?: boolean | null };
  best_moment?: string | null;
  getting_around?: string | null;
  highlights?: {
    name: string; scope?: string | null; what: string; why?: string | null; duration?: string | null; cost?: string | null;
    booking?: string | null; lat?: number | null; lng?: number | null;
  }[];
  visit?: { when: string; text: string; refs?: number[] }[];
  practical?: {
    getting_there?: string | null; best_time?: string | null;
    costs?: { item: string; low: number; high: number; unit: string }[];
    cost_note?: string | null; limits?: string[]; check_at?: string | null;
  };
}

const COSTS: CostKind[] = ['gratis', 'pago', 'varia'];
/** Domínio limpo ("www.campinas.sp.gov.br/x" → "campinas.sp.gov.br"); null se não parece domínio. */
export function cleanDomain(v: string | null | undefined): string | null {
  const d = (v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 80 ? d : null;
}

/**
 * Normaliza o detalhe da IA:
 * - "por que combina" só fica com motivos ligados a um rótulo que a turma informou (traço ou gosto);
 *   sem nenhum rótulo, a janela usa "para quem é";
 * - uma única opção de tempo sugerida; noites só para cidade/região;
 * - custos em centavos (a IA manda unidades da moeda), faixas em ordem;
 * - passos da visita citam só destaques que existem;
 * - coordenadas dos destaques longe demais do lugar (> 60 km) são descartadas.
 */
export function normalizeDetail(raw: RawDetail, ctx: { labels: string[]; currency: string; fair?: (s: string) => boolean; now?: string }): PlaceDetail {
  const fair = ctx.fair ?? (() => true);
  const ok = (s: string | null | undefined) => !!s && fair(s);
  const type = asPlaceType(raw.type);
  const labels = new Map(ctx.labels.map((l) => [fold(l), l]));
  const fit = (raw.fit ?? [])
    .map((f) => ({ trait: labels.get(fold(f.trait)) ?? '', text: clip(f.text, 240) }))
    .filter((f, i, a) => f.trait && f.text && fair(f.text) && a.findIndex((x) => x.trait === f.trait) === i)
    .slice(0, 4);
  const center = raw.lat != null && raw.lng != null ? ([raw.lat, raw.lng] as [number, number]) : null;
  const highlights: PlaceHighlight[] = (raw.highlights ?? [])
    .filter((h) => clip(h.name, 80) && ok(h.what))
    .slice(0, 5)
    .map((h) => {
      const hasCoord = h.lat != null && h.lng != null && Number.isFinite(h.lat) && Number.isFinite(h.lng);
      const near = hasCoord && (!center || haversineKm(center, [h.lat!, h.lng!]) <= 60);
      return {
        name: clip(h.name, 80),
        scope: h.scope === 'amplo' ? 'amplo' : 'especifico',
        what: clip(h.what, 220),
        why: ok(h.why) ? clip(h.why, 200) : null,
        duration: opt(h.duration, 40),
        cost: COSTS.includes(h.cost as CostKind) ? (h.cost as CostKind) : null,
        booking: ok(h.booking) ? clip(h.booking, 80) : null,
        lat: near ? h.lat! : null,
        lng: near ? h.lng! : null,
      };
    });
  const options = (raw.time.options ?? []).map((o) => ({ label: clip(o.label, 40), text: clip(o.text, 160), suggested: !!o.suggested })).filter((o) => o.label && o.text).slice(0, 3);
  const firstSuggested = options.findIndex((o) => o.suggested);
  const pick = firstSuggested >= 0 ? firstSuggested : options.length ? options.length - 1 : -1;
  const visit: PlaceVisitStep[] = (raw.visit ?? [])
    .filter((v) => clip(v.when, 30) && ok(v.text))
    .slice(0, 5)
    .map((v) => ({ when: clip(v.when, 30), text: clip(v.text, 180), refs: [...new Set((v.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= highlights.length))] }));
  const p = raw.practical ?? {};
  const costs: PlaceCostLine[] = (p.costs ?? [])
    .filter((c) => clip(c.item, 60) && Number.isFinite(c.low) && Number.isFinite(c.high) && c.low >= 0 && c.high >= 0)
    .slice(0, 6)
    .map((c) => ({ item: clip(c.item, 60), low: Math.round(Math.min(c.low, c.high) * 100), high: Math.round(Math.max(c.low, c.high) * 100), unit: clip(c.unit, 30) || 'por pessoa' }));
  return {
    name: clip(raw.name, 80),
    type,
    parent: opt(raw.parent, 80),
    country: clip(raw.country, 60),
    region: opt(raw.region, 80),
    lat: center?.[0] ?? null,
    lng: center?.[1] ?? null,
    summary: clip(raw.summary, 260),
    why_go: raw.why_go.map((x) => clip(x, 600)).filter((x) => x && fair(x)).slice(0, 2),
    fit,
    for_whom: ok(raw.for_whom) ? clip(raw.for_whom, 240) : null,
    caveats: (raw.caveats ?? []).map((x) => clip(x, 200)).filter((x) => x && fair(x)).slice(0, 3),
    time: {
      label: clip(raw.time.label, 40),
      options: options.map((o, i) => ({ ...o, suggested: i === pick })),
      why: ok(raw.time.why) ? clip(raw.time.why, 320) : '',
      stay_base: type === 'bairro' && typeof raw.time.stay_base === 'boolean' ? raw.time.stay_base : null,
    },
    best_moment: opt(raw.best_moment, 60),
    getting_around: opt(raw.getting_around, 60),
    highlights,
    visit: visit.length >= 2 ? visit : [],
    practical: {
      getting_there: ok(p.getting_there) ? clip(p.getting_there, 320) : null,
      best_time: ok(p.best_time) ? clip(p.best_time, 320) : null,
      costs,
      cost_note: opt(p.cost_note, 160),
      limits: (p.limits ?? []).map((x) => clip(x, 160)).filter((x) => x && fair(x)).slice(0, 4),
      check_at: cleanDomain(p.check_at),
    },
    currency: ctx.currency,
    generated_at: ctx.now ?? new Date().toISOString(),
  };
}

// ───────────── Minimapa dos destaques ─────────────

export interface MiniPin { n: number; x: number; y: number; scope: PlaceHighlight['scope'] }

/**
 * Posições relativas dos destaques numa caixa w×h (projeção simples, ok para distâncias de bairro e cidade).
 * Devolve também a maior distância entre dois destaques, em km, para a legenda. Menos de 2 pontos: null.
 */
export function miniMap(highlights: Pick<PlaceHighlight, 'lat' | 'lng' | 'scope'>[], w: number, h: number, pad = 22): { pins: MiniPin[]; spanKm: number } | null {
  const pts = highlights.map((x, i) => ({ ...x, n: i + 1 })).filter((x) => x.lat != null && x.lng != null);
  if (pts.length < 2) return null;
  const midLat = pts.reduce((a, p) => a + p.lat!, 0) / pts.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => p.lng! * k);
  const ys = pts.map((p) => p.lat!);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 0.002);
  const scale = Math.min((w - pad * 2) / span, (h - pad * 2) / span);
  const offX = (w - (maxX - minX) * scale) / 2;
  const offY = (h - (maxY - minY) * scale) / 2;
  let spanKm = 0;
  for (const a of pts) for (const b of pts) spanKm = Math.max(spanKm, haversineKm([a.lat!, a.lng!], [b.lat!, b.lng!]));
  return {
    pins: pts.map((p, i) => ({ n: p.n, scope: p.scope, x: Math.round(offX + (xs[i] - minX) * scale), y: Math.round(h - (offY + (ys[i] - minY) * scale)) })),
    spanKm: Math.round(spanKm * 10) / 10,
  };
}

/** Legenda de distância: "Tudo a até ~1,2 km" (a pé até ~2 km) ou "até ~25 km entre os pontos". */
export function spanLabel(km: number): string {
  const v = km < 10 ? String(Math.max(0.1, Math.round(km * 10) / 10)).replace('.', ',') : String(Math.round(km));
  return km <= 2 ? `Tudo a até ~${v} km, dá pra fazer a pé` : `Até ~${v} km entre os pontos`;
}
