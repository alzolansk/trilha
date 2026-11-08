// Descobrir (planning §5.4): questionário, afinidade local "% com a turma" e a montagem do roteiro sugerido.
import type { TripBundle } from '../data/types';
import { addDays, daysBetween } from './time';

export const VIBES: { id: string; label: string }[] = [
  { id: 'natureza', label: 'Natureza' },
  { id: 'cidade', label: 'Cidade' },
  { id: 'praia', label: 'Praia' },
  { id: 'cultura', label: 'Cultura' },
  { id: 'aventura', label: 'Aventura' },
  { id: 'comida', label: 'Comida' },
];

/** Respostas de uma pessoa (gravadas em `trip_preferences.answers`). Orçamento em unidades inteiras da moeda base. */
export interface DiscoverAnswers {
  budget?: number | null;
  days?: number | null;
  start?: string | null;
  people?: number | null;
  vibes?: string[];
  origin?: string | null;
}

/** Lê com segurança o jsonb (nunca confia no formato). */
export function parseAnswers(raw: unknown): DiscoverAnswers {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : null);
  const ids = new Set(VIBES.map((v) => v.id));
  return {
    budget: num(o.budget, 1_000_000),
    days: num(o.days, 120),
    people: num(o.people, 50),
    start: typeof o.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.start) ? o.start : null,
    vibes: Array.isArray(o.vibes) ? o.vibes.filter((v): v is string => typeof v === 'string' && ids.has(v)).slice(0, 6) : [],
    origin: typeof o.origin === 'string' ? o.origin.slice(0, 80) : null,
  };
}

export interface DestLike { cost_low: number; cost_high: number; tags?: string[] }

/** Quanto o destino atende a uma pessoa (0–1), pelo teto e pelas vibes. `null` se ela não respondeu nenhum dos dois. */
export function personFit(d: DestLike, a: DiscoverAnswers): number | null {
  const parts: number[] = [];
  if (a.budget) parts.push(d.cost_high <= a.budget ? 1 : d.cost_low <= a.budget ? 0.5 : 0);
  if (a.vibes?.length) {
    const tags = new Set((d.tags ?? []).map((t) => t.toLowerCase()));
    parts.push(a.vibes.filter((v) => tags.has(v)).length / a.vibes.length);
  }
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
}

/**
 * "% com a turma": média da adequação de cada pessoa que respondeu. Só aparece com 2 ou mais pessoas
 * respondendo; com uma só devolve `null` (o selo fica de fora).
 */
export function groupAffinity(d: DestLike, answers: DiscoverAnswers[]): number | null {
  const fits = answers.map((a) => personFit(d, a)).filter((x): x is number => x != null);
  if (fits.length < 2) return null;
  return Math.round((fits.reduce((x, y) => x + y, 0) / fits.length) * 100);
}

/**
 * Divide os dias da viagem entre as paradas sugeridas, em ordem, com as noites mais ou menos iguais
 * (o resto vai para as primeiras). A última parada sai no último dia. Sempre ao menos 1 noite por parada.
 */
export function planStops(names: string[], start: string, end: string): { name: string; arrival_date: string; departure_date: string }[] {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  const nights = Math.max(1, daysBetween(start, end));
  const list = clean.slice(0, nights);
  if (!list.length) return [];
  const base = Math.floor(nights / list.length);
  let extra = nights % list.length;
  let cursor = start;
  return list.map((name) => {
    const n = base + (extra-- > 0 ? 1 : 0);
    const out = { name: name.slice(0, 80), arrival_date: cursor, departure_date: addDays(cursor, n) };
    cursor = out.departure_date;
    return out;
  });
}

/** Resumo do roteiro: "Cusco · Machu Picchu · Lima". */
export const routeSummary = (stops: string[]) => stops.join(' · ');

/** Respostas de todos os membros que responderam (a minha primeiro não importa para o cálculo). */
export function teamAnswers(b: Pick<TripBundle, 'tripPreferences' | 'members'>): DiscoverAnswers[] {
  const ids = new Set(b.members.map((m) => m.user_id));
  return (b.tripPreferences ?? []).filter((p) => ids.has(p.user_id)).map((p) => parseAnswers(p.answers));
}
