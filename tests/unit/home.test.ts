// Início 3.0 (planning §13): bilhete, marcos, prontidão, postal, desde a última visita, frase e clima.
import { describe, expect, it } from 'vitest';
import type { Poll, PollVote, TripBundle } from '@/data/types';
import { buildDemoBundle } from '@/lib/demo/build';
import { DEMO_USER } from '@/lib/demo/build';
import { currencyForCountry } from '@/lib/currency';
import { dayHash, destinationCurrency, durationLabel, milestones, postcardOf, readiness, relDay, sinceLastVisit, ticketLegs } from '@/lib/home';
import { phraseOfDay, phraseSetFor } from '@/lib/phrases';
import { lastYear, parseWeather, weatherRequest } from '@/lib/weather';

const japan = (): TripBundle => buildDemoBundle('japao');
const TODAY = '2026-11-14';

describe('bilhete da viagem', () => {
  it('um trecho por parada, com carimbos do que está resolvido e do que falta', () => {
    const legs = ticketLegs(japan());
    expect(legs.map((l) => l.stop.name)).toEqual(['Tóquio', 'Hakone', 'Kyoto', 'Nara', 'Osaka']);
    expect(legs[0]).toMatchObject({ nights: 4, dayNumber: 1, current: false });
    expect(legs[1].stamps[0]).toEqual({ label: 'sem hospedagem', tone: 'todo' });
    expect(legs[0].stamps[0]).toEqual({ label: 'hospedagem ok', tone: 'ok' });
    expect(legs[0].stamps.some((s) => /passeio/.test(s.label))).toBe(true);
    expect(legs[1].hop).toBe('trem · 1h30');
    expect(legs[2].hop).toBe('trem · 2h');
  });

  it('marca a parada de hoje durante a viagem', () => {
    const legs = ticketLegs(japan(), '2027-04-10');
    expect(legs.filter((l) => l.current).map((l) => l.stop.name)).toEqual(['Kyoto']);
  });

  it('votação aberta da parada vira carimbo', () => {
    const b = japan();
    const hakone = b.stops.find((s) => s.name === 'Hakone')!;
    b.polls = [{ id: 'p1', trip_id: b.trip.id, question: 'Qual ryokan?', detail: null, target: 'stay', stop_id: hakone.id, multi: false, closes_at: null, status: 'open', decided_option_id: null, decided_by: null, decided_at: null, created_by: 'x', version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' } as Poll];
    expect(ticketLegs(b)[1].stamps.map((s) => s.label)).toContain('votação aberta');
  });
});

describe('até a partida', () => {
  it('hospedagem por reservar, check-in e embarque, em ordem', () => {
    const m = milestones(japan(), TODAY);
    expect(m.map((x) => x.key)).toEqual([expect.stringMatching(/^stay-/), 'checkin', 'leave']);
    expect(m[0]).toMatchObject({ date: '2027-02-06', title: 'Reservar hospedagem em Hakone', tone: 'todo' });
    expect(m[1].date).toBe('2027-04-01');
    expect(m[2].date).toBe('2027-04-02');
  });

  it('prazo ideal vencido vira "quanto antes" com a data de hoje', () => {
    const m = milestones(japan(), '2027-03-20');
    expect(m[0]).toMatchObject({ date: '2027-03-20', late: true });
  });

  it('documento de identidade que vence perto da volta entra como marco', () => {
    const b = japan();
    const id = b.documents.find((d) => d.category === 'identidade')!;
    id.valid_until = '2027-06-01';
    expect(milestones(b, TODAY).some((x) => x.key === `doc-${id.id}` && /Vence o documento/.test(x.title))).toBe(true);
  });

  it('nada no passado', () => {
    expect(milestones(japan(), '2027-04-08')).toEqual([]);
    expect(milestones(japan(), '2027-04-03').map((x) => x.title)).toEqual(['Reservar hospedagem em Hakone']);
  });

  it('rótulos curtos de distância e duração', () => {
    expect(relDay(TODAY, TODAY)).toBe('hoje');
    expect(relDay(TODAY, '2026-11-15')).toBe('amanhã');
    expect(relDay(TODAY, '2026-12-14')).toBe('em 30 d');
    expect(durationLabel(90)).toBe('1h30');
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(null)).toBeNull();
  });
});

describe('a turma está pronta?', () => {
  it('você primeiro, com o que falta; só dimensões que se aplicam', () => {
    const r = readiness(japan(), DEMO_USER, Date.parse('2026-11-14T12:00:00Z'))!;
    expect(r[0]).toMatchObject({ me: true, name: 'Você' });
    expect(r[0].dims.map((d) => d.key)).toEqual(expect.arrayContaining(['pool', 'docs']));
    expect(r[0].dims.map((d) => d.key)).not.toContain('vote'); // sem votação aberta
    expect(r[0].dims.find((d) => d.key === 'docs')?.ok).toBe(true);
    expect(r[1].missing).toContain('documentos');
  });

  it('voto pendente conta; quem votou fica ok', () => {
    const b = japan();
    b.polls = [{ id: 'p1', trip_id: b.trip.id, question: 'Osaka ou Nara?', detail: null, target: 'free', stop_id: null, multi: false, closes_at: null, status: 'open', decided_option_id: null, decided_by: null, decided_at: null, created_by: DEMO_USER, version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' } as Poll];
    b.pollOptions = [{ id: 'o1', poll_id: 'p1', trip_id: b.trip.id, label: 'Osaka', detail: null, link_url: null, price: null, currency: null, address: null, position: 0, created_by: DEMO_USER, created_at: '2026-11-01T00:00:00Z' }];
    b.pollVotes = [{ poll_id: 'p1', option_id: 'o1', trip_id: b.trip.id, user_id: DEMO_USER, created_at: '2026-11-02T00:00:00Z' } as PollVote];
    const r = readiness(b, DEMO_USER)!;
    expect(r.find((x) => x.me)!.dims.find((d) => d.key === 'vote')?.ok).toBe(true);
    expect(r.find((x) => !x.me)!.missing).toContain('voto');
  });
});

describe('postal do dia', () => {
  it('o mesmo passeio o dia inteiro, e outro em outro dia', () => {
    const b = japan();
    const a = postcardOf(b, TODAY)!;
    expect(a).not.toBeNull();
    expect(postcardOf(b, TODAY)!.activity.id).toBe(a.activity.id);
    const days = new Set(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((d) => postcardOf(b, d)!.activity.id));
    expect(days.size).toBeGreaterThan(1);
    expect(a.dayNumber).toBeGreaterThanOrEqual(1);
  });

  it('prefere passeio com foto; durante a viagem, só de amanhã em diante', () => {
    const b = japan();
    const pick = b.activities[3];
    pick.photo = { url: 'https://images.unsplash.com/photo-1?ixid=x' };
    expect(postcardOf(b, TODAY)!.activity.id).toBe(pick.id);
    const during = postcardOf(japan(), '2027-04-10')!;
    expect(during.activity.day > '2027-04-10').toBe(true);
  });

  it('dayHash é estável', () => {
    expect(dayHash('a|2026-11-14')).toBe(dayHash('a|2026-11-14'));
  });
});

describe('desde sua última visita', () => {
  it('só o que outras pessoas e o roteiro mudaram depois da visita, do mais novo ao mais velho', () => {
    const b = japan();
    const other = b.members.find((m) => m.user_id !== DEMO_USER)!.user_id;
    b.poolContributions = [
      { id: 'c1', trip_id: b.trip.id, user_id: other, kind: 'deposit', amount_cents: 50000, contributed_on: '2026-11-13', note: null, created_by: other, created_at: '2026-11-13T10:00:00Z' },
      { id: 'c2', trip_id: b.trip.id, user_id: DEMO_USER, kind: 'deposit', amount_cents: 50000, contributed_on: '2026-11-13', note: null, created_by: DEMO_USER, created_at: '2026-11-13T11:00:00Z' },
    ];
    b.activities[0].created_at = '2026-11-13T12:00:00Z';
    const r = sinceLastVisit(b, DEMO_USER, '2026-11-12T00:00:00Z');
    expect(r).toHaveLength(2);
    expect(r[0].text).toMatch(/entrou no dia 1/);
    expect(r[1].text).toMatch(/pôs R\$/);
    expect(sinceLastVisit(b, DEMO_USER, '2026-11-14T00:00:00Z')).toEqual([]);
  });
});

describe('moeda, frase e clima', () => {
  it('moeda do destino diferente da trilha', () => {
    expect(destinationCurrency(japan(), currencyForCountry)).toBe('JPY');
  });

  it('frase no idioma do país; português não tem', () => {
    const set = phraseSetFor('Japão · Kanto')!;
    expect(set.lang).toBe('ja');
    expect(phraseOfDay(set, 3).say).toBeTruthy();
    expect(phraseSetFor('Portugal')).toBeNull();
    expect(phraseSetFor('Peru')?.lang).toBe('es');
  });

  it('longe da data, consulta o ano passado; perto, a previsão', () => {
    const stop = { lat: 35, lng: 135, arrival_date: '2027-04-09', departure_date: '2027-04-13' };
    const far = weatherRequest(stop, TODAY)!;
    expect(far.kind).toBe('lastYear');
    expect(far.url).toContain('archive-api.open-meteo.com');
    expect(far.url).toContain('start_date=2026-04-09&end_date=2026-04-12');
    expect(weatherRequest(stop, '2027-04-01')!.kind).toBe('forecast');
    expect(weatherRequest({ ...stop, lat: null }, TODAY)).toBeNull();
    expect(lastYear('2028-02-29')).toBe('2027-02-28');
  });

  it('lê mínima, máxima e dias de chuva', () => {
    const w = parseWeather({ daily: { temperature_2m_max: [19.6, 21.2, null], temperature_2m_min: [8.4, 10.1, 9], precipitation_sum: [0, 3.2, 1] } }, 's', 'lastYear')!;
    expect(w).toMatchObject({ min: 8, max: 21, rain: 2, kind: 'lastYear' });
    expect(parseWeather({ daily: {} }, 's', 'forecast')).toBeNull();
  });
});
