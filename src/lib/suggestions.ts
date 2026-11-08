// Sugestões da Início e do Roteiro (planning §5.1 e §8.2). Puro e testável.
// Lembretes de regra (votos, reservas, documentos, aportes) são calculados na hora, a partir dos
// dados: não ficam gravados, então nunca ficam velhos. Sugestões de IA vêm da tabela `suggestions`.
import type { DayFit, Stop, Suggestion, TripBundle } from '../data/types';
import { sortedStops } from './derive';
import { fitOf } from './explore';
import { dayMonth } from './format';
import { formatMoney, memberPoolStatus } from './money';
import { myPendingVotes, optionsOf } from './polls';
import { ruleAlerts } from './rules';
import { addDays, daysBetween } from './time';

export type SlotState = 'vazio' | 'folga' | 'cheio' | 'aclimatar' | 'viagem';
export interface DaySlot {
  date: string;
  /** dia da viagem (1 = primeiro) */
  dayNumber: number;
  state: SlotState;
  count: number;
}

/** Altitude a partir da qual o primeiro dia fica para aclimatar (regra já usada nas dicas). */
export const ACCLIMATIZE_M = 2500;

export function dayNumber(b: Pick<TripBundle, 'trip'>, date: string): number {
  return daysBetween(b.trip.start_date, date) + 1;
}

/** Estado de um dia da parada: vazio, com folga (1 atividade), cheio, de aclimatar ou de viagem. */
export function slotsForDay(b: TripBundle, stop: Stop, date: string): DaySlot {
  const count = b.activities.filter((a) => a.stop_id === stop.id && a.day === date).length;
  const base = { date, dayNumber: dayNumber(b, date), count };
  if ((stop.altitude_m ?? 0) >= ACCLIMATIZE_M && date === stop.arrival_date && count === 0) return { ...base, state: 'aclimatar' };
  const leaves = date === stop.departure_date && b.stops.some((s) => s.id !== stop.id && s.arrival_date === date);
  if (leaves && count === 0) return { ...base, state: 'viagem' };
  return { ...base, state: count === 0 ? 'vazio' : count === 1 ? 'folga' : 'cheio' };
}

/** Dias da parada, da chegada à saída. */
export function stopSlots(b: TripBundle, stop: Stop): DaySlot[] {
  const n = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));
  return Array.from({ length: n + 1 }, (_, i) => slotsForDay(b, stop, addDays(stop.arrival_date, i)));
}

/** Chegada numa parada alta: mesmo com algo leve planejado, não é dia de encaixar passeio. */
export function isRestDay(stop: Pick<Stop, 'altitude_m' | 'arrival_date'>, date: string): boolean {
  return (stop.altitude_m ?? 0) >= ACCLIMATIZE_M && date === stop.arrival_date;
}

/** A atividade cabe nesse dia? Dia todo só em dia vazio; meio período também em dia com folga. */
export function fitsSlot(fit: DayFit | null | undefined, slot: DaySlot): boolean {
  if (slot.state === 'vazio') return true;
  if (slot.state === 'folga') return fit !== 'dia_todo';
  return false;
}

/** Primeiro dia da parada em que a sugestão cabe (respeita `day` quando a IA indicou). */
export function bestDayFor(b: TripBundle, s: Suggestion): DaySlot | null {
  const stop = s.stop_id ? b.stops.find((x) => x.id === s.stop_id) : null;
  if (!stop || s.kind !== 'activity') return null;
  const slots = stopSlots(b, stop);
  if (s.day != null) {
    const want = slots.find((x) => x.dayNumber === s.day);
    if (want && fitsSlot(s.payload.day_fit, want)) return want;
  }
  return slots.find((x) => !isRestDay(stop, x.date) && fitsSlot(s.payload.day_fit, x)) ?? null;
}

/** Até 3 sugestões novas da parada que cabem no dia e no teto de passeios (quando há teto). */
export function suggestionsForDay(b: TripBundle, stop: Stop, date: string, capCents = 0): Suggestion[] {
  const slot = slotsForDay(b, stop, date);
  return (b.suggestions ?? [])
    .filter((s) => s.status === 'new' && s.kind === 'activity' && s.stop_id === stop.id)
    .filter((s) => fitsSlot(s.payload.day_fit, slot))
    .filter((s) => fitOf(s.payload.cost_low ?? 0, s.payload.cost_high ?? 0, capCents) !== 'over')
    .slice(0, 3);
}

/** Parada sem sugestão ou com sugestões de mais de 14 dias: pede novas à IA (só editor). */
export function stopsNeedingSuggestions(b: TripBundle, now = Date.now()): Stop[] {
  const limit = now - 14 * 86_400_000;
  return sortedStops(b).filter((st) => {
    const mine = (b.suggestions ?? []).filter((s) => s.stop_id === st.id && s.source === 'ai');
    return !mine.length || mine.every((s) => Date.parse(s.created_at) < limit);
  });
}

export type HomeCardType = 'vote' | 'reserve' | 'activity' | 'area' | 'document' | 'pool';
export interface HomeCard {
  key: string;
  type: HomeCardType;
  /** linha pequena acima do título ("Falta você votar") */
  eyebrow: string;
  title: string;
  detail: string;
  /** caminho relativo à trilha */
  href: string;
  suggestion?: Suggestion;
  slot?: DaySlot | null;
}

const nameOf = (b: TripBundle, uid: string) => b.profiles.find((p) => p.id === uid)?.display_name?.split(' ')[0] ?? 'Alguém';

/**
 * Cartões da Início, na ordem da §5.1: voto meu pendente → reserva urgente → passeio que cabe
 * num dia vazio/com folga → documento → aporte atrasado. Sem IA, só os de regra aparecem.
 */
export function rankForHome(b: TripBundle, me: string, now = Date.now()): HomeCard[] {
  const out: HomeCard[] = [];

  for (const p of myPendingVotes(b, me, now)) {
    const opts = optionsOf(b, p.id);
    const voters = new Map<string, string[]>();
    for (const v of b.pollVotes.filter((x) => x.poll_id === p.id && x.user_id !== me)) {
      const label = opts.find((o) => o.id === v.option_id)?.label;
      if (label) voters.set(v.user_id, [...(voters.get(v.user_id) ?? []), label]);
    }
    const detail = [...voters].slice(0, 3).map(([u, l]) => `${nameOf(b, u)}: ${l.join(', ')}`).join(' · ');
    out.push({ key: `vote-${p.id}`, type: 'vote', eyebrow: 'Falta você votar', title: p.question, detail: detail || 'Ninguém votou ainda', href: '/turma/votos' });
  }

  const alerts = ruleAlerts(b, now);
  for (const a of alerts.filter((x) => x.key.startsWith('stay-missing-'))) {
    const stopId = a.key.slice('stay-missing-'.length);
    out.push({ key: a.key, type: 'reserve', eyebrow: 'Reserve logo', title: a.title, detail: a.detail, href: `/roteiro/${stopId}` });
  }
  const stops = sortedStops(b);
  stops.forEach((s, i) => {
    if (i > 0 && !b.transports.some((t) => t.stop_id === s.id) && !s.arrival_mode) {
      out.push({ key: `arrival-${s.id}`, type: 'reserve', eyebrow: 'Falta definir', title: `Como chegar em ${s.name}`, detail: `Chegada em ${dayMonth(s.arrival_date)} sem transporte.`, href: `/roteiro/${s.id}` });
    }
  });

  for (const s of (b.suggestions ?? []).filter((x) => x.status === 'new')) {
    const stop = s.stop_id ? b.stops.find((x) => x.id === s.stop_id) : null;
    if (s.kind === 'activity') {
      const slot = bestDayFor(b, s);
      if (!slot) continue;
      out.push({
        key: `sug-${s.id}`, type: 'activity', eyebrow: `Passeio · cabe no dia ${slot.dayNumber}`, title: s.payload.title,
        detail: s.payload.why ?? '', href: stop ? `/roteiro/${stop.id}` : '/roteiro', suggestion: s, slot,
      });
    } else if (s.kind === 'area' && stop && !stop.area) {
      out.push({ key: `sug-${s.id}`, type: 'area', eyebrow: `Onde ficar em ${stop.name}`, title: s.payload.title, detail: s.payload.why ?? '', href: `/roteiro/${stop.id}`, suggestion: s });
    }
  }

  for (const a of alerts.filter((x) => x.key === 'insurance-gap' || x.key.startsWith('id-expired-') || x.key.startsWith('passport-6m-'))) {
    out.push({ key: a.key, type: 'document', eyebrow: 'Documento', title: a.title, detail: a.detail, href: '/turma/documentos' });
  }

  const mine = memberPoolStatus(b, now).find((m) => m.userId === me);
  if (mine?.status === 'atrasado') {
    const gap = mine.expectedCents - mine.depositedCents;
    out.push({
      key: 'pool-me', type: 'pool', eyebrow: 'Seu aporte', title: `Faltam ${formatMoney(gap, b.trip.base_currency, { compact: true })} pra ficar em dia`,
      detail: `Você juntou ${formatMoney(mine.depositedCents, b.trip.base_currency, { compact: true })} de ${formatMoney(mine.targetCents, b.trip.base_currency, { compact: true })}.`,
      href: '/dinheiro',
    });
  }
  return out;
}

/** Custo médio estimado por pessoa (para gravar na atividade aceita). */
export function estimateCents(s: Suggestion): number | null {
  const lo = s.payload.cost_low;
  const hi = s.payload.cost_high;
  if (lo == null && hi == null) return null;
  return Math.round(((lo ?? hi ?? 0) + (hi ?? lo ?? 0)) / 2);
}
