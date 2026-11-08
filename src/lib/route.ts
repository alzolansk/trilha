// Roteiro e página da parada (planning §5.2 e §5.3). Funções puras e testáveis: o que mostrar
// em cada parada, em cada dia e entre paradas. Nada aqui inventa dado: sem valor, devolve null.
import type { Activity, PhotoRef, Stop, Suggestion, Transport, TransportMode, TripBundle } from '../data/types';
import { durationLabel, sortedStops, stayOf, transportMinutes } from './derive';
import { fitOf } from './explore';
import { normalize } from './format';
import { inspirationScore } from './polls';
import { bestDayFor, dayNumber, isRestDay, stopSlots, type DaySlot } from './suggestions';

const fold = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
/** Mesma coisa? Compara a parte antes da vírgula, sem acento, nos dois sentidos ("Montanha Colorida, saindo de Cusco" ≈ "Montanha Colorida"). */
export function sameThing(a: string, b: string): boolean {
  const x = fold(a.split(',')[0]);
  const y = fold(b.split(',')[0]);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** Parada em foco ao abrir o Roteiro: a de hoje (durante a viagem); senão a próxima que ainda não acabou. */
export function focusStopId(stops: Stop[], today: string): string | null {
  if (!stops.length) return null;
  const now = stops.find((s) => today >= s.arrival_date && today <= s.departure_date);
  if (now) return now.id;
  return (stops.find((s) => s.departure_date >= today) ?? stops[0]).id;
}

export type StopBadge = { label: 'pronto' | 'falta hospedagem' | 'em votação'; tone: 'ok' | 'warn' | 'brand' };

/** Selo da parada na lista: hospedagem em votação → em votação; sem hospedagem reservada → falta; senão pronto. */
export function stopBadge(b: TripBundle, stop: Stop): StopBadge {
  if ((b.polls ?? []).some((p) => p.stop_id === stop.id && p.status === 'open' && p.target === 'stay')) return { label: 'em votação', tone: 'brand' };
  const nights = Math.max(0, Math.round((Date.parse(stop.departure_date) - Date.parse(stop.arrival_date)) / 86_400_000));
  const stay = stayOf(b, stop.id);
  if (nights > 0 && (!stay || stay.status !== 'booked')) return { label: 'falta hospedagem', tone: 'warn' };
  return { label: 'pronto', tone: 'ok' };
}

const NOUN: Record<TransportMode, string> = { plane: 'Voo', train: 'Trem', bus: 'Ônibus', boat: 'Barco', car: 'Carro', walk: 'A pé', other: 'Trecho' };
/** Modos em que faz sentido cobrar reserva/localizador. */
const BOOKABLE: TransportMode[] = ['plane', 'train', 'bus', 'boat'];

/** O trecho já está garantido? Localizador preenchido ou um gasto ligado a ele (pago). */
export function isBooked(b: TripBundle, t: Transport): boolean {
  return !!t.booking_ref?.trim() || (b.expenses ?? []).some((e) => e.transport_id === t.id);
}

export interface Leg {
  transport: Transport | null;
  mode: TransportMode;
  /** "Voo Lima → Cusco" */
  title: string;
  duration: string | null;
  /** por pessoa, na moeda `currency` */
  priceCents: number | null;
  currency: string;
  estimate: boolean;
  /** só para modos reserváveis: falta localizador e não há gasto ligado */
  notBooked: boolean;
}

/** Linha de transporte que chega na parada `i` (ida a partir da origem quando i = 0). null = nada a mostrar. */
export function legInto(b: TripBundle, stops: Stop[], i: number): Leg | null {
  const stop = stops[i];
  const t = b.transports.find((x) => x.stop_id === stop.id && !x.is_return) ?? null;
  if (!t && i === 0) return null;
  const mode = t?.mode ?? stop.arrival_mode ?? 'other';
  const prev = stops[i - 1];
  const from = prev?.name ?? t?.origin_name ?? t?.origin_code ?? b.trip.origin ?? null;
  const min = t ? transportMinutes(t) ?? t.duration_min : null;
  return {
    transport: t, mode,
    title: `${NOUN[mode]}${from ? ` ${from}` : ''} → ${stop.name}`,
    duration: min ? durationLabel(min) : null,
    priceCents: t?.price_cents ?? null,
    currency: t?.price_currency ?? b.trip.base_currency,
    estimate: !!t?.price_is_estimate,
    notBooked: !!t && BOOKABLE.includes(mode) && !isBooked(b, t),
  };
}

/** Trecho de volta para casa (Fase 10): última linha do Roteiro, depois da última parada. */
export function returnLeg(b: TripBundle, stops: Stop[]): Leg | null {
  const t = b.transports.find((x) => x.is_return) ?? null;
  if (!t) return null;
  const last = stops[stops.length - 1];
  const from = t.origin_name ?? last?.name ?? null;
  const to = t.dest_name ?? b.trip.origin ?? 'casa';
  const min = transportMinutes(t) ?? t.duration_min;
  return {
    transport: t, mode: t.mode,
    title: `${NOUN[t.mode]}${from ? ` ${from}` : ''} → ${to}`,
    duration: min ? durationLabel(min) : null,
    priceCents: t.price_cents ?? null,
    currency: t.price_currency ?? b.trip.base_currency,
    estimate: !!t.price_is_estimate,
    notBooked: BOOKABLE.includes(t.mode) && !isBooked(b, t),
  };
}

/** Pendências do dia (ex.: "Trem para Aguas Calientes ainda não reservado"): trechos que SAEM nesse dia desta parada. */
export function dayPending(b: TripBundle, stop: Stop, date: string): string[] {
  const stops = sortedStops(b);
  const i = stops.findIndex((s) => s.id === stop.id);
  const next = stops[i + 1];
  const out: string[] = [];
  for (const t of b.transports) {
    const leaving = (next && t.stop_id === next.id) || (i === 0 && t.stop_id === stop.id);
    if (!leaving || t.depart_date !== date || !BOOKABLE.includes(t.mode) || isBooked(b, t)) continue;
    const dest = stops.find((s) => s.id === t.stop_id)?.name ?? t.dest_name ?? '';
    out.push(`${NOUN[t.mode]} para ${dest} ainda não reservado`);
  }
  return out;
}

/**
 * Sugestões de passeio por dia da parada (sem repetir): dia vazio recebe até 3 opções; dia com folga,
 * 1 (a que a IA indicou para aquele dia, se couber). A chegada em altitude fica de fora. Respeita o teto.
 */
export function placeDaySuggestions(b: TripBundle, stop: Stop, capCents = 0): Map<string, Suggestion[]> {
  const slots = stopSlots(b, stop);
  const cands = (b.suggestions ?? [])
    .filter((s) => s.status === 'new' && s.kind === 'activity' && s.stop_id === stop.id)
    .filter((s) => fitOf(s.payload.cost_low ?? 0, s.payload.cost_high ?? 0, capCents) !== 'over');
  const used = new Set<string>();
  const out = new Map<string, Suggestion[]>();
  const take = (slot: DaySlot, n: number) => {
    const fits = cands.filter((s) => !used.has(s.id) && fitsDay(s, slot));
    fits.sort((x, y) => Number(y.day === slot.dayNumber) - Number(x.day === slot.dayNumber));
    const pick = fits.slice(0, n);
    pick.forEach((s) => used.add(s.id));
    if (pick.length) out.set(slot.date, pick);
  };
  for (const slot of slots) if (slot.state === 'vazio') take(slot, 3);
  for (const slot of slots) if (slot.state === 'folga' && !isRestDay(stop, slot.date)) take(slot, 1);
  return out;
}

function fitsDay(s: Suggestion, slot: DaySlot): boolean {
  if (slot.state === 'vazio') return true;
  if (slot.state === 'folga') return s.payload.day_fit !== 'dia_todo';
  return false;
}

/** Sugestões esperando alguém olhar (novas), na trilha toda. */
export function waitingCount(b: TripBundle): number {
  return (b.suggestions ?? []).filter((s) => s.status === 'new' && (s.kind === 'activity' || s.kind === 'area')).length;
}

// ───────────── Página da parada ─────────────

export interface AreaItem {
  key: string;
  title: string;
  why: string | null;
  good: string | null;
  watch: string | null;
  walk: string | null;
  /** faixa da diária para o grupo (centavos) */
  costLow: number | null;
  costHigh: number | null;
  currency: string;
  photo: PhotoRef | null;
  photoQuery: string;
  suggestion: Suggestion | null;
  chosen: boolean;
}

/** Bairros da parada: o escolhido (`stops.area`) e até 3 outros sugeridos (até 4 no total). */
export function stopAreas(b: TripBundle, stop: Stop): { chosen: AreaItem | null; others: AreaItem[] } {
  const list = (b.suggestions ?? []).filter((s) => s.kind === 'area' && s.stop_id === stop.id && s.status !== 'dismissed');
  const cur = b.trip.base_currency;
  const item = (s: Suggestion, chosen: boolean): AreaItem => ({
    key: s.id, title: s.payload.title, why: s.payload.why ?? null, good: s.payload.good ?? null, watch: s.payload.watch ?? null, walk: s.payload.walk ?? null,
    costLow: s.payload.cost_low ?? null, costHigh: s.payload.cost_high ?? null, currency: s.payload.currency ?? cur,
    photo: s.payload.photo?.url ? s.payload.photo : null, photoQuery: s.payload.photo_query ?? `${s.payload.title}, ${stop.name}`, suggestion: s, chosen,
  });
  const area = stop.area?.trim();
  const hit = area ? list.find((s) => sameThing(s.payload.title, area)) : undefined;
  const chosen: AreaItem | null = hit
    ? item(hit, true)
    : area
      ? { key: `area-${stop.id}`, title: area, why: null, good: null, watch: null, walk: null, costLow: null, costHigh: null, currency: cur, photo: null, photoQuery: `${area}, ${stop.name}`, suggestion: null, chosen: true }
      : null;
  const others = list.filter((s) => s !== hit).slice(0, chosen ? 3 : 4).map((s) => item(s, false));
  return { chosen, others };
}

export type TourStatus =
  | { kind: 'roteiro'; day: number; date: string }
  | { kind: 'votacao'; pos: number | null; total: number | null }
  | { kind: 'nova'; slot: DaySlot | null };

export interface Tour {
  key: string;
  title: string;
  why: string | null;
  duration: string | null;
  effort: string | null;
  dayFit: string | null;
  /** por pessoa */
  costLow: number | null;
  costHigh: number | null;
  currency: string;
  estimate: boolean;
  photo: PhotoRef | null;
  photoQuery: string;
  status: TourStatus;
  /** quem marcou "quero muito" numa inspiração do Diário com o mesmo nome */
  fans: string[];
  /** quem salvou a inspiração no Diário */
  savedBy: string | null;
  suggestion: Suggestion | null;
  activity: Activity | null;
}

const firstName = (b: TripBundle, uid: string) => b.profiles.find((p) => p.id === uid)?.display_name?.split(' ')[0] ?? 'Alguém';

/**
 * Passeios da parada: sugestões da tabela `suggestions` (novas, em votação ou aceitas) mais as atividades
 * do plano que são passeio (têm custo, vieram de sugestão, votação ou inspiração). O primeiro é o destaque:
 * o que a turma mais quer (reações no Diário) e ainda não está no roteiro; senão a primeira sugestão nova.
 */
export function stopTours(b: TripBundle, stop: Stop): Tour[] {
  const cur = b.trip.base_currency;
  const acts = b.activities.filter((a) => a.stop_id === stop.id);
  const sugg = (b.suggestions ?? []).filter((s) => s.kind === 'activity' && s.stop_id === stop.id && s.status !== 'dismissed');
  const ideas = b.journalEntries.filter((e) => e.kind === 'inspiracao' && e.stop_id === stop.id);
  const openPolls = (b.polls ?? []).filter((p) => p.stop_id === stop.id && p.status === 'open');

  const social = (title: string) => {
    const e = ideas.find((x) => sameThing(x.title ?? "", title) || (x.place_name ? sameThing(x.place_name, title) : false));
    if (!e) return { fans: [] as string[], savedBy: null as string | null };
    return { fans: inspirationScore(b, e.id).muito.map((u) => firstName(b, u)), savedBy: firstName(b, e.author_id) };
  };
  const voteOf = (title: string): TourStatus => {
    for (const p of openPolls) {
      const opts = b.pollOptions.filter((o) => o.poll_id === p.id).sort((x, y) => x.position - y.position);
      const i = opts.findIndex((o) => sameThing(o.label, title));
      if (i >= 0) return { kind: 'votacao', pos: i + 1, total: opts.length };
    }
    return { kind: 'votacao', pos: null, total: null };
  };

  const out: Tour[] = [];
  const usedActs = new Set<string>();
  for (const s of sugg) {
    const p = s.payload;
    const act = acts.find((a) => !usedActs.has(a.id) && sameThing(a.title, p.title));
    if (act) usedActs.add(act.id);
    const status: TourStatus = act
      ? { kind: 'roteiro', day: dayNumber(b, act.day), date: act.day }
      : s.status === 'voting' ? voteOf(p.title) : s.status === 'accepted' ? { kind: 'votacao', pos: null, total: null } : { kind: 'nova', slot: bestDayFor(b, s) };
    if (s.status === 'accepted' && !act) continue; // aceita e depois removida do roteiro: não volta como nova
    out.push({
      key: s.id, title: p.title, why: p.why ?? null, duration: p.duration ?? null, effort: p.effort ?? null, dayFit: p.day_fit ?? null,
      costLow: act?.cost_cents ?? p.cost_low ?? null, costHigh: act?.cost_cents ?? p.cost_high ?? null,
      currency: (act?.cost_cents != null ? act.cost_currency : p.currency) ?? cur, estimate: act?.cost_cents != null ? act.cost_is_estimate !== false : (p.cost_high ?? 0) > 0,
      photo: (act?.photo?.url ? act.photo : p.photo?.url ? p.photo : null) ?? null, photoQuery: p.photo_query ?? p.title,
      status, ...social(p.title), suggestion: s, activity: act ?? null,
    });
  }
  for (const a of acts) {
    if (usedActs.has(a.id)) continue;
    const isTour = a.cost_cents != null || a.suggested_by === 'ai' || !!a.from_poll_id || !!a.from_entry_id || !!a.photo;
    if (!isTour) continue;
    out.push({
      key: a.id, title: a.title, why: a.notes, duration: null, effort: null, dayFit: null,
      costLow: a.cost_cents ?? null, costHigh: a.cost_cents ?? null, currency: a.cost_currency ?? cur, estimate: a.cost_cents != null && a.cost_is_estimate !== false,
      photo: a.photo?.url ? a.photo : null, photoQuery: `${a.title}, ${stop.name}`,
      status: { kind: 'roteiro', day: dayNumber(b, a.day), date: a.day }, ...social(a.title), suggestion: null, activity: a,
    });
  }

  const rank = (t: Tour) => (t.status.kind === 'roteiro' ? 0 : t.status.kind === 'votacao' ? 1 : 2);
  const rest = [...out].sort((x, y) => rank(x) - rank(y) || x.title.localeCompare(y.title, 'pt-BR'));
  const star = out.filter((t) => t.status.kind !== 'roteiro').sort((x, y) => y.fans.length - x.fans.length || Number(!!y.savedBy) - Number(!!x.savedBy))[0]
    ?? out.find((t) => t.status.kind === 'nova') ?? out[0];
  return star ? [star, ...rest.filter((t) => t !== star)] : [];
}
