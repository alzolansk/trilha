import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { claimsAction, EXPLORE_RULES, suggestActivitySchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser } from '@/lib/ai/server';
import { activityCapForStop, nightlyCap } from '@/lib/explore';
import { daysBetween } from '@/lib/time';
import type { TripBundle } from '@/data/types';

// Gera e GRAVA sugestões de passeio e de bairro para uma parada (planning §8.2).
// Só organizador/editor (RLS de suggestions). No máximo 1 chamada por parada por dia.
// Tudo é estimativa da IA: faixa de preço, sem nome de hotel, sem "reservei/verifiquei".
const input = z.object({ tripId: z.string().uuid(), stopId: z.string().uuid() });
const fair = (s: string) => !claimsAction(s);

export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const { tripId, stopId } = p.data;
    if (!aiConfigured().length) return NextResponse.json({ error: 'As sugestões precisam da IA, que não está configurada neste app.' }, { status: 503 });
    const { bundle, role } = await loadTripForUser(sb, user.id, tripId);
    if (role === 'viewer') throw new HttpError(403, 'Só quem edita a trilha pede sugestões novas.');
    const stop = (bundle.stops ?? []).find((s) => s.id === stopId);
    if (!stop) throw new HttpError(404, 'Parada não encontrada.');

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const recent = await sb.from('suggestions').select('id', { count: 'exact', head: true }).eq('trip_id', tripId).eq('stop_id', stopId).eq('source', 'ai').gte('created_at', since);
    if (recent.error) throw new HttpError(503, 'Sugestões indisponíveis: aplique as migrations pendentes.');
    if ((recent.count ?? 0) > 0) return NextResponse.json({ inserted: 0, reason: 'today' });

    const { count } = await sb.from('trip_members').select('user_id', { count: 'exact', head: true }).eq('trip_id', tripId);
    const people = Math.max(1, count ?? 1);
    const full = { ...bundle, members: Array.from({ length: people }, () => ({})) } as unknown as TripBundle;
    const cur = bundle.trip.base_currency;
    const nights = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));
    const cap = Math.round(activityCapForStop(full, stop) / 100);
    const night = Math.round(nightlyCap(full) / 100);
    const planned = (bundle.activities ?? []).filter((a) => a.stop_id === stop.id).map((a) => `${a.day}: ${a.title}`);
    const known = new Set([...(bundle.activities ?? []).map((a) => a.title.toLowerCase())]);
    await consumeQuota(sb);

    const res = await runWithFallback(
      'explore',
      EXPLORE_RULES,
      `Moeda: ${cur}. Pessoas: ${people}. Estilo: ${bundle.trip.style}.
Parada: ${stop.name}${stop.country ? `, ${stop.country}` : ''}, ${nights + 1} dia(s) (${stop.arrival_date} a ${stop.departure_date})${stop.altitude_m ? `, altitude ${stop.altitude_m} m` : ''}.
Já no plano (dia: atividade): ${JSON.stringify(planned)}.
${cap ? `Teto de passeios por pessoa nesta parada: ${cap} ${cur}. Inclua grátis, opções que cabem e no máximo 1 que passa do teto.` : 'Sem teto definido: misture grátis, baratos e alguns mais caros.'}
Sugira até 6 passeios ou atrações públicas (sem repetir o plano) e até 2 bairros para ficar${stop.area ? ` (a turma já escolheu ${stop.area}: não sugira bairros)` : ''}.
"day_fit" = manha | tarde | noite | dia_todo. "effort" = leve | moderado | puxado. "cost_low"/"cost_high" = custo aproximado por pessoa (0 e 0 se grátis).
${night ? `Para bairros, "price_low"/"price_high" = faixa da diária para o grupo todo (teto ${night} ${cur}).` : 'Para bairros, "price_low"/"price_high" = faixa da diária para o grupo todo.'}
"photo_query" = nome do lugar como aparece no título da Wikipedia (ex.: "Vinicunca", "Barranco (Lima)"); nunca um termo genérico.
JSON: {"items":[{"title":"...","why":"...","duration":"...","day_fit":"tarde","effort":"leve","cost_low":0,"cost_high":0,"photo_query":"..."}],"areas":[{"name":"...","why":"...","price_low":0,"price_high":0,"photo_query":"..."}]}`,
      (raw) => {
        const v = suggestActivitySchema.safeParse(raw);
        if (!v.success) return null;
        const items = v.data.items.filter((i) => fair(i.why) && !known.has(i.title.toLowerCase()));
        const areas = stop.area ? [] : (v.data.areas ?? []).filter((a) => fair(a.why));
        return items.length || areas.length ? { items, areas } : null;
      },
      { maxTokens: 1500, temperature: 0.7 },
    );
    if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');

    const lo = (a: number, b: number) => Math.min(a, b) * 100;
    const hi = (a: number, b: number) => Math.max(a, b) * 100;
    const rows = [
      ...res.data.items.map((i) => ({
        trip_id: tripId, stop_id: stopId, kind: 'activity', source: 'ai',
        payload: { title: i.title, why: i.why, duration: i.duration, day_fit: i.day_fit, effort: i.effort, cost_low: lo(i.cost_low, i.cost_high), cost_high: hi(i.cost_low, i.cost_high), currency: cur, photo_query: i.photo_query, model: `${res.provider}:${res.model}` },
      })),
      ...res.data.areas.map((a) => ({
        trip_id: tripId, stop_id: stopId, kind: 'area', source: 'ai',
        payload: { title: a.name, why: a.why, cost_low: lo(a.price_low, a.price_high), cost_high: hi(a.price_low, a.price_high), currency: cur, photo_query: a.photo_query, model: `${res.provider}:${res.model}` },
      })),
    ];
    const ins = await sb.from('suggestions').insert(rows);
    if (ins.error) throw new HttpError(ins.error.code === '42501' ? 403 : 500, 'Não deu pra salvar as sugestões.');
    return NextResponse.json({ inserted: rows.length, by: 'ai', model: `${res.provider}:${res.model}` });
  });
}
