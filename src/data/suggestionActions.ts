'use client';
// Ações sobre sugestões (planning §8.2): aceitar, levar para votação, dispensar.
// Tudo passa pelo TripSource (Supabase ou demo), como o resto do app.
import { estimateCents } from '../lib/suggestions';
import type { TripSource } from './source';
import type { Suggestion, TripBundle } from './types';

/** Aceitar: passeio vira atividade no dia; bairro vira a área da parada. Marca `accepted`. */
export async function acceptSuggestion(source: TripSource, b: TripBundle, s: Suggestion, date?: string | null): Promise<void> {
  if (s.kind === 'activity') {
    if (!s.stop_id || !date) throw new Error('Escolha o dia para pôr no roteiro.');
    const same = b.activities.filter((a) => a.stop_id === s.stop_id && a.day === date);
    const cost = estimateCents(s);
    await source.insert('activities', {
      trip_id: b.trip.id, stop_id: s.stop_id, day: date, time: null, title: s.payload.title.slice(0, 160),
      notes: s.payload.why?.slice(0, 2000) ?? null, position: same.length ? Math.max(...same.map((a) => a.position)) + 1 : 0,
      suggested_by: 'ai', cost_cents: cost, cost_currency: cost != null ? s.payload.currency ?? b.trip.base_currency : null,
      cost_is_estimate: true, photo: s.payload.photo ?? null,
    }, { returning: false });
  } else if (s.kind === 'area' && s.stop_id) {
    const stop = b.stops.find((x) => x.id === s.stop_id);
    if (stop) await source.update('stops', stop.id, { area: s.payload.title.slice(0, 80) }, stop.version);
  }
  await source.update('suggestions', s.id, { status: 'accepted' }, s.version);
}

/**
 * Levar para votação. Duas ou mais sugestões da mesma parada viram uma enquete de passeio
 * (a vencedora entra no roteiro ao decidir); uma só vira "topa?" livre, que não mexe no roteiro.
 */
export async function voteSuggestions(source: TripSource, b: TripBundle, list: Suggestion[], me: string): Promise<string> {
  if (!list.length) throw new Error('Nada para votar.');
  const pollId = crypto.randomUUID();
  const stopId = list[0].stop_id;
  const many = list.length > 1 && list.every((s) => s.stop_id === stopId && s.kind === 'activity');
  const stop = stopId ? b.stops.find((x) => x.id === stopId) : null;
  await source.insert('polls', {
    id: pollId, trip_id: b.trip.id,
    question: many ? `Qual passeio em ${stop?.name ?? 'esta parada'}?` : `Bora: ${list[0].payload.title}?`.slice(0, 140),
    detail: many ? 'Sugestões da Trilha. Preços são estimativa por pessoa.' : list[0].payload.why?.slice(0, 300) ?? null,
    target: many ? 'activity' : 'free', stop_id: many ? stopId : null, multi: false, closes_at: null, created_by: me,
  }, { returning: false });
  const options = many
    ? list.slice(0, 6).map((s) => {
      const cost = estimateCents(s);
      return { label: s.payload.title.slice(0, 80), detail: s.payload.why?.slice(0, 300) ?? null, price: cost != null ? (cost / 100).toFixed(2) : null, currency: cost != null ? s.payload.currency ?? b.trip.base_currency : null };
    })
    : [{ label: 'Topo', detail: null, price: null, currency: null }, { label: 'Passo', detail: null, price: null, currency: null }];
  for (const [i, o] of options.entries()) {
    await source.insert('poll_options', {
      id: crypto.randomUUID(), poll_id: pollId, trip_id: b.trip.id, ...o, link_url: null, address: null, position: i, created_by: me,
    }, { returning: false });
  }
  for (const s of list) await source.update('suggestions', s.id, { status: 'voting' }, s.version);
  return pollId;
}

export async function dismissSuggestion(source: TripSource, s: Suggestion): Promise<void> {
  await source.update('suggestions', s.id, { status: 'dismissed' }, s.version);
}
