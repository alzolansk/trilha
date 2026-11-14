// Matriz de documentos da Turma: trip_document_presence (migration 00013).
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a';
const BIA = '00000000-0000-4000-8000-00000000000b';
const ZE = '00000000-0000-4000-8000-00000000000d'; // fora da trilha
const TRIP = '50000000-0000-4000-8000-000000000001';

let db: Db;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ANA, 'Ana');
  await createUser(db, BIA, 'Bia');
  await createUser(db, ZE, 'Zé');
  await db.as(ANA, `insert into public.trips (id, title, destinations, start_date, end_date, created_by) values ($2, 'Peru', '{Peru}', '2027-01-10', '2027-01-20', $1)`, [ANA, TRIP]);
  const [{ t }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'editor', 24, 1) as t`, [TRIP]);
  await db.as(BIA, `select public.accept_invite($1)`, [t]);
  // Passaporte privado da Ana (pronto) e passagem ainda enviando.
  const [p] = await db.as<{ id: string }>(ANA,
    `insert into public.documents (trip_id, title, category, storage_path, original_name, mime, size_bytes, encrypted)
     values ($1, 'Passaporte da Ana', 'identidade', $2::text || '/a/passaporte.jpg', 'passaporte.jpg', 'image/jpeg', 1000, true) returning id`, [TRIP, TRIP]);
  await db.as(ANA, `insert into storage.objects (bucket_id, name) values ('documents', $1::text || '/a/passaporte.jpg')`, [TRIP]);
  await db.as(ANA, `update public.documents set status = 'ready' where id = $1`, [p.id]);
  await db.as(ANA,
    `insert into public.documents (trip_id, title, category, storage_path, original_name, mime, size_bytes, encrypted)
     values ($1, 'Voo', 'passagem', $2::text || '/a/voo.pdf', 'voo.pdf', 'application/pdf', 1000, true)`, [TRIP, TRIP]);
});

describe('trip_document_presence', () => {
  it('outra pessoa da turma vê que existe, sem ver o documento', async () => {
    expect(await db.as(BIA, `select id from public.documents where trip_id = $1`, [TRIP])).toHaveLength(0);
    const rows = await db.as<{ owner_id: string; category: string }>(BIA, `select * from public.trip_document_presence($1)`, [TRIP]);
    expect(rows).toEqual([{ owner_id: ANA, category: 'identidade' }]);
  });

  it('só devolve dono e categoria (nada de título ou arquivo)', async () => {
    const cols = await db.as<{ column_name: string }>(BIA, `select * from public.trip_document_presence($1) limit 0`, [TRIP]);
    expect(cols).toEqual([]);
    const [r] = await db.as<Record<string, unknown>>(BIA, `select * from public.trip_document_presence($1)`, [TRIP]);
    expect(Object.keys(r).sort()).toEqual(['category', 'owner_id']);
  });

  it('quem não é da trilha não recebe nada', async () => {
    expect(await db.as(ZE, `select * from public.trip_document_presence($1)`, [TRIP])).toHaveLength(0);
  });
});
