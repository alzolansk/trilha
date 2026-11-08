// Fase 10 (planning §10.11): party_size, trecho de volta e apply_onboarding_route.
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a';
const LEO = '00000000-0000-4000-8000-00000000000c'; // leitor
const TRIP = '40000000-0000-4000-8000-000000000001';

let db: Db;

async function failure(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { message: string; code?: string };
  }
  throw new Error('era esperado erro');
}

const route = (extra: Record<string, unknown> = {}) => JSON.stringify({
  stops: [
    { name: 'Roma', country: 'Itália', lat: 41.9, lng: 12.5, arrival_date: '2027-05-02', departure_date: '2027-05-06', arrival_mode: 'plane' },
    { name: 'Florença', country: 'Itália', lat: 43.77, lng: 11.25, arrival_date: '2027-05-06', departure_date: '2027-05-16', arrival_mode: 'train' },
  ],
  legs: [
    { stop_index: 0, mode: 'plane', origin_name: 'São Paulo', dest_name: 'Roma', depart_date: '2027-05-02', duration_min: 720, price_cents: 580000 },
    { stop_index: 1, mode: 'train', origin_name: 'Roma', dest_name: 'Florença', depart_date: '2027-05-06', duration_min: 90, price_cents: 18000 },
    { stop_index: 1, mode: 'plane', origin_name: 'Florença', dest_name: 'São Paulo', depart_date: '2027-05-16', price_cents: 300000, is_return: true },
  ],
  suggestions: [{ stop_index: 1, day: 7, status: 'accepted', payload: { title: 'Bate-volta: Siena', cost_low: 8000, cost_high: 12000, currency: 'BRL' } }],
  budget_plan: { style: 'equilibrado', pace: 'moderado' },
  onboarding: { status: 'em_andamento', step: 5 },
  ...extra,
});

const version = async () => (await db.as<{ version: number }>(ANA, `select version from public.trips where id = $1`, [TRIP]))[0].version;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ANA, 'Ana');
  await createUser(db, LEO, 'Léo');
  await db.as(ANA, `insert into public.trips (id, title, destinations, start_date, end_date, created_by, party_size, origin) values ($2, 'Itália', '{Itália}', '2027-05-02', '2027-05-16', $1, 2, 'São Paulo')`, [ANA, TRIP]);
  const [{ t }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 24, 1) as t`, [TRIP]);
  await db.as(LEO, `select public.accept_invite($1)`, [t]);
});

describe('trips.party_size e onboarding', () => {
  it('aceita de 1 a 50 pessoas', async () => {
    await db.as(ANA, `update public.trips set party_size = 50 where id = $1`, [TRIP]);
    const e = await failure(db.as(ANA, `update public.trips set party_size = 51 where id = $1`, [TRIP]));
    expect(e.message).toMatch(/check/);
    await db.as(ANA, `update public.trips set party_size = 2, onboarding = '{"status":"em_andamento","step":2}' where id = $1`, [TRIP]);
  });

  it('onboarding precisa ser objeto', async () => {
    const e = await failure(db.as(ANA, `update public.trips set onboarding = '[1]' where id = $1`, [TRIP]));
    expect(e.message).toMatch(/check/);
  });
});

describe('apply_onboarding_route', () => {
  it('leitor não aplica', async () => {
    const e = await failure(db.as(LEO, `select public.apply_onboarding_route($1, $2, $3::jsonb)`, [TRIP, await version(), route()]));
    expect(e.code).toBe('42501');
  });

  it('confere a versão da trilha', async () => {
    const e = await failure(db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb)`, [TRIP, (await version()) - 1, route()]));
    expect(e.message).toMatch(/mudou/);
  });

  it('cria paradas, trechos (com volta), sugestões e grava plano e onboarding', async () => {
    await db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb)`, [TRIP, await version(), route()]);
    const stops = await db.as<{ name: string; position: number }>(ANA, `select name, position from public.stops where trip_id = $1 order by position`, [TRIP]);
    expect(stops.map((s) => s.name)).toEqual(['Roma', 'Florença']);
    const legs = await db.as<{ is_return: boolean; price_currency: string; price_is_estimate: boolean }>(ANA, `select is_return, price_currency, price_is_estimate from public.transports where trip_id = $1`, [TRIP]);
    expect(legs).toHaveLength(3);
    expect(legs.filter((l) => l.is_return)).toHaveLength(1);
    expect(legs.every((l) => l.price_currency === 'BRL' && l.price_is_estimate)).toBe(true);
    const sug = await db.as<{ status: string }>(ANA, `select status from public.suggestions where trip_id = $1`, [TRIP]);
    expect(sug).toEqual([{ status: 'accepted' }]);
    const [trip] = await db.as<{ budget_plan: { style: string }; onboarding: { step: number } }>(ANA, `select budget_plan, onboarding from public.trips where id = $1`, [TRIP]);
    expect(trip.budget_plan.style).toBe('equilibrado');
    expect(trip.onboarding.step).toBe(5);
  });

  it('recusa quando já há roteiro, a não ser que peça para substituir', async () => {
    const e = await failure(db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb)`, [TRIP, await version(), route()]));
    expect(e.message).toMatch(/Já existe um roteiro/);
    await db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb, true)`, [TRIP, await version(), route()]);
    const [{ n }] = await db.as<{ n: number }>(ANA, `select count(*)::int as n from public.stops where trip_id = $1`, [TRIP]);
    expect(n).toBe(2);
  });

  it('só um trecho de volta por trilha', async () => {
    const [{ id }] = await db.as<{ id: string }>(ANA, `select id from public.stops where trip_id = $1 order by position limit 1`, [TRIP]);
    const e = await failure(db.as(ANA, `insert into public.transports (trip_id, stop_id, mode, is_return) values ($1, $2, 'plane', true)`, [TRIP, id]));
    expect(e.message).toMatch(/duplicate|unique/);
  });

  it('não substitui roteiro com gasto ligado e desfaz tudo em caso de erro', async () => {
    const [{ id: leg }] = await db.as<{ id: string }>(ANA, `select id from public.transports where trip_id = $1 and is_return`, [TRIP]);
    await db.as(ANA, `insert into public.expenses (trip_id, description, payer_id, amount, currency, rate_to_base, rate_source, rate_date, base_amount, spent_on, transport_id)
      values ($1, 'Voo', $2, '100.00', 'BRL', 1, 'Mesma moeda', '2027-05-01', '100.00', '2027-05-01', $3)`, [TRIP, ANA, leg]);
    const e = await failure(db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb, true)`, [TRIP, await version(), route()]));
    expect(e.message).toMatch(/gastos ligados/);
    const [{ n }] = await db.as<{ n: number }>(ANA, `select count(*)::int as n from public.transports where trip_id = $1`, [TRIP]);
    expect(n).toBe(3);
  });

  it('roteiro inválido não grava nada', async () => {
    const e = await failure(db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb, true)`, [TRIP, await version(), JSON.stringify({ stops: [] })]));
    expect(e.code).toBe('22023');
  });
});
