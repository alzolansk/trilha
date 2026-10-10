import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a'; // organizadora
const BIA = '00000000-0000-4000-8000-00000000000b'; // editora (via convite)
const LEO = '00000000-0000-4000-8000-00000000000c'; // leitor (via convite)
const ZE = '00000000-0000-4000-8000-00000000000d'; // terceiro, nunca convidado

let db: Db;
let trip: string;
let stop: string;
let editorToken: string;
let viewerToken: string;

async function rejects(p: Promise<unknown>, pattern?: RegExp) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'era esperado erro').toBeTruthy();
  if (pattern) expect(String((err as Error).message)).toMatch(pattern);
}

beforeAll(async () => {
  db = await createDb();
  for (const [id, name] of [[ANA, 'Ana'], [BIA, 'Bia'], [LEO, 'Léo'], [ZE, 'Zé']] as const) {
    await createUser(db, id, name);
  }
  trip = '10000000-0000-4000-8000-000000000001';
  await db.as(
    ANA,
    `insert into public.trips (id, title, start_date, end_date, created_by)
     values ($2, 'Peru + Bolívia', '2027-01-15', '2027-01-31', $1)`,
    [ANA, trip],
  );
  const [s] = await db.as<{ id: string }>(
    ANA,
    `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'Lima', '2027-01-15', '2027-01-17') returning id`,
    [trip],
  );
  stop = s.id;
});

describe('viagens e convites', () => {
  it('criadora vira organizadora e perfis são criados', async () => {
    const rows = await db.as<{ role: string }>(ANA, `select role from public.trip_members where trip_id = $1`, [trip]);
    expect(rows).toEqual([{ role: 'organizer' }]);
    const p = await db.as<{ display_name: string }>(ANA, `select display_name from public.profiles where id = $1`, [ANA]);
    expect(p[0].display_name).toBe('Ana');
  });

  it('não é possível criar viagem em nome de outra pessoa', async () => {
    await rejects(
      db.as(BIA, `insert into public.trips (title, start_date, end_date, created_by) values ('x', '2027-01-01', '2027-01-02', $1)`, [ANA]),
      /row-level security/,
    );
  });

  it('terceiros não veem a viagem nem conhecer o id dá acesso', async () => {
    expect(await db.as(ZE, `select * from public.trips where id = $1`, [trip])).toHaveLength(0);
    expect(await db.as(ZE, `select * from public.stops where trip_id = $1`, [trip])).toHaveLength(0);
    expect(await db.as(null, `select * from public.trips`).catch(() => [])).toHaveLength(0);
    await rejects(db.as(ZE, `insert into public.trip_members (trip_id, user_id, role) values ($1, $2, 'organizer')`, [trip, ZE]));
  });

  it('só organizador cria convite; token não fica salvo em texto', async () => {
    await rejects(db.as(ZE, `select public.create_invite($1, 'editor', 24, 5)`, [trip]), /organizadores/);
    const [r1] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'editor', 24, 1) as t`, [trip]);
    const [r2] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 24, 5) as t`, [trip]);
    editorToken = r1.t;
    viewerToken = r2.t;
    expect(editorToken).toMatch(/^[0-9a-f]{64}$/);
    const stored = await db.query<{ token_hash: string }>(`select token_hash from public.trip_invites`);
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(editorToken);
    await rejects(db.as(ANA, `select public.create_invite($1, 'organizer', 24, 1)`, [trip]), /organizadores/);
  });

  it('aceitar convite dá o papel do convite; limite de usos é respeitado', async () => {
    const prev = await db.as<{ trip_title: string; valid: boolean }>(BIA, `select * from public.preview_invite($1)`, [editorToken]);
    expect(prev[0]).toMatchObject({ trip_title: 'Peru + Bolívia', valid: true });
    const [acc] = await db.as<{ id: string }>(BIA, `select public.accept_invite($1) as id`, [editorToken]);
    expect(acc.id).toBe(trip);
    await rejects(db.as(ZE, `select public.accept_invite($1)`, [editorToken]), /usos/);
    await db.as(LEO, `select public.accept_invite($1)`, [viewerToken]);
    const roles = await db.as<{ user_id: string; role: string }>(ANA, `select user_id, role from public.trip_members where trip_id = $1 order by role`, [trip]);
    expect(roles.find((r) => r.user_id === BIA)?.role).toBe('editor');
    expect(roles.find((r) => r.user_id === LEO)?.role).toBe('viewer');
  });

  it('convite revogado ou expirado não funciona; token inválido também não', async () => {
    const [r] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 24, 5) as t`, [trip]);
    await db.as(ANA, `update public.trip_invites set revoked_at = now() where trip_id = $1 and revoked_at is null and role = 'viewer' and uses = 0`, [trip]);
    await rejects(db.as(ZE, `select public.accept_invite($1)`, [r.t]), /revogado/);
    const [r2] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 1, 5) as t`, [trip]);
    await db.query(`update public.trip_invites set expires_at = now() - interval '1 minute' where uses = 0 and revoked_at is null`);
    await rejects(db.as(ZE, `select public.accept_invite($1)`, [r2.t]), /expirado/);
    await rejects(db.as(ZE, `select public.accept_invite($1)`, ['f'.repeat(64)]), /inválido/);
    expect(await db.as(ZE, `select * from public.trips where id = $1`, [trip])).toHaveLength(0);
  });

  it('editores não veem nem revogam convites', async () => {
    expect(await db.as(BIA, `select * from public.trip_invites`)).toHaveLength(0);
  });
});

describe('papéis', () => {
  it('editora altera roteiro; leitor só consulta', async () => {
    await db.as(BIA, `insert into public.stops (trip_id, name, arrival_date, departure_date, position) values ($1, 'Cusco', '2027-01-17', '2027-01-21', 1)`, [trip]);
    const seen = await db.as(LEO, `select name from public.stops where trip_id = $1 order by position`, [trip]);
    expect(seen).toEqual([{ name: 'Lima' }, { name: 'Cusco' }]);
    await rejects(db.as(LEO, `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'X', '2027-01-17', '2027-01-18')`, [trip]), /row-level security/);
    const upd = await db.as(LEO, `update public.stops set name = 'Hack' where id = $1 returning id`, [stop]);
    expect(upd).toHaveLength(0);
    const del = await db.as(LEO, `delete from public.stops where id = $1 returning id`, [stop]);
    expect(del).toHaveLength(0);
  });

  it('editora não exclui a viagem nem muda papéis', async () => {
    expect(await db.as(BIA, `delete from public.trips where id = $1 returning id`, [trip])).toHaveLength(0);
    expect(await db.as(BIA, `update public.trip_members set role = 'organizer' where user_id = $1 returning user_id`, [BIA])).toHaveLength(0);
  });

  it('a última organizadora não pode sair nem se rebaixar', async () => {
    await rejects(db.as(ANA, `delete from public.trip_members where trip_id = $1 and user_id = $2`, [trip, ANA]), /organizador/);
    await rejects(db.as(ANA, `update public.trip_members set role = 'editor' where trip_id = $1 and user_id = $2`, [trip, ANA]), /organizador/);
  });

  it('controle de versão detecta edição concorrente', async () => {
    const [{ version }] = await db.as<{ version: number }>(ANA, `select version from public.stops where id = $1`, [stop]);
    expect(await db.as(ANA, `update public.stops set notes = 'a' where id = $1 and version = $2 returning version`, [stop, version])).toEqual([{ version: version + 1 }]);
    expect(await db.as(BIA, `update public.stops set notes = 'b' where id = $1 and version = $2 returning version`, [stop, version])).toHaveLength(0);
  });

  it('integridade: parada de outra viagem não pode ser vinculada', async () => {
    const other = '10000000-0000-4000-8000-000000000002';
    await db.as(ZE, `insert into public.trips (id, title, start_date, end_date, created_by) values ($2, 'Outra', '2027-02-01', '2027-02-02', $1)`, [ZE, other]);
    expect(await db.as(ZE, `select id from public.trips`)).toEqual([{ id: other }]);
    await rejects(db.as(ZE, `insert into public.activities (trip_id, stop_id, day, title) values ($1, $2, '2027-02-01', 'x')`, [other, stop]));
  });
});

describe('documentos e storage', () => {
  let privateDoc: string;
  let tripDoc: string;

  it('documento pessoal é privado por padrão', async () => {
    const [d] = await db.as<{ id: string }>(
      ANA,
      `insert into public.documents (trip_id, title, category, storage_path, original_name, mime, size_bytes, encrypted)
       values ($1, 'Passaporte', 'identidade', $2::text || '/p1/passaporte.jpg', 'passaporte.jpg', 'image/jpeg', 1000, true) returning id`,
      [trip, trip],
    );
    privateDoc = d.id;
    await db.as(ANA, `insert into storage.objects (bucket_id, name) values ('documents', $1::text || '/p1/passaporte.jpg')`, [trip]);
    await db.as(ANA, `update public.documents set status = 'ready' where id = $1`, [privateDoc]);
    expect(await db.as(BIA, `select id from public.documents where id = $1`, [privateDoc])).toHaveLength(0);
    expect(await db.as(BIA, `select name from storage.objects where name like $1::text || '%'`, [trip])).toHaveLength(0);
    expect(await db.as(ANA, `select name from storage.objects where name like $1::text || '%'`, [trip])).toHaveLength(1);
  });

  it('compartilhamento explícito libera só para a pessoa escolhida', async () => {
    await db.as(ANA, `update public.documents set visibility = 'shared' where id = $1`, [privateDoc]);
    await db.as(ANA, `insert into public.document_shares (document_id, user_id) values ($1, $2)`, [privateDoc, BIA]);
    expect(await db.as(BIA, `select id from public.documents where id = $1`, [privateDoc])).toHaveLength(1);
    expect(await db.as(BIA, `select name from storage.objects where bucket_id = 'documents'`)).toHaveLength(1);
    expect(await db.as(LEO, `select id from public.documents where id = $1`, [privateDoc])).toHaveLength(0);
    await rejects(db.as(ANA, `insert into public.document_shares (document_id, user_id) values ($1, $2)`, [privateDoc, ZE]), /row-level security/);
    await rejects(db.as(BIA, `insert into public.document_shares (document_id, user_id) values ($1, $2)`, [privateDoc, LEO]), /row-level security/);
  });

  it('só o dono muda visibilidade, mesmo com permissão de edição', async () => {
    const [d] = await db.as<{ id: string }>(
      BIA,
      `insert into public.documents (trip_id, title, category, visibility, storage_path, original_name, mime, size_bytes, status, encrypted)
       values ($1, 'Passagem', 'passagem', 'trip', $2::text || '/p2/voo.pdf', 'voo.pdf', 'application/pdf', 2000, 'uploading', true) returning id`,
      [trip, trip],
    );
    tripDoc = d.id;
    await db.as(BIA, `insert into storage.objects (bucket_id, name) values ('documents', $1::text || '/p2/voo.pdf')`, [trip]);
    // ainda em envio: invisível para os outros
    expect(await db.as(LEO, `select id from public.documents where id = $1`, [tripDoc])).toHaveLength(0);
    await db.as(BIA, `update public.documents set status = 'ready' where id = $1`, [tripDoc]);
    expect(await db.as(LEO, `select id from public.documents where id = $1`, [tripDoc])).toHaveLength(1);
    await rejects(db.as(ANA, `update public.documents set visibility = 'private' where id = $1`, [tripDoc]), /dono/);
    expect(await db.as(ANA, `update public.documents set stop_id = $2 where id = $1 returning id`, [tripDoc, stop])).toHaveLength(1);
  });

  it('ninguém envia arquivo para o caminho de documento alheio', async () => {
    await rejects(db.as(BIA, `insert into storage.objects (bucket_id, name) values ('documents', $1::text || '/p1/outro.jpg')`, [trip]), /row-level security/);
    await rejects(db.as(ZE, `insert into storage.objects (bucket_id, name) values ('documents', $1::text || '/p2/voo.pdf.2')`, [trip]), /row-level security/);
    // documento já pronto não aceita novo arquivo
    await rejects(db.as(BIA, `insert into storage.objects (bucket_id, name) values ('journal', $1::text || '/x/y.jpg')`, [trip]), /row-level security/);
  });

  it('terceiro e leitor não apagam arquivos', async () => {
    expect(await db.as(ZE, `delete from storage.objects returning name`)).toHaveLength(0);
    expect(await db.as(LEO, `delete from storage.objects returning name`)).toHaveLength(0);
    expect(await db.as(LEO, `delete from public.documents returning id`)).toHaveLength(0);
  });

  it('quem sai da viagem perde acesso aos documentos compartilhados', async () => {
    await db.as(BIA, `delete from public.trip_members where trip_id = $1 and user_id = $2`, [trip, BIA]);
    // continua vendo só o que ela mesma enviou; o documento compartilhado pela Ana some
    expect(await db.as(BIA, `select id from public.documents where owner_id <> $1`, [BIA])).toHaveLength(0);
    expect(await db.as(BIA, `select name from storage.objects where name like '%passaporte%'`)).toHaveLength(0);
    // volta como editora para os próximos testes
    await db.query(`insert into public.trip_members (trip_id, user_id, role) values ($1, $2, 'editor')`, [trip, BIA]);
  });
});

describe('criptografia ponta a ponta', () => {
  const pub = (n: string) => JSON.stringify({ kty: 'EC', crv: 'P-256', x: `x${n}`, y: `y${n}` });
  const vault = (uid: string, n: string) =>
    db.as(uid, `select public.create_key_vault($1::jsonb, 'w', 'iv', 'salt', 600000)`, [pub(n)]);
  let privateDoc: string;
  let tripDoc: string;

  beforeAll(async () => {
    [{ id: privateDoc }] = await db.as<{ id: string }>(ANA, `select id from public.documents where title = 'Passaporte'`);
    [{ id: tripDoc }] = await db.as<{ id: string }>(BIA, `select id from public.documents where title = 'Passagem'`);
  });

  it('cofre: só pela RPC, uma vez; chave pública visível à turma, cofre só à dona', async () => {
    for (const [u, n] of [[ANA, 'a'], [BIA, 'b'], [LEO, 'c'], [ZE, 'd']] as const) await vault(u, n);
    await rejects(vault(ANA, 'a2'), /já tem um cofre/);
    await rejects(db.as(ANA, `insert into public.user_keys (user_id, public_key) values ($1, $2::jsonb)`, [ANA, pub('z')]), /permission denied/);
    await rejects(db.as(null, `select public.create_key_vault($1::jsonb, 'w', 'iv', 'salt', 600000)`, [pub('n')]));
    // chave privada no JWK é recusada
    await db.query(`delete from public.user_keys where user_id = $1`, [ZE]);
    await rejects(db.as(ZE, `select public.create_key_vault($1::jsonb, 'w', 'iv', 'salt', 600000)`, [JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'secreta' })]), /check/);
    await vault(ZE, 'd');

    expect(await db.as(BIA, `select user_id from public.user_keys where user_id = $1`, [ANA])).toHaveLength(1);
    expect(await db.as(ZE, `select user_id from public.user_keys where user_id = $1`, [ANA])).toHaveLength(0);
    expect(await db.as(BIA, `select * from public.user_vaults`)).toHaveLength(1);
    expect(await db.as(BIA, `update public.user_vaults set wrap_iv = 'x' where user_id = $1 returning user_id`, [ANA])).toHaveLength(0);
  });

  it('chave do documento só é liberada por quem lê e para quem pode ler', async () => {
    const grant = (by: string, doc: string, to: string) =>
      db.as(by, `insert into public.document_keys (document_id, user_id, wrapped_key) values ($1, $2, 'v1.k')`, [doc, to]);
    await grant(ANA, privateDoc, ANA);
    await grant(ANA, privateDoc, BIA); // compartilhado com a Bia
    await rejects(grant(ANA, privateDoc, LEO), /row-level security/); // não compartilhado com o Léo
    await rejects(grant(LEO, privateDoc, LEO), /row-level security/); // Léo não lê o documento
    await grant(BIA, tripDoc, BIA);
    await grant(BIA, tripDoc, LEO); // da turma toda: qualquer membro com chave libera
    await rejects(grant(BIA, tripDoc, ZE), /row-level security/); // fora da viagem
    await rejects(grant(ZE, tripDoc, ZE), /row-level security/);
    await rejects(db.as(ANA, `insert into public.document_keys (document_id, user_id, wrapped_key, created_by) values ($1, $2, 'v1.k', $3)`, [tripDoc, ANA, BIA]), /row-level security/);

    expect(await db.as(LEO, `select user_id from public.document_keys where document_id = $1`, [privateDoc])).toHaveLength(0);
    expect(await db.as(LEO, `select user_id from public.document_keys where document_id = $1`, [tripDoc])).toHaveLength(2);
    await rejects(db.as(LEO, `update public.document_keys set wrapped_key = 'x'`), /permission denied/);
  });

  it('perder acesso apaga a chave embrulhada', async () => {
    await db.as(ANA, `update public.documents set visibility = 'private' where id = $1`, [privateDoc]);
    expect(await db.query(`select user_id from public.document_keys where document_id = $1`, [privateDoc]).then((r) => r.rows)).toEqual([{ user_id: ANA }]);
    await db.query(`delete from public.trip_members where trip_id = $1 and user_id = $2`, [trip, LEO]);
    expect(await db.query(`select 1 from public.document_keys where user_id = $1`, [LEO]).then((r) => r.rows)).toHaveLength(0);
    await db.query(`insert into public.trip_members (trip_id, user_id, role) values ($1, $2, 'viewer')`, [trip, LEO]);
  });

  it('documento novo só entra cifrado e não deixa de ser cifrado', async () => {
    await rejects(
      db.as(ANA, `insert into public.documents (trip_id, title, storage_path, original_name, mime, size_bytes) values ($1::uuid, 'x', $1::text || '/p9/x', 'x.pdf', 'application/pdf', 1)`, [trip]),
      /row-level security/,
    );
    await rejects(db.as(ANA, `update public.documents set encrypted = false where id = $1`, [privateDoc]), /imutáveis/);
  });

  it('recomeçar o cofre apaga as chaves da pessoa', async () => {
    await db.as(BIA, `select public.reset_key_vault()`);
    expect(await db.query(`select 1 from public.document_keys where user_id = $1`, [BIA]).then((r) => r.rows)).toHaveLength(0);
    expect(await db.as(BIA, `select * from public.user_vaults`)).toHaveLength(0);
  });
});

describe('gastos', () => {
  it('rateio precisa fechar com o total e envolver só membros', async () => {
    const base = {
      trip_id: trip, description: 'Jantar', payer_id: ANA, amount: '100.00', currency: 'PEN',
      rate_to_base: '1.5', rate_source: 'manual', rate_date: '2027-01-16', rate_is_manual: true,
      base_amount: '150.00', spent_on: '2027-01-16',
    };
    await rejects(db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(base), JSON.stringify([{ user_id: ANA, share_cents: 7500 }, { user_id: BIA, share_cents: 7499 }])]), /não fecha/);
    await rejects(db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(base), JSON.stringify([{ user_id: ANA, share_cents: 7500 }, { user_id: ZE, share_cents: 7500 }])]), /não participa/);
    const [ok] = await db.as<{ id: string }>(ANA, `select public.save_expense($1::jsonb, $2::jsonb) as id`, [JSON.stringify(base), JSON.stringify([{ user_id: ANA, share_cents: 7500 }, { user_id: BIA, share_cents: 7500 }])]);
    expect(ok.id).toBeTruthy();
    await rejects(db.as(LEO, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify(base), JSON.stringify([{ user_id: LEO, share_cents: 15000 }])]), /row-level security/);
    // edição com versão antiga falha
    await rejects(db.as(ANA, `select public.save_expense($1::jsonb, $2::jsonb)`, [JSON.stringify({ ...base, id: ok.id, version: 99 }), JSON.stringify([{ user_id: ANA, share_cents: 15000 }])]), /outra pessoa/);
    const shares = await db.as(LEO, `select user_id, share_cents from public.expense_shares where expense_id = $1 order by user_id`, [ok.id]);
    expect(shares).toHaveLength(2);
  });

  it('acerto só entre membros e por quem pode editar', async () => {
    await rejects(db.as(ANA, `insert into public.settlements (trip_id, from_user, to_user, amount_cents) values ($1, $2, $3, 100)`, [trip, ZE, ANA]), /não participa/);
    await rejects(db.as(LEO, `insert into public.settlements (trip_id, from_user, to_user, amount_cents) values ($1, $2, $3, 100)`, [trip, LEO, ANA]), /row-level security/);
    expect(await db.as(BIA, `insert into public.settlements (trip_id, from_user, to_user, amount_cents) values ($1, $2, $3, 7500) returning id`, [trip, BIA, ANA])).toHaveLength(1);
  });
});

describe('caixa da turma', () => {
  it('editor lança aporte de membro; leitor só consulta; fora da viagem não', async () => {
    await db.as(BIA, `insert into public.pool_contributions (trip_id, user_id, amount_cents) values ($1, $2, 50000)`, [trip, ANA]);
    expect(await db.as(LEO, `select amount_cents from public.pool_contributions`)).toHaveLength(1);
    await rejects(db.as(LEO, `insert into public.pool_contributions (trip_id, user_id, amount_cents) values ($1, $2, 100)`, [trip, LEO]), /row-level security/);
    await rejects(db.as(BIA, `insert into public.pool_contributions (trip_id, user_id, amount_cents) values ($1, $2, 100)`, [trip, ZE]), /não participa/);
    await rejects(db.as(BIA, `insert into public.pool_contributions (trip_id, user_id, amount_cents, created_by) values ($1, $2, 100, $3)`, [trip, BIA, ANA]), /row-level security/);
    await rejects(db.as(BIA, `insert into public.pool_contributions (trip_id, user_id, amount_cents) values ($1, $2, 0)`, [trip, BIA]), /check/);
    expect(await db.as(ZE, `select * from public.pool_contributions`)).toHaveLength(0);
    expect(await db.as(LEO, `delete from public.pool_contributions returning id`)).toHaveLength(0);
  });

  it('save_expense grava gasto pago pelo caixa', async () => {
    const [{ save_expense: id }] = await db.as<{ save_expense: string }>(
      BIA,
      `select public.save_expense($1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({ trip_id: trip, description: 'Mercado', payer_id: BIA, amount: '60.00', currency: 'BRL', rate_to_base: 1, rate_source: 'Mesma moeda', rate_date: '2027-01-16', base_amount: '60.00', spent_on: '2027-01-16', paid_from_pool: true }),
        JSON.stringify([{ user_id: ANA, share_cents: 3000 }, { user_id: BIA, share_cents: 3000 }]),
      ],
    );
    const [row] = await db.as<{ paid_from_pool: boolean }>(LEO, `select paid_from_pool from public.expenses where id = $1`, [id]);
    expect(row.paid_from_pool).toBe(true);
  });
});

describe('diário', () => {
  it('cada pessoa edita só o próprio registro; terceiros não leem', async () => {
    const [e] = await db.as<{ id: string }>(BIA, `insert into public.journal_entries (trip_id, stop_id, body) values ($1, $2, 'Chegamos!') returning id`, [trip, stop]);
    expect(await db.as(ANA, `update public.journal_entries set body = 'x' where id = $1 returning id`, [e.id])).toHaveLength(0);
    expect(await db.as(ZE, `select id from public.journal_entries`)).toHaveLength(0);
    await db.as(BIA, `insert into storage.objects (bucket_id, name) values ('journal', $1::text || '/' || $2 || '/f.jpg')`, [trip, e.id]);
    await rejects(db.as(ANA, `insert into storage.objects (bucket_id, name) values ('journal', $1::text || '/' || $2 || '/g.jpg')`, [trip, e.id]), /row-level security/);
    expect(await db.as(LEO, `select name from storage.objects where bucket_id = 'journal'`)).toHaveLength(1);
    expect(await db.as(ZE, `select name from storage.objects where bucket_id = 'journal'`)).toHaveLength(0);
  });
});

describe('extensões do SPEC v3', () => {
  it('identidade persiste e é validada no formato mínimo', async () => {
    await rejects(db.as(ANA, `update public.trips set identity = '[]'::jsonb where id = $1`, [trip]), /identity_shape/);
    const ok = await db.as(ANA, `update public.trips set identity = '{"palette":{},"slit":"diamond"}'::jsonb, style = 'Aventura' where id = $1 returning style`, [trip]);
    expect(ok).toEqual([{ style: 'Aventura' }]);
    expect(await db.as(LEO, `update public.trips set identity = null where id = $1 returning id`, [trip])).toHaveLength(0);
  });

  it('analytics só grava com opt-in e ninguém lê eventos pelo app', async () => {
    await rejects(db.as(ANA, `insert into public.analytics_events (name) values ('trip.open')`), /row-level security/);
    await db.as(ANA, `update public.profiles set analytics_opt_in = true where id = $1`, [ANA]);
    await db.as(ANA, `insert into public.analytics_events (name, trip_id) values ('trip.open', $1)`, [trip]);
    await rejects(db.as(ANA, `insert into public.analytics_events (name, trip_id) values ('trip.open', '10000000-0000-4000-8000-000000000002')`), /row-level security/);
    await rejects(db.as(ANA, `select * from public.analytics_events`), /permission denied/);
  });

  it('limite diário de IA por pessoa', async () => {
    for (let i = 1; i <= 3; i++) {
      const [r] = await db.as<{ n: number }>(BIA, `select public.consume_ai_call(3) as n`);
      expect(r.n).toBe(i);
    }
    await rejects(db.as(BIA, `select public.consume_ai_call(3)`), /Limite/);
    await rejects(db.as(null, `select public.consume_ai_call(3)`));
  });

  it('preferência offline só para documentos legíveis e só da própria pessoa', async () => {
    const [doc] = await db.as<{ id: string }>(ANA, `select id from public.documents where title = 'Passaporte'`);
    await rejects(db.as(LEO, `insert into public.document_offline_prefs (user_id, document_id, keep_offline) values ($1, $2, true)`, [LEO, doc.id]), /row-level security/);
    await db.as(ANA, `insert into public.document_offline_prefs (user_id, document_id, keep_offline) values ($1, $2, false)`, [ANA, doc.id]);
    expect(await db.as(BIA, `select * from public.document_offline_prefs`)).toHaveLength(0);
  });

  it('retrospectiva: leitor lê, não escreve; push só da própria pessoa', async () => {
    await db.as(ANA, `insert into public.trip_retros (trip_id, content, generated_by) values ($1, '{"title":"x"}', 'rules')`, [trip]);
    expect(await db.as(LEO, `select generated_by from public.trip_retros`)).toEqual([{ generated_by: 'rules' }]);
    expect(await db.as(LEO, `update public.trip_retros set generated_by = 'ai' returning trip_id`)).toHaveLength(0);
    await db.as(LEO, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/1', 'k', 'a')`);
    expect(await db.as(ANA, `select * from public.push_subscriptions`)).toHaveLength(0);
    await rejects(db.as(ANA, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/2', 'k', 'a')`, [LEO]), /row-level security/);
  });
});
