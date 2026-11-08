// Orçamento em conversa (planning §5.5 e §7): calcula o previsto por pessoa a partir do roteiro
// e das respostas da turma (estilo, ritmo, passeios escolhidos, diária de comida).
// Puro e testável. Valores de itens sem preço confirmado continuam ESTIMATIVA na UI.
import type { BudgetFood, BudgetKind, BudgetPace, BudgetPlan, BudgetSnapshot, BudgetStyle, Transport, TripBundle } from '../data/types';
import { categoryKind, itemCost, toBaseCents, type Rates } from './money';
import { estimateCents } from './suggestions';
import { headcount } from './people';
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

/** Trajeto da cidade-dormitório: uma ida e volta por noite (no dia da chegada já se dorme lá). Centavos por pessoa. */
export const commuteCost = (base: { commute_pp_day: number }, nights: number) => Math.max(0, Math.round(base.commute_pp_day)) * Math.max(1, nights);

/** Id do trajeto diário de uma parada nos trechos do Orçamento (`transport_cents` aceita um valor digitado). */
export const commuteId = (stopId: string) => `cm:${stopId}`;

/** Paradas que dormem numa cidade vizinha: o trajeto diário entra no transporte, como estimativa. */
export function commuteLegs(b: Pick<TripBundle, 'stops'>, plan: Pick<BudgetPlan, 'transport_cents'> | null | undefined): { id: string; stopId: string; title: string; perPersonCents: number }[] {
  return [...b.stops].sort((x, y) => x.position - y.position).filter((s) => s.stay_base?.name).map((s) => {
    const n = Math.max(0, daysBetween(s.arrival_date, s.departure_date));
    const id = commuteId(s.id);
    return { id, stopId: s.id, title: `Trajeto diário ${s.stay_base!.name} ↔ ${s.name}`, perPersonCents: plan?.transport_cents?.[id] ?? commuteCost(s.stay_base!, n) };
  });
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
  /** noites da viagem sem cidade no roteiro (entram pela referência do estilo, como estimativa) */
  uncoveredNights: number;
  /** roteiro sem nenhuma parada: o total não é mostrado (planning §10.10) */
  empty: boolean;
  /** voo de ida/volta sem trecho no roteiro e ainda sem valor: avisa, mas não bloqueia o fechamento */
  pendingVirtual: number;
}

/** Trecho que ainda não existe no roteiro: voo de ida (origem → 1ª parada) ou de volta (última → origem). */
export interface VirtualLeg {
  key: 'ida' | 'volta';
  title: string;
}

/** Voo de ida e volta que faltam no roteiro, quando a trilha tem origem (planning §10.10.3). */
export function virtualLegs(b: Pick<TripBundle, 'trip' | 'stops' | 'transports'>): VirtualLeg[] {
  const origin = b.trip.origin?.trim();
  const stops = [...b.stops].sort((x, y) => x.position - y.position);
  if (!origin || !stops.length) return [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  const out: VirtualLeg[] = [];
  if (!b.transports.some((t) => t.stop_id === first.id && !t.is_return)) out.push({ key: 'ida', title: `Voo ${origin} → ${first.name}` });
  if (!b.transports.some((t) => t.is_return)) out.push({ key: 'volta', title: `Voo ${last.name} → ${origin}` });
  return out;
}

const ppl = (b: Pick<TripBundle, 'members'> & { trip?: Pick<TripBundle['trip'], 'party_size'> }) => headcount(b);

/** Calcula o previsto a partir do roteiro e do plano. `rates` converte preços em outra moeda. */
export function budgetFromPlan(b: TripBundle, plan: Pick<BudgetPlan, 'style' | 'pace' | 'activities' | 'daily_food_cents' | 'transport_cents' | 'stay_estimates'>, rates: Rates = {}): PlanResult {
  const people = ppl(b);
  const days = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const nights = Math.max(0, days - 1);
  const style = STYLE_FACTOR[plan.style] ?? 1;
  const empty = b.stops.length === 0;

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
  // Voo de ida/volta que ainda não está no roteiro: entra com o valor aceito (estimativa) ou fica pendente.
  let pendingVirtual = 0;
  for (const v of virtualLegs(b)) {
    const o = plan.transport_cents?.[v.key];
    if (o != null) { tr += o; trEst += o; } else pendingVirtual++;
  }

  // Trajeto diário de quem dorme numa cidade vizinha (estimativa, ou o valor digitado no Orçamento).
  for (const c of commuteLegs(b, plan)) { tr += c.perPersonCents; trEst += c.perPersonCents; }

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

  // Noites da viagem sem cidade no roteiro: referência do estilo (ou a média das faixas já estimadas).
  const covered = b.stops.reduce((a, s) => a + Math.max(0, daysBetween(s.arrival_date, s.departure_date)), 0);
  const uncoveredNights = Math.max(0, nights - covered);
  if (uncoveredNights > 0) {
    const known = Object.values(plan.stay_estimates ?? {}).map((x) => x[plan.style]).filter((x): x is { low: number; high: number } => !!x);
    const night = known.length ? Math.round(known.reduce((a, r) => a + (r.low + r.high) / 2, 0) / known.length) : nightFor(plan.style);
    st += night * uncoveredNights;
    stEst += night * uncoveredNights;
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
  return { lines, perPersonCents, totalCents: perPersonCents * people, people, days, nights, uncoveredNights, empty, pendingVirtual };
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

/** Foto do roteiro usado no cálculo (com o valor por pessoa de cada categoria, quando há resultado). */
export function snapshotOf(b: Pick<TripBundle, 'stops' | 'members'> & { trip?: Pick<TripBundle['trip'], 'party_size'> }, now = new Date().toISOString(), result?: PlanResult): BudgetSnapshot {
  return {
    stops: [...b.stops].sort((x, y) => x.position - y.position).map((s) => ({ id: s.id, nights: Math.max(0, daysBetween(s.arrival_date, s.departure_date)) })),
    people: ppl(b),
    at: now,
    ...(result ? { lines: Object.fromEntries(result.lines.map((l) => [l.kind, l.perPersonCents])) } : {}),
  };
}

export type PlanChange =
  | { kind: 'stop_added'; stopId: string; name: string }
  | { kind: 'stop_removed'; stopId: string }
  | { kind: 'nights'; stopId: string; name: string; from: number; to: number }
  | { kind: 'people'; from: number; to: number }
  | { kind: 'money'; line: PlanLine['kind']; delta: number };

/** O que mudou no roteiro desde o último Orçamento ("o roteiro mudou, quer recalcular?"). */
export function diffSince(snap: BudgetSnapshot | null | undefined, b: Pick<TripBundle, 'stops' | 'members'> & { trip?: Pick<TripBundle['trip'], 'party_size'> }, current?: PlanResult): PlanChange[] {
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
  // Diferença de valor por pessoa em cada categoria (ignora menos de 1 unidade da moeda).
  if (snap.lines && current) {
    for (const l of current.lines) {
      const before = snap.lines[l.kind];
      if (before == null) continue;
      const delta = l.perPersonCents - before;
      if (Math.abs(delta) >= 100) out.push({ kind: 'money', line: l.kind, delta });
    }
  }
  return out;
}

// ───────────── Passos do Orçamento em conversa (planning §5.5) ─────────────

export interface TransportLeg {
  /** id do trecho, ou 'ida'/'volta' para o voo que ainda não está no roteiro */
  id: string;
  /** voo de ida/volta calculado pela Trilha, sem trecho gravado */
  virtual?: boolean;
  title: string;
  /** por pessoa, na base; null = sem preço */
  perPersonCents: number | null;
  /** 'roteiro' = preço gravado no trecho; 'trilha' = aceito no Orçamento (estimativa) */
  from: 'roteiro' | 'trilha' | null;
  isEstimate: boolean;
  /** trajeto diário da cidade-dormitório até a parada */
  commute?: boolean;
}

const LEG_MODE: Record<string, string> = { plane: 'Voo', bus: 'Ônibus', train: 'Trem', car: 'Carro', boat: 'Barco', walk: 'A pé', other: 'Trecho' };

/** Nome do trecho: "Voo Lima → Cusco". Sem origem, usa a parada anterior (ou a origem da trilha). */
export function legTitle(b: Pick<TripBundle, 'stops' | 'trip'>, t: Transport): string {
  const stops = [...b.stops].sort((x, y) => x.position - y.position);
  const i = stops.findIndex((s) => s.id === t.stop_id);
  const from = t.is_return ? t.origin_name ?? stops[i]?.name ?? null : t.origin_name ?? t.origin_code ?? (i > 0 ? stops[i - 1].name : b.trip.origin) ?? null;
  const to = t.is_return ? t.dest_name ?? b.trip.origin ?? null : t.dest_name ?? t.dest_code ?? stops[i]?.name ?? null;
  const mode = LEG_MODE[t.mode] ?? 'Trecho';
  return [mode, [from, to].filter(Boolean).join(' → ')].filter(Boolean).join(' ');
}

/** Passo 1: cada trecho do roteiro com o valor por pessoa (confirmado, estimado ou faltando). */
export function transportLegs(b: TripBundle, plan: Pick<BudgetPlan, 'transport_cents'> | null | undefined, rates: Rates = {}): TransportLeg[] {
  const order = new Map([...b.stops].sort((x, y) => x.position - y.position).map((s, i) => [s.id, i]));
  const virtual = virtualLegs(b).map((v): TransportLeg => {
    const o = plan?.transport_cents?.[v.key];
    return { id: v.key, virtual: true, title: v.title, perPersonCents: o ?? null, from: o != null ? 'trilha' : null, isEstimate: o != null };
  });
  const real = [...b.transports]
    .sort((x, y) => Number(!!x.is_return) - Number(!!y.is_return) || (order.get(x.stop_id) ?? 0) - (order.get(y.stop_id) ?? 0) || (x.depart_date ?? '').localeCompare(y.depart_date ?? ''))
    .map((t) => {
      const v = toBaseCents(t.price_cents, t.price_currency, b.trip.base_currency, rates);
      const o = plan?.transport_cents?.[t.id];
      if (v != null) return { id: t.id, title: legTitle(b, t), perPersonCents: v, from: 'roteiro' as const, isEstimate: t.price_is_estimate ?? true };
      if (o != null) return { id: t.id, title: legTitle(b, t), perPersonCents: o, from: 'trilha' as const, isEstimate: true };
      return { id: t.id, title: legTitle(b, t), perPersonCents: null, from: null, isEstimate: false };
    });
  const commute = commuteLegs(b, plan).map((c): TransportLeg => ({ id: c.id, title: c.title, perPersonCents: c.perPersonCents, from: 'trilha', isEstimate: true, commute: true }));
  return [...virtual.filter((v) => v.id === 'ida'), ...real, ...commute, ...virtual.filter((v) => v.id === 'volta')];
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
    transport_ranges: saved?.transport_ranges ?? null,
    food_range: saved?.food_range ?? null,
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

const LINE_NAME: Record<PlanLine['kind'], string> = { transporte: 'transporte', hospedagem: 'hospedagem', passeios: 'passeios', comida: 'comida' };

/** Frase do aviso "Mudou desde a última vez". `money` formata centavos (ex.: "R$ 310"). */
export function describeChanges(changes: PlanChange[], money: (cents: number) => string = (c) => (c / 100).toFixed(0)): string[] {
  return changes.map((c) => {
    if (c.kind === 'money') return `${c.delta > 0 ? '+' : '-'}${money(Math.abs(c.delta))} em ${LINE_NAME[c.line]} por pessoa`;
    if (c.kind === 'stop_added') return `+1 parada (${c.name})`;
    if (c.kind === 'stop_removed') return '-1 parada';
    if (c.kind === 'nights') return `${c.name}: ${c.from} → ${c.to} noites`;
    return `turma: ${c.from} → ${c.to} pessoas`;
  });
}

/** Fração de incerteza por tipo quando não há faixa guardada. */
const SPREAD: Record<PlanLine['kind'], number> = { transporte: 0.25, hospedagem: 0.25, passeios: 0.2, comida: 0.25 };

/**
 * Faixa do total por pessoa (planning §10.10.4): valores confirmados entram iguais nos três; a parte estimada
 * varia pela largura das faixas guardadas no plano (trechos, diárias, comida) ou, sem elas, por SPREAD.
 */
export function budgetRange(r: PlanResult, plan: Pick<BudgetPlan, 'style' | 'stay_estimates' | 'food_range' | 'transport_ranges'>): { low: number; mid: number; high: number } {
  const width = (rs: { low: number; high: number }[]) => {
    const ok = rs.filter((x) => x.high > 0);
    if (!ok.length) return null;
    return ok.reduce((a, x) => a + (x.high - x.low) / (x.high + x.low), 0) / ok.length;
  };
  const known: Partial<Record<PlanLine['kind'], number | null>> = {
    transporte: width(Object.values(plan.transport_ranges ?? {})),
    hospedagem: width(Object.values(plan.stay_estimates ?? {}).map((x) => x[plan.style]).filter((x): x is { low: number; high: number } => !!x)),
    comida: plan.food_range ? width([plan.food_range]) : null,
  };
  let low = 0;
  let high = 0;
  for (const l of r.lines) {
    const k = Math.min(0.6, known[l.kind] ?? SPREAD[l.kind]);
    const est = Math.min(l.perPersonCents, l.estimatedCents);
    low += l.perPersonCents - Math.round(est * k);
    high += l.perPersonCents + Math.round(est * k);
  }
  // Faixa é ordem de grandeza: arredonda as pontas para dezenas da moeda (sem centavos).
  const round = (v: number) => Math.round(v / 1000) * 1000;
  return { low: Math.max(0, round(low)), mid: r.perPersonCents, high: round(high) };
}
