// Apuração da votação da turma (ref/SPEC-votacao.md §5.1). Funções puras sobre o TripBundle.
// Votos de quem não é mais membro são ignorados (defesa extra além do gatilho do banco).
import type { InspirationValue, InspirationVote, Poll, PollOption, TripBundle } from '../data/types';

const memberSet = (b: TripBundle) => new Set(b.members.map((m) => m.user_id));

export type PollState = 'open' | 'awaiting_decision' | 'closed';

export function pollOf(b: TripBundle, pollId: string): Poll | null {
  return (b.polls ?? []).find((p) => p.id === pollId) ?? null;
}

export function optionsOf(b: TripBundle, pollId: string): PollOption[] {
  return (b.pollOptions ?? []).filter((o) => o.poll_id === pollId).sort((x, y) => x.position - y.position || x.created_at.localeCompare(y.created_at));
}

/** Votos atuais da enquete, só de membros. */
function votesOf(b: TripBundle, pollId: string) {
  const members = memberSet(b);
  return (b.pollVotes ?? []).filter((v) => v.poll_id === pollId && members.has(v.user_id));
}

/** Apuração: ordenada por votos (desc) e depois pela ordem das opções. */
export function tallyPoll(b: TripBundle, pollId: string): { optionId: string; votes: number; voters: string[] }[] {
  const vs = votesOf(b, pollId);
  return optionsOf(b, pollId)
    .map((o, i) => ({ i, optionId: o.id, voters: vs.filter((v) => v.option_id === o.id).map((v) => v.user_id) }))
    .map((r) => ({ ...r, votes: r.voters.length }))
    .sort((x, y) => y.votes - x.votes || x.i - y.i)
    .map(({ optionId, votes, voters }) => ({ optionId, votes, voters }));
}

/** Opções empatadas no topo ([] enquanto ninguém votou). */
export function pollWinners(b: TripBundle, pollId: string): string[] {
  const t = tallyPoll(b, pollId);
  const top = t[0]?.votes ?? 0;
  return top > 0 ? t.filter((r) => r.votes === top).map((r) => r.optionId) : [];
}

/** awaiting_decision = prazo passou e ninguém decidiu ainda (a enquete nunca fecha sozinha). */
export function pollState(b: TripBundle, pollId: string, now = Date.now()): PollState {
  const p = pollOf(b, pollId);
  if (!p || p.status === 'closed') return 'closed';
  return p.closes_at && Date.parse(p.closes_at) <= now ? 'awaiting_decision' : 'open';
}

/** Quantas pessoas da turma atual votaram. */
export function votersCount(b: TripBundle, pollId: string): { voted: number; total: number } {
  return { voted: new Set(votesOf(b, pollId).map((v) => v.user_id)).size, total: b.members.length };
}

/** Meus votos numa enquete (ids das opções). */
export function myVotes(b: TripBundle, pollId: string, me: string): string[] {
  return (b.pollVotes ?? []).filter((v) => v.poll_id === pollId && v.user_id === me).map((v) => v.option_id);
}

/** Enquetes abertas, dentro do prazo, em que ainda não votei. */
export function myPendingVotes(b: TripBundle, me: string, now = Date.now()): Poll[] {
  return (b.polls ?? []).filter((p) => pollState(b, p.id, now) === 'open' && myVotes(b, p.id, me).length === 0);
}

/** Quem criou (se ainda é da viagem) ou qualquer organizador decide. */
export function canDecide(b: TripBundle, poll: Poll, me: string): boolean {
  const m = b.members.find((x) => x.user_id === me);
  return !!m && (m.role === 'organizer' || poll.created_by === me);
}

/** Reações atuais de uma inspiração, só de membros. */
export function inspirationVotesOf(b: TripBundle, entryId: string): InspirationVote[] {
  const members = memberSet(b);
  return (b.inspirationVotes ?? []).filter((v) => v.entry_id === entryId && members.has(v.user_id));
}

/** Termômetro: score = soma dos valores; listas de quem marcou cada reação. */
export function inspirationScore(b: TripBundle, entryId: string): { score: number; muito: string[]; topo: string[]; passo: string[] } {
  const by = (value: InspirationValue, vs: InspirationVote[]) => vs.filter((v) => v.value === value).map((v) => v.user_id);
  const vs = inspirationVotesOf(b, entryId);
  return {
    score: vs.reduce((n, v) => n + v.value, 0),
    muito: by(2, vs),
    topo: by(1, vs),
    passo: by(-1, vs),
  };
}

/** Minha reação a uma inspiração (null se não reagi). */
export function myInspirationVote(b: TripBundle, entryId: string, me: string): InspirationValue | null {
  return (b.inspirationVotes ?? []).find((v) => v.entry_id === entryId && v.user_id === me)?.value ?? null;
}

export interface PollPush { title: string; body: string; url: string; tag: string }

/**
 * Lembretes de votação para uma pessoa numa viagem (rotina diária):
 * prazo nas próximas 24h sem voto dela; prazo vencido sem decisão para quem cria ou organiza.
 * Enquete sem opções é ignorada.
 */
export function pollPushes(
  trip: { id: string; title: string },
  polls: Pick<Poll, 'id' | 'trip_id' | 'question' | 'closes_at' | 'status' | 'created_by'>[],
  votes: { poll_id: string; user_id: string }[],
  optionPollIds: Set<string>,
  me: { user_id: string; role: string },
  now = Date.now(),
): PollPush[] {
  const out: PollPush[] = [];
  for (const p of polls) {
    if (p.trip_id !== trip.id || p.status !== 'open' || !p.closes_at || !optionPollIds.has(p.id)) continue;
    const left = Date.parse(p.closes_at) - now;
    const url = `/t/${trip.id}/turma#decisoes`;
    if (left > 0 && left <= 24 * 3600_000 && !votes.some((v) => v.poll_id === p.id && v.user_id === me.user_id)) {
      out.push({ title: `${trip.title}: falta seu voto`, body: p.question, url, tag: `poll-${p.id}` });
    } else if (left <= 0 && (me.role === 'organizer' || p.created_by === me.user_id)) {
      out.push({ title: `${trip.title}: hora de decidir`, body: p.question, url, tag: `poll-decide-${p.id}` });
    }
  }
  return out;
}
