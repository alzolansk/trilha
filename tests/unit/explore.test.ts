import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { sortedStops } from '@/lib/derive';
import {
  activityCapForStop, fitOf, hoursLabel, nightlyCap, perPersonCents, rangeLabel, splitBudget, staySearchLinks,
} from '@/lib/explore';
import type { TripBundle } from '@/data/types';

const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;
const cats = [
  { id: 't', name: 'Transporte' }, { id: 'h', name: 'Hospedagem' }, { id: 'c', name: 'Comida' }, { id: 'p', name: 'Passeios' }, { id: 'x', name: 'Lembrancinhas' },
];

describe('orçamento do planejamento', () => {
  it('divide o total sugerido e fecha a soma exata', () => {
    const m = splitBudget(130_000, cats);
    expect(m.get('t')).toBe(28_600);
    expect(m.get('c')).toBe(32_500);
    expect(m.get('p')).toBe(16_900);
    expect(m.get('h')).toBe(52_000);
    expect(m.has('x')).toBe(false);
    expect([...m.values()].reduce((a, v) => a + v, 0)).toBe(130_000);
  });

  it('casa categoria sem acento/maiúscula e redistribui quando falta alguma', () => {
    const m = splitBudget(100_00, [{ id: 'h', name: 'hospedagem' }, { id: 'p', name: 'PASSEIOS' }]);
    expect((m.get('h') ?? 0) + (m.get('p') ?? 0)).toBe(100_00);
    expect(m.get('h')! > m.get('p')!).toBe(true);
  });

  it('cabe / passa usa o topo da faixa', () => {
    expect(fitOf(0, 0, 10_000)).toBe('free');
    expect(fitOf(5_000, 9_000, 10_000)).toBe('fits');
    expect(fitOf(5_000, 12_000, 10_000)).toBe('over');
    expect(fitOf(5_000, 12_000, 0)).toBe('unknown');
  });

  it('rótulos de estimativa', () => {
    expect(rangeLabel(8_000, 12_000, 'BRL')).toBe('~R$ 80–120');
    expect(rangeLabel(0, 0, 'BRL')).toBe('grátis');
    expect(hoursLabel(4.5)).toBe('~4h30');
    expect(hoursLabel(3)).toBe('~3h');
    expect(hoursLabel(0.5)).toBe('~30 min');
  });

  it('demo: por pessoa, teto da diária e teto de passeios por parada', () => {
    const b = andes();
    b.trip.budget_total = '9000.00';
    expect(perPersonCents(b)).toBe(Math.round(900_000 / b.members.length));
    const m = splitBudget(900_000, b.budgetCategories);
    b.budgetCategories = b.budgetCategories.map((c) => ({ ...c, planned: m.has(c.id) ? m.get(c.id)! / 100 : c.planned }));
    expect(nightlyCap(b)).toBeGreaterThan(0);
    const st = sortedStops(b)[0];
    const cap = activityCapForStop(b, st);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(Math.round((m.get(b.budgetCategories.find((c) => c.name === 'Passeios')!.id) ?? 0) / b.members.length));
  });

  it('links de busca levam cidade, datas e pessoas', () => {
    const [booking, airbnb] = staySearchLinks('Paraty, Brasil', '2026-11-20', '2026-11-23', 2);
    expect(booking.url).toContain('ss=Paraty%2C%20Brasil');
    expect(booking.url).toContain('checkin=2026-11-20');
    expect(booking.url).toContain('group_adults=2');
    expect(airbnb.url).toContain('checkout=2026-11-23');
  });
});
