import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { budgetFromPlan, foodLevels, initialPlan, stayOptions, tourOptions, transportLegs } from '@/lib/budgetPlan';
import { categoryContext, categoryStatus, customSplit, filterMovements, ledger, movementsCsv, paymentPreset, recentHit, unpaidItems } from '@/lib/money';
import type { TripBundle } from '@/data/types';
import { taskDueForPush } from '@/lib/taskReminders';
const demo = () => structuredClone(buildDemoBundle('andes')) as TripBundle;
describe('Fase 6 · orçamento', () => {
  it('mantém hospedagens com preço e só varia as noites sem preço', () => {
    const b = demo();
    b.stays[0].status = 'pending'; b.stays[0].price_is_estimate = true;
    const before = stayOptions(b);
    expect(before.options[0].perPersonCents).toBeLessThan(before.options[1].perPersonCents);
    expect(before.options[1].perPersonCents).toBeLessThan(before.options[2].perPersonCents);
    // A demo tem uma noite sem cidade (ônibus noturno); ela entra pela referência do estilo. Aqui ela é coberta.
    b.stops[2].departure_date = b.stops[3].arrival_date;
    b.stays = b.stops.map((st, i) => ({ ...b.stays[0], id: `stay-${i}`, stop_id: st.id, price_cents: 30000, price_is_estimate: false, price_currency: 'BRL', checkin_date: st.arrival_date, checkout_date: st.departure_date }));
    expect(new Set(stayOptions(b).options.map((o) => o.perPersonCents)).size).toBe(1);
  });
  it('seleção explícita soma só passeios escolhidos, incluindo sugestões', () => {
    const b = demo(), p = initialPlan(b);
    const tour = tourOptions(b).find((t) => t.type === 'suggestion' && t.perPersonCents != null)!;
    p.activities = [tour.id];
    const r = budgetFromPlan(b, p);
    expect(r.lines.find((l) => l.kind === 'passeios')?.perPersonCents).toBe(tour.perPersonCents);
    p.activities = [];
    expect(budgetFromPlan(b, p).lines.find((l) => l.kind === 'passeios')?.perPersonCents).toBe(0);
  });
  it('trecho sem preço aceita estimativa sem transformar em confirmado', () => {
    const b = demo(); b.transports[0].price_cents = null;
    const p = initialPlan(b); p.transport_cents = { [b.transports[0].id]: 12345 };
    const leg = transportLegs(b, p).find((l) => l.id === b.transports[0].id)!;
    expect(leg).toMatchObject({ perPersonCents: 12345, from: 'trilha', isEstimate: true });
    expect(budgetFromPlan(b, p).lines[0].estimatedCents).toBeGreaterThanOrEqual(12345);
  });
  it('reabre plano, remove ids obsoletos e preserva seleção vazia', () => {
    const b = demo(); b.trip.budget_plan = { style: 'conforto', pace: 'leve', activities: ['sumiu'], food: 'solto', daily_food_cents: 12300 };
    expect(initialPlan(b)).toMatchObject({ style: 'conforto', food: 'solto', daily_food_cents: 12300, activities: [] });
  });
  it('comida usa extremos e média da faixa; zero explícito não vira referência', () => {
    expect(foodLevels({ low: 10000, high: 4000 })).toEqual({ econ: 4000, medio: 7000, solto: 10000 });
    expect(foodLevels().econ).toBeLessThan(foodLevels().solto);
    expect(budgetFromPlan(demo(), { style: 'conforto', pace: 'leve', daily_food_cents: 0 }).lines[3].perPersonCents).toBe(0);
  });
  it('mediana de hospedagem no plano substitui só a estadia pendente estimada', () => {
    const b = demo(); const stay = b.stays[0]; stay.status = 'pending'; stay.price_is_estimate = true;
    const p = initialPlan(b); p.stay_estimates = { [stay.stop_id]: { equilibrado: { low: 1000, high: 3000 } } };
    const estimated = budgetFromPlan(b, p).lines[1].perPersonCents;
    stay.status = 'booked';
    expect(budgetFromPlan(b, p).lines[1].perPersonCents).not.toBe(estimated);
    expect(stayOptions(b, {}, p).fixed).toBeGreaterThan(0);
  });
});
describe('Fase 6 · extrato e gasto ligado', () => {
  it('cron inclui aporte de ontem, mas não repete indefinidamente nem envia a outra pessoa', () => {
    const t = { due_date: '2026-11-08', assignee_id: 'ana', dismissed: false, alert_key: 'pool:ana' };
    expect(taskDueForPush(t, 'ana', '2026-11-09')).toBe(true);
    expect(taskDueForPush(t, 'ana', '2026-11-10')).toBe(false);
    expect(taskDueForPush(t, 'bia', '2026-11-08')).toBe(false);
    expect(taskDueForPush({ ...t, dismissed: true }, 'ana', '2026-11-08')).toBe(false);
    expect(taskDueForPush({ ...t, alert_key: null }, 'ana', '2026-11-09')).toBe(false);
  });
  it('junta tipos, ordena e filtra pessoas que dividem o gasto', () => {
    const b = demo(), list = ledger(b);
    expect(list).toHaveLength(b.expenses.length + b.poolContributions.length + b.settlements.length);
    expect(list.map((m) => m.date)).toEqual(list.map((m) => m.date).sort().reverse());
    expect(filterMovements(list, { type: 'pool' }).every((m) => m.kind === 'deposit' || m.kind === 'refund')).toBe(true);
    const exp = list.find((m) => m.kind === 'expense' && m.people?.length)!;
    expect(filterMovements(list, { person: exp.people![0], type: 'expenses' })).toContainEqual(exp);
    expect(filterMovements(list, { q: 'INEXISTENTE' })).toEqual([]);
    expect(filterMovements(list, { categoryId: exp.categoryId, stopId: exp.stopId })).toContainEqual(exp);
  });
  it('CSV protege fórmula, aspas e quebra de linha e mantém moeda original', () => {
    const csv = movementsCsv([{ id: '1', kind: 'expense', date: '2026-11-08', at: '', title: '=CMD;"teste"\nlinha', who: 'caixa', cents: 12345, original: { cents: 9000, currency: 'PEN' } }], { base: 'BRL', nameOf: () => 'Ana', categoryOf: () => 'Passeios', stopOf: () => 'Cusco' });
    expect(csv).toContain('"\'=CMD;""teste""\nlinha"');
    expect(csv).toContain('90,00;PEN;123,45');
  });
  it('preset traz valor da turma, categoria e parada, excluindo itens pagos da busca', () => {
    const b = demo(), item = unpaidItems(b).find((i) => i.type === 'activity')!;
    expect(paymentPreset(b, item.type, item.id)).toMatchObject({ description: item.title, categoryId: item.categoryId, stopId: item.stopId, cents: item.costCents });
    b.expenses[0].activity_id = item.id; b.expenses[0].transport_id = null;
    expect(unpaidItems(b).some((i) => i.id === item.id)).toBe(false);
  });
  it('contexto usa dados reais da demo e destaque expira depois de 24h', () => {
    const b = demo();
    expect(categoryContext(b, categoryStatus(b).find((c) => c.kind === 'comida')!)).toContain('R$ 90');
    b.expenses[0].created_at = '2026-11-08T12:00:00Z';
    const now = Date.parse('2026-11-08T13:00:00Z');
    expect(recentHit(b, now)?.description).toBe(b.expenses[0].description);
    expect(recentHit({ expenses: [b.expenses[0]] }, now + 86400000)).toBeNull();
  });
  it('valores diferentes precisam fechar o total em centavos', () => {
    expect(customSplit(10001, { a: 5000, b: 5001, c: null }).diff).toBe(0);
    expect(customSplit(10000, { a: 4999, b: 5000 }).diff).toBe(1);
  });
});
