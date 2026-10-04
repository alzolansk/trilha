import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseServer } from '../supabase/server';
import type { Role, TripBundle } from '../../data/types';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<{ sb: SupabaseClient; user: User }> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, 'Entre na sua conta.');
  return { sb, user: data.user };
}

/** Consome uma chamada da cota diária da pessoa (tabela ai_usage, atômico no banco). */
export async function consumeQuota(sb: SupabaseClient) {
  const limit = Number(process.env.AI_DAILY_LIMIT_PER_USER || 60);
  const { error } = await sb.rpc('consume_ai_call', { p_limit: limit });
  if (error) throw new HttpError(429, 'Limite diário de IA atingido. Amanhã libera de novo.');
}

/** Carrega a viagem com a sessão da pessoa: o RLS garante que ela é membro. */
export async function loadTripForUser(sb: SupabaseClient, userId: string, tripId: string): Promise<{ bundle: Partial<TripBundle> & { trip: TripBundle['trip'] }; role: Role }> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw new HttpError(400, 'Viagem inválida.');
  const [trip, member, stops, transports, stays, activities, docs, items, cats, expenses, budget, tasks, journal, photos] = await Promise.all([
    sb.from('trips').select('*').eq('id', tripId).maybeSingle(),
    sb.from('trip_members').select('role').eq('trip_id', tripId).eq('user_id', userId).maybeSingle(),
    sb.from('stops').select('*').eq('trip_id', tripId).order('position'),
    sb.from('transports').select('*').eq('trip_id', tripId),
    sb.from('stays').select('*').eq('trip_id', tripId),
    sb.from('activities').select('*').eq('trip_id', tripId),
    sb.from('documents').select('id,title,category,stop_id,valid_from,valid_until,status').eq('trip_id', tripId),
    sb.from('packing_items').select('*').eq('trip_id', tripId),
    sb.from('packing_categories').select('*').eq('trip_id', tripId),
    sb.from('expenses').select('*').eq('trip_id', tripId),
    sb.from('budget_categories').select('*').eq('trip_id', tripId),
    sb.from('tasks').select('*').eq('trip_id', tripId),
    sb.from('journal_entries').select('*').eq('trip_id', tripId),
    sb.from('journal_photos').select('id,entry_id,caption').eq('trip_id', tripId),
  ]);
  if (!trip.data || !member.data) throw new HttpError(404, 'Viagem não encontrada.');
  return {
    role: member.data.role as Role,
    bundle: {
      trip: trip.data,
      stops: stops.data ?? [], transports: transports.data ?? [], stays: stays.data ?? [], activities: activities.data ?? [],
      documents: (docs.data ?? []) as never, packingItems: items.data ?? [], packingCategories: cats.data ?? [],
      expenses: expenses.data ?? [], budgetCategories: budget.data ?? [], tasks: tasks.data ?? [], journalEntries: journal.data ?? [],
      journalPhotos: (photos.data ?? []) as never, expenseShares: [], settlements: [], members: [], profiles: [], documentShares: [], offlinePrefs: [], retro: null,
    },
  };
}

export function handle(fn: () => Promise<Response>) {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[api]', (e as Error)?.message);
    return NextResponse.json({ error: 'Falha interna.' }, { status: 500 });
  });
}

export async function readJson<T>(req: Request, maxBytes = 60_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Requisição grande demais.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

/** Resumo compacto da viagem para os prompts (sem dados pessoais desnecessários). */
export function tripBrief(b: Partial<TripBundle> & { trip: TripBundle['trip'] }) {
  return {
    destino: b.trip.title,
    ida: b.trip.start_date,
    volta: b.trip.end_date,
    estilo: b.trip.style,
    paradas: (b.stops ?? []).map((s) => ({
      id: s.id, cidade: s.name, pais: s.country, chegada: s.arrival_date, saida: s.departure_date, altitude_m: s.altitude_m,
      transporte_chegada: (b.transports ?? []).find((t) => t.stop_id === s.id)?.mode ?? s.arrival_mode,
      hospedagem: (() => {
        const st = (b.stays ?? []).find((x) => x.stop_id === s.id);
        return st ? { nome: st.name, estado: st.status } : null;
      })(),
      plano: (b.activities ?? []).filter((a) => a.stop_id === s.id).map((a) => `${a.day} ${a.title}`).slice(0, 8),
    })),
  };
}
