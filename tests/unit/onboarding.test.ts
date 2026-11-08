// Fase 10 (planning §10.12 e §10.10): regras puras do onboarding e correções do Orçamento.
import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { budgetFromPlan, budgetRange, describeChanges, diffSince, initialPlan, snapshotOf, transportLegs, virtualLegs } from '@/lib/budgetPlan';
import { headcount } from '@/lib/people';
import {
  adjustNights, assignTourDays, cutSuggestions, datesFor, defaultMarks, filterNearby, fitNights, foodByCountry, minNightsOfMust,
  missingMust, moveStop, normalizeRoute, parseOnboarding, placeKey, preselectTours, removeStop, routeToRows, staleLegs,
} from '@/lib/onboarding';
import type { NearbyIdea, PlaceIdea, RouteProposal, RouteStop, TripBundle } from '@/data/types';

const stop = (name: string, nights: number, extra: Partial<RouteStop> = {}): RouteStop => ({ name, country: 'Itália', nights, day_trips: [], ...extra });
const leg = (from: string, to: string, low = 15000, high = 21000) => ({ from, to, mode: 'train' as const, hours: 2, cost_low: low, cost_high: high });
const italia = (): RouteProposal => ({
  outbound: { from: 'São Paulo', to: 'Roma', mode: 'plane', hours: 12, cost_low: 500000, cost_high: 660000 },
  stops: [stop('Roma', 4), stop('Florença', 4), stop('Cinque Terre', 2), stop('Milão', 1), stop('Veneza', 3)],
  legs: [leg('Roma', 'Florença'), leg('Florença', 'Cinque Terre'), leg('Cinque Terre', 'Milão'), leg('Milão', 'Veneza')],
  return: { from: 'Veneza', to: 'São Paulo', mode: 'plane', hours: 13, cost_low: 300000, cost_high: 400000 },
  food_pp_day: [{ country: 'Itália', low: 18000, high: 30000 }],
  left_out: [], wishes: [], generated_at: '2026-11-08T00:00:00Z',
});
const sum = (r: RouteProposal) => r.stops.reduce((a, s) => a + s.nights, 0);

describe('parseOnboarding', () => {
  it('tolera lixo e rejeita status desconhecido', () => {
    expect(parseOnboarding(null)).toBeNull();
    expect(parseOnboarding([1])).toBeNull();
    expect(parseOnboarding({ status: 'x' })).toBeNull();
    const o = parseOnboarding({ status: 'em_andamento', step: 9, marks: { roma: 'must', x: 'bad' }, wishes: ['a', 3] });
    expect(o?.step).toBe(2);
    expect(o?.marks).toEqual({ roma: 'must' });
    expect(o?.wishes).toEqual(['a']);
    expect(o?.route_calls).toBe(0);
  });
});

describe('passo 3', () => {
  const items: PlaceIdea[] = [
    { name: 'Roma', country: 'Itália', why: 'x', nights_min: 3, nights_max: 4, lat: 41.9, lng: 12.5 },
    { name: 'Florença', country: 'Itália', why: 'x', nights_min: 3, nights_max: 4, lat: 43.77, lng: 11.25 },
    { name: 'Lucca', country: 'Itália', why: 'x', nights_min: 1, nights_max: 2, added: true },
  ];
  const near = (name: string, from: string, hours: number, lat?: number, lng?: number): NearbyIdea => ({ name, country: 'Itália', why: 'x', from, mode: 'bus', hours, kind: 'bate_volta', cost_low: 1, cost_high: 2, lat, lng });

  it('marcações iniciais e mínimo de noites dos indispensáveis', () => {
    const m = defaultMarks(items, [near('Siena', 'Florença', 1.2)], { roma: 'must' });
    expect(m).toEqual({ roma: 'must', florenca: 'maybe', lucca: 'must', siena: 'maybe' });
    expect(minNightsOfMust(items, [], m)).toBe(4);
  });

  it('"perto daqui" descarta longe, repetido e o que já está na lista', () => {
    const list = filterNearby([
      near('Siena', 'Florença', 1.2, 43.32, 11.33),
      near('Siena', 'Florença', 1.2),
      near('Roma', 'Florença', 1.5),
      near('Nápoles', 'Florença', 3, 40.85, 14.27), // ~ 400 km de Florença
      near('Nice', 'Gênova', 5),
    ], items);
    expect(list.map((n) => n.name)).toEqual(['Siena']);
  });

  it('placeKey ignora acento e caixa', () => {
    expect(placeKey('  Florença ')).toBe(placeKey('florenca'));
  });
});

describe('passo 4: noites e ordem', () => {
  it('fitNights fecha a soma e corta paradas que não cabem', () => {
    expect(fitNights([stop('A', 5), stop('B', 5), stop('C', 5)], 14).stops.map((s) => s.nights)).toEqual([4, 5, 5]);
    expect(fitNights([stop('A', 1), stop('B', 1)], 6).stops.reduce((a, s) => a + s.nights, 0)).toBe(6);
    const r = fitNights([stop('A', 1), stop('B', 1), stop('C', 1)], 2);
    expect(r.stops.map((s) => s.name)).toEqual(['A', 'B']);
    expect(r.dropped.map((s) => s.name)).toEqual(['C']);
  });

  it('+ e − mantêm a soma e respeitam 1 noite mínima', () => {
    const r = italia();
    const plus = adjustNights(r, 3, 1); // Milão ganha de um vizinho
    expect(sum(plus)).toBe(14);
    expect(plus.stops[3].nights).toBe(2);
    expect(adjustNights(r, 3, -1)).toBe(r); // Milão já tem 1
    const minus = adjustNights(r, 0, -1);
    expect(sum(minus)).toBe(14);
    expect(minus.stops[0].nights).toBe(3);
  });

  it('reordenar refaz os trechos e marca os novos para recalcular', () => {
    const r = moveStop(italia(), 4, 0); // Veneza primeiro
    expect(r.stops[0].name).toBe('Veneza');
    expect(r.outbound?.to).toBe('Veneza');
    expect(r.outbound?.cost_low).toBeNull();
    expect(r.legs).toHaveLength(4);
    expect(r.legs[1]).toMatchObject({ from: 'Roma', to: 'Florença', cost_low: 15000 }); // par já existia
    expect(staleLegs(r).length).toBeGreaterThan(0);
  });

  it('tirar uma parada devolve as noites e registra o motivo', () => {
    const r = removeStop(italia(), 2, 14);
    expect(r.stops.map((s) => s.name)).not.toContain('Cinque Terre');
    expect(sum(r)).toBe(14);
    expect(r.left_out[0].name).toBe('Cinque Terre');
  });

  it('datas contíguas e payload com ida, trechos e volta (open-jaw)', () => {
    const r = italia();
    const d = datesFor(r, '2027-05-02');
    expect(d[0]).toEqual({ arrival: '2027-05-02', departure: '2027-05-06' });
    expect(d[4].departure).toBe('2027-05-16');
    let n = 0;
    const rows = routeToRows(r, { start_date: '2027-05-02', end_date: '2027-05-16', origin: 'São Paulo' }, () => `id-${n++}`);
    expect(rows.stops.map((s) => s.id)).toEqual(['id-0', 'id-1', 'id-2', 'id-3', 'id-4']);
    expect(rows.stops[0].arrival_mode).toBe('plane');
    expect(rows.legs).toHaveLength(6);
    expect(rows.legs[0]).toMatchObject({ stop_index: 0, origin_name: 'São Paulo', dest_name: 'Roma', price_cents: 580000 });
    expect(rows.legs[5]).toMatchObject({ stop_index: 4, origin_name: 'Veneza', dest_name: 'São Paulo', is_return: true, depart_date: '2027-05-16' });
    expect(rows.legs[1].depart_date).toBe('2027-05-06');
  });

  it('sem origem não cria volta', () => {
    const rows = routeToRows(italia(), { start_date: '2027-05-02', end_date: '2027-05-16', origin: null });
    expect(rows.legs.some((l) => l.is_return)).toBe(false);
  });

  it('normalizeRoute: noites somando o total, trechos em ordem e indispensável explicado', () => {
    const raw = italia();
    raw.stops[0].nights = 9;
    raw.legs = [leg('Veneza', 'Milão')]; // fora de ordem e faltando
    const r = normalizeRoute(raw, 14, ['Roma', 'Costa Amalfitana']);
    expect(sum(r)).toBe(14);
    expect(r.legs.map((l) => `${l.from}>${l.to}`)).toEqual(['Roma>Florença', 'Florença>Cinque Terre', 'Cinque Terre>Milão', 'Milão>Veneza']);
    expect(r.legs[3].cost_low).toBe(15000); // reaproveitou o par invertido
    expect(r.left_out.map((l) => l.name)).toEqual(['Costa Amalfitana']);
    expect(missingMust(raw, ['Roma', 'Capri'])).toEqual(['Capri']);
  });
});

describe('passo 5 e 6', () => {
  const tours = [
    { id: 'a', title: 'Coliseu', cost_low: 20000, cost_high: 30000, tags: ['cultura'] },
    { id: 'b', title: 'Vaticano', cost_low: 15000, cost_high: 20000, tags: ['cultura', 'arte'] },
    { id: 'c', title: 'Aula de massa', cost_low: 35000, cost_high: 40000, wish: 'aula de massa' },
    { id: 'd', title: 'Bar', cost_low: 5000, cost_high: 8000, tags: ['noturna'] },
  ];

  it('pré-seleção pelo ritmo, desejo primeiro', () => {
    expect(preselectTours(tours, 2, 'moderado', ['arte'])).toEqual(['c', 'b']);
    expect(preselectTours(tours, 2, 'leve', [])).toEqual(['c']);
  });

  it('espalha os passeios e deixa o dia da chegada por último', () => {
    const days = assignTourDays({ arrival_date: '2027-05-02', departure_date: '2027-05-05' }, [{ id: 'x', day_fit: 'dia_todo' }, { id: 'y' }, { id: 'z' }]);
    expect(days.get('x')).toBe('2027-05-03');
    expect(days.get('y')).toBe('2027-05-04');
    expect(days.get('z')).toBe('2027-05-02');
  });

  it('comida ponderada pelas noites de cada país', () => {
    const r = foodByCountry([{ country: 'Itália', nights: 3 }, { country: 'França', nights: 1 }], [{ country: 'Itália', low: 100, high: 200 }, { country: 'França', low: 300, high: 400 }]);
    expect(r).toEqual({ low: 150, high: 250 });
    expect(foodByCountry([], [])).toBeNull();
  });

  it('sugestões de corte calculam a economia', () => {
    const cuts = cutSuggestions({ style: 'conforto', activities: ['a', 'b', 'c'] }, [
      { id: 'a', title: 'Coliseu', perPersonCents: 25000 }, { id: 'b', title: 'Vaticano', perPersonCents: 17500 }, { id: 'c', title: 'Aula', perPersonCents: 37500 },
    ], (p) => 1_000_000 - (p.style === 'equilibrado' ? 200_000 : 0) - (p.activities ? 62_500 : 0));
    expect(cuts).toEqual([{ label: 'Trocar hotel por pousada', savesCents: 200_000 }, { label: 'Tirar Aula e Coliseu', savesCents: 62_500 }]);
  });
});

describe('Orçamento (§10.10) e pessoas na viagem (§10.9)', () => {
  const demo = () => structuredClone(buildDemoBundle('andes')) as TripBundle;

  it('headcount usa o maior entre membros e party_size', () => {
    const b = demo();
    expect(headcount(b)).toBe(b.members.length);
    b.trip.party_size = 6;
    expect(headcount(b)).toBe(6);
    b.trip.party_size = 1;
    expect(headcount(b)).toBe(b.members.length);
  });

  it('roteiro vazio: sem total; noites contadas pela viagem', () => {
    const b = demo();
    b.stops = []; b.transports = []; b.stays = []; b.activities = [];
    const r = budgetFromPlan(b, initialPlan(b));
    expect(r.empty).toBe(true);
    expect(r.nights).toBe(16);
    expect(r.uncoveredNights).toBe(16);
    expect(r.lines.find((l) => l.kind === 'hospedagem')!.perPersonCents).toBeGreaterThan(0);
  });

  it('voo de volta virtual: pendente até ter valor, depois entra como estimativa', () => {
    const b = demo();
    expect(virtualLegs(b).map((v) => v.key)).toEqual(['volta']);
    const p = initialPlan(b);
    const before = budgetFromPlan(b, p);
    expect(before.pendingVirtual).toBe(1);
    p.transport_cents = { ...p.transport_cents, volta: 250000 };
    const after = budgetFromPlan(b, p);
    expect(after.pendingVirtual).toBe(0);
    expect(after.lines[0].perPersonCents - before.lines[0].perPersonCents).toBe(250000);
    const legs = transportLegs(b, p);
    expect(legs[legs.length - 1]).toMatchObject({ id: 'volta', virtual: true, perPersonCents: 250000 });
    b.trip.origin = null;
    expect(virtualLegs(b)).toEqual([]);
  });

  it('party_size divide o total da turma', () => {
    const b = demo();
    const r1 = budgetFromPlan(b, initialPlan(b));
    b.trip.party_size = 10;
    const r2 = budgetFromPlan(b, initialPlan(b));
    expect(r2.people).toBe(10);
    expect(r2.totalCents).toBe(r2.perPersonCents * 10);
    expect(r1.people).toBe(b.members.length);
  });

  it('faixa mínima e máxima em volta do valor do meio', () => {
    const b = demo();
    const p = initialPlan(b);
    const r = budgetFromPlan(b, p);
    const range = budgetRange(r, p);
    expect(range.mid).toBe(r.perPersonCents);
    expect(range.low).toBeLessThan(range.mid);
    expect(range.high).toBeGreaterThan(range.mid);
  });

  it('aviso de mudança cita valores', () => {
    const b = demo();
    const p = initialPlan(b);
    const r = budgetFromPlan(b, p);
    const snap = snapshotOf(b, '2026-11-08', r);
    const r2 = budgetFromPlan(b, { ...p, transport_cents: { ...p.transport_cents, volta: 31000 } });
    const text = describeChanges(diffSince(snap, b, r2), (c) => `R$ ${c / 100}`);
    expect(text).toEqual(['+R$ 310 em transporte por pessoa']);
  });
});

describe('passo 4 · custo por parada e origem', () => {
  it('stopCost soma diária × noites, comida do país e bate-voltas', async () => {
    const { stopCost, routeCost, markOf } = await import('@/lib/onboarding');
    const st = { ...stop('Roma', 4), stay_pp_night: { equilibrado: { low: 20000, high: 30000 } }, day_trips: [{ name: 'Tivoli', day_offset: 1, cost_low: 4000, cost_high: 6000 }] };
    const food = [{ country: 'Itália', low: 18000, high: 30000 }];
    const c = stopCost(st, 'equilibrado', food, 9000, 7000);
    expect(c).toEqual({ stay: 100000, food: 96000, trips: 5000, total: 201000, stayIsReference: false });
    // Sem faixa para o estilo: referência
    expect(stopCost(st, 'conforto', [], 17100, 7000)).toMatchObject({ stay: 68400, food: 28000, stayIsReference: true });
    const r = italia();
    const t = routeCost(r, 'equilibrado', 9000, 7000);
    expect(t.legs).toBe(580000 + 4 * 18000 + 350000);
    expect(t.total).toBe(t.legs + t.stops);
    const places = { items: [{ name: 'Roma', country: 'Itália', why: 'x', nights_min: 3, nights_max: 4 }], nearby: [{ name: 'Tivoli', country: 'Itália', why: 'x', from: 'Roma', mode: 'bus' as const, hours: 1, kind: 'bate_volta' as const, cost_low: 1, cost_high: 2 }] };
    expect(markOf('roma', places, { roma: 'must' })).toEqual({ mark: 'must', nearby: false, added: false });
    expect(markOf('Tivoli', places, { tivoli: 'maybe' })).toEqual({ mark: 'maybe', nearby: true, added: false });
    expect(markOf('Bolonha', places, {})).toEqual({ mark: null, nearby: false, added: false });
  });
});

describe('passagem de ida e volta (splitFlights)', () => {
  it('divide o bilhete de ida e volta pela metade entre ida e volta', async () => {
    const { splitFlights } = await import('@/lib/onboarding');
    // IA manda o bilhete de ida e volta em `flights`: R$ 10–12 mil → R$ 5–6 mil em cada trecho
    expect(splitFlights({ cost_low: 10000, cost_high: 12000 }, { cost_low: 0, cost_high: 0 }, { cost_low: 0, cost_high: 0 }))
      .toEqual({ out: { cost_low: 500000, cost_high: 600000 }, back: { cost_low: 500000, cost_high: 600000 } });
    // Sem `flights`, mas com o mesmo valor repetido na ida e na volta (o erro que contava 11 mil duas vezes)
    expect(splitFlights(null, { cost_low: 10000, cost_high: 12000 }, { cost_low: 10500, cost_high: 11500 }))
      .toEqual({ out: { cost_low: 500000, cost_high: 600000 }, back: { cost_low: 525000, cost_high: 575000 } });
    // Valores bem diferentes (ida de avião, volta de trem): ficam como vieram
    expect(splitFlights(null, { cost_low: 5000, cost_high: 6000 }, { cost_low: 300, cost_high: 400 }))
      .toEqual({ out: { cost_low: 500000, cost_high: 600000 }, back: { cost_low: 30000, cost_high: 40000 } });
  });
});
