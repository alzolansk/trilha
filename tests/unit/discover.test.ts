import { describe, expect, it } from 'vitest';
import { groupAffinity, parseAnswers, personFit, planStops } from '@/lib/discover';

const peru = { cost_low: 1200, cost_high: 1800, tags: ['natureza', 'cultura'] };
const praia = { cost_low: 600, cost_high: 900, tags: ['praia'] };

describe('descobrir', () => {
  it('lê respostas com segurança', () => {
    expect(parseAnswers(null)).toMatchObject({ budget: null, vibes: [] });
    expect(parseAnswers({ budget: -5, days: 'x', vibes: ['praia', 'hack', 3] })).toMatchObject({ budget: null, days: null, vibes: ['praia'] });
    expect(parseAnswers({ budget: 2000, people: 4, start: '2027-01-10' })).toMatchObject({ budget: 2000, people: 4, start: '2027-01-10' });
  });

  it('adequação por pessoa usa teto e vibe', () => {
    expect(personFit(peru, { budget: 2000, vibes: ['natureza'] })).toBe(1);
    expect(personFit(peru, { budget: 1500, vibes: [] })).toBe(0.5);
    expect(personFit(peru, { budget: 1000, vibes: ['praia'] })).toBe(0);
    expect(personFit(peru, {})).toBeNull();
  });

  it('"% com a turma" só aparece com 2 ou mais pessoas respondendo', () => {
    expect(groupAffinity(peru, [{ budget: 2000, vibes: ['natureza'] }])).toBeNull();
    expect(groupAffinity(peru, [{ budget: 2000, vibes: ['natureza'] }, {}])).toBeNull();
    expect(groupAffinity(peru, [{ budget: 2000, vibes: ['natureza'] }, { budget: 1000, vibes: ['praia'] }])).toBe(50);
    expect(groupAffinity(praia, [{ vibes: ['praia'] }, { vibes: ['praia'] }])).toBe(100);
  });

  it('divide as noites entre as paradas sem sobra nem buraco', () => {
    const r = planStops(['Cusco', 'Machu Picchu', 'Lima'], '2027-01-10', '2027-01-20');
    expect(r.map((x) => x.name)).toEqual(['Cusco', 'Machu Picchu', 'Lima']);
    expect(r[0].arrival_date).toBe('2027-01-10');
    expect(r[1].arrival_date).toBe(r[0].departure_date);
    expect(r[2].arrival_date).toBe(r[1].departure_date);
    expect(r[2].departure_date).toBe('2027-01-20');
    for (const x of r) expect(x.departure_date > x.arrival_date).toBe(true);
  });

  it('com poucas noites reduz as paradas e nunca devolve estadia de zero noite', () => {
    const r = planStops(['A', 'B', 'C'], '2027-01-10', '2027-01-12');
    expect(r).toHaveLength(2);
    expect(r.at(-1)!.departure_date).toBe('2027-01-12');
    expect(planStops([], '2027-01-10', '2027-01-12')).toEqual([]);
  });
});
