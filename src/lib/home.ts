// Início 3.0 (planning §13, 14/11/2026): o que a Início mostra além do hero, tudo derivado do que a trilha já tem.
// Funções puras (sem rede, sem React), testadas em tests/unit/home.test.ts. Bloco sem dado devolve vazio/null e some.
import type { Activity, DocCategory, PhotoRef, Stop, TripBundle } from '../data/types';
import { docMatrix } from './docMatrix';
import { MODE_LABEL } from './format';
import { formatMoney, memberPoolStatus } from './money';
import { myPendingVotes, pollState, votersCount } from './polls';
import { sortedStops } from './derive';
import { addDays, daysBetween } from './time';

const firstName = (b: TripBundle, uid: string | null | undefined) =>
  (uid ? b.profiles.find((p) => p.id === uid)?.display_name?.split(' ')[0] : null) ?? 'Alguém';

/** "1h30", "45 min". */
export function durationLabel(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}

/** Distância em dias, do jeito curto: "hoje", "amanhã", "em 12 d", "há 3 d". */
export function relDay(today: string, date: string): string {
  const d = daysBetween(today, date);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d < 0) return `há ${-d} d`;
  return `em ${d} d`;
}

// ───────────── Bilhete da viagem ─────────────

export type StampTone = 'ok' | 'todo' | 'mute';
export interface Stamp { label: string; tone: StampTone }
export interface TicketLeg {
  stop: Stop;
  nights: number;
  /** dia da viagem em que chega (1 = primeiro dia) */
  dayNumber: number;
  photo: PhotoRef | null;
  stamps: Stamp[];
  /** como chega nesta parada ("trem · 1h30"); null quando não há trecho */
  hop: string | null;
  /** a viagem está nesta parada hoje */
  current: boolean;
}

/** Um trecho do bilhete por parada, com o que está resolvido (carimbo verde) e o que falta (carimbo laranja). */
export function ticketLegs(b: TripBundle, today: string | null = null): TicketLeg[] {
  const now = Date.now();
  return sortedStops(b).map((stop) => {
    const nights = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));
    const stamps: Stamp[] = [];
    if (nights > 0) {
      const stays = b.stays.filter((x) => x.stop_id === stop.id);
      stamps.push(stays.some((x) => x.status === 'booked') ? { label: 'hospedagem ok', tone: 'ok' } : { label: 'sem hospedagem', tone: 'todo' });
    }
    if ((b.polls ?? []).some((p) => p.stop_id === stop.id && pollState(b, p.id, now) === 'open')) stamps.push({ label: 'votação aberta', tone: 'todo' });
    const acts = b.activities.filter((a) => a.stop_id === stop.id);
    if (acts.length) stamps.push({ label: acts.length === 1 ? '1 passeio' : `${acts.length} passeios`, tone: 'mute' });
    if (nights > 0) {
      const days = Array.from({ length: nights }, (_, i) => addDays(stop.arrival_date, i));
      const free = days.filter((d) => !acts.some((a) => a.day === d)).length;
      if (free) stamps.push({ label: free === 1 ? '1 dia livre' : `${free} dias livres`, tone: 'mute' });
    }
    const t = b.transports.find((x) => x.stop_id === stop.id && !x.is_return);
    const hop = t ? [MODE_LABEL[t.mode]?.toLowerCase() ?? t.mode, durationLabel(t.duration_min)].filter(Boolean).join(' · ') : null;
    return {
      stop, nights, dayNumber: daysBetween(b.trip.start_date, stop.arrival_date) + 1,
      photo: stop.photo?.url ? stop.photo : null, stamps, hop,
      current: !!today && today >= stop.arrival_date && today < stop.departure_date,
    };
  });
}

// ───────────── Até a partida ─────────────

export interface Milestone {
  key: string;
  /** YYYY-MM-DD; para o que já devia ter acontecido, é hoje */
  date: string;
  title: string;
  detail: string | null;
  /** caminho relativo à trilha */
  href: string | null;
  /** algo para a turma fazer (laranja) ou um fato da agenda (cinza) */
  tone: 'todo' | 'info';
  /** o prazo ideal já passou: "quanto antes" */
  late?: boolean;
}

const RESERVE_DAYS = 60;
const PASSPORT_MARGIN_DAYS = 180;

/**
 * Marcos datados até o embarque: votação que fecha, hospedagem por reservar (ideal até 60 dias antes),
 * documento de identidade que vence até 6 meses depois da volta, check-in do voo (48 h antes) e o embarque.
 */
export function milestones(b: TripBundle, today: string): Milestone[] {
  const out: Milestone[] = [];
  const trip = b.trip;
  const now = Date.now();
  for (const p of b.polls ?? []) {
    if (pollState(b, p.id, now) !== 'open' || !p.closes_at) continue;
    const { voted, total } = votersCount(b, p.id);
    out.push({ key: `poll-${p.id}`, date: p.closes_at.slice(0, 10), title: `Fechar: ${p.question}`, detail: `${voted} de ${total} votaram`, href: '/turma/votos', tone: 'todo' });
  }
  for (const s of sortedStops(b)) {
    if (daysBetween(s.arrival_date, s.departure_date) <= 0 || s.arrival_date < today) continue;
    if (b.stays.some((x) => x.stop_id === s.id && x.status === 'booked')) continue;
    const ideal = addDays(s.arrival_date, -RESERVE_DAYS);
    const late = ideal < today;
    out.push({ key: `stay-${s.id}`, date: late ? today : ideal, title: `Reservar hospedagem em ${s.name}`, detail: late ? 'quanto antes: perto da data sobra pouco e fica caro' : 'perto da data sobra pouco e fica caro', href: `/roteiro/${s.id}`, tone: 'todo', late });
  }
  const limit = addDays(trip.end_date, PASSPORT_MARGIN_DAYS);
  const idCat: DocCategory = 'identidade';
  for (const d of b.documents) {
    if (d.category !== idCat || d.status !== 'ready' || !d.valid_until || d.valid_until >= limit) continue;
    const gone = d.valid_until < today;
    out.push({
      key: `doc-${d.id}`, date: gone ? today : d.valid_until, title: `${gone ? 'Venceu' : 'Vence'} o documento de ${firstName(b, d.owner_id)}`,
      detail: 'muitos países pedem validade de 6 meses depois da volta', href: '/turma/documentos', tone: 'todo', late: gone,
    });
  }
  const flight = b.transports
    .filter((t) => t.mode === 'plane' && !t.is_return && t.depart_date)
    .sort((x, y) => (x.depart_date! < y.depart_date! ? -1 : 1))[0];
  if (flight?.depart_date) out.push({ key: 'checkin', date: addDays(flight.depart_date, -2), title: 'Check-in do voo abre', detail: 'em geral 48 h antes; confira na companhia', href: null, tone: 'info' });
  const leave = trip.departure_at ? trip.departure_at.slice(0, 10) : trip.start_date;
  out.push({ key: 'leave', date: leave, title: trip.origin ? `Embarque em ${trip.origin}` : 'Embarque', detail: null, href: null, tone: 'info' });
  return out
    .filter((m) => m.date >= today)
    .sort((x, y) => x.date.localeCompare(y.date) || (x.tone === y.tone ? 0 : x.tone === 'todo' ? -1 : 1));
}

// ───────────── A turma está pronta? ─────────────

export type ReadyKey = 'pool' | 'docs' | 'vote' | 'pack';
export interface ReadyDim { key: ReadyKey; ok: boolean; label: string }
export interface ReadyRow { userId: string; name: string; color: string | null; me: boolean; dims: ReadyDim[]; missing: string[] }

/**
 * Prontidão de cada pessoa: aporte em dia, passaporte e passagem enviados, votos dados e mala (itens dela) feita.
 * Uma dimensão sem dado para a pessoa (sem orçamento, sem votação aberta, nada na mala dela) não conta.
 * null quando nada se aplica a ninguém.
 */
export function readiness(b: TripBundle, me: string, now = Date.now()): ReadyRow[] | null {
  const pool = memberPoolStatus(b, now);
  const docs = docMatrix(b).filter((c) => c.cat === 'identidade' || c.cat === 'passagem');
  const openPolls = (b.polls ?? []).filter((p) => pollState(b, p.id, now) === 'open');
  const rows = b.members.map((m) => {
    const uid = m.user_id;
    const dims: ReadyDim[] = [];
    const ps = pool.find((x) => x.userId === uid);
    if (ps && ps.status !== 'sem_meta') dims.push({ key: 'pool', ok: ps.status !== 'atrasado', label: 'aporte' });
    if (docs.length) dims.push({ key: 'docs', ok: docs.every((c) => c.has.get(uid)), label: 'documentos' });
    if (openPolls.length) dims.push({ key: 'vote', ok: myPendingVotes(b, uid, now).length === 0, label: 'voto' });
    const mine = b.packingItems.filter((i) => i.assignee_id === uid);
    if (mine.length) dims.push({ key: 'pack', ok: mine.every((i) => i.done), label: 'mala' });
    const p = b.profiles.find((x) => x.id === uid);
    return { userId: uid, name: uid === me ? 'Você' : p?.display_name?.split(' ')[0] ?? 'Pessoa', color: p?.color ?? null, me: uid === me, dims, missing: dims.filter((d) => !d.ok).map((d) => d.label) };
  });
  if (!rows.some((r) => r.dims.length)) return null;
  // Você primeiro; depois quem falta mais.
  return rows.sort((x, y) => (x.me ? -1 : y.me ? 1 : y.missing.length - x.missing.length));
}

// ───────────── Postal do dia ─────────────

export interface Postcard { activity: Activity; stop: Stop; dayNumber: number }

/** Número estável a partir de um texto (o mesmo postal o dia inteiro, em todos os aparelhos). */
export function dayHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Um passeio do roteiro por dia, sempre o mesmo naquele dia. Passeios com foto têm preferência.
 * Durante a viagem, só passeios de amanhã em diante (o de hoje já está em "Hoje em…").
 */
export function postcardOf(b: TripBundle, today: string): Postcard | null {
  const from = today >= b.trip.start_date ? addDays(today, 1) : b.trip.start_date;
  const pool = b.activities.filter((a) => a.day >= from && b.stops.some((s) => s.id === a.stop_id));
  if (!pool.length) return null;
  const withPhoto = pool.filter((a) => a.photo?.url);
  const list = (withPhoto.length ? withPhoto : pool).sort((x, y) => x.day.localeCompare(y.day) || x.position - y.position || x.id.localeCompare(y.id));
  const activity = list[dayHash(`${b.trip.id}|${today}`) % list.length];
  const stop = b.stops.find((s) => s.id === activity.stop_id)!;
  return { activity, stop, dayNumber: daysBetween(b.trip.start_date, activity.day) + 1 };
}

// ───────────── Desde sua última visita ─────────────

export interface Recent { key: string; who: string | null; text: string; at: string; href: string }

const DOC_LABEL: Record<DocCategory, string> = { passagem: 'uma passagem', identidade: 'um documento de identidade', reserva: 'uma reserva', ingresso: 'um ingresso', seguro: 'o seguro', outro: 'um documento' };

/** O que outras pessoas (e o roteiro) mudaram depois de `since` (ISO), do mais novo ao mais antigo. */
export function sinceLastVisit(b: TripBundle, me: string, since: string, max = 4): Recent[] {
  const out: Recent[] = [];
  const after = (at: string | null | undefined) => !!at && at > since;
  const cur = b.trip.base_currency;
  for (const e of b.expenses) if (after(e.created_at) && e.created_by && e.created_by !== me) out.push({ key: `exp-${e.id}`, who: e.created_by, text: `${firstName(b, e.created_by)} lançou “${e.description}”`, at: e.created_at, href: '/dinheiro/extrato' });
  for (const c of b.poolContributions ?? []) if (after(c.created_at) && c.user_id !== me && c.kind === 'deposit') out.push({ key: `pool-${c.id}`, who: c.user_id, text: `${firstName(b, c.user_id)} pôs ${formatMoney(c.amount_cents, cur, { compact: true })} no caixa`, at: c.created_at, href: '/dinheiro' });
  for (const p of b.polls ?? []) if (after(p.created_at) && p.created_by !== me) out.push({ key: `poll-${p.id}`, who: p.created_by, text: `${firstName(b, p.created_by)} abriu a votação “${p.question}”`, at: p.created_at, href: '/turma/votos' });
  const voted = new Set<string>();
  for (const v of [...(b.pollVotes ?? [])].sort((x, y) => y.created_at.localeCompare(x.created_at))) {
    if (!after(v.created_at) || v.user_id === me || voted.has(`${v.poll_id}|${v.user_id}`)) continue;
    voted.add(`${v.poll_id}|${v.user_id}`);
    const q = b.polls?.find((p) => p.id === v.poll_id)?.question;
    out.push({ key: `vote-${v.poll_id}-${v.user_id}`, who: v.user_id, text: q ? `${firstName(b, v.user_id)} votou em “${q}”` : `${firstName(b, v.user_id)} votou`, at: v.created_at, href: '/turma/votos' });
  }
  for (const d of b.documents) if (after(d.created_at) && d.owner_id !== me && d.status === 'ready') out.push({ key: `doc-${d.id}`, who: d.owner_id, text: `${firstName(b, d.owner_id)} enviou ${DOC_LABEL[d.category]}`, at: d.created_at, href: '/turma/documentos' });
  for (const j of b.journalEntries) {
    if (!after(j.created_at) || j.author_id === me) continue;
    out.push({ key: `jr-${j.id}`, who: j.author_id, text: j.kind === 'inspiracao' ? `${firstName(b, j.author_id)} guardou uma ideia${j.title ? `: ${j.title}` : ''}` : `${firstName(b, j.author_id)} escreveu no Diário`, at: j.created_at, href: '/turma/diario' });
  }
  // Roteiro não guarda o autor: aparece sem nome, só quando entrou depois da última visita.
  for (const a of b.activities) {
    if (!after(a.created_at)) continue;
    const day = daysBetween(b.trip.start_date, a.day) + 1;
    out.push({ key: `act-${a.id}`, who: null, text: `${a.title} entrou no dia ${day}`, at: a.created_at, href: `/roteiro/${a.stop_id}` });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, max);
}

/** Moeda do destino diferente da moeda da trilha (a primeira, pela ordem das paradas). */
export function destinationCurrency(b: TripBundle, byCountry: (c: string | null | undefined) => string | null): string | null {
  for (const s of sortedStops(b)) {
    const c = byCountry(s.country);
    if (c && c !== b.trip.base_currency) return c;
  }
  return null;
}
