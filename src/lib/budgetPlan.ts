// Orçamento em conversa (planning §5.5 e §7): calcula o previsto por pessoa a partir do roteiro
// e das respostas da turma (estilo, ritmo, passeios escolhidos, diária de comida).
// Puro e testável. Valores de itens sem preço confirmado continuam ESTIMATIVA na UI.
import type { BudgetKind, BudgetPace, BudgetPlan, BudgetSnapshot, BudgetStyle, TripBundle } from '../data/types';
import { categoryKind, itemCost, toBaseCents, type Rates } from './money';
import { daysBetween } from './time';

export const STYLES: { key: BudgetStyle; label: string; detail: string }[] = [
  { key: 'economico', label: 'Econômico', detail: 'Hostel, mercado e transporte público' },
  { key: 'equilibrado', label: 'Equilibrado', detail: 'Pousada simples e um restaurante por dia' },
  { key: 'conforto', label: 'Conforto', detail: 'Quarto privativo e menos perrengue' },
];
export const PACES: { key: BudgetPace; label: string; detail: string }[] = [
  { key: 'leve', label: 'Leve', detail: 'Um passeio a cada dois dias' },
  { key: 'moderado', label: 'Moderado', detail: 'Um passeio por dia' },
  { key: 'intenso', label: 'Intenso', detail: 'Dois passeios por dia' },
];

/** Multiplica hospedagem sem preço e comida. */
export const STYLE_FACTOR: Record<BudgetStyle, number> = { economico: 0.7, equilibrado: 1, conforto: 1.6 };
/** Passeios por dia livre, para estimar os que ainda não estão no roteiro. */
export const PACE_PER_DAY: Record<BudgetPace, number> = { leve: 0.5, moderado: 1, intenso: 2 };
/** Referências por pessoa no estilo "equilibrado" (centavos da base), usadas só quando falta dado. */
export const DEFAULTS = { nightPerPerson: 12000, foodPerDay: 9000, activity: 10000 };

export interface PlanLine {
  kind: Exclude<BudgetKind, 'outro'>;
  /** por pessoa, centavos da base */
  perPersonCents: number;
  /** parte que veio de referência (sem preço no roteiro): mostrar como estimativa */
  estimatedCents: number;
  /** itens do roteiro sem preço */
  missing: number;
}
export interface PlanResult {
  lines: PlanLine[];
  perPersonCents: number;
  totalCents: number;
  people: number;
  days: number;
  nights: number;
}

const ppl = (b: Pick<TripBundle, 'members'>) => Math.max(1, b.members.length);

/** Calcula o previsto a partir do roteiro e do plano. `rates` converte preços em outra moeda. */
export function budgetFromPlan(b: TripBundle, plan: Pick<BudgetPlan, 'style' | 'pace' | 'activities' | 'daily_food_cents'>, rates: Rates = {}): PlanResult {
  const people = ppl(b);
  const days = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const nights = Math.max(0, days - 1);
  const style = STYLE_FACTOR[plan.style] ?? 1;

  // Transporte: preço por pessoa de cada trecho.
  let tr = 0;
  let trMissing = 0;
  for (const t of b.transports) {
    const v = toBaseCents(t.price_cents, t.price_currency, b.trip.base_currency, rates);
    if (v == null) trMissing++;
    else tr += v;
  }

  // Hospedagem: preço por noite da casa ÷ pessoas; parada com noites e sem preço → referência × estilo.
  let st = 0;
  let stEst = 0;
  let stMissing = 0;
  for (const s of b.stops) {
    const n = Math.max(0, daysBetween(s.arrival_date, s.departure_date));
    if (!n) continue;
    const stay = b.stays.find((x) => x.stop_id === s.id);
    const total = stay ? itemCost(b, 'stay', stay.id, rates) : null;
    if (total == null) {
      stMissing++;
      const v = Math.round(DEFAULTS.nightPerPerson * style) * n;
      st += v;
      stEst += v;
    } else st += Math.round(total / people);
  }

  // Passeios: os escolhidos (ou todos com preço) + dias livres conforme o ritmo.
  const chosen = plan.activities ? b.activities.filter((a) => plan.activities!.includes(a.id)) : b.activities.filter((a) => a.cost_cents != null);
  let ps = 0;
  let psMissing = 0;
  for (const a of chosen) {
    const v = toBaseCents(a.cost_cents, a.cost_currency, b.trip.base_currency, rates);
    if (v == null) psMissing++;
    else ps += v;
  }
  const busyDays = new Set(b.activities.map((a) => a.day)).size;
  const freeDays = Math.max(0, days - busyDays);
  const psEst = Math.round(freeDays * PACE_PER_DAY[plan.pace] * DEFAULTS.activity);
  ps += psEst;

  // Comida: diária confirmada (ou referência) × estilo × dias.
  const food = Math.round((plan.daily_food_cents ?? DEFAULTS.foodPerDay) * (plan.daily_food_cents ? 1 : style)) * days;

  const lines: PlanLine[] = [
    { kind: 'transporte', perPersonCents: tr, estimatedCents: 0, missing: trMissing },
    { kind: 'hospedagem', perPersonCents: st, estimatedCents: stEst, missing: stMissing },
    { kind: 'passeios', perPersonCents: ps, estimatedCents: psEst, missing: psMissing },
    { kind: 'comida', perPersonCents: food, estimatedCents: plan.daily_food_cents ? 0 : food, missing: 0 },
  ];
  const perPersonCents = lines.reduce((a, l) => a + l.perPersonCents, 0);
  return { lines, perPersonCents, totalCents: perPersonCents * people, people, days, nights };
}

/** Novo previsto (turma toda, em reais com 2 casas) por categoria, casando pelo tipo. */
export function plannedUpdates(b: Pick<TripBundle, 'budgetCategories'>, r: PlanResult): { id: string; planned: string }[] {
  const out: { id: string; planned: string }[] = [];
  const seen = new Set<string>();
  for (const c of [...b.budgetCategories].sort((x, y) => x.position - y.position)) {
    const kind = categoryKind(c);
    const line = r.lines.find((l) => l.kind === kind);
    if (!line || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ id: c.id, planned: ((line.perPersonCents * r.people) / 100).toFixed(2) });
  }
  return out;
}

/** Foto do roteiro usado no cálculo. */
export function snapshotOf(b: Pick<TripBundle, 'stops' | 'members'>, now = new Date().toISOString()): BudgetSnapshot {
  return {
    stops: [...b.stops].sort((x, y) => x.position - y.position).map((s) => ({ id: s.id, nights: Math.max(0, daysBetween(s.arrival_date, s.departure_date)) })),
    people: ppl(b),
    at: now,
  };
}

export type PlanChange =
  | { kind: 'stop_added'; stopId: string; name: string }
  | { kind: 'stop_removed'; stopId: string }
  | { kind: 'nights'; stopId: string; name: string; from: number; to: number }
  | { kind: 'people'; from: number; to: number };

/** O que mudou no roteiro desde o último Orçamento ("o roteiro mudou, quer recalcular?"). */
export function diffSince(snap: BudgetSnapshot | null | undefined, b: Pick<TripBundle, 'stops' | 'members'>): PlanChange[] {
  if (!snap) return [];
  const now = snapshotOf(b, snap.at);
  const out: PlanChange[] = [];
  const before = new Map(snap.stops.map((s) => [s.id, s.nights]));
  for (const s of now.stops) {
    const name = b.stops.find((x) => x.id === s.id)?.name ?? '';
    if (!before.has(s.id)) out.push({ kind: 'stop_added', stopId: s.id, name });
    else if (before.get(s.id) !== s.nights) out.push({ kind: 'nights', stopId: s.id, name, from: before.get(s.id)!, to: s.nights });
  }
  for (const s of snap.stops) if (!now.stops.some((x) => x.id === s.id)) out.push({ kind: 'stop_removed', stopId: s.id });
  if (snap.people !== now.people) out.push({ kind: 'people', from: snap.people, to: now.people });
  return out;
}
