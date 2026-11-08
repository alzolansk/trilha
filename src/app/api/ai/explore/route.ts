import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { claimsAction, EXPLORE_RULES, exploreActivitySchema, exploreDestSchema, exploreStaySchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser, tripBrief } from '@/lib/ai/server';
import { haversineKm } from '@/lib/derive';
import { daysBetween } from '@/lib/time';

// Sugestões do planejamento: destinos, passeios e bairros pra ficar. Só sugere;
// nada é salvo aqui, e tudo volta marcado como estimativa da IA.
const reais = z.number().int().min(0).max(1_000_000).nullable().optional();
const input = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('destinations'), tripId: z.string().uuid(), origin: z.string().max(80).nullable().optional(),
    nearStopId: z.string().uuid().nullable().optional(), budgetPerPerson: reais, maxHours: z.number().min(1).max(30).nullable().optional(),
    vibes: z.array(z.string().max(20)).max(6).optional(),
  }),
  z.object({ kind: z.literal('activities'), tripId: z.string().uuid(), stopId: z.string().uuid(), capPerPerson: reais }),
  z.object({ kind: z.literal('stays'), tripId: z.string().uuid(), stopId: z.string().uuid(), nightlyCap: reais, budgetStyle: z.enum(['economico', 'equilibrado', 'conforto']).optional() }),
]);

const fair = (s: string) => !claimsAction(s);
const range = <T extends { cost_low: number; cost_high: number }>(x: T): T => ({ ...x, cost_low: Math.min(x.cost_low, x.cost_high), cost_high: Math.max(x.cost_low, x.cost_high) });

export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const q = p.data;
    if (!aiConfigured().length) return NextResponse.json({ error: 'As sugestões precisam da IA, que não está configurada neste app.' }, { status: 503 });
    const { bundle } = await loadTripForUser(sb, user.id, q.tripId);
    const { count } = await sb.from('trip_members').select('user_id', { count: 'exact', head: true }).eq('trip_id', q.tripId);
    const people = Math.max(1, count ?? 1);
    const cur = bundle.trip.base_currency;
    const days = daysBetween(bundle.trip.start_date, bundle.trip.end_date) + 1;
    const ctx = `Moeda: ${cur}. Pessoas: ${people}. Estilo: ${bundle.trip.style}. Datas: ${bundle.trip.start_date} a ${bundle.trip.end_date} (${days} dias).`;
    await consumeQuota(sb);

    if (q.kind === 'destinations') {
      const stops = bundle.stops ?? [];
      const near = q.nearStopId ? stops.find((s) => s.id === q.nearStopId) : null;
      const hasDest = bundle.trip.destinations.some((d) => d.trim());
      const ask = hasDest
        ? `A trilha já tem roteiro: ${JSON.stringify(tripBrief(bundle).paradas.map((s) => ({ cidade: s.cidade, pais: s.pais, chegada: s.chegada, saida: s.saida })))}.
Sugira até 6 lugares PERTO de ${near ? `"${near.name}"` : 'alguma das paradas'} que valham um bate-volta ou uma parada extra, sem repetir as paradas.
"hours" = tempo de ida a partir ${near ? `de ${near.name}` : 'da parada mais próxima'}; "cost_low"/"cost_high" = custo extra por pessoa (transporte ida e volta + entrada/passeio principal; inclua hospedagem só se precisar dormir lá).`
        : `A turma ainda não sabe o destino. Saindo de "${q.origin || bundle.trip.origin || 'origem não informada'}".
Sugira até 6 destinos que caibam em ${days} dias${q.maxHours ? `, com no máximo ~${q.maxHours}h de viagem de ida` : ''}.
"hours" = tempo de ida desde a origem; "cost_low"/"cost_high" = custo TOTAL por pessoa da viagem inteira (transporte ida e volta + hospedagem dividida + comida).
Em "origin" devolva o nome e as coordenadas aproximadas da origem.`;
      const res = await runWithFallback(
        'explore',
        EXPLORE_RULES,
        `${ctx}
${q.budgetPerPerson ? `Orçamento por pessoa: ${q.budgetPerPerson} ${cur}. Prefira opções que caibam, mas pode incluir 1 que passe um pouco, se valer muito.` : 'Sem orçamento definido: varie entre opções mais baratas e mais caras.'}
${q.vibes?.length ? `A turma quer: ${q.vibes.join(', ')}.` : ''}
${ask}
"why" = uma frase do porquê combina com a turma. "lat"/"lng" = coordenadas aproximadas do lugar.
JSON: {"origin":{"name":"...","lat":0,"lng":0} ou null,"items":[{"name":"...","region":"estado/província","country":"...","lat":0,"lng":0,"why":"...","mode":"bus|car|plane|train|boat","hours":0,"cost_low":0,"cost_high":0}]}`,
        (raw) => {
          const v = exploreDestSchema.safeParse(raw);
          if (!v.success) return null;
          const taken = new Set(stops.map((s) => s.name.toLowerCase()));
          const items = v.data.items.filter((i) => fair(i.why) && !taken.has(i.name.toLowerCase())).map(range);
          return items.length ? { origin: v.data.origin ?? null, items } : null;
        },
        { maxTokens: 1600, temperature: 0.7 },
      );
      if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
      // Distância em linha reta calculada aqui (não pela IA), quando há um ponto de partida.
      const from = near?.lat != null && near.lng != null ? [near.lat, near.lng] as [number, number] : res.data.origin ? [res.data.origin.lat, res.data.origin.lng] as [number, number] : null;
      const items = res.data.items.map((i) => ({ ...i, km: from ? Math.round(haversineKm(from, [i.lat, i.lng])) : null }));
      return NextResponse.json({ data: { items, from: near?.name ?? res.data.origin?.name ?? null, currency: cur, people }, by: 'ai', model: `${res.provider}:${res.model}` });
    }

    const stop = (bundle.stops ?? []).find((s) => s.id === q.stopId);
    if (!stop) throw new HttpError(404, 'Parada não encontrada.');
    const nights = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));

    if (q.kind === 'activities') {
      const planned = (bundle.activities ?? []).filter((a) => a.stop_id === stop.id).map((a) => a.title);
      const res = await runWithFallback(
        'explore',
        EXPLORE_RULES,
        `${ctx}
Parada: ${stop.name}${stop.country ? `, ${stop.country}` : ''}, ${nights + 1} dia(s) (${stop.arrival_date} a ${stop.departure_date}).
Já no plano: ${JSON.stringify(planned)}.
${q.capPerPerson ? `Teto de passeios por pessoa nesta parada: ${q.capPerPerson} ${cur}. Inclua opções grátis, opções que cabem e no máximo 2 que passam do teto.` : 'Sem teto definido: misture grátis, baratos e alguns mais caros.'}
Sugira até 8 passeios ou atrações (sem repetir o plano). "cost_low"/"cost_high" = custo aproximado por pessoa (0 e 0 se for grátis). "duration" = ex.: "2h", "meio dia", "dia inteiro".
JSON: {"items":[{"title":"...","why":"...","duration":"...","cost_low":0,"cost_high":0}]}`,
        (raw) => {
          const v = exploreActivitySchema.safeParse(raw);
          if (!v.success) return null;
          const items = v.data.items.filter((i) => fair(i.why) && !planned.some((t) => t.toLowerCase() === i.title.toLowerCase())).map(range);
          return items.length ? items : null;
        },
        { maxTokens: 1200, temperature: 0.7 },
      );
      if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
      return NextResponse.json({ data: { items: res.data, currency: cur }, by: 'ai', model: `${res.provider}:${res.model}` });
    }

    const res = await runWithFallback(
      'explore',
      EXPLORE_RULES,
      `${ctx}
Parada: ${stop.name}${stop.country ? `, ${stop.country}` : ''}, ${nights} noite(s).
${q.budgetStyle ? `Estilo para as faixas de diária: ${{ economico: 'Hostel, quarto da turma', equilibrado: 'Pousada simples, quarto da turma', conforto: 'Hotel, mais conforto' }[q.budgetStyle]}. Não cite estabelecimentos.` : ''}
Plano na parada: ${JSON.stringify((bundle.activities ?? []).filter((a) => a.stop_id === stop.id).map((a) => a.title))}.
${q.nightlyCap ? `Teto da diária para o grupo todo: ${q.nightlyCap} ${cur}.` : ''}
Sugira até 4 bairros ou regiões pra se hospedar, explicando pra quem cada um combina (perto do quê, como é à noite, se precisa de transporte). "price_low"/"price_high" = faixa aproximada da diária de um quarto/casa para ${people} pessoa(s), em ${cur}.
JSON: {"areas":[{"name":"...","why":"...","price_low":0,"price_high":0}]}`,
      (raw) => {
        const v = exploreStaySchema.safeParse(raw);
        if (!v.success) return null;
        const areas = v.data.areas.filter((a) => fair(a.why)).map((a) => ({ ...a, price_low: Math.min(a.price_low, a.price_high), price_high: Math.max(a.price_low, a.price_high) }));
        return areas.length ? areas : null;
      },
      { maxTokens: 900, temperature: 0.6 },
    );
    if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
    return NextResponse.json({ data: { areas: res.data, currency: cur }, by: 'ai', model: `${res.provider}:${res.model}` });
  });
}
