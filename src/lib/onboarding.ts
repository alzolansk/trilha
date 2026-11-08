// Onboarding roteirizado (planning §10.12): regras puras dos passos 3 a 6.
// Sem rede e sem React; usado pela tela /montar, pela rota de IA e pelos testes.
import type {
  BudgetPace, BudgetPlan, BudgetStyle, NearbyIdea, OnboardingState, OnboardingStep, PlaceIdea, PlaceMark, RouteLeg,
  RouteProposal, RouteStop, TourIdea, TransportMode, Trip, TripStyle,
} from '../data/types';
import { haversineKm } from './derive';
import { PACE_PER_DAY } from './budgetPlan';
import { addDays, daysBetween } from './time';

/** Chave estável de um lugar (sem acento, minúsculas). */
export const placeKey = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const STATUSES = ['em_andamento', 'concluido', 'manual', 'pulado'] as const;
const STEPS: OnboardingStep[] = [2, 3, 4, 5, 6];

/** Lê `trips.onboarding` com segurança (nunca confia no formato do jsonb). */
export function parseOnboarding(raw: unknown): OnboardingState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const status = STATUSES.includes(o.status as never) ? (o.status as OnboardingState['status']) : null;
  if (!status) return null;
  const step = STEPS.includes(o.step as never) ? (o.step as OnboardingStep) : 2;
  const marks: Record<string, PlaceMark> = {};
  if (o.marks && typeof o.marks === 'object') {
    for (const [k, v] of Object.entries(o.marks as Record<string, unknown>)) if (v === 'must' || v === 'maybe' || v === 'skip') marks[k] = v;
  }
  return {
    ...(o as unknown as OnboardingState),
    status,
    step,
    marks,
    wishes: Array.isArray(o.wishes) ? o.wishes.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 80)).slice(0, 5) : [],
    route_calls: typeof o.route_calls === 'number' && o.route_calls >= 0 ? Math.floor(o.route_calls) : 0,
    tour_pick: Array.isArray(o.tour_pick) ? o.tour_pick.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** Onboarding aberto (mostra "Continuar montando" na Início). */
export const onboardingOpen = (t: Pick<Trip, 'onboarding'>) => parseOnboarding(t.onboarding)?.status === 'em_andamento';

/** Noites da viagem (0 numa viagem de um dia). */
export const nightsOf = (t: Pick<Trip, 'start_date' | 'end_date'>) => Math.max(0, daysBetween(t.start_date, t.end_date));

export const MAX_ROUTE_CALLS = 10;

/** `trips.style` coerente com o estilo de hospedagem escolhido no passo 2. */
export const TRIP_STYLE_OF: Record<BudgetStyle, TripStyle> = { economico: 'Mochilão', equilibrado: 'Cultural', conforto: 'Conforto' };

// ───────────── Passo 3 ─────────────

/** Marcações iniciais: lugares e "perto daqui" como "talvez", adicionados à mão "indispensável". Mantém as já feitas. */
export function defaultMarks(items: PlaceIdea[], nearby: NearbyIdea[], current: Record<string, PlaceMark> = {}): Record<string, PlaceMark> {
  const out: Record<string, PlaceMark> = {};
  for (const p of items) out[placeKey(p.name)] = current[placeKey(p.name)] ?? (p.added ? 'must' : 'maybe');
  for (const n of nearby) out[placeKey(n.name)] = current[placeKey(n.name)] ?? 'maybe';
  return out;
}

export function namesBy(mark: PlaceMark, items: PlaceIdea[], nearby: NearbyIdea[], marks: Record<string, PlaceMark>): string[] {
  return [...items.map((p) => p.name), ...nearby.map((n) => n.name)].filter((n) => marks[placeKey(n)] === mark);
}

/** Noites mínimas que os "não pode faltar" pedem (bate-volta não conta). */
export function minNightsOfMust(items: PlaceIdea[], nearby: NearbyIdea[], marks: Record<string, PlaceMark>): number {
  const a = items.filter((p) => marks[placeKey(p.name)] === 'must').reduce((s, p) => s + Math.max(1, p.nights_min), 0);
  const b = nearby.filter((n) => marks[placeKey(n.name)] === 'must' && n.kind === 'parada').length;
  return a + b;
}

/**
 * "Perto daqui" honesto: até 4 h, sem repetir a lista principal e, quando dá para conferir pelas
 * coordenadas do lugar de onde se sai, a no máximo 300 km em linha reta (planning §10.13).
 */
export function filterNearby(nearby: NearbyIdea[], items: Pick<PlaceIdea, 'name' | 'lat' | 'lng'>[]): NearbyIdea[] {
  const main = new Set(items.map((p) => placeKey(p.name)));
  const seen = new Set<string>();
  return nearby.filter((n) => {
    const k = placeKey(n.name);
    if (main.has(k) || seen.has(k) || !(n.hours > 0) || n.hours > 4) return false;
    const from = items.find((p) => placeKey(p.name) === placeKey(n.from));
    if (from?.lat != null && from.lng != null && n.lat != null && n.lng != null && haversineKm([from.lat, from.lng], [n.lat, n.lng]) > 300) return false;
    seen.add(k);
    return true;
  });
}

// ───────────── Passo 4 ─────────────

/**
 * Corrige a soma das noites para `total`: tira das maiores e dá às menores, nunca abaixo de 1.
 * Se houver mais paradas que noites, as do fim saem (e voltam em `dropped`).
 */
export function fitNights<T extends { nights: number }>(stops: T[], total: number): { stops: T[]; dropped: T[] } {
  const list = stops.map((s) => ({ ...s, nights: Math.max(1, Math.round(Number.isFinite(s.nights) ? s.nights : 1)) }));
  const dropped: T[] = [];
  const cap = Math.max(1, total);
  while (list.length > cap) dropped.unshift(list.pop()!);
  if (!list.length) return { stops: list, dropped };
  let sum = list.reduce((a, s) => a + s.nights, 0);
  while (sum > total) {
    const i = list.reduce((best, s, j) => (s.nights > list[best].nights ? j : best), 0);
    if (list[i].nights <= 1) break;
    list[i].nights--; sum--;
  }
  while (sum < total) {
    const i = list.reduce((best, s, j) => (s.nights < list[best].nights ? j : best), 0);
    list[i].nights++; sum++;
  }
  return { stops: list, dropped };
}

/** Liga as paradas em ordem: reaproveita o trecho existente do mesmo par (em qualquer sentido) ou cria um "a recalcular". */
function relink(route: RouteProposal, prev: RouteProposal): RouteProposal {
  const find = (a: string, b: string): RouteLeg | undefined => {
    const all = [...prev.legs, ...(prev.outbound ? [prev.outbound] : []), ...(prev.return ? [prev.return] : [])];
    return all.find((l) => placeKey(l.from) === placeKey(a) && placeKey(l.to) === placeKey(b))
      ?? all.find((l) => placeKey(l.from) === placeKey(b) && placeKey(l.to) === placeKey(a));
  };
  const legs = route.stops.slice(1).map((s, i): RouteLeg => {
    const from = route.stops[i].name;
    const old = find(from, s.name);
    return old ? { ...old, from, to: s.name } : { from, to: s.name, mode: 'train', hours: null, cost_low: null, cost_high: null };
  });
  const first = route.stops[0];
  const last = route.stops[route.stops.length - 1];
  const outbound = prev.outbound && first ? (placeKey(prev.outbound.to) === placeKey(first.name) ? prev.outbound : { ...prev.outbound, to: first.name, cost_low: null, cost_high: null, hours: null }) : prev.outbound;
  const ret = prev.return && last ? (placeKey(prev.return.from) === placeKey(last.name) ? prev.return : { ...prev.return, from: last.name, cost_low: null, cost_high: null, hours: null }) : prev.return;
  return { ...route, legs, outbound, return: ret };
}

/** Regra do + / − (planning §10.6): a noite sai da (ou vai para a) parada vizinha. Sem mudança se não couber. */
export function adjustNights(route: RouteProposal, index: number, delta: 1 | -1): RouteProposal {
  const stops = route.stops.map((s) => ({ ...s }));
  const me = stops[index];
  if (!me || stops.length < 2) return route;
  const neighbors = [index - 1, index + 1].filter((j) => j >= 0 && j < stops.length);
  if (delta > 0) {
    const donor = neighbors.filter((j) => stops[j].nights > 1).sort((a, b) => stops[b].nights - stops[a].nights)[0]
      ?? stops.map((_, j) => j).filter((j) => j !== index && stops[j].nights > 1).sort((a, b) => stops[b].nights - stops[a].nights)[0];
    if (donor == null) return route;
    stops[donor].nights--; me.nights++;
  } else {
    if (me.nights <= 1) return route;
    const taker = [...neighbors].sort((a, b) => stops[a].nights - stops[b].nights)[0];
    stops[taker].nights++; me.nights--;
  }
  return { ...route, stops };
}

/** Reordena (↑ ↓). Trechos que mudam de par ficam sem preço até recalcular. */
export function moveStop(route: RouteProposal, from: number, to: number): RouteProposal {
  if (from === to || from < 0 || to < 0 || from >= route.stops.length || to >= route.stops.length) return route;
  const stops = [...route.stops];
  const [s] = stops.splice(from, 1);
  stops.splice(to, 0, s);
  return relink({ ...route, stops }, route);
}

/** Tira uma parada; as noites dela vão para as outras. */
export function removeStop(route: RouteProposal, index: number, total: number): RouteProposal {
  if (route.stops.length <= 1) return route;
  const removed = route.stops[index];
  const stops = fitNights(route.stops.filter((_, i) => i !== index), total).stops;
  return relink({ ...route, stops, left_out: [...route.left_out, { name: removed.name, reason: 'Você tirou do roteiro.' }] }, route);
}

/** Trechos sem preço (a recalcular). */
export const staleLegs = (route: RouteProposal) => [route.outbound, ...route.legs, route.return].filter((l): l is RouteLeg => !!l && l.cost_low == null);

/** Datas contíguas de cada parada a partir do início da viagem. */
export function datesFor(route: Pick<RouteProposal, 'stops'>, start: string): { arrival: string; departure: string }[] {
  let cursor = start;
  return route.stops.map((s) => {
    const out = { arrival: cursor, departure: addDays(cursor, Math.max(0, s.nights)) };
    cursor = out.departure;
    return out;
  });
}

const mid = (l: { cost_low: number | null; cost_high: number | null }) => (l.cost_low == null || l.cost_high == null ? null : Math.round((l.cost_low + l.cost_high) / 2));
const minutes = (h: number | null) => (h != null && h > 0 ? Math.min(10080, Math.round(h * 60)) : null);

export interface RouteRows {
  stops: { id: string; name: string; country: string | null; lat: number | null; lng: number | null; arrival_date: string; departure_date: string; arrival_mode: TransportMode }[];
  legs: { stop_index: number; mode: TransportMode; origin_name: string | null; dest_name: string; depart_date: string; duration_min: number | null; price_cents: number | null; is_return?: boolean }[];
  suggestions: never[];
}

/** Payload de `apply_onboarding_route`: paradas (com ids gerados aqui), ida, trechos entre paradas e volta. */
export function routeToRows(route: RouteProposal, trip: Pick<Trip, 'start_date' | 'end_date' | 'origin'>, newId: () => string = () => crypto.randomUUID()): RouteRows {
  const dates = datesFor(route, trip.start_date);
  const stops = route.stops.map((s, i) => ({
    id: newId(),
    name: s.name.slice(0, 80),
    country: s.country?.slice(0, 60) || null,
    lat: s.lat != null && s.lng != null ? s.lat : null,
    lng: s.lat != null && s.lng != null ? s.lng : null,
    arrival_date: dates[i].arrival,
    departure_date: dates[i].departure,
    arrival_mode: (i === 0 ? route.outbound?.mode : route.legs[i - 1]?.mode) ?? 'other',
  }));
  const legs: RouteRows['legs'] = [];
  const origin = trip.origin?.trim() || null;
  if (route.outbound && stops.length) {
    legs.push({ stop_index: 0, mode: route.outbound.mode, origin_name: origin, dest_name: stops[0].name, depart_date: trip.start_date, duration_min: minutes(route.outbound.hours), price_cents: mid(route.outbound) });
  }
  route.legs.forEach((l, i) => {
    if (!stops[i + 1]) return;
    legs.push({ stop_index: i + 1, mode: l.mode, origin_name: stops[i].name, dest_name: stops[i + 1].name, depart_date: stops[i + 1].arrival_date, duration_min: minutes(l.hours), price_cents: mid(l) });
  });
  if (route.return && stops.length && origin) {
    const last = stops.length - 1;
    legs.push({ stop_index: last, mode: route.return.mode, origin_name: stops[last].name, dest_name: origin, depart_date: trip.end_date, duration_min: minutes(route.return.hours), price_cents: mid(route.return), is_return: true });
  }
  return { stops, legs, suggestions: [] };
}

/** Diária de hospedagem por parada (ids reais) para `budget_plan.stay_estimates`. */
export function stayEstimatesOf(route: RouteProposal, stopIds: string[]): NonNullable<BudgetPlan['stay_estimates']> {
  const out: NonNullable<BudgetPlan['stay_estimates']> = {};
  route.stops.forEach((s, i) => { if (stopIds[i] && s.stay_pp_night) out[stopIds[i]] = s.stay_pp_night; });
  return out;
}

/** Faixa da diária de comida ponderada pelas noites em cada país (planning §10.10.5). Centavos. */
export function foodByCountry(
  stops: { country?: string | null; nights?: number; arrival_date?: string; departure_date?: string }[],
  ranges: { country: string; low: number; high: number }[],
): { low: number; high: number } | null {
  const ok = ranges.filter((r) => r.high > 0);
  if (!ok.length) return null;
  let w = 0;
  let low = 0;
  let high = 0;
  for (const s of stops) {
    const n = Math.max(1, s.nights ?? (s.arrival_date && s.departure_date ? daysBetween(s.arrival_date, s.departure_date) : 1));
    const r = ok.find((x) => placeKey(x.country) === placeKey(s.country ?? '')) ?? null;
    if (!r) continue;
    w += n; low += Math.min(r.low, r.high) * n; high += Math.max(r.low, r.high) * n;
  }
  if (!w) {
    const avg = (k: 'low' | 'high') => Math.round(ok.reduce((a, r) => a + r[k], 0) / ok.length);
    return { low: avg('low'), high: avg('high') };
  }
  return { low: Math.round(low / w), high: Math.round(high / w) };
}

export interface StopCost {
  /** hospedagem por pessoa na parada (diária × noites) */
  stay: number;
  /** comida por pessoa na parada (diária do país × noites, no mínimo 1 dia) */
  food: number;
  /** bate-voltas da parada, por pessoa */
  trips: number;
  total: number;
  /** a diária veio da referência geral (a IA não deu faixa para o estilo) */
  stayIsReference: boolean;
}

const midOf = (r: { low: number; high: number } | undefined | null) => (r ? Math.round((r.low + r.high) / 2) : null);

/**
 * Quanto custa ficar na parada, por pessoa (planning §10.6): hospedagem no estilo escolhido, comida do país
 * e bate-voltas. Sem faixa da IA, usa a referência do estilo (`nightFor`) e a diária média de comida.
 */
export function stopCost(stop: RouteStop, style: BudgetStyle, food: RouteProposal['food_pp_day'], fallbackNight: number, fallbackFood: number): StopCost {
  const nightRange = midOf(stop.stay_pp_night?.[style] ?? null);
  const stay = (nightRange ?? fallbackNight) * Math.max(0, stop.nights);
  const country = food.find((f) => placeKey(f.country) === placeKey(stop.country)) ?? null;
  const day = country ? Math.round((country.low + country.high) / 2) : food.length ? Math.round(food.reduce((a, f) => a + (f.low + f.high) / 2, 0) / food.length) : fallbackFood;
  const foodTotal = day * Math.max(1, stop.nights);
  const trips = stop.day_trips.reduce((a, d) => a + Math.round((d.cost_low + d.cost_high) / 2), 0);
  return { stay, food: foodTotal, trips, total: stay + foodTotal + trips, stayIsReference: nightRange == null };
}

/** Total por pessoa da rota proposta: ida, trechos, volta e o custo de cada parada. */
export function routeCost(route: RouteProposal, style: BudgetStyle, fallbackNight: number, fallbackFood: number): { legs: number; stops: number; total: number; pendingLegs: number } {
  const all = [route.outbound, ...route.legs, route.return].filter((l): l is RouteLeg => !!l);
  const legs = all.reduce((a, l) => a + (mid(l) ?? 0), 0);
  const stops = route.stops.reduce((a, st) => a + stopCost(st, style, route.food_pp_day, fallbackNight, fallbackFood).total, 0);
  return { legs, stops, total: legs + stops, pendingLegs: all.filter((l) => mid(l) == null).length };
}

/** Como a pessoa tinha marcado um lugar no passo 3 (para "Ficou de fora" e para o selo da parada). */
export function markOf(name: string, places: { items: PlaceIdea[]; nearby: NearbyIdea[] } | null | undefined, marks: Record<string, PlaceMark>): { mark: PlaceMark | null; nearby: boolean; added: boolean } {
  const k = placeKey(name);
  const item = places?.items.find((p) => placeKey(p.name) === k);
  const near = places?.nearby.find((n) => placeKey(n.name) === k);
  return { mark: marks[k] ?? null, nearby: !!near && !item, added: !!item?.added };
}

// ───────────── Passo 5 ─────────────

/** Quantos passeios o ritmo pede numa parada (dias livres × passeios por dia). */
export function toursWanted(nights: number, pace: BudgetPace): number {
  const days = Math.max(1, nights);
  return Math.max(1, Math.round(days * PACE_PER_DAY[pace]));
}

/** Pré-seleção: desejos primeiro, depois quem mais combina com os gostos, depois o mais barato. */
export function preselectTours(ideas: TourIdea[], nights: number, pace: BudgetPace, vibes: string[]): string[] {
  const want = toursWanted(nights, pace);
  const v = new Set(vibes.map((x) => x.toLowerCase()));
  const score = (t: TourIdea) => (t.wish ? 100 : 0) + (t.tags ?? []).filter((x) => v.has(x.toLowerCase())).length * 10 - (t.cost_low + t.cost_high) / 2 / 1e6;
  return [...ideas].sort((a, b) => score(b) - score(a)).slice(0, want).map((t) => t.id);
}

/**
 * Dia de cada passeio dentro da parada: espalha um por dia; "dia todo" fica com um dia só para ele.
 * O dia da chegada só recebe passeio quando não sobra outro.
 */
export function assignTourDays(stop: { arrival_date: string; departure_date: string }, tours: Pick<TourIdea, 'id' | 'day_fit'>[]): Map<string, string> {
  const nights = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));
  const days = Array.from({ length: Math.max(1, nights) }, (_, i) => addDays(stop.arrival_date, i));
  const order = days.length > 1 ? [...days.slice(1), days[0]] : days;
  const load = new Map(order.map((d) => [d, 0]));
  const full = new Set<string>();
  const out = new Map<string, string>();
  const sorted = [...tours].sort((a, b) => Number(b.day_fit === 'dia_todo') - Number(a.day_fit === 'dia_todo'));
  for (const t of sorted) {
    const free = order.filter((d) => !full.has(d));
    const pool = free.length ? free : order;
    const day = t.day_fit === 'dia_todo'
      ? pool.find((d) => (load.get(d) ?? 0) === 0) ?? pool.reduce((a, d) => ((load.get(d) ?? 0) < (load.get(a) ?? 0) ? d : a), pool[0])
      : pool.reduce((a, d) => ((load.get(d) ?? 0) < (load.get(a) ?? 0) ? d : a), pool[0]);
    out.set(t.id, day);
    load.set(day, (load.get(day) ?? 0) + 1);
    if (t.day_fit === 'dia_todo') full.add(day);
  }
  return out;
}

/** Bate-voltas da rota viram passeios do passo 5 (já marcados). */
export function dayTripTours(stop: RouteStop): TourIdea[] {
  return stop.day_trips.map((d) => ({
    id: `bv-${placeKey(stop.name)}-${placeKey(d.name)}`.replace(/[^a-z0-9-]/g, '-'),
    title: `Bate-volta: ${d.name}`.slice(0, 80),
    why: `Saindo de ${stop.name}.`,
    duration: 'dia inteiro',
    cost_low: d.cost_low,
    cost_high: d.cost_high,
    day_fit: 'dia_todo',
    wish: null,
  }));
}

// ───────────── Passo 6 ─────────────

export interface CutSuggestion {
  label: string;
  savesCents: number;
}

/**
 * Até 2 sugestões de corte quando o total passa do teto: hospedagem um degrau mais barata e
 * tirar os 2 passeios mais caros. `computePerPerson` recalcula o total com outro plano.
 */
export function cutSuggestions(
  plan: Pick<BudgetPlan, 'style' | 'activities'>,
  tours: { id: string; title: string; perPersonCents: number | null }[],
  computePerPerson: (p: Partial<BudgetPlan>) => number,
): CutSuggestion[] {
  const out: CutSuggestion[] = [];
  const now = computePerPerson({});
  const cheaper: Partial<Record<BudgetStyle, BudgetStyle>> = { conforto: 'equilibrado', equilibrado: 'economico' };
  const label: Record<BudgetStyle, string> = { economico: 'hostel', equilibrado: 'pousada', conforto: 'hotel' };
  const next = cheaper[plan.style];
  if (next) {
    const saves = now - computePerPerson({ style: next });
    if (saves > 0) out.push({ label: `Trocar ${label[plan.style]} por ${label[next]}`, savesCents: saves });
  }
  const picked = tours.filter((t) => plan.activities?.includes(t.id) && t.perPersonCents != null).sort((a, b) => (b.perPersonCents ?? 0) - (a.perPersonCents ?? 0)).slice(0, 2);
  if (picked.length) {
    const ids = new Set(picked.map((t) => t.id));
    const saves = now - computePerPerson({ activities: plan.activities?.filter((id) => !ids.has(id)) });
    if (saves > 0) out.push({ label: `Tirar ${picked.map((t) => t.title).join(' e ')}`, savesCents: saves });
  }
  return out;
}

// ───────────── Rota da IA (servidor) ─────────────

/**
 * Normaliza a rota da IA: noites somando o total da viagem, trechos ligando as paradas em ordem
 * e todo "não pode faltar" incluído ou explicado em `left_out`.
 */
export function normalizeRoute(raw: RouteProposal, totalNights: number, must: string[]): RouteProposal {
  const { stops, dropped } = fitNights(raw.stops.filter((s) => s.name?.trim()), Math.max(1, totalNights));
  const left = [...raw.left_out, ...dropped.map((d) => ({ name: d.name, reason: 'Não coube nas noites da viagem.' }))];
  const inRoute = new Set(stops.flatMap((s) => [placeKey(s.name), ...s.day_trips.map((d) => placeKey(d.name))]));
  for (const m of must) {
    const k = placeKey(m);
    if (!inRoute.has(k) && !left.some((l) => placeKey(l.name) === k)) left.push({ name: m, reason: 'A Trilha não conseguiu encaixar.' });
  }
  const base: RouteProposal = { ...raw, stops, left_out: left.filter((l, i, a) => !inRoute.has(placeKey(l.name)) && a.findIndex((x) => placeKey(x.name) === placeKey(l.name)) === i) };
  return relink(base, raw);
}

/** "Não pode faltar" que não entraram na rota nem foram explicados (para pedir uma nova tentativa). */
export function missingMust(route: Pick<RouteProposal, 'stops' | 'left_out'>, must: string[]): string[] {
  const inRoute = new Set(route.stops.flatMap((s) => [placeKey(s.name), ...s.day_trips.map((d) => placeKey(d.name))]));
  const explained = new Set(route.left_out.map((l) => placeKey(l.name)));
  return must.filter((m) => !inRoute.has(placeKey(m)) && !explained.has(placeKey(m)));
}
