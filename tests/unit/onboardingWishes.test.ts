// Ajustes de 08/11/2026: desejos sempre com lugar no roteiro (ou "não coube" explícito) e resumo dos lugares adicionados.
import { describe, expect, it } from 'vitest';
import { applyPlaceInfo, dayTripTours, infoOf, needsInfo, normalizeRoute, normalizeWishes, wishesAt } from '@/lib/onboarding';
import type { PlaceIdea, PlaceInfo, RouteProposal, RouteStop } from '@/data/types';

const stop = (name: string, nights: number, extra: Partial<RouteStop> = {}): RouteStop => ({ name, country: 'Itália', nights, day_trips: [], ...extra });
const route = (stops: RouteStop[], wishes: RouteProposal['wishes'] = []): RouteProposal => ({
  outbound: null, stops, legs: [], return: null, food_pp_day: [], left_out: [], wishes, generated_at: '2026-11-08T00:00:00Z',
});
const info = (asked: string, name: string, extra: Partial<PlaceInfo> = {}): PlaceInfo & { asked: string } => ({
  asked, name, country: 'Itália', why: 'Litoral com vilas penduradas nas falésias.', lat: 40.63, lng: 14.6,
  attractions: [{ name: 'Positano', why: 'Casinhas coloridas.' }], tip: 'Vá de barco.', nights_min: 2, nights_max: 3, ...extra,
});

describe('normalizeWishes', () => {
  it('desejo num bate-volta conta pela parada de onde ele sai', () => {
    const r = route([stop('Milão', 3, { day_trips: [{ name: 'Bernina Express (Tirano → St. Moritz)', day_offset: 1, cost_low: 0, cost_high: 0, wish: 'Bernina Express' }] })],
      [{ wish: 'Bernina Express', stop: 'Bernina Express (Tirano → St. Moritz)', how: 'Trem de Milão até Tirano.' }]);
    const w = normalizeWishes(r, ['Bernina Express']);
    expect(w).toEqual([{ wish: 'Bernina Express', stop: 'Milão', how: 'Trem de Milão até Tirano.', reason: null, sacrifice: null }]);
    expect(wishesAt({ ...r, wishes: w }, r.stops[0])).toEqual([{ wish: 'Bernina Express', how: 'Trem de Milão até Tirano.', dayTrip: 'Bernina Express (Tirano → St. Moritz)' }]);
  });

  it('parada marcada com o desejo vale mesmo se a IA esqueceu de citar', () => {
    const r = route([stop('Roma', 3), stop('Tirano', 1, { wish: 'Bernina Express' })]);
    expect(normalizeWishes(r, ['Bernina Express'])[0].stop).toBe('Tirano');
  });

  it('parada que não está na rota vira "não coube", com motivo e o que sacrificar', () => {
    const r = route([stop('Roma', 3)], [{ wish: 'Bernina Express', stop: 'Chur', reason: null, sacrifice: '1 noite a menos em Roma' }]);
    const [w] = normalizeWishes(r, ['Bernina Express']);
    expect(w.stop).toBeNull();
    expect(w.reason).toMatch(/não achou/);
    expect(w.sacrifice).toBe('1 noite a menos em Roma');
  });

  it('todo desejo pedido aparece, sem repetir', () => {
    const w = normalizeWishes(route([stop('Bolonha', 2)], [{ wish: 'aula de massa', stop: 'Bolonha' }]), ['aula de massa', 'Aula de Massa', 'ver a Última Ceia']);
    expect(w.map((x) => [x.wish, x.stop])).toEqual([['aula de massa', 'Bolonha'], ['ver a Última Ceia', null]]);
  });

  it('normalizeRoute devolve os desejos normalizados', () => {
    const r = normalizeRoute(route([stop('Milão', 2)], [{ wish: 'Bernina Express', stop: 'Milão' }]), 2, [], ['Bernina Express']);
    expect(r.wishes[0]).toMatchObject({ wish: 'Bernina Express', stop: 'Milão' });
  });

  it('bate-volta com desejo leva o desejo para o passeio do passo 5', () => {
    const st = stop('Milão', 3, { day_trips: [{ name: 'Bernina Express', day_offset: 1, cost_low: 10000, cost_high: 20000, wish: 'Bernina Express', why: 'Trem panorâmico pelos Alpes.' }] });
    const [t] = dayTripTours(st);
    expect(t.wish).toBe('Bernina Express');
    expect(t.why).toMatch(/Alpes.*Milão/);
  });
});

describe('resumo dos lugares adicionados', () => {
  const added: PlaceIdea = { name: 'Costa Malfitana', country: '', why: 'Você adicionou.', nights_min: 1, nights_max: 3, added: true };
  const roma: PlaceIdea = { name: 'Roma', country: 'Itália', why: 'Capital.', nights_min: 3, nights_max: 4, attractions: [{ name: 'Coliseu' }] };

  it('só pede resumo do que foi adicionado à mão ou veio do Descobrir, uma vez', () => {
    expect(needsInfo([added, roma, { ...roma, name: 'Lucca', from_discover: true }])).toEqual(['Costa Malfitana', 'Lucca']);
    expect(needsInfo([{ ...added, enriched: true }])).toEqual([]);
  });

  it('corrige o nome e leva a marcação junto', () => {
    const r = applyPlaceInfo([roma, added], { roma: 'maybe', 'costa malfitana': 'must' }, [info('Costa Malfitana', 'Costa Amalfitana')]);
    expect(r.items[1]).toMatchObject({ name: 'Costa Amalfitana', country: 'Itália', added: true, enriched: true, nights_min: 2, nights_max: 3 });
    expect(r.items[1].attractions?.[0].name).toBe('Positano');
    expect(r.marks).toEqual({ roma: 'maybe', 'costa amalfitana': 'must' });
  });

  it('nome corrigido que já estava na lista não duplica e fica com a marcação mais forte', () => {
    const r = applyPlaceInfo([{ ...roma, name: 'Costa Amalfitana' }, added], { 'costa amalfitana': 'maybe', 'costa malfitana': 'must' }, [info('Costa Malfitana', 'Costa Amalfitana')]);
    expect(r.items.map((p) => p.name)).toEqual(['Costa Amalfitana']);
    expect(r.marks).toEqual({ 'costa amalfitana': 'must' });
  });

  it('experiência guarda de onde sai', () => {
    const r = applyPlaceInfo([{ ...added, name: 'Bernina Express' }], {}, [info('Bernina Express', 'Bernina Express', { kind: 'experiencia', base: 'Tirano', nights_min: 0, nights_max: 0 })]);
    expect(r.items[0]).toMatchObject({ kind: 'experiencia', base: 'Tirano', nights_min: 1 });
  });

  it('infoOf: lista do passo 3, depois o cache; lugar sem resumo ainda pede busca', () => {
    const places = { items: [roma, added], nearby: [] };
    expect(infoOf('Roma', places, {}).detailed).toBe(true);
    expect(infoOf('Costa Malfitana', places, {}).detailed).toBe(false);
    const cache = { 'costa malfitana': info('Costa Malfitana', 'Costa Amalfitana') };
    expect(infoOf('Costa Malfitana', places, cache)).toMatchObject({ detailed: true, info: { name: 'Costa Amalfitana' } });
    expect(infoOf('Tivoli', places, {}).info).toBeNull();
  });
});
