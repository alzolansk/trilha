// Passeios no mapa (ajuste de 09/11): lugar e trajeto das atividades.
import { describe, expect, it } from 'vitest';
import type { Activity, OnboardingState, Stop, Trip, TripBundle } from '../../src/data/types';
import { activityMarks, cleanPlace, dayTripName, MAX_KM, needsLocate, pathLabel, placeOf, routePlaceFor } from '../../src/lib/activityPlace';

const milao = { id: 's-mi', name: 'Milão', lat: 45.464, lng: 9.19 } as Stop;
const roma = { id: 's-ro', name: 'Roma', lat: 41.9, lng: 12.5 } as Stop;
const onboarding = {
  status: 'concluido', step: 6,
  route: {
    stops: [
      { name: 'Roma', country: 'Itália', lat: 41.9, lng: 12.5, nights: 3, day_trips: [] },
      { name: 'Milão', country: 'Itália', lat: 45.464, lng: 9.19, nights: 3, day_trips: [{ name: 'Bernina Express', day_offset: 1, cost_low: 40000, cost_high: 60000, lat: 46.41, lng: 10.02 }] },
    ],
    legs: [], left_out: [], wishes: [],
  },
} as unknown as OnboardingState;
const act = (over: Partial<Activity>): Activity => ({ id: 'a1', stop_id: 's-mi', day: '2027-05-17', position: 0, title: 'Duomo', place: null, ...over } as Activity);
const bundle = (activities: Activity[], ob: OnboardingState | null = onboarding) =>
  ({ trip: { onboarding: ob } as Trip, stops: [roma, milao], activities }) as unknown as Pick<TripBundle, 'trip' | 'stops' | 'activities'>;

const berninaPath = [
  { name: 'Milão', lat: 45.464, lng: 9.19 }, { name: 'Tirano', lat: 46.216, lng: 10.168 },
  { name: 'Alp Grüm', lat: 46.374, lng: 10.03 }, { name: 'St. Moritz', lat: 46.498, lng: 9.838 },
];

describe('dayTripName', () => {
  it('lê o nome do bate-volta do título', () => {
    expect(dayTripName('Bate-volta: Bernina Express')).toBe('Bernina Express');
    expect(dayTripName('bate volta · Lago de Como')).toBe('Lago de Como');
    expect(dayTripName('Catedral de Milão')).toBeNull();
  });
});

describe('cleanPlace', () => {
  it('aceita ponto perto da parada e trajeto válido', () => {
    const p = cleanPlace({ name: 'Bernina Express', lat: 46.41, lng: 10.02, path: berninaPath }, milao);
    expect(p).toMatchObject({ name: 'Bernina Express', lat: 46.41, by: 'ai' });
    expect(p?.path).toHaveLength(4);
  });
  it('descarta ponto longe demais da parada (erro da IA)', () => {
    expect(cleanPlace({ name: 'Bernina Express', lat: 46.41, lng: 10.02 }, roma)).toBeNull();
    expect(MAX_KM).toBeLessThan(500);
  });
  it('trajeto com ponto inválido ou distante fica de fora, o ponto continua', () => {
    const bad = cleanPlace({ name: 'X', lat: 46.41, lng: 10.02, path: [...berninaPath, { name: 'Lisboa', lat: 38.72, lng: -9.14 }] }, milao);
    expect(bad?.path).toBeNull();
    const one = cleanPlace({ name: 'X', lat: 46.41, lng: 10.02, path: [berninaPath[0]] }, milao);
    expect(one?.path).toBeNull();
  });
  it('sem ponto principal usa o meio do trajeto; sem nada, null', () => {
    expect(cleanPlace({ name: 'Bernina', lat: null, lng: null, path: berninaPath }, milao)).toMatchObject({ lat: 46.374 });
    expect(cleanPlace({ name: 'Tarde livre', lat: null, lng: null, path: null }, milao)).toBeNull();
    expect(cleanPlace({ name: 'Nulo', lat: 0, lng: 0 }, null)).toBeNull();
  });
});

describe('placeOf e routePlaceFor', () => {
  it('bate-volta aceito no roteiro volta a ter o ponto da proposta', () => {
    const a = act({ title: 'Bate-volta: Bernina Express' });
    expect(routePlaceFor(bundle([a]), milao, a.title)).toMatchObject({ name: 'Bernina Express', lat: 46.41, lng: 10.02, by: 'route' });
    expect(placeOf(bundle([a]), a)).toMatchObject({ name: 'Bernina Express' });
  });
  it('sem rota (ou outro título) fica fora do mapa', () => {
    expect(placeOf(bundle([], null), act({ title: 'Bate-volta: Bernina Express' }))).toBeNull();
    expect(placeOf(bundle([]), act({ title: 'Duomo' }))).toBeNull();
  });
  it('lugar gravado vale mais que a rota; "não é lugar" tira do mapa', () => {
    const saved = act({ title: 'Bate-volta: Bernina Express', place: { name: 'Bernina Express', lat: 46.4, lng: 10.0, path: berninaPath, by: 'ai' } });
    expect(placeOf(bundle([saved]), saved)?.path).toHaveLength(4);
    expect(placeOf(bundle([]), act({ title: 'Bate-volta: Bernina Express', place: { none: true } }))).toBeNull();
  });
});

describe('needsLocate', () => {
  it('pergunta sem lugar ou só com o ponto da rota; não pergunta de novo o resto', () => {
    expect(needsLocate({ place: null })).toBe(true);
    expect(needsLocate({ place: { name: 'Bernina Express', lat: 46.41, lng: 10.02, by: 'route' } })).toBe(true);
    expect(needsLocate({ place: { name: 'Duomo', lat: 45.46, lng: 9.19, path: null, by: 'ai' } })).toBe(false);
    expect(needsLocate({ place: { name: 'Duomo', lat: 45.46, lng: 9.19, by: 'osm' } })).toBe(false);
    expect(needsLocate({ place: { none: true, by: 'ai' } })).toBe(false);
  });
});

describe('activityMarks', () => {
  it('separa passeio na cidade de bate-volta/percurso e mantém a ordem do roteiro', () => {
    const marks = activityMarks(bundle([
      act({ id: 'b', day: '2027-05-18', title: 'Bate-volta: Bernina Express', place: { name: 'Bernina Express', lat: 46.41, lng: 10.02, path: berninaPath, by: 'ai' } }),
      act({ id: 'a', day: '2027-05-17', title: 'Catedral de Milão', place: { name: 'Duomo di Milano', lat: 45.4642, lng: 9.1916, path: null, by: 'ai' } }),
      act({ id: 'c', day: '2027-05-19', title: 'Tarde livre', place: { none: true, by: 'ai' } }),
    ]));
    expect(marks.map((m) => m.id)).toEqual(['a', 'b']);
    expect(marks[0]).toMatchObject({ far: false, place: 'Duomo di Milano', path: null });
    expect(marks[1]).toMatchObject({ far: true, place: null, pathLabel: 'Milão → Tirano → Alp Grüm → St. Moritz' });
    expect(marks[1].path).toHaveLength(4);
    expect(marks[1].pathNames[1]).toBe('Tirano');
  });
  it('pathLabel tira nomes repetidos em sequência', () => {
    expect(pathLabel([{ name: 'Puno', lat: 1, lng: 1 }, { name: 'Puno', lat: 1.1, lng: 1 }, { name: 'Taquile', lat: 2, lng: 2 }])).toBe('Puno → Taquile');
  });
});
