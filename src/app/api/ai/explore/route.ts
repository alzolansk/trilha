import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { claimsAction, EXPLORE_RULES, exploreActivitySchema, exploreDestSchema, explorePlacesSchema, exploreRouteSchema, exploreStaySchema } from '@/lib/ai/prompts';
import type { NearbyIdea, PlaceIdea, RouteProposal } from '@/data/types';
import { filterNearby, missingMust, nightsOf, normalizeRoute, parseOnboarding } from '@/lib/onboarding';
import { headcount } from '@/lib/people';
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
  z.object({
    kind: z.literal('activities'), tripId: z.string().uuid(), stopId: z.string().uuid(), capPerPerson: reais,
    vibes: z.array(z.string().max(20)).max(9).optional(), wishes: z.array(z.string().max(80)).max(5).optional(),
    pace: z.enum(['leve', 'moderado', 'intenso']).optional(),
  }),
  z.object({ kind: z.literal('places'), tripId: z.string().uuid() }),
  z.object({
    kind: z.literal('route'), tripId: z.string().uuid(),
    must: z.array(z.string().max(80)).max(16), maybe: z.array(z.string().max(80)).max(20), skip: z.array(z.string().max(80)).max(20),
    wishes: z.array(z.string().max(80)).max(5).default([]),
    variant: z.enum(['calmo', 'mais_lugares']).nullable().optional(),
    force: z.array(z.string().max(80)).max(4).optional(),
    // Ajuste pedido em texto ("Roma ficou com muitos dias") sobre o roteiro atual, já com as edições da pessoa.
    feedback: z.string().trim().max(300).optional(),
    current: z.array(z.object({ name: z.string().max(80), nights: z.number().int().min(1).max(60) })).max(12).optional(),
  }),
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
    const { bundle, role } = await loadTripForUser(sb, user.id, q.tripId);
    if ((q.kind === 'places' || q.kind === 'route') && role === 'viewer') throw new HttpError(403, 'Só quem edita a trilha monta o roteiro.');
    const { count } = await sb.from('trip_members').select('user_id', { count: 'exact', head: true }).eq('trip_id', q.tripId);
    // Pessoas na viagem: membros no app ou trips.party_size, o que for maior (planning §10.9).
    const people = headcount({ members: Array.from({ length: Math.max(1, count ?? 1) }) as never[], trip: bundle.trip });
    const cur = bundle.trip.base_currency;
    const days = daysBetween(bundle.trip.start_date, bundle.trip.end_date) + 1;
    const ctx = `Moeda: ${cur}. Pessoas: ${people}. Estilo: ${bundle.trip.style}. Datas: ${bundle.trip.start_date} a ${bundle.trip.end_date} (${days} dias).`;
    await consumeQuota(sb);

    if (q.kind === 'places' || q.kind === 'route') return onboardingAi(q, bundle, ctx, cur);

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
"stops" = de 2 a 6 cidades/paradas reais, em ordem, de um roteiro enxuto nesse destino (a primeira costuma ser o próprio lugar). "photo_query" = nome do lugar + uma palavra-chave para achar uma foto. "tags" = vibes que o lugar atende, só entre: natureza, cidade, praia, cultura, aventura, comida.
JSON: {"origin":{"name":"...","lat":0,"lng":0} ou null,"items":[{"name":"...","region":"estado/província","country":"...","lat":0,"lng":0,"why":"...","mode":"bus|car|plane|train|boat","hours":0,"cost_low":0,"cost_high":0,"stops":["..."],"photo_query":"...","tags":["..."]}]}`,
        (raw) => {
          const v = exploreDestSchema.safeParse(raw);
          if (!v.success) return null;
          const taken = new Set(stops.map((s) => s.name.toLowerCase()));
          const items = v.data.items.filter((i) => fair(i.why) && !taken.has(i.name.toLowerCase())).map(range).map((i) => ({ ...i, stops: i.stops.filter((n) => fair(n)).slice(0, 6) }));
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
${q.vibes?.length ? `A turma gosta de: ${q.vibes.join(', ')}.` : ''}
${q.pace ? `Ritmo da viagem: ${{ leve: 'calmo', moderado: 'equilibrado', intenso: 'ver tudo' }[q.pace]}.` : ''}
${q.wishes?.length ? `Desejos da turma (inclua um passeio para cada desejo que faça sentido NESTA cidade, e diga qual em "wish"): ${JSON.stringify(q.wishes)}.` : ''}
Sugira até 8 passeios ou atrações (sem repetir o plano). "cost_low"/"cost_high" = custo aproximado por pessoa (0 e 0 se for grátis). "duration" = ex.: "2h", "meio dia", "dia inteiro".
"tags" = só entre: natureza, cidade, praia, cultura, arte, comida, aventura, noturna, compras. "day_fit" = manha|tarde|noite|dia_todo. "photo_query" = nome da atração + cidade. "wish" = o desejo atendido, ou null.
JSON: {"items":[{"title":"...","why":"...","duration":"...","cost_low":0,"cost_high":0,"tags":["..."],"day_fit":"manha","photo_query":"...","wish":null}]}`,
        (raw) => {
          const v = exploreActivitySchema.safeParse(raw);
          if (!v.success) return null;
          const wishes = new Set((q.wishes ?? []).map((w) => w.toLowerCase().trim()));
          const items = v.data.items.filter((i) => fair(i.why) && !planned.some((t) => t.toLowerCase() === i.title.toLowerCase())).map(range)
            // "wish" só vale se for um dos desejos enviados (a IA às vezes preenche em todos).
            .map((i) => ({ ...i, wish: i.wish && wishes.has(i.wish.toLowerCase().trim()) ? i.wish : null }));
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

type Brief = Partial<import('@/data/types').TripBundle> & { trip: import('@/data/types').Trip };
type PlacesQ = { kind: 'places'; tripId: string };
type RouteQ = {
  kind: 'route'; tripId: string; must: string[]; maybe: string[]; skip: string[]; wishes: string[];
  variant?: 'calmo' | 'mais_lugares' | null; force?: string[]; feedback?: string; current?: { name: string; nights: number }[];
};
const cents = (v: number) => Math.round(v * 100);
const PACE_TEXT = { leve: 'calmo, poucas cidades (cerca de 3 ou mais noites por parada)', moderado: 'equilibrado (2 a 4 noites por parada)', intenso: 'ver tudo (cerca de 2 noites por parada, com bate-voltas)' } as const;

/** Passos 3 e 4 do onboarding (planning §10.5, §10.6 e §10.13). Só sugere; nada é gravado aqui. */
async function onboardingAi(q: PlacesQ | RouteQ, bundle: Brief, ctx: string, cur: string) {
  const trip = bundle.trip;
  const ob = parseOnboarding(trip.onboarding);
  const prefs = ob?.prefs;
  const dest = trip.destinations.filter((d) => d.trim()).join(', ') || trip.title;
  const nights = nightsOf(trip);
  const about = `${ctx}
Destino: ${dest}. Saindo de: ${trip.origin || 'não informado'}. Noites: ${nights}.
${prefs?.vibes?.length ? `A turma gosta de: ${prefs.vibes.join(', ')}.` : ''}
${prefs ? `Ritmo: ${PACE_TEXT[prefs.pace]}. Hospedagem: ${{ economico: 'hostel', equilibrado: 'pousada ou apartamento', conforto: 'hotel' }[prefs.stay]}.` : ''}
${prefs?.budget ? `Teto por pessoa para a viagem toda: ${prefs.budget} ${cur}.` : ''}`;

  if (q.kind === 'places') {
    const fromDiscover = ob?.discover_stops ?? [];
    const res = await runWithFallback(
      'explore',
      EXPLORE_RULES,
      `${about}
${fromDiscover.length ? `Já sugeridas antes (inclua): ${JSON.stringify(fromDiscover)}.` : ''}
1) "items": de 8 a 10 cidades ou regiões DENTRO de ${dest} que combinam com a turma, das mais imperdíveis para as menos. "nights_min"/"nights_max" = noites que o lugar costuma pedir. "highlights" = até 3 destaques curtos. "why" = uma frase do porquê combina.
2) "nearby": de 4 a 8 lugares PERTO de algum dos items, que muitos viajantes não sabem que ficam perto, inclusive em países vizinhos (a até ~3h de viagem). "from" = o item de onde se sai (mesmo nome usado em items). "hours" = tempo de ida. "kind" = "bate_volta" se cabe num dia sem dormir, senão "parada". "cost_low"/"cost_high" = custo extra por pessoa (transporte ida e volta) em ${cur}.
"attractions" = os principais pontos turísticos ou experiências do lugar (4 a 6 nos items, 2 a 3 no nearby), com o nome oficial curto e uma frase do que tem de legal. "tip" = uma dica prática curta (melhor horário, como circular, o que evitar). Nada de nomes de hotel ou restaurante.
"lat"/"lng" = coordenadas aproximadas. "photo_query" = nome do lugar + uma palavra-chave. "tags" só entre: natureza, cidade, praia, cultura, arte, comida, aventura, noturna, compras.
JSON: {"items":[{"name":"...","region":"...","country":"...","lat":0,"lng":0,"why":"...","nights_min":2,"nights_max":3,"highlights":["..."],"photo_query":"...","tags":["..."],"attractions":[{"name":"...","why":"..."}],"tip":"..."}],"nearby":[{"name":"...","country":"...","lat":0,"lng":0,"why":"...","from":"...","mode":"train","hours":1.5,"kind":"bate_volta","cost_low":0,"cost_high":0,"photo_query":"...","attractions":[{"name":"...","why":"..."}],"tip":"..."}]}`,
      (raw) => {
        const v = explorePlacesSchema.safeParse(raw);
        if (!v.success) return null;
        const items: PlaceIdea[] = v.data.items.filter((i) => fair(i.why)).map((i) => ({
          ...i, region: i.region ?? null, nights_min: Math.min(i.nights_min, i.nights_max), nights_max: Math.max(i.nights_min, i.nights_max),
          highlights: i.highlights.filter(fair), photo_query: i.photo_query ?? null,
          attractions: i.attractions.filter((x) => fair(x.why ?? '')).map((x) => ({ name: x.name, why: x.why ?? null })),
          tip: i.tip && fair(i.tip) ? i.tip : null,
        }));
        const nearby: NearbyIdea[] = filterNearby(v.data.nearby.filter((n) => fair(n.why)).map((n) => ({
          ...n, cost_low: cents(Math.min(n.cost_low, n.cost_high)), cost_high: cents(Math.max(n.cost_low, n.cost_high)), photo_query: n.photo_query ?? null,
          attractions: n.attractions.filter((x) => fair(x.why ?? '')).map((x) => ({ name: x.name, why: x.why ?? null })),
          tip: n.tip && fair(n.tip) ? n.tip : null,
        })), items);
        return items.length >= 3 ? { items, nearby } : null;
      },
      { maxTokens: 4200, temperature: 0.6 },
    );
    if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
    return NextResponse.json({ data: { ...res.data, currency: cur }, by: 'ai', estimate: true, model: `${res.provider}:${res.model}` });
  }

  const ask = (strict: boolean) => `${about}
Monte o roteiro de ${nights} noites.
NÃO PODE FALTAR: ${JSON.stringify(q.must)}${strict ? ' (OBRIGATÓRIO: inclua todos como parada ou bate-volta; se for impossível, explique em left_out)' : ''}.
Talvez: ${JSON.stringify(q.maybe)}. Não incluir: ${JSON.stringify(q.skip)}.
${q.force?.length ? `Inclua também, obrigatoriamente: ${JSON.stringify(q.force)}.` : ''}
${q.current?.length ? `Roteiro atual (com as edições da pessoa): ${q.current.map((c) => `${c.name} ${c.nights} noite(s)`).join(' → ')}.` : ''}
${q.feedback ? `PEDIDO DE AJUSTE da pessoa (prioridade máxima): "${q.feedback.replace(/"/g, "'")}". Refaça o roteiro atendendo o pedido e mantendo o resto do roteiro atual o mais parecido possível. Se o pedido for impossível, faça o mais próximo e explique em left_out.` : ''}
${q.variant === 'calmo' ? 'Versão MAIS CALMA: menos cidades, mais noites em cada.' : q.variant === 'mais_lugares' ? 'Versão com MAIS LUGARES: mais paradas e bate-voltas, sem passar das noites.' : ''}
${q.wishes.length ? `Desejos da turma: ${JSON.stringify(q.wishes)}. Em "wishes", diga em qual parada cada um cabe (ou null).` : ''}
Regras: a soma de "nights" das paradas deve ser exatamente ${nights}. Ordem geográfica que evite voltar caminho; entrar por uma cidade e sair por outra é normal.
"outbound" = chegada a partir de ${trip.origin || 'origem (se não souber, null)'} até a primeira parada; "return" = da última parada de volta para a origem (null se não houver origem). Preço POR PESSOA, só ida, em ${cur}.
"legs" = trechos entre paradas consecutivas, em ordem (from = parada atual, to = próxima), com preço por pessoa em ${cur}.
"day_trips" = bate-voltas a partir da parada ("day_offset" = dia dentro da parada, 0 = chegada; custo por pessoa).
"stay_pp_night" = faixa [mín, máx] da diária POR PESSOA (quarto dividido entre a turma) em cada estilo, em ${cur}.
"food_pp_day" = faixa de comida por pessoa por dia em cada país da rota, em ${cur}.
"left_out" = lugares pedidos que não couberam e o motivo curto.
JSON: {"outbound":{"to":"...","mode":"plane","hours":0,"cost_low":0,"cost_high":0},"stops":[{"name":"...","country":"...","lat":0,"lng":0,"nights":2,"why":"...","day_trips":[{"name":"...","day_offset":1,"cost_low":0,"cost_high":0}],"stay_pp_night":{"economico":[0,0],"equilibrado":[0,0],"conforto":[0,0]}}],"legs":[{"from":"...","to":"...","mode":"train","hours":0,"cost_low":0,"cost_high":0}],"return":{"from":"...","mode":"plane","hours":0,"cost_low":0,"cost_high":0},"food_pp_day":[{"country":"...","low":0,"high":0}],"left_out":[{"name":"...","reason":"..."}],"wishes":[{"wish":"...","stop":"..."}]}`;

  const parse = (raw: unknown): RouteProposal | null => {
    const v = exploreRouteSchema.safeParse(raw);
    if (!v.success) return null;
    const d = v.data;
    const range = (lo: number, hi: number) => ({ cost_low: cents(Math.min(lo, hi)), cost_high: cents(Math.max(lo, hi)) });
    const origin = trip.origin?.trim() || null;
    const stops = d.stops.filter((x) => fair(x.why ?? '')).map((x) => ({
      name: x.name, country: x.country, lat: x.lat, lng: x.lng, nights: x.nights, why: x.why ?? null,
      day_trips: x.day_trips.filter((t) => fair(t.name)).map((t) => ({ name: t.name, day_offset: t.day_offset, ...range(t.cost_low, t.cost_high) })),
      stay_pp_night: Object.fromEntries(Object.entries(x.stay_pp_night ?? {}).filter(([, p]) => !!p).map(([k, p]) => [k, { low: cents(Math.min(p![0], p![1])), high: cents(Math.max(p![0], p![1])) }])),
    }));
    if (!stops.length) return null;
    return {
      outbound: d.outbound && origin ? { from: origin, to: d.outbound.to, mode: d.outbound.mode, hours: d.outbound.hours, ...range(d.outbound.cost_low, d.outbound.cost_high) } : null,
      stops,
      legs: d.legs.map((l) => ({ from: l.from, to: l.to, mode: l.mode, hours: l.hours, ...range(l.cost_low, l.cost_high) })),
      return: d.return && origin ? { from: d.return.from, to: origin, mode: d.return.mode, hours: d.return.hours, ...range(d.return.cost_low, d.return.cost_high) } : null,
      food_pp_day: d.food_pp_day.map((f) => ({ country: f.country, low: cents(Math.min(f.low, f.high)), high: cents(Math.max(f.low, f.high)) })),
      left_out: d.left_out.filter((l) => fair(l.reason)),
      wishes: d.wishes,
      generated_at: new Date().toISOString(),
    };
  };

  const must = [...q.must, ...(q.force ?? [])];
  const call = (strict: boolean) => runWithFallback('explore', EXPLORE_RULES, ask(strict), parse, { maxTokens: 2400, temperature: 0.5 });
  let res = await call(false);
  // Um "não pode faltar" sumiu sem explicação: uma nova tentativa, mais firme.
  if (res && missingMust(res.data, must).length) res = (await call(true)) ?? res;
  if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
  const route = normalizeRoute(res.data, nights, must);
  return NextResponse.json({ data: { route, currency: cur }, by: 'ai', estimate: true, model: `${res.provider}:${res.model}` });
}
