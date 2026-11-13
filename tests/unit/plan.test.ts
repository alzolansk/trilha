import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { hasDestination, nextStep, planStage, planSteps } from '@/lib/plan';
import type { Poll, TripBundle } from '@/data/types';

const NOW = Date.parse('2026-11-08T12:00:00-03:00');

/** Trilha recém-criada sem destino: só datas, turma e grupos vazios. */
function blank(): TripBundle {
  const b = structuredClone(buildDemoBundle('andes')) as TripBundle;
  b.trip = { ...b.trip, destinations: [], identity: null, budget_total: null };
  b.budgetCategories = b.budgetCategories.map((c) => ({ ...c, planned: 0 }));
  Object.assign(b, { stops: [], stays: [], transports: [], activities: [], polls: [], pollOptions: [], pollVotes: [] });
  return b;
}

function poll(b: TripBundle, patch: Partial<Poll> = {}): Poll {
  const p: Poll = {
    id: 'p1', trip_id: b.trip.id, question: 'Pra onde a gente vai?', detail: null, target: 'free', stop_id: null, multi: false,
    closes_at: null, status: 'open', decided_option_id: null, decided_by: null, decided_at: null, created_by: b.members[0].user_id,
    version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...patch,
  };
  b.polls = [p];
  return p;
}

describe('modo planejamento', () => {
  it('sem destino e sem votação: sonhar, próximo passo é escolher o destino', () => {
    const b = blank();
    const me = b.members[0].user_id;
    expect(hasDestination(b)).toBe(false);
    expect(planStage(b, NOW)).toBe('sonhar');
    expect(nextStep(b, me, NOW)?.key).toBe('destination');
    expect(nextStep(b, me, NOW)?.link).toBe('/descobrir');
    const steps = planSteps(b, me, NOW);
    expect(steps.map((s) => s.key)).toEqual(['destination', 'budget', 'stops', 'stay']);
    expect(steps.find((s) => s.key === 'stops')?.locked).toBe(true);
  });

  it('votação aberta sem meu voto: decidir, próximo passo é votar', () => {
    const b = blank();
    const me = b.members[0].user_id;
    poll(b);
    expect(planStage(b, NOW)).toBe('decidir');
    expect(nextStep(b, me, NOW)?.key).toBe('vote-p1');
  });

  it('prazo da votação acabou: quem decide vê "Fechar o destino"', () => {
    const b = blank();
    const me = b.members[0].user_id;
    poll(b, { closes_at: '2026-11-05T00:00:00Z' });
    expect(nextStep(b, me, NOW)?.key).toBe('decide-p1');
  });

  it('com destino, sem orçamento e sem paradas: montar', () => {
    const b = blank();
    const me = b.members[0].user_id;
    b.trip.destinations = ['Paraty'];
    expect(planStage(b, NOW)).toBe('montar');
    expect(nextStep(b, me, NOW)?.key).toBe('budget');
    b.trip.budget_total = '2600.00';
    expect(nextStep(b, me, NOW)?.key).toBe('stops');
  });

  it('demo completa antes do embarque não pede nada de planejamento básico', () => {
    const b = structuredClone(buildDemoBundle('andes')) as TripBundle;
    const me = b.members[0].user_id;
    expect(hasDestination(b)).toBe(true);
    expect(planSteps(b, me, NOW).some((s) => s.key === 'destination' || s.key === 'stops')).toBe(false);
  });
});
