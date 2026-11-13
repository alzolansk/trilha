// Ajuste de 08/11/2026: dormir numa cidade vizinha mais barata, só quando a economia é considerável.
import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { budgetFromPlan, commuteId, transportLegs } from '@/lib/budgetPlan';
import { keepStayChoices, routeToRows, stayAltSaving, stayEstimatesOf, stopCost } from '@/lib/onboarding';
import type { RouteProposal, RouteStop, StayBase, TripBundle } from '@/data/types';

const salerno = (extra: Partial<StayBase> = {}): StayBase => ({
  name: 'Salerno', country: 'Itália', lat: 40.68, lng: 14.77, why: 'Barco para a costa.', mode: 'boat', minutes: 35, commute_pp_day: 3000,
  stay_pp_night: { equilibrado: { low: 12000, high: 18000 } }, ...extra,
});
const costa = (extra: Partial<RouteStop> = {}): RouteStop => ({
  name: 'Costa Amalfitana', country: 'Itália', nights: 3, day_trips: [], stay_pp_night: { equilibrado: { low: 30000, high: 40000 } }, stay_alt: salerno(), ...extra,
});
const route = (stops: RouteStop[]): RouteProposal => ({ outbound: null, stops, legs: [], return: null, food_pp_day: [], left_out: [], wishes: [], generated_at: 'x' });

describe('stayAltSaving', () => {
  it('economia já descontando o trajeto: (350 − 150) × 3 − 30 × 3 = R$ 510', () => {
    expect(stayAltSaving(costa(), 'equilibrado', 20000)).toEqual({ saves: 51000, share: 51000 / 105000 });
  });

  it('não sugere quando economiza pouco (menos de 20% da hospedagem)', () => {
    expect(stayAltSaving(costa({ stay_alt: salerno({ stay_pp_night: { equilibrado: { low: 28000, high: 34000 } } }) }), 'equilibrado', 20000)).toBeNull();
  });

  it('não sugere trajeto longo nem base sem diária no estilo', () => {
    expect(stayAltSaving(costa({ stay_alt: salerno({ minutes: 90 }) }), 'equilibrado', 20000)).toBeNull();
    expect(stayAltSaving(costa(), 'conforto', 20000)).toBeNull();
    expect(stayAltSaving(costa({ stay_alt: null }), 'equilibrado', 20000)).toBeNull();
  });
});

describe('custo e gravação', () => {
  it('stopCost usa a diária da base e soma o trajeto só quando a pessoa escolhe', () => {
    expect(stopCost(costa(), 'equilibrado', [], 20000, 10000)).toMatchObject({ stay: 105000, commute: 0 });
    expect(stopCost(costa({ stay_at_alt: true }), 'equilibrado', [], 20000, 10000)).toMatchObject({ stay: 45000, commute: 9000, total: 45000 + 9000 + 30000 });
  });

  it('routeToRows grava stay_base e as estimativas de diária vêm da base', () => {
    const r = route([{ ...costa(), name: 'Roma', stay_alt: null }, costa({ stay_at_alt: true })]);
    const rows = routeToRows(r, { start_date: '2027-05-02', end_date: '2027-05-08', origin: null }, (() => { let i = 0; return () => `id${i++}`; })());
    expect(rows.stops[0].stay_base).toBeNull();
    expect(rows.stops[1].stay_base?.name).toBe('Salerno');
    expect(stayEstimatesOf(r, ['id0', 'id1'])).toEqual({ id0: { equilibrado: { low: 30000, high: 40000 } }, id1: { equilibrado: { low: 12000, high: 18000 } } });
  });

  it('refazer a rota mantém a escolha quando a mesma base volta', () => {
    const next = keepStayChoices(route([costa(), { ...costa(), name: 'Roma', stay_alt: salerno({ name: 'Tivoli' }) }]), route([costa({ stay_at_alt: true })]));
    expect(next.stops.map((s) => !!s.stay_at_alt)).toEqual([true, false]);
  });
});

describe('Orçamento', () => {
  const demo = () => structuredClone(buildDemoBundle('andes')) as TripBundle;
  it('o trajeto diário entra no transporte e aparece entre os trechos', () => {
    const b = demo();
    const plan = { style: 'equilibrado' as const, pace: 'moderado' as const, transport_cents: {} };
    const before = budgetFromPlan(b, plan).lines.find((l) => l.kind === 'transporte')!.perPersonCents;
    const st = [...b.stops].sort((x, y) => x.position - y.position)[0];
    st.stay_base = salerno({ name: 'Base', commute_pp_day: 2500 });
    const nights = Math.round((Date.parse(st.departure_date) - Date.parse(st.arrival_date)) / 864e5);
    const after = budgetFromPlan(b, plan).lines.find((l) => l.kind === 'transporte')!.perPersonCents;
    expect(after - before).toBe(2500 * Math.max(1, nights));
    const leg = transportLegs(b, plan).find((l) => l.commute)!;
    expect(leg).toMatchObject({ id: commuteId(st.id), title: `Trajeto diário Base ↔ ${st.name}`, isEstimate: true });
    // Valor digitado no Orçamento substitui a estimativa
    expect(budgetFromPlan(b, { ...plan, transport_cents: { [commuteId(st.id)]: 100 } }).lines.find((l) => l.kind === 'transporte')!.perPersonCents - before).toBe(100);
  });
});
