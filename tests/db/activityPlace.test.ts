// Ajuste de 09/11/2026 (migration 0012): a atividade guarda onde acontece e o trajeto do passeio.
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a';
const TRIP = '40000000-0000-4000-8000-000000000012';
const STOP = '40000000-0000-4000-8000-000000000112';
const ACT = '40000000-0000-4000-8000-000000000212';
let db: Db;

async function failure(p: Promise<unknown>): Promise<{ message: string }> {
  try { await p; } catch (e) { return e as { message: string }; }
  throw new Error('era esperado erro');
}
const set = (place: unknown) => db.as(ANA, `update public.activities set place = $2::jsonb where id = $1`, [ACT, place == null ? null : JSON.stringify(place)]);

const bernina = {
  name: 'Bernina Express', lat: 46.41, lng: 10.02, by: 'ai',
  path: [{ name: 'Tirano', lat: 46.216, lng: 10.168 }, { name: 'Alp Grüm', lat: 46.374, lng: 10.03 }, { name: 'St. Moritz', lat: 46.498, lng: 9.838 }],
};

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ANA, 'Ana');
  await db.as(ANA, `insert into public.trips (id, title, destinations, start_date, end_date, created_by) values ($2, 'Itália', '{Itália}', '2027-05-02', '2027-05-08', $1)`, [ANA, TRIP]);
  await db.as(ANA, `insert into public.stops (id, trip_id, position, name, arrival_date, departure_date) values ($1, $2, 0, 'Milão', '2027-05-02', '2027-05-08')`, [STOP, TRIP]);
  await db.as(ANA, `insert into public.activities (id, trip_id, stop_id, day, title, position) values ($1, $2, $3, '2027-05-04', 'Bate-volta: Bernina Express', 0)`, [ACT, TRIP, STOP]);
});

describe('activities.place', () => {
  it('aceita ponto com trajeto, ponto sem trajeto, "não é lugar" e null', async () => {
    await set(bernina);
    const [row] = await db.as<{ place: typeof bernina }>(ANA, `select place from public.activities where id = $1`, [ACT]);
    expect(row.place.path).toHaveLength(3);
    await set({ name: 'Duomo', lat: 45.464, lng: 9.19, path: null, by: 'osm' });
    await set({ name: 'Bernina Express', lat: 46.41, lng: 10.02, by: 'route' });
    await set({ none: true, by: 'ai' });
    await set(null);
  });

  it('recusa coordenada fora da faixa, texto no lugar de número e trajeto inválido', async () => {
    for (const bad of [
      { name: 'X', lat: 120, lng: 9 },
      { name: 'X', lat: '45', lng: 9 },
      { name: 'X', lng: 9 },
      { ...bernina, path: [{ name: 'Tirano', lat: 46.2, lng: 10.1 }] },
      { ...bernina, path: [{ name: 'Tirano', lat: 46.2, lng: 10.1 }, { name: 'Erro', lat: 46.2 }] },
      { ...bernina, path: 'Tirano → St. Moritz' },
      'Bernina',
      { ...bernina, why: 'x'.repeat(5000) },
    ]) {
      expect((await failure(set(bad))).message).toMatch(/check/);
    }
  });
});
