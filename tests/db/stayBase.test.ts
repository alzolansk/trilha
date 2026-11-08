// Ajuste de 08/11/2026 (migration 0011): a parada guarda a cidade vizinha mais barata onde a turma dorme.
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a';
const TRIP = '40000000-0000-4000-8000-000000000011';
let db: Db;

const salerno = { name: 'Salerno', country: 'Itália', lat: 40.68, lng: 14.77, why: 'Base barata com barco para a costa.', mode: 'boat', minutes: 35, commute_pp_day: 3000, stay_pp_night: { equilibrado: { low: 15000, high: 22000 } } };
const route = (stayBase: unknown) => JSON.stringify({
  stops: [
    { name: 'Roma', country: 'Itália', lat: 41.9, lng: 12.5, arrival_date: '2027-05-02', departure_date: '2027-05-05', arrival_mode: 'plane' },
    { name: 'Costa Amalfitana', country: 'Itália', lat: 40.63, lng: 14.6, arrival_date: '2027-05-05', departure_date: '2027-05-08', arrival_mode: 'train', stay_base: stayBase },
  ],
  legs: [],
});
const version = async () => (await db.as<{ version: number }>(ANA, `select version from public.trips where id = $1`, [TRIP]))[0].version;

async function failure(p: Promise<unknown>): Promise<{ message: string }> {
  try { await p; } catch (e) { return e as { message: string }; }
  throw new Error('era esperado erro');
}

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ANA, 'Ana');
  await db.as(ANA, `insert into public.trips (id, title, destinations, start_date, end_date, created_by) values ($2, 'Itália', '{Itália}', '2027-05-02', '2027-05-08', $1)`, [ANA, TRIP]);
});

describe('stops.stay_base', () => {
  it('apply_onboarding_route grava a cidade onde a turma dorme', async () => {
    await db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb)`, [TRIP, await version(), route(salerno)]);
    const rows = await db.as<{ name: string; stay_base: typeof salerno | null }>(ANA, `select name, stay_base from public.stops where trip_id = $1 order by position`, [TRIP]);
    expect(rows[0].stay_base).toBeNull();
    expect(rows[1].stay_base).toMatchObject({ name: 'Salerno', minutes: 35, commute_pp_day: 3000 });
  });

  it('valor que não é objeto vira null (não quebra a rota)', async () => {
    await db.as(ANA, `select public.apply_onboarding_route($1, $2, $3::jsonb, true)`, [TRIP, await version(), route('Salerno')]);
    const [{ n }] = await db.as<{ n: number }>(ANA, `select count(*)::int as n from public.stops where trip_id = $1 and stay_base is not null`, [TRIP]);
    expect(n).toBe(0);
  });

  it('precisa de nome e cabe em 2 KB; null volta a dormir na cidade', async () => {
    const [{ id }] = await db.as<{ id: string }>(ANA, `select id from public.stops where trip_id = $1 order by position desc limit 1`, [TRIP]);
    const e = await failure(db.as(ANA, `update public.stops set stay_base = '{"minutes":30}' where id = $1`, [id]));
    expect(e.message).toMatch(/check/);
    const big = JSON.stringify({ ...salerno, why: 'x'.repeat(3000) });
    expect((await failure(db.as(ANA, `update public.stops set stay_base = $2::jsonb where id = $1`, [id, big]))).message).toMatch(/check/);
    await db.as(ANA, `update public.stops set stay_base = $2::jsonb where id = $1`, [id, JSON.stringify(salerno)]);
    await db.as(ANA, `update public.stops set stay_base = null where id = $1`, [id]);
  });
});
