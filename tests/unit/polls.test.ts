import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { inspirationScore, myInspirationVote, myPendingVotes, pollPushes, pollState, pollWinners, tallyPoll, votersCount } from '@/lib/polls';
import type { InspirationValue, Poll, TripBundle } from '@/data/types';

const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;

function withVotes(votes: [string, InspirationValue][]) {
  const b = andes();
  const entry = b.journalEntries[0].id;
  b.inspirationVotes = votes.map(([user_id, value]) => ({ entry_id: entry, trip_id: b.trip.id, user_id, value, updated_at: b.fetchedAt }));
  return { b, entry };
}

describe('termômetro das inspirações', () => {
  it('score é a soma dos valores; listas por reação', () => {
    const b0 = andes();
    const [ana, bia, leo] = b0.members.map((m) => m.user_id);
    const { b, entry } = withVotes([[ana, 2], [bia, 1], [leo, -1]]);
    expect(inspirationScore(b, entry)).toEqual({ score: 2, muito: [ana], topo: [bia], passo: [leo] });
  });

  it('sem reações: score 0 e listas vazias', () => {
    const { b, entry } = withVotes([]);
    expect(inspirationScore(b, entry)).toEqual({ score: 0, muito: [], topo: [], passo: [] });
  });

  it('reação de quem não é mais membro é ignorada', () => {
    const b0 = andes();
    const [ana] = b0.members.map((m) => m.user_id);
    const { b, entry } = withVotes([[ana, 1], ['00000000-0000-4000-8000-0000000000ff', 2]]);
    expect(inspirationScore(b, entry)).toEqual({ score: 1, muito: [], topo: [ana], passo: [] });
  });

  it('só conta reações da própria inspiração', () => {
    const b = andes();
    const [first, second] = b.journalEntries;
    expect(inspirationScore(b, first.id).score).toBe(3);
    expect(inspirationScore(b, second.id).score).toBe(1);
  });

  it('minha reação', () => {
    const b0 = andes();
    const [me, bia] = b0.members.map((m) => m.user_id);
    const { b, entry } = withVotes([[bia, -1]]);
    expect(myInspirationVote(b, entry, me)).toBeNull();
    expect(myInspirationVote(b, entry, bia)).toBe(-1);
  });

  it('bundle antigo sem a lista não quebra', () => {
    const b = andes() as Partial<TripBundle> as TripBundle;
    delete (b as Partial<TripBundle>).inspirationVotes;
    expect(inspirationScore(b, b.journalEntries[0].id).score).toBe(0);
  });
});

describe('demonstração', () => {
  it('Andes tem inspirações com reações de 2 pessoas, nenhuma minha', () => {
    const b = andes();
    const reacted = new Set(b.inspirationVotes.map((v) => v.entry_id));
    expect(reacted.size).toBe(2);
    expect(new Set(b.inspirationVotes.map((v) => v.user_id)).size).toBe(2);
    expect(b.inspirationVotes.some((v) => v.user_id === b.trip.created_by)).toBe(false);
    expect(b.journalEntries.every((e) => e.kind === 'inspiracao')).toBe(true);
  });
});

describe('apuração das enquetes', () => {
  const NOW = Date.parse('2026-10-10T12:00:00-03:00');
  // Enquete livre montada à mão sobre a demo: 3 opções, quem vota é passado em cada teste.
  function setup(marks: [number, number[]][], extra: Partial<Poll> = {}) {
    const b = andes();
    const people = b.members.map((m) => m.user_id);
    const pid = 'p-teste';
    b.polls = [{ id: pid, trip_id: b.trip.id, question: 'Qual?', detail: null, target: 'free', stop_id: null, multi: false, closes_at: null, status: 'open', decided_option_id: null, decided_by: null, decided_at: null, created_by: people[0], version: 1, created_at: b.fetchedAt, updated_at: b.fetchedAt, ...extra }];
    b.pollOptions = ['A', 'B', 'C'].map((label, i) => ({ id: `o${i}`, poll_id: pid, trip_id: b.trip.id, label, detail: null, link_url: null, price: null, currency: null, address: null, position: i, created_by: people[0], created_at: b.fetchedAt }));
    b.pollVotes = marks.flatMap(([u, os]) => os.map((o) => ({ poll_id: pid, option_id: `o${o}`, trip_id: b.trip.id, user_id: people[u] ?? `ex-${u}`, created_at: b.fetchedAt })));
    return { b, pid, people };
  }

  it('simples: mais votada primeiro, depois a ordem das opções', () => {
    const { b, pid, people } = setup([[0, [2]], [1, [2]], [2, [0]]]);
    expect(tallyPoll(b, pid)).toEqual([
      { optionId: 'o2', votes: 2, voters: [people[0], people[1]] },
      { optionId: 'o0', votes: 1, voters: [people[2]] },
      { optionId: 'o1', votes: 0, voters: [] },
    ]);
    expect(pollWinners(b, pid)).toEqual(['o2']);
    expect(votersCount(b, pid)).toEqual({ voted: 3, total: b.members.length });
  });

  it('múltipla: cada pessoa conta uma vez em votersCount', () => {
    const { b, pid } = setup([[0, [0, 1, 2]], [1, [1]]], { multi: true });
    expect(tallyPoll(b, pid).map((r) => [r.optionId, r.votes])).toEqual([['o1', 2], ['o0', 1], ['o2', 1]]);
    expect(votersCount(b, pid).voted).toBe(2);
  });

  it('empate no topo e sem votos', () => {
    expect(pollWinners(setup([[0, [0]], [1, [1]]]).b, 'p-teste')).toEqual(['o0', 'o1']);
    expect(pollWinners(setup([]).b, 'p-teste')).toEqual([]);
  });

  it('voto de ex-membro é ignorado', () => {
    const { b, pid } = setup([[0, [1]], [99, [0]], [98, [0]]]);
    expect(pollWinners(b, pid)).toEqual(['o1']);
    expect(votersCount(b, pid).voted).toBe(1);
  });

  it('pollState antes e depois do prazo; fechada', () => {
    const { b, pid } = setup([], { closes_at: '2026-10-11T23:59:00-03:00' });
    expect(pollState(b, pid, NOW)).toBe('open');
    expect(pollState(b, pid, Date.parse('2026-10-12T00:00:00-03:00'))).toBe('awaiting_decision');
    b.polls[0].status = 'closed';
    expect(pollState(b, pid, NOW)).toBe('closed');
  });

  it('myPendingVotes ignora fechadas, vencidas e já votadas', () => {
    const { b, people } = setup([]);
    const me = people[0];
    const base = b.polls[0];
    b.polls = [
      { ...base, id: 'aberta' },
      { ...base, id: 'fechada', status: 'closed', decided_at: b.fetchedAt },
      { ...base, id: 'vencida', closes_at: '2026-10-01T00:00:00Z' },
      { ...base, id: 'votada', closes_at: '2026-12-01T00:00:00Z' },
    ];
    b.pollVotes = [{ poll_id: 'votada', option_id: 'o0', trip_id: b.trip.id, user_id: me, created_at: b.fetchedAt }];
    expect(myPendingVotes(b, me, NOW).map((p) => p.id)).toEqual(['aberta']);
    expect(myPendingVotes(b, people[1], NOW).map((p) => p.id)).toEqual(['aberta', 'votada']);
  });

  it('demo Andes: hospedagem aberta com 3 opções e votos de 2 pessoas; passeio decidido e aplicado', () => {
    const b = andes();
    const [stay, act] = b.polls;
    expect(stay).toMatchObject({ target: 'stay', status: 'open' });
    expect(b.pollOptions.filter((o) => o.poll_id === stay.id)).toHaveLength(3);
    expect(votersCount(b, stay.id).voted).toBe(2);
    expect(myPendingVotes(b, b.trip.created_by!, NOW).map((p) => p.id)).toEqual([stay.id]);
    expect(act).toMatchObject({ target: 'activity', status: 'closed' });
    expect(b.activities.filter((a) => a.from_poll_id === act.id)).toHaveLength(1);
  });
});

describe('decisão na demonstração (mesmas regras do banco)', () => {
  it('hospedagem decidida vira a pendente da parada e o alerta "sem reserva" passa a citar a escolhida', async () => {
    const { createDemoSource } = await import('@/data/demoSource');
    const { ruleAlerts } = await import('@/lib/rules');
    const src = createDemoSource('andes');
    const b0 = await src.load();
    const poll = b0.polls.find((p) => p.target === 'stay' && p.status === 'open')!;
    const [pirwa, inti] = b0.pollOptions.filter((o) => o.poll_id === poll.id);
    // voto: opção de outra enquete e duas opções numa enquete simples são recusados
    const other = b0.pollOptions.find((o) => o.poll_id !== poll.id)!;
    await expect(src.rpc('cast_vote', { p_poll: poll.id, p_options: [other.id] })).rejects.toMatchObject({ code: '22023' });
    await expect(src.rpc('cast_vote', { p_poll: poll.id, p_options: [pirwa.id, inti.id] })).rejects.toMatchObject({ code: '22023' });
    const r = await src.rpc<{ applied: boolean; stay_id: string }>('close_poll', { p_poll: poll.id, p_option: pirwa.id });
    expect(r.applied).toBe(true);
    const b = await src.load();
    const stay = b.stays.find((s) => s.id === r.stay_id)!;
    expect(stay).toMatchObject({ name: 'Hostel Pirwa', status: 'pending', from_poll_id: poll.id, stop_id: poll.stop_id });
    expect(ruleAlerts(b).find((a) => a.key === `stay-missing-${poll.stop_id}`)?.title).toBe('Hostel Pirwa sem reserva');
    await expect(src.rpc('cast_vote', { p_poll: poll.id, p_options: [inti.id] })).rejects.toMatchObject({ code: 'P0001' });
    await expect(src.rpc('close_poll', { p_poll: poll.id, p_option: inti.id })).rejects.toMatchObject({ code: 'P0001' });
  });

  it('voto com prazo vencido é recusado e a enquete segue aberta', async () => {
    const { createDemoSource } = await import('@/data/demoSource');
    const src = createDemoSource('japao');
    const pid = crypto.randomUUID();
    await src.insert('polls', { id: pid, question: 'Qual?', closes_at: '2020-01-01T00:00:00Z' }, { returning: false });
    const oid = crypto.randomUUID();
    await src.insert('poll_options', { id: oid, poll_id: pid, label: 'A' }, { returning: false });
    await expect(src.rpc('cast_vote', { p_poll: pid, p_options: [oid] })).rejects.toMatchObject({ code: 'P0001', message: 'Votação encerrada' });
    const b = await src.load();
    expect(pollState(b, pid)).toBe('awaiting_decision');
    await expect(src.rpc('cast_vote', { p_poll: 'nao-existe', p_options: [] })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('lembretes de votação (rotina diária)', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z');
  const trip = { id: 't1', title: 'Peru' };
  const poll = (id: string, closes: string | null, extra: Partial<Poll> = {}) =>
    ({ id, trip_id: 't1', question: `Pergunta ${id}`, closes_at: closes, status: 'open' as const, created_by: 'ana', ...extra });
  const withOpts = new Set(['soon', 'late', 'past', 'voted', 'closed', 'other']);

  it('prazo nas próximas 24h sem meu voto → falta seu voto', () => {
    const r = pollPushes(trip, [poll('soon', '2026-10-11T06:00:00Z'), poll('late', '2026-10-13T00:00:00Z'), poll('voted', '2026-10-11T00:00:00Z')],
      [{ poll_id: 'voted', user_id: 'leo' }], withOpts, { user_id: 'leo', role: 'viewer' }, NOW);
    expect(r).toEqual([{ title: 'Peru: falta seu voto', body: 'Pergunta soon', url: '/t/t1/turma#decisoes', tag: 'poll-soon' }]);
  });

  it('prazo vencido → hora de decidir só para quem criou ou organiza', () => {
    const polls = [poll('past', '2026-10-09T00:00:00Z', { created_by: 'bia' })];
    expect(pollPushes(trip, polls, [], withOpts, { user_id: 'leo', role: 'viewer' }, NOW)).toEqual([]);
    expect(pollPushes(trip, polls, [], withOpts, { user_id: 'bia', role: 'editor' }, NOW).map((m) => [m.title, m.tag])).toEqual([['Peru: hora de decidir', 'poll-decide-past']]);
    expect(pollPushes(trip, polls, [], withOpts, { user_id: 'ana', role: 'organizer' }, NOW)).toHaveLength(1);
  });

  it('ignora encerradas, sem prazo, sem opções e de outra viagem', () => {
    const polls = [
      poll('closed', '2026-10-11T00:00:00Z', { status: 'closed' }),
      poll('noDeadline', null),
      poll('noOpts', '2026-10-11T00:00:00Z'),
      poll('other', '2026-10-11T00:00:00Z', { trip_id: 't2' }),
    ];
    expect(pollPushes(trip, polls, [], new Set([...withOpts, 'noDeadline']), { user_id: 'ana', role: 'organizer' }, NOW)).toEqual([]);
  });
});
