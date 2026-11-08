// Modo planejamento: em que fase a trilha está e qual é o próximo passo.
// Funções puras sobre o TripBundle; tudo derivado do que já foi salvo (nada vira tarefa no banco).
import type { Poll, TripBundle } from '../data/types';
import { sortedStops, tripPhase } from './derive';
import { toCents } from './money';
import { canDecide, myVotes, pollState, votersCount } from './polls';

export type PlanStage = 'sonhar' | 'decidir' | 'montar' | 'reservar' | 'viajar';
export const PLAN_STAGES: { key: PlanStage; label: string }[] = [
  { key: 'sonhar', label: 'Sonhar' },
  { key: 'decidir', label: 'Decidir' },
  { key: 'montar', label: 'Montar' },
  { key: 'reservar', label: 'Reservar' },
  { key: 'viajar', label: 'Viajar' },
];

export interface PlanStep {
  key: string;
  title: string;
  detail: string;
  /** caminho relativo à trilha ('' = Início) */
  link: string;
  cta: string;
  /** só depois que o destino for fechado */
  locked?: boolean;
}

/** Trilha criada sem destino (onboarding "ainda não sei pra onde"). */
export function hasDestination(b: TripBundle): boolean {
  return b.trip.destinations.some((d) => d.trim().length > 0);
}

/** Enquetes livres abertas enquanto não há destino: são a disputa pelo destino. */
function destinationPolls(b: TripBundle, now: number): Poll[] {
  if (hasDestination(b)) return [];
  return (b.polls ?? []).filter((p) => p.target === 'free' && pollState(b, p.id, now) !== 'closed');
}

function hasBudget(b: TripBundle): boolean {
  if (b.trip.budget_total != null && toCents(String(b.trip.budget_total)) > 0) return true;
  return b.budgetCategories.some((c) => toCents(String(c.planned)) > 0);
}

export function planStage(b: TripBundle, now = Date.now()): PlanStage {
  if (!hasDestination(b)) return destinationPolls(b, now).length ? 'decidir' : 'sonhar';
  if (tripPhase(b.trip, now).kind !== 'before') return 'viajar';
  const stops = sortedStops(b);
  if (!hasBudget(b) || !stops.length) return 'montar';
  const unbooked = stops.some((s, i) => {
    const nights = s.arrival_date < s.departure_date;
    const stay = b.stays.find((x) => x.stop_id === s.id);
    const needsStay = nights && stay?.status !== 'booked';
    const needsArrival = i > 0 && !b.transports.some((t) => t.stop_id === s.id) && !s.arrival_mode;
    return needsStay || needsArrival;
  });
  return unbooked ? 'reservar' : 'viajar';
}

/** Passos do planejamento em ordem; o primeiro é o "próximo passo". */
export function planSteps(b: TripBundle, me: string, now = Date.now()): PlanStep[] {
  const out: PlanStep[] = [];
  const polls = destinationPolls(b, now);

  if (!hasDestination(b)) {
    for (const p of polls) {
      const { voted, total } = votersCount(b, p.id);
      const mine = myVotes(b, p.id, me).length > 0;
      const st = pollState(b, p.id, now);
      if (st === 'awaiting_decision' && canDecide(b, p, me)) {
        out.push({ key: `decide-${p.id}`, title: 'Fechar o destino.', detail: `A votação “${p.question}” terminou. Falta decidir.`, link: '/turma#decisoes', cta: 'Decidir' });
      } else if (!mine && st === 'open') {
        out.push({ key: `vote-${p.id}`, title: 'Votar no destino.', detail: `${voted} de ${total} já votaram em “${p.question}”. Falta você.`, link: '/turma#decisoes', cta: 'Votar' });
      } else {
        out.push({
          key: `wait-${p.id}`, title: 'Fechar o destino.',
          detail: voted < total ? `${voted} de ${total} votaram. Dá pra esperar a turma ou decidir já.` : 'Todo mundo votou. Hora de fechar.',
          link: '/turma#decisoes', cta: 'Ver votação',
        });
      }
    }
    if (!polls.length) {
      out.push({
        key: 'destination', title: 'Escolher o destino.',
        detail: b.members.length > 1
          ? 'Veja lugares que cabem no tempo e no bolso de vocês, ponha os melhores na disputa e votem juntos.'
          : 'Veja lugares que cabem no seu tempo e no seu bolso, ponha os melhores na disputa e chame a turma pra votar.',
        link: '/descobrir', cta: 'Ver sugestões',
      });
    }
  }

  if (!hasBudget(b)) {
    out.push({ key: 'budget', title: 'Combinar o orçamento.', detail: 'Quanto cada pessoa quer gastar. Vira o previsto de transporte, hospedagem, comida e passeios.', link: '/dinheiro/orcamento', cta: 'Definir orçamento' });
  }

  const locked = !hasDestination(b);
  const stops = sortedStops(b);
  if (!stops.length) {
    out.push({ key: 'stops', title: 'Montar o roteiro.', detail: locked ? 'Liberado quando o destino fechar.' : 'Adicione a primeira parada: cidade e datas.', link: '/roteiro', cta: 'Adicionar parada', locked });
    out.push({ key: 'stay', title: 'Escolher onde ficar.', detail: locked ? 'Liberado quando o destino fechar.' : 'Depois das paradas.', link: '/roteiro', cta: 'Ver roteiro', locked: true });
  } else {
    stops.forEach((s, i) => {
      if (i > 0 && !b.transports.some((t) => t.stop_id === s.id) && !s.arrival_mode) {
        out.push({ key: `arrival-${s.id}`, title: `Como chegar em ${s.name}.`, detail: 'Defina o transporte do trecho.', link: '/roteiro', cta: 'Definir' });
      }
      const stay = b.stays.find((x) => x.stop_id === s.id);
      if (s.arrival_date < s.departure_date && !stay) {
        out.push({ key: `stay-${s.id}`, title: `Onde ficar em ${s.name}.`, detail: 'Nenhuma hospedagem escolhida ainda.', link: '/roteiro', cta: 'Escolher' });
      }
    });
  }
  return out;
}

/** Próximo passo disponível (ignora os bloqueados) ou null quando não falta nada do planejamento. */
export function nextStep(b: TripBundle, me: string, now = Date.now()): PlanStep | null {
  return planSteps(b, me, now).find((s) => !s.locked) ?? null;
}
