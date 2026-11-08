// Trilha 2.0 (planning.md §7): colunas novas, vínculo gasto ↔ item, sugestões, preferências e backfills.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a'; // organizadora
const BIA = '00000000-0000-4000-8000-00000000000b'; // editora
const LEO = '00000000-0000-4000-8000-00000000000c'; // leitor (viewer)
const ZE = '00000000-0000-4000-8000-00000000000d'; // terceiro

const TRIP = '30000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000002';

let db: Db;
let lima: string;
let passeio: string;
let pousada: string;
let voo: string;
let alheia: string; // atividade de outra viagem
let hosp: string;

async function failure(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { message: string; code?: string };
  }
  throw new Error('era esperado erro');
}

const expense = (extra: Record<string, unknown> = {}) => ({
  trip_id: TRIP, description: 'Ingresso', payer_id: ANA, amount: '100.00', currency: 'BRL', rate_to_base: 1,
  rate_source: 'Mesma moeda', rate_date: '2027-01-16', base_amount: '100.00', spent_on: '2027-01-16', ...extra,
});
const shares = JSON.stringify([{ user_id: ANA, share_cents: 5000 }, { user_id: BIA, share_cents: 5000 }]);

beforeAll(async () => {
  // Para antes da migration do redesign, semeia dados antigos e só então aplica (testa os backfills).
  db = await createDb({ before: '20261108000008' });
  for (const [id, name] of [[ANA, 'Ana'], [BIA, 'Bia'], [LEO, 'Léo'], [ZE, 'Zé']] as const) await createUser(db, id, name);
  await db.as(ANA, `insert into public.trips (id, title, start_date, end_date, created_by, identity) values ($2, 'Peru', '2027-01-15', '2027-01-31', $1, $3::jsonb)`,
    [ANA, TRIP, JSON.stringify({ key: 'andes', palette: { acc: '#E86A33' }, slit: 'lens' })]);
  // Identidade gerada com acento claro demais (não passa 3:1 com branco): fica null = automático.
  await db.as(ZE, `insert into public.trips (id, title, start_date, end_date, created_by, identity) values ($2, 'Outra', '2027-02-01', '2027-02-05', $1, $3::jsonb)`,
    [ZE, OTHER, JSON.stringify({ key: 'gerada', palette: { acc: '#F5D76E' }, slit: 'lens' })]);
  for (const [name, pos] of [['Transporte', 0], ['Hospedagem', 1], ['Passeios e ingressos', 2], ['Alimentação', 3], ['Lembrancinhas', 4]] as const) {
    await db.as(ANA, `insert into public.budget_categories (trip_id, name, planned, position) values ($1, $2, 1000, $3)`, [TRIP, name, pos]);
  }
  await applyMigrations(db, '20261108000008');

  const [{ t: ed }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'editor', 24, 1) as t`, [TRIP]);
  const [{ t: vw }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 24, 1) as t`, [TRIP]);
  await db.as(BIA, `select public.accept_invite($1)`, [ed]);
  await db.as(LEO, `select public.accept_invite($1)`, [vw]);
  [{ id: lima }] = await db.as<{ id: string }>(ANA, `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'Lima', '2027-01-15', '2027-01-17') returning id`, [TRIP]);
  [{ id: passeio }] = await db.as<{ id: string }>(ANA, `insert into public.activities (trip_id, stop_id, day, title, cost_cents, cost_currency) values ($1, $2, '2027-01-16', 'Barranco', 4500, 'PEN') returning id`, [TRIP, lima]);
  [{ id: pousada }] = await db.as<{ id: string }>(ANA, `insert into public.stays (trip_id, stop_id, name, price_cents, price_currency, link_url) values ($1, $2, 'Hostel', 18000, 'BRL', 'https://www.booking.com/x') returning id`, [TRIP, lima]);
  [{ id: voo }] = await db.as<{ id: string }>(ANA, `insert into public.transports (trip_id, stop_id, mode, price_cents, price_currency) values ($1, $2, 'plane', 120000, 'BRL') returning id`, [TRIP, lima]);
  const [{ id: zeStop }] = await db.as<{ id: string }>(ZE, `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'X', '2027-02-01', '2027-02-02') returning id`, [OTHER]);
  [{ id: alheia }] = await db.as<{ id: string }>(ZE, `insert into public.activities (trip_id, stop_id, day, title) values ($1, $2, '2027-02-01', 'Alheia') returning id`, [OTHER, zeStop]);
  [{ id: hosp }] = await db.as<{ id: string }>(ANA, `select id from public.budget_categories where trip_id = $1 and name = 'Hospedagem'`, [TRIP]);
});

describe('backfills', () => {
  it('accent: destino do dicionário vira a cor curada; acento claro demais fica automático (null)', async () => {
    const rows = await db.as<{ id: string; accent: string | null }>(ANA, `select id, accent from public.trips`);
    expect(rows).toEqual([{ id: TRIP, accent: '#C8452C' }]);
    const [other] = await db.as<{ accent: string | null }>(ZE, `select accent from public.trips where id = $1`, [OTHER]);
    expect(other.accent).toBeNull();
  });

  it('accent recusa hex inválido', async () => {
    const e = await failure(db.as(ANA, `update public.trips set accent = 'vermelho' where id = $1`, [TRIP]));
    expect(e.message).toMatch(/check constraint/);
    expect(await db.as(BIA, `update public.trips set accent = '#17614F' where id = $1 returning accent`, [TRIP])).toEqual([{ accent: '#17614F' }]);
  });

  it('budget_categories.kind é preenchido pelo nome', async () => {
    const rows = await db.as<{ name: string; kind: string }>(ANA, `select name, kind from public.budget_categories order by position`);
    expect(rows.map((r) => r.kind)).toEqual(['transporte', 'hospedagem', 'passeios', 'comida', 'outro']);
  });

  it('categoria nova sem kind ganha o tipo pelo nome (app antigo continua funcionando)', async () => {
    const [row] = await db.as<{ kind: string }>(ANA, `insert into public.budget_categories (trip_id, name, position) values ($1, 'Comida de rua', 9) returning kind`, [TRIP]);
    expect(row.kind).toBe('comida');
    await db.as(ANA, `delete from public.budget_categories where trip_id = $1 and position = 9`, [TRIP]);
  });
});

describe('colunas novas', () => {
  it('preço exige moeda; foto exige url https ou path', async () => {
    await failure(db.as(ANA, `update public.stays set price_currency = null where id = $1`, [pousada]));
    await failure(db.as(ANA, `update public.activities set photo = '{"url":"http://x"}' where id = $1`, [passeio]));
    await failure(db.as(ANA, `update public.stays set link_url = 'javascript:alert(1)' where id = $1`, [pousada]));
    const [s] = await db.as<{ photo: { author: string } }>(ANA, `update public.stops set area = 'Miraflores', photo = $2::jsonb where id = $1 returning photo`,
      [lima, JSON.stringify({ url: 'https://upload.wikimedia.org/a.jpg', author: 'Fulano', license: 'CC BY-SA 4.0', source_url: 'https://commons.wikimedia.org/wiki/File:a.jpg' })]);
    expect(s.photo.author).toBe('Fulano');
    const [a] = await db.as<{ price_is_estimate: boolean }>(LEO, `select price_is_estimate from public.transports where id = $1`, [voo]);
    expect(a.price_is_estimate).toBe(true);
  });

  it('assignee da mala precisa ser da viagem', async () => {
    const [{ id: cat }] = await db.as<{ id: string }>(ANA, `insert into public.packing_categories (trip_id, name) values ($1, 'Roupas') returning id`, [TRIP]);
    const e = await failure(db.as(ANA, `insert into public.packing_items (trip_id, category_id, label, assignee_id) values ($1, $2, 'Gorro', $3)`, [TRIP, cat, ZE]));
    expect(e.message).toMatch(/não participa/);
    expect(await db.as(BIA, `insert into public.packing_items (trip_id, category_id, label, assignee_id) values ($1, $2, 'Gorro', $3) returning label`, [TRIP, cat, LEO])).toHaveLength(1);
  });

  it('cota no caixa: só o organizador define', async () => {
    expect(await db.as(BIA, `update public.trip_members set pool_target_cents = 1 where trip_id = $1 returning user_id`, [TRIP])).toHaveLength(0);
    expect(await db.as(ANA, `update public.trip_members set pool_target_cents = 500000 where trip_id = $1 and user_id = $2 returning pool_target_cents`, [TRIP, BIA]))
      .toEqual([{ pool_target_cents: 500000 }]);
  });
});

describe('save_expense com vínculo', () => {
  it('grava o vínculo com a atividade e a categoria', async () => {
    const [{ id }] = await db.as<{ id: string }>(BIA, `select public.save_expense($1::jsonb, $2::jsonb) as id`, [JSON.stringify(expense({ activity_id: passeio, paid_from_pool: true })), shares]);
    const [row] = await db.as<{ activity_id: string; stay_id: string | null }>(LEO, `select activity_id, stay_id from public.expenses where id = $1`, [id]);
    expect(row).toEqual({ activity_id: passeio, stay_id: null });
  });

  it('edita trocando o vínculo para a hospedagem', async () => {
    const [{ id }] = await db.as<{ id: string }>(ANA, `select public.save_expense($1::jsonb, $2::jsonb) as id`, [JSON.stringify(expense({ transport_id: voo })), shares]);
    await db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(expense({ id, version: 1, stay_id: pousada, category_id: hosp })), shares]);
    const [row] = await db.as<{ stay_id: string; transport_id: string | null }>(ANA, `select stay_id, transport_id from public.expenses where id = $1`, [id]);
    expect(row).toEqual({ stay_id: pousada, transport_id: null });
  });

  it('recusa item de outra viagem e mais de um vínculo', async () => {
    const e1 = await failure(db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(expense({ activity_id: alheia })), shares]));
    expect(e1.message).toMatch(/não é desta viagem/);
    const e2 = await failure(db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(expense({ activity_id: passeio, stay_id: pousada })), shares]));
    expect(e2.message).toMatch(/no máximo um item/);
    // nem por insert direto (FK composta)
    await failure(db.as(ANA, `insert into public.expenses (trip_id, description, payer_id, amount, currency, rate_to_base, rate_source, rate_date, base_amount, spent_on, activity_id)
      values ($1, 'x', $2, 1, 'BRL', 1, 'x', '2027-01-16', 1, '2027-01-16', $3)`, [TRIP, ANA, alheia]));
  });

  it('apagar a atividade solta o vínculo, sem apagar o gasto', async () => {
    const [{ id: act }] = await db.as<{ id: string }>(ANA, `insert into public.activities (trip_id, stop_id, day, title) values ($1, $2, '2027-01-16', 'Temporária') returning id`, [TRIP, lima]);
    const [{ id }] = await db.as<{ id: string }>(ANA, `select public.save_expense($1::jsonb, $2::jsonb) as id`, [JSON.stringify(expense({ activity_id: act })), shares]);
    await db.as(ANA, `delete from public.activities where id = $1`, [act]);
    const [row] = await db.as<{ activity_id: string | null }>(ANA, `select activity_id from public.expenses where id = $1`, [id]);
    expect(row.activity_id).toBeNull();
  });
});

describe('sugestões', () => {
  let sid: string;
  it('editor cria; todos da viagem leem; terceiro não vê', async () => {
    [{ id: sid }] = await db.as<{ id: string }>(BIA, `insert into public.suggestions (trip_id, stop_id, kind, day, payload) values ($1, $2, 'activity', 2, $3::jsonb) returning id`,
      [TRIP, lima, JSON.stringify({ title: 'Circuito Mágico del Agua', why: 'Fontes iluminadas à noite', cost_low: 1000, cost_high: 1500, currency: 'PEN' })]);
    expect(await db.as(LEO, `select id from public.suggestions`)).toHaveLength(1);
    expect(await db.as(ZE, `select id from public.suggestions`)).toHaveLength(0);
  });

  it('payload precisa de título', async () => {
    await failure(db.as(ANA, `insert into public.suggestions (trip_id, kind, payload) values ($1, 'reminder', '{}')`, [TRIP]));
  });

  it('leitor não muda o status (nem para dispensar); editor muda e fica registrado quem agiu', async () => {
    expect(await db.as(LEO, `update public.suggestions set status = 'dismissed' where id = $1 returning id`, [sid])).toHaveLength(0);
    const [row] = await db.as<{ status: string; acted_by: string; version: number }>(BIA, `update public.suggestions set status = 'accepted', acted_by = $2 where id = $1 returning status, acted_by, version`, [sid, ANA]);
    expect(row).toEqual({ status: 'accepted', acted_by: BIA, version: 2 });
  });

  it('status fora da lista é recusado', async () => {
    await failure(db.as(ANA, `update public.suggestions set status = 'reservado' where id = $1`, [sid]));
  });
});

describe('preferências', () => {
  it('cada um grava a própria; todos da viagem leem', async () => {
    await db.as(LEO, `insert into public.trip_preferences (trip_id, answers) values ($1, '{"vibe":["natureza"]}')`, [TRIP]);
    await db.as(BIA, `insert into public.trip_preferences (trip_id, answers) values ($1, '{"vibe":["cidade"]}')`, [TRIP]);
    expect(await db.as(ANA, `select user_id from public.trip_preferences`)).toHaveLength(2);
    expect(await db.as(ZE, `select user_id from public.trip_preferences`)).toHaveLength(0);
  });

  it('ninguém grava nem edita a resposta de outra pessoa', async () => {
    const e = await failure(db.as(ANA, `insert into public.trip_preferences (trip_id, user_id, answers) values ($1, $2, '{}')`, [TRIP, LEO]));
    expect(e.message).toMatch(/row-level security/);
    expect(await db.as(ANA, `update public.trip_preferences set answers = '{}' where user_id = $1 returning user_id`, [LEO])).toHaveLength(0);
    await failure(db.as(ZE, `insert into public.trip_preferences (trip_id, answers) values ($1, '{}')`, [TRIP]));
  });

  it('quem sai da viagem leva as respostas junto', async () => {
    await db.as(LEO, `delete from public.trip_members where trip_id = $1 and user_id = $2`, [TRIP, LEO]);
    const rows = await db.as<{ user_id: string }>(ANA, `select user_id from public.trip_preferences`);
    expect(rows).toEqual([{ user_id: BIA }]);
  });
});
