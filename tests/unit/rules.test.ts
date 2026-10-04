import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { departureLabel, legToNext, sortedStops, stayStatusLabel, straightKm, transportMinutes, tripPhase, tripTarget } from '@/lib/derive';
import { ruleAlerts, rulePacking, ruleRetro, ruleTip } from '@/lib/rules';
import type { DocumentRow, TripBundle } from '@/data/types';

const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;

describe('dados derivados', () => {
  it('demo Andes: 6 paradas ordenadas, trecho e rótulo de embarque', () => {
    const b = andes();
    const st = sortedStops(b);
    expect(st.map((s) => s.name)).toEqual(['Lima', 'Cusco', 'Machu Picchu', 'Puno', 'La Paz', 'Uyuni']);
    expect(legToNext(b, st, 0)).toBe('Avião · 1h25');
    expect(departureLabel(b)).toBe('15 JAN 2027 · 06:40 · GRU → LIM');
    expect(tripTarget(b.trip)).toBe(Date.parse('2027-01-15T06:40:00-03:00'));
    expect(straightKm(st).complete).toBe(true);
  });
  it('fases da viagem', () => {
    const b = andes();
    expect(tripPhase(b.trip, Date.parse('2026-10-04T12:00:00Z')).kind).toBe('before');
    expect(tripPhase(b.trip, Date.parse('2027-01-15T15:00:00Z')).kind).toBe('today');
    expect(tripPhase(b.trip, Date.parse('2027-01-20T15:00:00Z'))).toEqual({ kind: 'during', day: 6, total: 17 });
    expect(tripPhase(b.trip, Date.parse('2027-02-10T15:00:00Z'))).toEqual({ kind: 'after', daysAgo: 10 });
  });
  it('duração só é calculada com horários e fusos das duas pontas', () => {
    const b = andes();
    const t = { ...b.transports[1], duration_min: null, depart_date: '2027-01-17', depart_time: '08:10', depart_tz: 'America/Lima', arrive_date: '2027-01-17', arrive_time: '09:35', arrive_tz: 'America/Lima' };
    expect(transportMinutes(t)).toBe(85);
    expect(transportMinutes({ ...t, arrive_tz: null })).toBeNull();
    // fusos diferentes: GRU 06:40 (-03) → LIM 10:05 (-05) = 5h25
    expect(transportMinutes({ ...t, depart_time: '06:40', depart_tz: 'America/Sao_Paulo', arrive_time: '10:05' })).toBe(325);
  });
  it('estado da hospedagem depende de reserva e comprovante', () => {
    const b = andes();
    const pending = b.stays.find((s) => s.status === 'pending')!;
    expect(stayStatusLabel(b, pending).label).toBe('Sem reserva');
    const booked = b.stays[0];
    expect(['Reserva anexada', 'Reservado · falta anexar']).toContain(stayStatusLabel(b, booked).label);
  });
});

describe('regras de alerta (dados reais, nada inventado)', () => {
  it('seguro que termina antes da volta', () => {
    const b = andes();
    const ins = b.documents.find((d) => d.category === 'seguro') as DocumentRow;
    ins.valid_until = '2027-01-30';
    const a = ruleAlerts(b, Date.parse('2026-10-04T12:00:00Z'));
    const gap = a.find((x) => x.key === 'insurance-gap');
    expect(gap?.title).toBe('Seguro cobre até 30 jan, sua volta é 31 jan');
    ins.valid_until = '2027-02-01';
    expect(ruleAlerts(b).some((x) => x.key === 'insurance-gap')).toBe(false);
  });
  it('sem data de validade informada, não alerta sobre seguro', () => {
    const b = andes();
    expect(ruleAlerts(b).some((x) => x.key === 'insurance-gap')).toBe(false);
  });
  it('hospedagem pendente e orçamento estourado por categoria', () => {
    const a = ruleAlerts(andes());
    expect(a.some((x) => x.key.startsWith('stay-missing-') && /Aguas Calientes/.test(x.title))).toBe(true);
    expect(a.find((x) => x.key.startsWith('budget-cat-'))?.title).toBe('Hospedagem passou 12% do previsto');
  });
  it('dica por regra usa a altitude salva, sem inventar', () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    expect(ruleTip(b, cusco)?.text).toMatch(/3\.400 m/);
    expect(ruleTip(b, { ...cusco, altitude_m: null, tz: null })).toBeNull();
  });
  it('sugestões de mala trazem motivo e não repetem itens existentes', () => {
    const b = andes();
    const s = rulePacking(b);
    expect(s.every((x) => x.reason.length > 10)).toBe(true);
    expect(s.some((x) => x.label === 'Segunda pele')).toBe(false); // já existe na mala do exemplo
  });
  it('retrospectiva por regras usa só números e trajeto reais', () => {
    const r = ruleRetro(andes());
    expect(r.title).toBe('Peru + Bolívia: 17 dias, 6 paradas');
    expect(r.chapters).toHaveLength(6);
  });
});
