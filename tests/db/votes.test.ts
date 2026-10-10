// Votação da turma (ref/SPEC-votacao.md §10): termômetro, "levar pro roteiro" e enquetes.
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, createUser, type Db } from './harness';

const ANA = '00000000-0000-4000-8000-00000000000a'; // organizadora
const BIA = '00000000-0000-4000-8000-00000000000b'; // editora
const LEO = '00000000-0000-4000-8000-00000000000c'; // leitor (viewer)
const ZE = '00000000-0000-4000-8000-00000000000d'; // terceiro

const TRIP = '20000000-0000-4000-8000-000000000001';

let db: Db;
let lima: string;
let cusco: string;
let inspAna: string; // inspiração da Ana, sem parada
let inspBia: string; // inspiração da Bia, sem parada
let registro: string;

async function failure(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { message: string; code?: string };
  }
  throw new Error('era esperado erro');
}

beforeAll(async () => {
  db = await createDb();
  for (const [id, name] of [[ANA, 'Ana'], [BIA, 'Bia'], [LEO, 'Léo'], [ZE, 'Zé']] as const) await createUser(db, id, name);
  await db.as(ANA, `insert into public.trips (id, title, start_date, end_date, created_by) values ($2, 'Peru', '2027-01-15', '2027-01-31', $1)`, [ANA, TRIP]);
  const [{ t: ed }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'editor', 24, 1) as t`, [TRIP]);
  const [{ t: vw }] = await db.as<{ t: string }>(ANA, `select public.create_invite($1, 'viewer', 24, 1) as t`, [TRIP]);
  await db.as(BIA, `select public.accept_invite($1)`, [ed]);
  await db.as(LEO, `select public.accept_invite($1)`, [vw]);
  [{ id: lima }] = await db.as<{ id: string }>(ANA, `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'Lima', '2027-01-15', '2027-01-17') returning id`, [TRIP]);
  [{ id: cusco }] = await db.as<{ id: string }>(ANA, `insert into public.stops (trip_id, name, arrival_date, departure_date, position) values ($1, 'Cusco', '2027-01-17', '2027-01-21', 1) returning id`, [TRIP]);
  [{ id: inspAna }] = await db.as<{ id: string }>(ANA, `insert into public.journal_entries (trip_id, author_id, phase, kind, title, body, link_url) values ($1, $2, 'antes', 'inspiracao', 'Mercado de San Pedro', 'Comer no balcão', 'https://exemplo.com/mercado') returning id`, [TRIP, ANA]);
  [{ id: inspBia }] = await db.as<{ id: string }>(BIA, `insert into public.journal_entries (trip_id, author_id, phase, kind, place_name) values ($1, $2, 'antes', 'inspiracao', 'Sacsayhuamán') returning id`, [TRIP, BIA]);
  [{ id: registro }] = await db.as<{ id: string }>(ANA, `insert into public.journal_entries (trip_id, author_id, phase, kind, body) values ($1, $2, 'durante', 'registro', 'Chegamos') returning id`, [TRIP, ANA]);
});

describe('termômetro nas inspirações', () => {
  it('1. leitor reage a uma inspiração e muda a reação', async () => {
    await db.as(LEO, `insert into public.inspiration_votes (entry_id, trip_id, value) values ($1, $2, 2)`, [inspAna, TRIP]);
    await db.as(LEO, `insert into public.inspiration_votes (entry_id, trip_id, user_id, value) values ($1, $2, $3, -1)
      on conflict (entry_id, user_id) do update set value = excluded.value`, [inspAna, TRIP, LEO]);
    await db.as(BIA, `insert into public.inspiration_votes (entry_id, trip_id, value) values ($1, $2, 1)`, [inspAna, TRIP]);
    const rows = await db.as<{ user_id: string; value: number }>(ANA, `select user_id, value from public.inspiration_votes where entry_id = $1 order by user_id`, [inspAna]);
    expect(rows).toEqual([{ user_id: BIA, value: 1 }, { user_id: LEO, value: -1 }]);
  });

  it('valor fora de -1/1/2 é recusado; ninguém reage em nome de outra pessoa', async () => {
    await failure(db.as(LEO, `update public.inspiration_votes set value = 3 where entry_id = $1 and user_id = $2`, [inspAna, LEO]));
    const e = await failure(db.as(LEO, `insert into public.inspiration_votes (entry_id, trip_id, user_id, value) values ($1, $2, $3, 2)`, [inspBia, TRIP, ANA]));
    expect(e.message).toMatch(/row-level security/);
    expect(await db.as(LEO, `update public.inspiration_votes set value = 2 where user_id = $1 returning value`, [BIA])).toHaveLength(0);
    expect(await db.as(ANA, `delete from public.inspiration_votes where user_id = $1 returning value`, [LEO])).toHaveLength(0);
  });

  it('reação não troca de inspiração nem de pessoa', async () => {
    const e = await failure(db.as(LEO, `update public.inspiration_votes set entry_id = $2 where entry_id = $1 and user_id = $3`, [inspAna, inspBia, LEO]));
    expect(e.code).toBe('22023');
  });

  it('13. reação em entrada "registro" é recusada', async () => {
    const e = await failure(db.as(LEO, `insert into public.inspiration_votes (entry_id, trip_id, value) values ($1, $2, 1)`, [registro, TRIP]));
    expect(e.code).toBe('22023');
    expect(e.message).toMatch(/Só dá pra reagir a inspirações/);
  });

  it('terceiro não lê nem grava reações', async () => {
    expect(await db.as(ZE, `select * from public.inspiration_votes`)).toHaveLength(0);
    await failure(db.as(ZE, `insert into public.inspiration_votes (entry_id, trip_id, value) values ($1, $2, 2)`, [inspAna, TRIP]));
  });

  it('quem reagiu pode retirar a própria reação', async () => {
    await db.as(BIA, `insert into public.inspiration_votes (entry_id, trip_id, value) values ($1, $2, 2)`, [inspBia, TRIP]);
    expect(await db.as(BIA, `delete from public.inspiration_votes where entry_id = $1 and user_id = $2 returning value`, [inspBia, BIA])).toEqual([{ value: 2 }]);
  });
});

describe('levar inspiração ao roteiro', () => {
  it('2. leitor e terceiro não promovem', async () => {
    const e = await failure(db.as(LEO, `select public.promote_inspiration($1, $2, '2027-01-18')`, [inspAna, cusco]));
    expect(e.code).toBe('42501');
    await failure(db.as(ZE, `select public.promote_inspiration($1, $2, '2027-01-18')`, [inspAna, cusco]));
    expect(await db.query(`select 1 from public.activities where from_entry_id = $1`, [inspAna]).then((r) => r.rows)).toHaveLength(0);
  });

  it('dia fora da parada e parada de outra viagem são recusados', async () => {
    expect((await failure(db.as(BIA, `select public.promote_inspiration($1, $2, '2027-01-25')`, [inspAna, cusco]))).code).toBe('22023');
    const other = '20000000-0000-4000-8000-000000000002';
    await db.as(ZE, `insert into public.trips (id, title, start_date, end_date, created_by) values ($2, 'Outra', '2027-02-01', '2027-02-05', $1)`, [ZE, other]);
    const [{ id: alheia }] = await db.as<{ id: string }>(ZE, `insert into public.stops (trip_id, name, arrival_date, departure_date) values ($1, 'X', '2027-02-01', '2027-02-03') returning id`, [other]);
    expect((await failure(db.as(BIA, `select public.promote_inspiration($1, $2, '2027-02-02')`, [inspAna, alheia]))).code).toBe('22023');
  });

  it('12. cria atividade com from_entry_id no fim do dia; segunda vez dá 23505', async () => {
    await db.as(ANA, `insert into public.activities (trip_id, stop_id, day, title, position) values ($1, $2, '2027-01-18', 'City tour', 0)`, [TRIP, cusco]);
    const [{ id }] = await db.as<{ id: string }>(BIA, `select public.promote_inspiration($1, $2, '2027-01-18', '09:30') as id`, [inspAna, cusco]);
    const [act] = await db.as<Record<string, unknown>>(LEO, `select * from public.activities where id = $1`, [id]);
    expect(act).toMatchObject({
      from_entry_id: inspAna, stop_id: cusco, day: expect.anything(), time: '09:30:00', title: 'Mercado de San Pedro',
      notes: 'Comer no balcão\n\nhttps://exemplo.com/mercado', position: 1, suggested_by: null,
    });
    const again = await failure(db.as(ANA, `select public.promote_inspiration($1, $2, '2027-01-19')`, [inspAna, cusco]));
    expect(again.code).toBe('23505');
  });

  it('parada só é gravada na inspiração quando quem promove é o autor', async () => {
    // Bia promoveu a inspiração da Ana: a entrada continua sem parada (só o autor edita).
    const [a] = await db.as<{ stop_id: string | null }>(ANA, `select stop_id from public.journal_entries where id = $1`, [inspAna]);
    expect(a.stop_id).toBeNull();
    // Bia promove a própria: a parada é gravada; título vem do nome do lugar.
    const [{ id }] = await db.as<{ id: string }>(BIA, `select public.promote_inspiration($1, $2, '2027-01-15') as id`, [inspBia, lima]);
    const [b] = await db.as<{ stop_id: string | null }>(ANA, `select stop_id from public.journal_entries where id = $1`, [inspBia]);
    expect(b.stop_id).toBe(lima);
    const [act] = await db.as<{ title: string; notes: string | null; position: number }>(ANA, `select title, notes, position from public.activities where id = $1`, [id]);
    expect(act).toEqual({ title: 'Sacsayhuamán', notes: null, position: 0 });
  });

  it('12. entrada "registro" é recusada', async () => {
    const e = await failure(db.as(BIA, `select public.promote_inspiration($1, $2, '2027-01-15')`, [registro, lima]));
    expect(e.code).toBe('22023');
  });

  it('apagar a inspiração mantém a atividade e solta o vínculo', async () => {
    await db.as(BIA, `delete from public.journal_entries where id = $1`, [inspBia]);
    const rows = await db.as<{ from_entry_id: string | null }>(ANA, `select from_entry_id from public.activities where title = 'Sacsayhuamán'`);
    expect(rows).toEqual([{ from_entry_id: null }]);
  });
});

describe('enquetes', () => {
  let pStay: string; // Ana · hospedagem em Cusco · uma opção por pessoa
  let pAct: string; // Bia · passeio em Lima
  const opts: Record<string, string[]> = {};

  async function newPoll(uid: string, target: 'stay' | 'activity' | 'free', stopId: string | null, labels: string[], multi = false) {
    const [{ id }] = await db.as<{ id: string }>(uid, `insert into public.polls (trip_id, question, target, stop_id, multi, created_by) values ($1, $2, $3, $4, $5, $6) returning id`, [TRIP, `Enquete ${labels[0]}`, target, stopId, multi, uid]);
    opts[id] = [];
    for (const [i, label] of labels.entries()) {
      const [o] = await db.as<{ id: string }>(uid, `insert into public.poll_options (poll_id, trip_id, label, detail, link_url, address, position, created_by) values ($1, $2, $3, 'Café incluso', 'https://exemplo.com/' || $5, 'Rua ' || $3, $4, $6) returning id`, [id, TRIP, label, i, i, uid]);
      opts[id].push(o.id);
    }
    return id;
  }
  const votesOf = (poll: string, uid: string) =>
    db.query<{ option_id: string }>(`select option_id from public.poll_votes where poll_id = $1 and user_id = $2 order by option_id`, [poll, uid]).then((r) => r.rows.map((x) => x.option_id));

  beforeAll(async () => {
    pStay = await newPoll(ANA, 'stay', cusco, ['Hostel A', 'Hostel B', 'Hostel C']);
    pAct = await newPoll(BIA, 'activity', lima, ['Museu Larco', 'Barranco']);
  });

  it('1. leitor vota numa enquete e todos veem o voto com nome', async () => {
    await db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pStay][1]]]);
    const seen = await db.as<{ user_id: string }>(BIA, `select user_id from public.poll_votes where poll_id = $1`, [pStay]);
    expect(seen).toEqual([{ user_id: LEO }]);
  });

  it('2. leitor não cria enquete nem opção e não fecha enquete', async () => {
    expect((await failure(db.as(LEO, `insert into public.polls (trip_id, question, created_by) values ($1, 'x', $2)`, [TRIP, LEO]))).message).toMatch(/row-level security/);
    expect((await failure(db.as(LEO, `insert into public.poll_options (poll_id, trip_id, label, created_by) values ($1, $2, 'x', $3)`, [pStay, TRIP, LEO]))).message).toMatch(/row-level security/);
    expect((await failure(db.as(LEO, `select public.close_poll($1, $2)`, [pStay, opts[pStay][0]]))).code).toBe('42501');
  });

  it('3. terceiro não lê enquetes, opções, votos nem reações; cast_vote recusa', async () => {
    for (const t of ['polls', 'poll_options', 'poll_votes', 'inspiration_votes']) {
      expect(await db.as(ZE, `select * from public.${t} where trip_id = $1`, [TRIP]), t).toHaveLength(0);
    }
    expect((await failure(db.as(ZE, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pStay][0]]]))).code).toBe('42501');
    expect((await failure(db.as(ZE, `select public.close_poll($1, $2)`, [pStay, opts[pStay][0]]))).code).toBe('42501');
  });

  it('4. ninguém insere em poll_votes direto, nem em nome de outra pessoa', async () => {
    for (const uid of [ANA, LEO]) {
      const e = await failure(db.as(uid, `insert into public.poll_votes (poll_id, option_id, trip_id, user_id) values ($1, $2, $3, $4)`, [pStay, opts[pStay][0], TRIP, LEO]));
      expect(e.message).toMatch(/permission denied/);
    }
    expect((await failure(db.as(ANA, `delete from public.poll_votes where poll_id = $1`, [pStay]))).message).toMatch(/permission denied/);
    expect(await votesOf(pStay, LEO)).toEqual([opts[pStay][1]]);
  });

  it('5. cast_vote recusa opção de outra enquete, 2 opções em enquete simples, enquete fechada e prazo vencido', async () => {
    expect((await failure(db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pAct][0]]]))).code).toBe('22023');
    expect((await failure(db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [pStay, opts[pStay].slice(0, 2)]))).code).toBe('22023');
    const late = await newPoll(ANA, 'free', null, ['Sim', 'Não']);
    await db.as(ANA, `update public.polls set closes_at = now() - interval '1 minute' where id = $1`, [late]);
    const e = await failure(db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [late, [opts[late][0]]]));
    expect([e.code, e.message]).toEqual(['P0001', expect.stringMatching(/Votação encerrada/)]);
    await db.as(ANA, `select public.close_poll($1, $2)`, [late, opts[late][0]]);
    expect((await failure(db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [late, [opts[late][0]]]))).code).toBe('P0001');
    // prazo vencido não fecha sozinha: segue aberta até alguém decidir
    const open = await newPoll(BIA, 'free', null, ['A', 'B']);
    await db.as(BIA, `update public.polls set closes_at = now() - interval '1 day' where id = $1`, [open]);
    expect(await db.as(ANA, `select status from public.polls where id = $1`, [open])).toEqual([{ status: 'open' }]);
  });

  it('enquete múltipla aceita de 1 até o total de opções', async () => {
    const multi = await newPoll(BIA, 'free', null, ['Seg', 'Ter', 'Qua'], true);
    await db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [multi, opts[multi]]);
    expect(await votesOf(multi, LEO)).toHaveLength(3);
  });

  it('6. array vazio retira o voto; votar de novo substitui', async () => {
    await db.as(LEO, `select public.cast_vote($1, '{}'::uuid[])`, [pStay]);
    expect(await votesOf(pStay, LEO)).toEqual([]);
    await db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pStay][0]]]);
    await db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pStay][2]]]);
    expect(await votesOf(pStay, LEO)).toEqual([opts[pStay][2]]);
    await db.as(BIA, `select public.cast_vote($1, $2::uuid[])`, [pStay, [opts[pStay][2]]]);
  });

  it('7. opção com voto não sai nem muda de rótulo; enquete fechada não aceita opção; sétima opção é recusada', async () => {
    const voted = opts[pStay][2];
    const del = await failure(db.as(ANA, `delete from public.poll_options where id = $1`, [voted]));
    expect([del.code, del.message]).toEqual(['P0001', 'Esta opção já tem votos']);
    // sem privilégio de update pela API; e nem o dono do banco troca o rótulo de opção votada
    expect((await failure(db.as(ANA, `update public.poll_options set label = 'x' where id = $1`, [voted]))).message).toMatch(/permission denied/);
    expect((await failure(db.query(`update public.poll_options set label = 'x' where id = $1`, [voted]))).message).toMatch(/já tem votos/);
    // opção sem voto pode sair; opção nova em enquete aberta pode entrar
    await db.as(ANA, `delete from public.poll_options where id = $1`, [opts[pStay][1]]);
    opts[pStay].splice(1, 1);
    const six = await newPoll(BIA, 'free', null, ['1', '2', '3', '4', '5', '6']);
    const seventh = await failure(db.as(BIA, `insert into public.poll_options (poll_id, trip_id, label, created_by) values ($1, $2, '7', $3)`, [six, TRIP, BIA]));
    expect(seventh.code).toBe('22023');
    await db.as(BIA, `select public.close_poll($1, $2)`, [six, opts[six][0]]);
    const closed = await failure(db.as(BIA, `insert into public.poll_options (poll_id, trip_id, label, created_by) values ($1, $2, 'tarde', $3)`, [six, TRIP, BIA]));
    expect([closed.code, closed.message]).toEqual(['P0001', 'Enquete encerrada']);
  });

  it('tipo da votação não muda depois do primeiro voto', async () => {
    expect((await failure(db.as(ANA, `update public.polls set multi = true where id = $1`, [pStay]))).code).toBe('P0001');
  });

  it('11. ninguém muda status nem decided_* por update direto', async () => {
    for (const set of [`status = 'closed'`, `decided_at = now()`, `decided_by = '${ANA}'`, `decided_option_id = '${opts[pStay][0]}'`, `target = 'free'`]) {
      expect((await failure(db.as(ANA, `update public.polls set ${set} where id = $1`, [pStay]))).message, set).toMatch(/permission denied/);
    }
    expect((await failure(db.as(ANA, `insert into public.polls (trip_id, question, status, decided_at, created_by) values ($1, 'x', 'closed', now(), $2)`, [TRIP, ANA]))).message).toMatch(/permission denied/);
  });

  it('editar enquete: quem criou ou organizador, só enquanto aberta', async () => {
    expect(await db.as(BIA, `update public.polls set question = 'Hack' where id = $1 returning id`, [pStay])).toHaveLength(0);
    expect(await db.as(ANA, `update public.polls set question = 'Onde dormir em Lima?' where id = $1 returning version`, [pAct])).toEqual([{ version: 2 }]);
  });

  it('parada com enquete aberta de hospedagem/passeio não pode ser excluída', async () => {
    await failure(db.as(ANA, `delete from public.stops where id = $1`, [cusco]));
    expect(await db.as(ANA, `select 1 from public.stops where id = $1`, [cusco])).toHaveLength(1);
  });

  it('8. editora não fecha enquete da organizadora; organizadora fecha enquete da editora', async () => {
    expect((await failure(db.as(BIA, `select public.close_poll($1, $2)`, [pStay, opts[pStay][0]]))).code).toBe('42501');
    const [{ r }] = await db.as<{ r: Record<string, unknown> }>(ANA, `select public.close_poll($1, $2, null, false) as r`, [pAct, opts[pAct][1]]);
    expect(r).toEqual({ applied: false, reason: 'not_applied' });
    const [p] = await db.as<Record<string, unknown>>(LEO, `select status, decided_option_id, decided_by from public.polls where id = $1`, [pAct]);
    expect(p).toEqual({ status: 'closed', decided_option_id: opts[pAct][1], decided_by: ANA });
    expect((await failure(db.as(ANA, `select public.close_poll($1, $2)`, [pAct, opts[pAct][0]]))).code).toBe('P0001');
    // encerrada: ninguém edita
    expect(await db.as(ANA, `update public.polls set question = 'x' where id = $1 returning id`, [pAct])).toHaveLength(0);
  });

  it('9. hospedagem: sem hospedagem cria pendente; com pendente atualiza; com reservada não mexe', async () => {
    expect(await db.as(ANA, `select 1 from public.stays where stop_id = $1`, [cusco])).toHaveLength(0);
    // a vencedora pode ser menos votada: quem decide escolhe
    const [{ r: r1 }] = await db.as<{ r: { applied: boolean; stay_id: string } }>(ANA, `select public.close_poll($1, $2) as r`, [pStay, opts[pStay][0]]);
    expect(r1.applied).toBe(true);
    const [st] = await db.as<Record<string, unknown>>(ANA, `select name, address, status, notes, checkin_date::text, checkout_date::text, from_poll_id from public.stays where id = $1`, [r1.stay_id]);
    expect(st).toEqual({ name: 'Hostel A', address: 'Rua Hostel A', status: 'pending', notes: 'Café incluso\n\nhttps://exemplo.com/0', checkin_date: '2027-01-17', checkout_date: '2027-01-21', from_poll_id: pStay });

    const second = await newPoll(BIA, 'stay', cusco, ['Pousada Z', 'Pousada Y']);
    const [{ r: r2 }] = await db.as<{ r: { applied: boolean; stay_id: string } }>(BIA, `select public.close_poll($1, $2) as r`, [second, opts[second][1]]);
    expect(r2).toEqual({ applied: true, reason: null, stay_id: r1.stay_id });
    const stays = await db.as<{ name: string; from_poll_id: string }>(ANA, `select name, from_poll_id from public.stays where stop_id = $1`, [cusco]);
    expect(stays).toEqual([{ name: 'Pousada Y', from_poll_id: second }]);

    await db.as(ANA, `update public.stays set status = 'booked' where id = $1`, [r1.stay_id]);
    const third = await newPoll(ANA, 'stay', cusco, ['Outro']);
    const [{ r: r3 }] = await db.as<{ r: unknown }>(ANA, `select public.close_poll($1, $2) as r`, [third, opts[third][0]]);
    expect(r3).toEqual({ applied: false, reason: 'stay_booked', stay_id: null });
    expect(await db.as(ANA, `select name, status from public.stays where stop_id = $1`, [cusco])).toEqual([{ name: 'Pousada Y', status: 'booked' }]);
    expect(await db.as(ANA, `select status from public.polls where id = $1`, [third])).toEqual([{ status: 'closed' }]);
  });

  it('10. passeio: dia fora da parada é recusado (e nada muda); dentro, vira atividade no fim do dia', async () => {
    const p = await newPoll(BIA, 'activity', lima, ['Circuito Mágico', 'Huaca']);
    expect((await failure(db.as(BIA, `select public.close_poll($1, $2, '2027-01-20')`, [p, opts[p][0]]))).code).toBe('22023');
    expect(await db.as(BIA, `select status from public.polls where id = $1`, [p])).toEqual([{ status: 'open' }]);
    const [{ r }] = await db.as<{ r: { applied: boolean; activity_id: string } }>(BIA, `select public.close_poll($1, $2, '2027-01-16') as r`, [p, opts[p][0]]);
    expect(r.applied).toBe(true);
    const [a] = await db.as<Record<string, unknown>>(LEO, `select title, day::text, from_poll_id, suggested_by from public.activities where id = $1`, [r.activity_id]);
    expect(a).toEqual({ title: 'Circuito Mágico', day: '2027-01-16', from_poll_id: p, suggested_by: null });
  });

  it('livre só registra', async () => {
    const p = await newPoll(ANA, 'free', null, ['Uyuni', 'Atacama']);
    const [{ r }] = await db.as<{ r: unknown }>(ANA, `select public.close_poll($1, $2) as r`, [p, opts[p][1]]);
    expect(r).toEqual({ applied: false, reason: 'free' });
  });

  it('excluir enquete com votos apaga opções e votos juntos', async () => {
    const p = await newPoll(BIA, 'free', null, ['X', 'Y']);
    await db.as(LEO, `select public.cast_vote($1, $2::uuid[])`, [p, [opts[p][0]]]);
    expect(await db.as(ANA, `delete from public.polls where id = $1 returning id`, [p])).toHaveLength(1);
    expect(await db.query(`select 1 from public.poll_options where poll_id = $1`, [p]).then((x) => x.rows)).toHaveLength(0);
    expect(await db.query(`select 1 from public.poll_votes where poll_id = $1`, [p]).then((x) => x.rows)).toHaveLength(0);
  });
});

describe('saída da viagem', () => {
  it('14. remover o leitor apaga os votos e as reações dele', async () => {
    expect(await db.query(`select 1 from public.inspiration_votes where user_id = $1`, [LEO]).then((r) => r.rows)).not.toHaveLength(0);
    expect(await db.query(`select 1 from public.poll_votes where user_id = $1`, [LEO]).then((r) => r.rows)).not.toHaveLength(0);
    await db.as(ANA, `delete from public.trip_members where trip_id = $1 and user_id = $2`, [TRIP, LEO]);
    expect(await db.query(`select 1 from public.inspiration_votes where user_id = $1`, [LEO]).then((r) => r.rows)).toHaveLength(0);
    expect(await db.query(`select 1 from public.poll_votes where user_id = $1`, [LEO]).then((r) => r.rows)).toHaveLength(0);
    // enquetes e votos dos outros continuam
    expect(await db.query(`select 1 from public.poll_votes where user_id = $1`, [BIA]).then((r) => r.rows)).not.toHaveLength(0);
    // as dos outros continuam
    expect(await db.query(`select 1 from public.inspiration_votes where user_id = $1`, [BIA]).then((r) => r.rows)).toHaveLength(1);
  });

  it('funções de gatilho não são chamáveis pela API', async () => {
    const rows = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.drop_member_votes()', 'execute') as ok`);
    expect(rows.rows[0].ok).toBe(false);
  });
});
