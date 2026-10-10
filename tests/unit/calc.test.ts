import { describe, expect, it } from 'vitest';
import { suggestFromText } from '@/lib/classify';
import { balances, budgetByCategory, POOL, poolSummary, splitEqual, suggestTransfers, toCents } from '@/lib/money';
import { addMonthsClamped, countdown, daysBetween, humanUntil, wallToInstant } from '@/lib/time';
import type { Stop, Transport } from '@/data/types';

describe('countdown (meses de calendário + dias/horas/minutos)', () => {
  const tz = 'America/Sao_Paulo';
  it('referência do protótipo', () => {
    const target = Date.parse('2027-01-15T06:40:00-03:00');
    const now = Date.parse('2026-10-04T10:00:00-03:00');
    const c = countdown(now, target, tz);
    expect([c.months, c.days, c.hours, c.minutes]).toEqual([3, 10, 20, 40]);
    expect(c.totalDays).toBe(103);
  });
  it('virada de mês com dia 31 (31 jan + 1 mês = 28 fev)', () => {
    expect(addMonthsClamped({ y: 2027, mo: 1, d: 31, h: 0, mi: 0, s: 0 }, 1)).toMatchObject({ mo: 2, d: 28 });
    const now = Date.parse('2027-01-31T12:00:00-03:00');
    const c = countdown(now, Date.parse('2027-03-01T12:00:00-03:00'), tz);
    expect([c.months, c.days, c.hours]).toEqual([1, 1, 0]);
  });
  it('horário de verão (Lisboa) mantém o mês de calendário', () => {
    const tzL = 'Europe/Lisbon';
    const now = wallToInstant(tzL, { y: 2027, mo: 3, d: 1, h: 9, mi: 0, s: 0 });
    const target = wallToInstant(tzL, { y: 2027, mo: 4, d: 1, h: 9, mi: 0, s: 0 });
    const c = countdown(now, target, tzL);
    expect([c.months, c.days, c.hours, c.minutes]).toEqual([1, 0, 0, 0]);
  });
  it('estados: passou / mesmo instante', () => {
    expect(countdown(10, 5, tz).done).toBe(true);
    expect(humanUntil(Date.parse('2026-10-04T00:00:00Z'), Date.parse('2027-12-20T00:00:00Z'), tz)).toBe('1 ano e 2 meses');
    expect(daysBetween('2027-01-15', '2027-01-31')).toBe(16);
  });
});

describe('dinheiro e rateio', () => {
  it('rateio fecha em centavos', () => {
    const s = splitEqual(10000, ['a', 'b', 'c']);
    expect(s.map((x) => x.share_cents)).toEqual([3334, 3333, 3333]);
    expect(s.reduce((a, b) => a + b.share_cents, 0)).toBe(10000);
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('12.5')).toBe(1250);
  });
  it('saldos e acertos, com pagamento registrado', () => {
    const exp = [
      { payer_id: 'vc', base_amount: '300.00', shares: splitEqual(30000, ['vc', 'bi', 'le']) },
      { payer_id: 'bi', base_amount: '90.00', shares: splitEqual(9000, ['vc', 'bi', 'le']) },
    ];
    let net = balances(exp, [], ['vc', 'bi', 'le']);
    expect(net.get('vc')).toBe(30000 - 10000 - 3000);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    const tr = suggestTransfers(net);
    expect(tr).toEqual([{ from: 'le', to: 'vc', cents: 13000 }, { from: 'bi', to: 'vc', cents: 4000 }]);
    net = balances(exp, [{ from_user: 'le', to_user: 'vc', amount_cents: 13000 }], ['vc', 'bi', 'le']);
    expect(suggestTransfers(net)).toEqual([{ from: 'bi', to: 'vc', cents: 4000 }]);
  });
  it('caixa da turma: aportes, gastos pelo caixa e devolução da sobra', () => {
    const people = ['vc', 'bi', 'le'];
    const pool = [
      { user_id: 'vc', kind: 'deposit' as const, amount_cents: 50000 },
      { user_id: 'bi', kind: 'deposit' as const, amount_cents: 30000 },
    ];
    const exp = [
      { payer_id: 'vc', paid_from_pool: true, base_amount: '600.00', shares: splitEqual(60000, people) },
      { payer_id: 'le', base_amount: '30.00', shares: splitEqual(3000, people) },
    ];
    expect(poolSummary(exp, pool)).toMatchObject({ deposited: 80000, spent: 60000, refunded: 0, balance: 20000 });
    const net = balances(exp, [], people, pool);
    // vc: aportou 500, consumiu 200 + 10 · bi: 300 − 210 · le: pagou 30, consumiu 210 · caixa: sobra 200
    expect(Object.fromEntries(net)).toEqual({ vc: 29000, bi: 9000, le: -18000, [POOL]: -20000 });
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(suggestTransfers(net)).toEqual([
      { from: POOL, to: 'vc', cents: 20000 },
      { from: 'le', to: 'vc', cents: 9000 },
      { from: 'le', to: 'bi', cents: 9000 },
    ]);
    // devolução registrada zera o caixa
    const after = balances(exp, [], people, [...pool, { user_id: 'vc', kind: 'refund', amount_cents: 20000 }]);
    expect(after.get(POOL)).toBe(0);
    expect(after.get('vc')).toBe(9000);
  });
  it('caixa que gastou mais do que recebeu pede aporte', () => {
    const net = balances([{ payer_id: 'vc', paid_from_pool: true, base_amount: '100.00', shares: splitEqual(10000, ['vc', 'bi']) }], [], ['vc', 'bi'], [{ user_id: 'vc', kind: 'deposit', amount_cents: 6000 }]);
    // caixa recebeu 60 e pagou 100: falta 40, e a Bi (que consumiu 50 sem aportar) cobre
    expect(suggestTransfers(net)).toEqual([{ from: 'bi', to: POOL, cents: 4000 }, { from: 'bi', to: 'vc', cents: 1000 }]);
  });
  it('orçamento por categoria e desvio', () => {
    const r = budgetByCategory(
      [{ id: 'h', name: 'Hospedagem', color: '#000000', planned: '1590' }],
      [{ category_id: 'h', base_amount: '1780' }, { category_id: null, base_amount: '10' }],
    );
    expect(r[0]).toMatchObject({ spentCents: 178000, overPct: 12 });
    expect(r[1].name).toBe('Sem categoria');
  });
});

describe('classificação assistida', () => {
  const stops = [
    { id: 's1', name: 'Lima' },
    { id: 's2', name: 'Cusco' },
  ] as Stop[];
  const transports = [{ stop_id: 's2', dest_code: 'CUZ', booking_ref: 'ABC123' }] as Transport[];
  it('passagem com código e localizador', () => {
    const r = suggestFromText('LATAM Boarding Pass LIM - CUZ Seat 14C Localizador ABC123', 'voo.pdf', stops, transports);
    expect(r.category).toBe('passagem');
    expect(r.stopId).toBe('s2');
    expect(r.title).toBe('LIM → CUZ');
  });
  it('sem sinais: não inventa', () => {
    const r = suggestFromText('', 'IMG_2031.jpg', stops, transports);
    expect(r.category).toBeNull();
    expect(r.stopId).toBeNull();
    expect(r.title).toBeNull();
  });
  it('seguro', () => {
    expect(suggestFromText('Apólice de seguro viagem — vigência 15/01 a 30/01, cobertura médica', 'a.pdf', stops, transports).category).toBe('seguro');
  });
});
