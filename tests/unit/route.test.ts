// Trilha 2.0 · Fase 5: Roteiro e página da parada (lib/route.ts) e links de hospedagem filtrados.
import { describe, expect, it } from 'vitest';
import { buildDemoBundle, DEMO_USER } from '@/lib/demo/build';
import { staySearchLinks } from '@/lib/explore';
import { bookingTodo, dayPending, focusStopId, isBooked, legInto, placeDaySuggestions, returnLeg, sameThing, stayState, stopAreas, stopBadge, stopTours, waitingCount } from '@/lib/route';
import { bestDayFor } from '@/lib/suggestions';
import { sortedStops } from '@/lib/derive';
import { addStayOption, voteSuggestions } from '@/data/suggestionActions';
import type { TripSource } from '@/data/source';
import type { TripBundle } from '@/data/types';

const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;

/** Source mínimo que só registra os inserts/updates (as ações não leem do banco). */
function recorder() {
  const rows: { table: string; row: Record<string, unknown> }[] = [];
  const updates: { table: string; id: string; patch: Record<string, unknown> }[] = [];
  const source = {
    kind: 'demo',
    insert: async (table: string, row: Record<string, unknown>) => { rows.push({ table, row }); return row; },
    update: async (table: string, id: string, patch: Record<string, unknown>) => { updates.push({ table, id, patch }); return patch; },
  } as unknown as TripSource;
  return { source, rows, updates };
}

describe('route · lista do roteiro', () => {
  it('foco: a parada de hoje durante a viagem; antes, a próxima que não acabou', () => {
    const stops = sortedStops(andes());
    expect(focusStopId(stops, '2026-11-08')).toBe(stops[0].id);
    expect(focusStopId(stops, '2027-01-19')).toBe(stops[1].id); // Cusco, 17 → 21 jan
    expect(focusStopId(stops, '2027-03-01')).toBe(stops[0].id); // depois da viagem: volta ao começo
    expect(focusStopId([], '2027-01-01')).toBeNull();
  });

  it('selo da parada: pronto, falta hospedagem, em votação', () => {
    const b = andes();
    const [lima, , mapi] = sortedStops(b);
    expect(stopBadge(b, lima)).toEqual({ label: 'pronto', tone: 'ok' });
    expect(stopBadge(b, mapi).label).toBe('em votação'); // enquete de hospedagem aberta em Aguas Calientes
    b.polls = [];
    expect(stopBadge(b, mapi).label).toBe('falta hospedagem');
  });

  it('trecho entre paradas: título, duração, preço por pessoa e "não reservado"', () => {
    const b = andes();
    const stops = sortedStops(b);
    const ida = legInto(b, stops, 0)!;
    expect(ida.title).toBe('Voo GRU → Lima');
    expect(ida.notBooked).toBe(false); // voo pago pelo caixa (gasto ligado)
    const toCusco = legInto(b, stops, 1)!;
    expect(toCusco.title).toBe('Voo Lima → Cusco');
    expect(toCusco.priceCents).toBe(145_000);
    expect(toCusco.notBooked).toBe(true);
    expect(isBooked(b, { ...toCusco.transport!, booking_ref: 'ABC123' })).toBe(true);
  });

  it('trecho: reservado ou a reservar, e o dia de saída', () => {
    const b = andes();
    const stops = sortedStops(b);
    const ida = legInto(b, stops, 0)!;
    expect(ida.booked).toBe(true);
    expect(ida.notBooked).toBe(false);
    const toCusco = legInto(b, stops, 1)!;
    expect(toCusco.booked).toBe(false);
    expect(toCusco.date).toBe(toCusco.transport!.depart_date);
  });

  it('onde dormir: reservado, em votação, a definir', () => {
    const b = andes();
    const [lima, , mapi] = sortedStops(b);
    expect(stayState(b, lima)).toBe('booked');
    expect(stayState(b, mapi)).toBe('voting');
    b.polls = [];
    expect(stayState(b, mapi)).toBe('missing');
  });

  it('"Antes de ir": junta trechos e hospedagens que faltam, com soma por pessoa', () => {
    const b = andes();
    const stops = sortedStops(b);
    const todo = bookingTodo(b, stops);
    const legs = [...stops.map((_, i) => legInto(b, stops, i)), returnLeg(b, stops)].filter((l) => l?.transport && (l.booked || l.notBooked));
    expect(todo.pending + todo.done).toBe(legs.length + stops.filter((x) => stayState(b, x) !== 'none').length);
    const planes = todo.groups.find((g) => g.key === 'plane')!;
    expect(planes.legs.map((l) => l.title)).toContain('Voo Lima → Cusco');
    expect(planes.legs.every((l) => l.notBooked)).toBe(true);
    if (planes.totalCents != null) expect(planes.totalCents).toBe(planes.legs.reduce((a, l) => a + (l.priceCents ?? 0), 0));
    const stay = todo.groups.find((g) => g.key === 'stay');
    expect(stay?.stops.map((x) => x.name)).not.toContain('Lima');
    // reservar tudo zera as pendências
    for (const t of b.transports) t.booking_ref = 'OK1';
    for (const st of b.stays) st.status = 'booked';
    b.polls = [];
    const done = bookingTodo(b, stops);
    expect(done.groups.filter((g) => g.key !== 'stay')).toEqual([]);
  });

  it('pendência do dia aparece no dia em que o trecho SAI da parada', () => {
    const b = andes();
    const [lima, cusco] = sortedStops(b);
    expect(dayPending(b, lima, '2027-01-17')).toEqual(['Voo para Cusco ainda não reservado']);
    expect(dayPending(b, cusco, '2027-01-17')).toEqual([]);
    expect(dayPending(b, cusco, '2027-01-21')).toEqual(['Trem para Machu Picchu ainda não reservado']);
  });

  it('sugestões por dia: dia vazio recebe 3 opções; folga recebe 1; a chegada em altitude fica de fora', () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const placed = placeDaySuggestions(b, cusco);
    expect(placed.get('2027-01-20')?.map((s) => s.payload.title)).toEqual(['Montanha Colorida, saindo de Cusco', 'Laguna Humantay', 'Aula de cozinha peruana']);
    expect(placed.get('2027-01-18')?.map((s) => s.payload.title)).toEqual(['Sacsayhuamán']);
    expect(placed.has('2027-01-17')).toBe(false); // chegada a 3.400 m
    // nenhuma sugestão aparece em dois dias
    const all = [...placed.values()].flat().map((s) => s.id);
    expect(new Set(all).size).toBe(all.length);
    // teto baixo tira as que passam
    expect(placeDaySuggestions(b, cusco, 5_000).get('2027-01-20')).toBeUndefined();
  });

  it('bestDayFor também pula a chegada em altitude (Início e Roteiro dizem o mesmo dia)', () => {
    const b = andes();
    const sacsa = b.suggestions.find((s) => s.payload.title === 'Sacsayhuamán')!;
    expect(bestDayFor(b, sacsa)?.date).toBe('2027-01-18');
  });

  it('conta as sugestões esperando', () => {
    const b = andes();
    expect(waitingCount(b)).toBe(9); // 6 passeios + 3 bairros novos (San Blas já foi aceito)
  });
});

describe('route · página da parada', () => {
  it('bairros: o escolhido vem com Bom/Atenção; os outros, até 3', () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const { chosen, others } = stopAreas(b, cusco);
    expect(chosen).toMatchObject({ title: 'San Blas', good: 'vista, silêncio, cafés', watch: 'ladeira com mala', chosen: true });
    expect(others.map((a) => a.title)).toEqual(['Centro histórico', 'San Pedro']);
    // bairro escolhido sem sugestão vira um cartão só com o nome (nada inventado)
    const lima = sortedStops(b)[0];
    expect(stopAreas(b, lima).chosen).toMatchObject({ title: 'Miraflores', why: null, good: null });
  });

  it('passeios: sugestões + atividades com custo; destaque é o que a turma salvou e ainda não está no roteiro', () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const tours = stopTours(b, cusco);
    expect(tours[0].title).toBe('Montanha Colorida, saindo de Cusco');
    expect(tours[0].savedBy).toBe('Bia');
    expect(tours[0].status).toMatchObject({ kind: 'nova', slot: { dayNumber: 6 } });
    const vale = tours.find((t) => /Vale Sagrado/.test(t.title))!;
    expect(vale.status).toMatchObject({ kind: 'roteiro', day: 5 });
    expect(tours.some((t) => /aclimatar/.test(t.title))).toBe(false); // atividade sem custo não é passeio
  });

  it('passeio em votação mostra a posição na enquete', async () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const list = b.suggestions.filter((s) => s.stop_id === cusco.id && s.kind === 'activity').slice(0, 3);
    const { source, rows } = recorder();
    await voteSuggestions(source, b, list, DEMO_USER);
    const poll = rows.find((r) => r.table === 'polls')!.row;
    const opts = rows.filter((r) => r.table === 'poll_options').map((r) => r.row);
    expect(poll).toMatchObject({ target: 'activity', stop_id: cusco.id, question: 'Qual passeio em Cusco?' });
    expect(opts.map((o) => o.price)).toEqual(['150.00', '115.00', '185.00']);
    // simula o banco depois da votação criada
    b.polls.push({ ...(poll as object), status: "open" } as never);
    opts.forEach((o) => b.pollOptions.push(o as never));
    list.forEach((s) => (s.status = 'voting'));
    const t = stopTours(b, cusco).find((x) => x.title === 'Laguna Humantay')!;
    expect(t.status).toEqual({ kind: 'votacao', pos: 2, total: 3 });
  });

  it('bairros vão para votação livre com a diária', async () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const areas = b.suggestions.filter((s) => s.stop_id === cusco.id && s.kind === 'area' && s.status === 'new');
    const { source, rows } = recorder();
    await voteSuggestions(source, b, areas, DEMO_USER);
    expect(rows[0].row).toMatchObject({ target: 'free', question: 'Em que bairro ficar em Cusco?' });
    expect(rows.filter((r) => r.table === 'poll_options').map((r) => r.row.label)).toEqual(['Centro histórico', 'San Pedro']);
  });

  it('link colado vira opção na enquete de hospedagem (cria a enquete quando não há)', async () => {
    const b = andes();
    const [, cusco, mapi] = sortedStops(b);
    const a = recorder();
    const r1 = await addStayOption(a.source, b, cusco, DEMO_USER, { label: 'Casa azul', link: 'https://www.airbnb.com.br/rooms/1', priceCents: 21000, currency: 'BRL' });
    expect(r1.created).toBe(true);
    expect(a.rows[0].row).toMatchObject({ target: 'stay', stop_id: cusco.id });
    expect(a.rows[1].row).toMatchObject({ label: 'Casa azul', price: '210.00', currency: 'BRL', link_url: 'https://www.airbnb.com.br/rooms/1', address: 'San Blas, Cusco', position: 0 });
    const c = recorder();
    const r2 = await addStayOption(c.source, b, mapi, DEMO_USER, { label: 'Outra', link: 'https://booking.com/x', priceCents: null, currency: 'BRL' });
    expect(r2.created).toBe(false);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].row).toMatchObject({ position: 3, price: null, currency: null });
    await expect(addStayOption(c.source, b, mapi, DEMO_USER, { label: 'x', link: 'javascript:alert(1)', priceCents: null, currency: 'BRL' })).rejects.toThrow(/http/);
  });

  it('sameThing compara a parte antes da vírgula, sem acento', () => {
    expect(sameThing('Montanha Colorida, saindo de Cusco', 'Montanha Colorida')).toBe(true);
    expect(sameThing('Sacsayhuamán', 'sacsayhuaman')).toBe(true);
    expect(sameThing('Vale Sagrado', 'Valle de la Luna')).toBe(false);
  });
});

describe('staySearchLinks com bairro e teto', () => {
  it('Booking e Airbnb levam bairro, datas, pessoas e teto por noite; Hostelworld sem teto', () => {
    const [booking, airbnb, hw] = staySearchLinks('Cusco, Peru', '2027-01-17', '2027-01-21', 3, { area: 'San Blas', maxNightCents: 20_000, currency: 'BRL' });
    const bu = new URL(booking.url);
    expect(bu.searchParams.get('ss')).toBe('San Blas, Cusco, Peru');
    expect(bu.searchParams.get('checkin')).toBe('2027-01-17');
    expect(bu.searchParams.get('group_adults')).toBe('3');
    expect(bu.searchParams.get('nflt')).toBe('price=BRL-0-200-1');
    const au = new URL(airbnb.url);
    expect(decodeURIComponent(au.pathname)).toBe('/s/San Blas, Cusco, Peru/homes');
    expect(au.searchParams.get('price_max')).toBe('200');
    expect(au.searchParams.get('adults')).toBe('3');
    expect(hw.url).toContain('search_keywords=San%20Blas%2C%20Cusco%2C%20Peru');
    expect(hw.url).not.toContain('200');
  });

  it('sem teto, sem filtro de preço; bairro que já está no nome não repete', () => {
    const [booking, airbnb] = staySearchLinks('San Blas, Cusco', '2027-01-17', '2027-01-21', 2, { area: 'San Blas' });
    expect(new URL(booking.url).searchParams.get('ss')).toBe('San Blas, Cusco');
    expect(new URL(booking.url).searchParams.has('nflt')).toBe(false);
    expect(new URL(airbnb.url).searchParams.has('price_max')).toBe(false);
  });
});
