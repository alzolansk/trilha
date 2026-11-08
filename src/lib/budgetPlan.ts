// Orçamento em conversa (planning §5.5 e §7): calcula o previsto por pessoa a partir do roteiro
// e das respostas da turma (estilo, ritmo, passeios escolhidos, diária de comida).
// Puro e testável. Valores de itens sem preço confirmado continuam ESTIMATIVA na UI.
import type { BudgetFood, BudgetKind, BudgetPace, BudgetPlan, BudgetSnapshot, BudgetStyle, Transport, TripBundle } from '../data/types';
import { categoryKind, itemCost, toBaseCents, type Rates } from './money';
import { estimateCents } from './suggestions';
import { daysBetween } from './time';

/** Estilos de hospedagem do Orçamento (canvas: Hostel / Pousada / Hotel). */
export const STYLES: { key: BudgetStyle; label: string; detail: string; note: string }[] = [
  { key: 'economico', label: 'Hostel', detail: 'quarto da turma, banheiro dividido', note: 'Mais barato e menos sossego. Vale procurar quarto privativo para a turma.' },
  { key: 'equilibrado', label: 'Pousada', detail: 'quarto para a turma, café incluso', note: 'O meio-termo: pousadas simples em bairro central costumam caber nesse valor.' },
  { key: 'conforto', label: 'Hotel', detail: 'mais conforto, nem sempre no melhor bairro', note: 'Hotel nessa faixa às vezes fica longe do centro. Confira o bairro antes de reservar.' },
];
export const PACES: { key: BudgetPace; label: string; detail: string }[] = [
  { key: 'leve', label: 'Leve', detail: 'Um passeio a cada dois dias' },
  { key: 'moderado', label: 'Moderado', detail: 'Um passeio por dia' },
  { key: 'intenso', label: 'Intenso', detail: 'Dois passeios por dia' },
];

/** Multiplica hospedagem sem preço e comida. */
export const STYLE_FACTOR: Record<BudgetStyle, number> = { economico: 0.6, equilibrado: 1, conforto: 1.9 };
/** Passeios por dia livre, para estimar os que ainda não estão no roteiro. */
export const PACE_PER_DAY: Record<BudgetPace, number> = { leve: 0.5, moderado: 1, intenso: 2 };
/** Referências por pessoa no estilo "equilibrado" (centavos da base), usadas só quando falta dado. */
export const DEFAULTS = { nightPerPerson: 9000, foodPerDay: 7000, activity: 10000 };

/** Ritmos de comida (canvas: Econômico / Médio / Solto), em fração da diária de referência. */
export const FOODS: { key: BudgetFood; label: string; factor: number }[] = [
  { key: 'econ', label: 'Econômico', factor: 0.65 },
  { key: 'medio', label: 'Médio', factor: 1 },
  { key: 'solto', label: 'Solto', factor: 1.7 },
];

/** Diária por pessoa de cada ritmo. Com uma faixa estimada (IA), usa mínimo, média e máximo dela. */
export function foodLevels(range?: { low: number; high: number } | null): Record<BudgetFood, number> {
  if (range && range.high > 0) {
    const lo = Math.min(range.low, range.high);
    const hi = Math.max(range.low, range.high);
    return { econ: Math.round(lo), medio: Math.round((lo + hi) / 2), solto: Math.round(hi) };
  }
  return Object.fromEntries(FOODS.map((f) => [f.key, Math.round(DEFAULTS.foodPerDay * f.factor)])) as Record<BudgetFood, number>;
}

/** Valor da noite por pessoa de cada estilo, para paradas sem hospedagem com preço. */
export const nightFor = (style: BudgetStyle) => Math.round(DEFAULTS.nightPerPerson * (STYLE_FACTOR[style] ?? 1));

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
export function budgetFromPlan(b: TripBundle, plan: Pick<BudgetPlan, 'style' | 'pace' | 'activities' | 'daily_food_cents' | 'transport_cents' | 'stay_estimates'>, rates: Rates = {}): PlanResult {
  const people = ppl(b);
  const days = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const nights = Math.max(0, days - 1);
  const style = STYLE_FACTOR[plan.style] ?? 1;

  // Transporte: preço por pessoa de cada trecho.
  // Trecho sem preço usa o valor que a turma aceitou no Orçamento (transport_cents), como estimativa.
  let tr = 0;
  let trEst = 0;
  let trMissing = 0;
  for (const t of b.transports) {
    const v = toBaseCents(t.price_cents, t.price_currency, b.trip.base_currency, rates);
    const o = plan.transport_cents?.[t.id];
    if (v != null) { tr += v; if (t.price_is_estimate ?? true) trEst += v; }
    else if (o != null) {
      tr += o;
      trEst += o;
    } else trMissing++;
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
    const range = plan.stay_estimates?.[s.id]?.[plan.style];
    if (range && stay?.status !== 'booked' && stay?.price_is_estimate !== false) {
      const v = Math.round((range.low + range.high) / 2) * n;
      st += v; stEst += v; continue;
    }
    if (total == null) {
      stMissing++;
      const v = nightFor(plan.style) * n;
      st += v;
      stEst += v;
    } else {
      // Preço confirmado ou reserva feita não muda com o estilo. Uma referência de
      // hospedagem ainda pendente acompanha a escolha, sem alterar o item no roteiro.
      const flexible = stay?.status !== 'booked' && (stay?.price_is_estimate ?? true);
      const v = Math.round(total / people * (flexible ? style : 1));
      st += v; if (stay?.price_is_estimate ?? true) stEst += v;
    }
  }

  // Passeios: com seleção explícita (Orçamento em conversa), só os escolhidos — atividades do roteiro e
  // sugestões da Trilha. Sem seleção, todos com preço + uma reserva para os dias livres conforme o ritmo.
  let ps = 0;
  let psEst = 0;
  let psMissing = 0;
  if (plan.activities) {
    for (const o of tourOptions(b, rates).filter((x) => plan.activities!.includes(x.id))) {
      if (o.perPersonCents == null) psMissing++;
      else {
        ps += o.perPersonCents;
        if (o.isEstimate) psEst += o.perPersonCents;
      }
    }
  } else {
    for (const a of b.activities.filter((x) => x.cost_cents != null)) {
      const v = toBaseCents(a.cost_cents, a.cost_currency, b.trip.base_currency, rates);
      if (v == null) psMissing++;
      else ps += v;
    }
    const busyDays = new Set(b.activities.map((a) => a.day)).size;
    const freeDays = Math.max(0, days - busyDays);
    const extra = Math.round(freeDays * PACE_PER_DAY[plan.pace] * DEFAULTS.activity);
    ps += extra;
    psEst += extra;
  }

  // Comida: diária confirmada (ou referência) × estilo × dias.
  const food = Math.round((plan.daily_food_cents ?? DEFAULTS.foodPerDay) * (plan.daily_food_cents != null ? 1 : style)) * days;

  const lines: PlanLine[] = [
    { kind: 'transporte', perPersonCents: tr, estimatedCents: trEst, missing: trMissing },
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

// ───────────── Passos do Orçamento em conversa (planning §5.5) ─────────────

export interface TransportLeg {
  id: string;
  title: string;
  /** por pessoa, na base; null = sem preço */
  perPersonCents: number | null;
  /** 'roteiro' = preço gravado no trecho; 'trilha' = aceito no Orçamento (estimativa) */
  from: 'roteiro' | 'trilha' | null;
  isEstimate: boolean;
}

const LEG_MODE: Record<string, string> = { plane: 'Voo', bus: 'Ônibus', train: 'Trem', car: 'Carro', boat: 'Barco', walk: 'A pé', other: 'Trecho' };

/** Nome do trecho: "Voo Lima → Cusco". Sem origem, usa a parada anterior (ou a origem da trilha). */
export function legTitle(b: Pick<TripBundle, 'stops' | 'trip'>, t: Transport): string {
  const stops = [...b.stops].sort((x, y) => x.position - y.position);
  const i = stops.findIndex((s) => s.id === t.stop_id);
  const from = t.origin_name ?? t.origin_code ?? (i > 0 ? stops[i - 1].name : b.trip.origin) ?? null;
  const to = t.dest_name ?? t.dest_code ?? stops[i]?.name ?? null;
  const mode = LEG_MODE[t.mode] ?? 'Trecho';
  return [mode, [from, to].filter(Boolean).join(' → ')].filter(Boolean).join(' ');
}

/** Passo 1: cada trecho do roteiro com o valor por pessoa (confirmado, estimado ou faltando). */
export function transportLegs(b: TripBundle, plan: Pick<BudgetPlan, 'transport_cents'> | null | undefined, rates: Rates = {}): TransportLeg[] {
  const order = new Map([...b.stops].sort((x, y) => x.position - y.position).map((s, i) => [s.id, i]));
  return [...b.transports]
    .sort((x, y) => (order.get(x.stop_id) ?? 0) - (order.get(y.stop_id) ?? 0) || (x.depart_date ?? '').localeCompare(y.depart_date ?? ''))
    .map((t) => {
      const v = toBaseCents(t.price_cents, t.price_currency, b.trip.base_currency, rates);
      const o = plan?.transport_cents?.[t.id];
      if (v != null) return { id: t.id, title: legTitle(b, t), perPersonCents: v, from: 'roteiro' as const, isEstimate: t.price_is_estimate ?? true };
      if (o != null) return { id: t.id, title: legTitle(b, t), perPersonCents: o, from: 'trilha' as const, isEstimate: true };
      return { id: t.id, title: legTitle(b, t), perPersonCents: null, from: null, isEstimate: false };
    });
}

export interface StayOption {
  key: BudgetStyle;
  label: string;
  detail: string;
  note: string;
  /** noite por pessoa usada nas paradas sem hospedagem com preço */
  nightCents: number;
  /** hospedagem por pessoa na viagem toda, com este estilo */
  perPersonCents: number;
}

/** Passo 2: as 3 opções de estilo, já com o total por pessoa (estadias com preço entram com o valor real). */
export function stayOptions(b: TripBundle, rates: Rates = {}, plan?: Pick<BudgetPlan, 'stay_estimates'>): { options: StayOption[]; nights: number; fixed: number } {
  const options = STYLES.map((st) => {
    const r = budgetFromPlan(b, { ...plan, style: st.key, pace: 'moderado', activities: [], daily_food_cents: 0 }, rates);
    return { ...st, nightCents: nightFor(st.key), perPersonCents: r.lines.find((l) => l.kind === 'hospedagem')!.perPersonCents };
  });
  const nights = b.stops.reduce((a, s) => a + Math.max(0, daysBetween(s.arrival_date, s.departure_date)), 0);
  const fixed = b.stops.filter((s) => {
    const stay = b.stays.find((x) => x.stop_id === s.id);
    return stay && (stay.status === 'booked' || stay.price_is_estimate === false) && itemCost(b, 'stay', stay.id, rates) != null;
  }).length;
  return { options, nights, fixed };
}

export interface TourOption {
  /** id da atividade ou da sugestão */
  id: string;
  type: 'activity' | 'suggestion';
  title: string;
  /** "no roteiro · dia 7" / "sugestão da Trilha" / "em votação" */
  tag: string;
  perPersonCents: number | null;
  isEstimate: boolean;
}

/** Passo 3: atividades do roteiro com custo e sugestões de passeio ainda abertas. */
export function tourOptions(b: TripBundle, rates: Rates = {}): TourOption[] {
  const base = b.trip.base_currency;
  const acts = [...b.activities]
    .filter((a) => a.cost_cents != null)
    .sort((x, y) => x.day.localeCompare(y.day) || x.position - y.position)
    .map((a) => ({
      id: a.id, type: 'activity' as const, title: a.title, tag: `no roteiro · dia ${daysBetween(b.trip.start_date, a.day) + 1}`,
      perPersonCents: toBaseCents(a.cost_cents, a.cost_currency, base, rates), isEstimate: a.cost_is_estimate ?? true,
    }));
  const sugs = (b.suggestions ?? [])
    .filter((s) => s.kind === 'activity' && (s.status === 'new' || s.status === 'voting'))
    .map((s) => ({
      id: s.id, type: 'suggestion' as const, title: s.payload.title, tag: s.status === 'voting' ? 'em votação' : 'sugestão da Trilha',
      perPersonCents: toBaseCents(estimateCents(s), s.payload.currency ?? base, base, rates), isEstimate: true,
    }));
  return [...acts, ...sugs];
}

/** Respostas iniciais: as gravadas, ou um ponto de partida (pousada, médio, passeios do roteiro marcados). */
export function initialPlan(b: TripBundle, rates: Rates = {}): BudgetPlan {
  const saved = b.trip.budget_plan;
  const tours = tourOptions(b, rates);
  const food = saved?.food ?? 'medio';
  return {
    style: saved?.style ?? 'equilibrado',
    pace: saved?.pace ?? 'moderado',
    food,
    daily_food_cents: saved?.daily_food_cents ?? foodLevels()[food],
    // ids que sumiram (atividade apagada, sugestão dispensada) saem da seleção
    activities: saved?.activities ? saved.activities.filter((id) => tours.some((t) => t.id === id)) : tours.filter((t) => t.type === 'activity').map((t) => t.id),
    transport_cents: saved?.transport_cents ?? {},
    stay_estimates: saved?.stay_estimates,
    snapshot: saved?.snapshot ?? null,
    updated_at: saved?.updated_at,
  };
}

/** Teto por pessoa (trips.budget_total ÷ turma), quando existe. */
export function capPerPerson(b: Pick<TripBundle, 'trip' | 'members'>): number | null {
  const t = b.trip.budget_total;
  if (t == null || t === '') return null;
  const c = Math.round(Number(t) * 100);
  return c > 0 ? Math.round(c / ppl(b)) : null;
}

/** Frase do aviso "Mudou desde a última vez". */
export function describeChanges(changes: PlanChange[]): string[] {
  return changes.map((c) => {
    if (c.kind === 'stop_added') return `+1 parada (${c.name})`;
    if (c.kind === 'stop_removed') return '-1 parada';
    if (c.kind === 'nights') return `${c.name}: ${c.from} → ${c.to} noites`;
    return `turma: ${c.from} → ${c.to} pessoas`;
  });
}
