// Canvas "cidade e reservas": passeio com contexto (fase 1), o que falta na parada (fase 2) e leitura
// de passagem (fase 3). Tudo puro.
import { describe, expect, it } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { sortedStops } from '@/lib/derive';
import { airport } from '@/lib/airports';
import { stopIntro, stopReadiness, stopTours } from '@/lib/route';
import { parsedCount, parseTicket } from '@/lib/ticketParse';
import { parseTourExtras, tourTag, tourWhat, tourWhyGo } from '@/lib/tourInfo';
import type { TripBundle } from '@/data/types';

const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;
const money = (c: number, cur: string) => `${cur} ${Math.round(c / 100)}`;

describe('tourInfo · contexto do passeio', () => {
  it('selo só com motivo; "combina" só quando a turma contou gostos', () => {
    const base = { what: 'Lagoa glacial ao pé do Salkantay.', why_go: ['Água turquesa.'], caveats: ['Subida íngreme.'] };
    expect(parseTourExtras({ ...base, tag: 'achadinho', tag_reason: '' }).tag).toBeNull();
    expect(parseTourExtras({ ...base, tag: 'achadinho', tag_reason: 'pouca gente vai' }).tag).toBe('achadinho');
    expect(parseTourExtras({ ...base, tag: 'combina', tag_reason: 'vocês gostam de natureza' }, { hasPreferences: false }).tag).toBeNull();
    expect(parseTourExtras({ ...base, tag: 'combina', tag_reason: 'vocês gostam de natureza' }, { hasPreferences: true }).tag).toBe('combina');
    expect(parseTourExtras({ ...base, tag: 'famoso', tag_reason: 'x' }).tag).toBeNull();
  });

  it('listas curtas, sem repetir o "o que é" e sem itens vazios', () => {
    const x = parseTourExtras({ what: 'Museu do ouro', why_go: ['Museu do ouro', 'Peças incas originais', 'Peças incas originais', '', 'a', 'Café no pátio', 'Quarto item longo'] });
    expect(x.why_go).toEqual(['Peças incas originais', 'Café no pátio', 'Quarto item longo']);
  });

  it('"o que é" cai para o why antigo; por que vale não repete a mesma frase', () => {
    expect(tourWhat({ title: 'Sacsayhuamán', what: null, why: 'Fortaleza inca a 15 min do centro.' })).toBe('Fortaleza inca a 15 min do centro.');
    expect(tourWhat({ title: 'Sacsayhuamán', what: null, why: 'Sacsayhuamán' })).toBeNull();
    expect(tourWhyGo({ title: 'X', what: null, why: 'Fortaleza inca.' })).toEqual([]);
    expect(tourWhyGo({ title: 'X', what: 'Fortaleza inca.', why: 'Vista da cidade.' })).toEqual(['Vista da cidade.']);
    expect(tourTag({ tag: 'classico', tag_reason: '  ' })).toBeNull();
  });

  it('os passeios da parada carregam o contexto gravado na sugestão', () => {
    const b = andes();
    const cusco = sortedStops(b)[1];
    const humantay = stopTours(b, cusco).find((t) => t.title === 'Laguna Humantay')!;
    expect(humantay.what).toMatch(/Lagoa glacial/);
    expect(humantay.tag).toBe('combina');
    expect(humantay.whyGo.length).toBeGreaterThan(0);
    expect(humantay.caveats.length).toBeGreaterThan(0);
    expect(humantay.bookingHint).toBeTruthy();
  });
});

describe('route · o que falta na parada', () => {
  it('responde chegar, dormir e dias, nessa ordem e só com dado que existe', () => {
    const b = andes();
    const stops = sortedStops(b);
    for (let i = 0; i < stops.length; i++) {
      const items = stopReadiness(b, stops, i, money);
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(3);
      expect(items[0].key).toBe('arrive');
      expect(items.map((x) => x.key)).toEqual([...new Set(items.map((x) => x.key))]);
      for (const it of items) {
        expect(it.title).toBeTruthy();
        expect(it.text).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it('trecho sem localizador nem gasto é "falta comprar"; com localizador vira comprado', () => {
    const b = andes();
    const stops = sortedStops(b);
    const i = stops.findIndex((st, k) => k > 0 && b.transports.some((t) => t.stop_id === st.id && t.mode === 'plane'));
    const t = b.transports.find((x) => x.stop_id === stops[i].id)!;
    t.booking_ref = null;
    b.expenses = b.expenses.filter((e) => e.transport_id !== t.id);
    expect(stopReadiness(b, stops, i, money)[0]).toMatchObject({ state: 'todo', label: 'Falta comprar' });
    t.booking_ref = 'QX7P2M';
    expect(stopReadiness(b, stops, i, money)[0]).toMatchObject({ state: 'done', label: 'Comprado' });
  });

  it('hospedagem reservada fica resolvida; sem hospedagem pede o lugar', () => {
    const b = andes();
    const stops = sortedStops(b);
    const i = stops.findIndex((st) => b.stays.some((x) => x.stop_id === st.id && x.status === 'booked'));
    expect(stopReadiness(b, stops, i, money).find((x) => x.key === 'stay')?.state).toBe('done');
    const sid = stops[i].id;
    b.stays = b.stays.filter((x) => x.stop_id !== sid);
    b.polls = (b.polls ?? []).filter((p) => p.stop_id !== sid);
    expect(stopReadiness(b, stops, i, money).find((x) => x.key === 'stay')?.state).toBe('todo');
  });

  it('frase da capa: de onde chegam e para onde seguem', () => {
    const b = andes();
    const stops = sortedStops(b);
    expect(stopIntro(b, stops, 0)).toMatch(/^Primeira parada\. Vocês chegam/);
    expect(stopIntro(b, stops, 1)).toContain(`de ${stops[0].name}`);
    expect(stopIntro(b, stops, 1)).toContain(`para ${stops[2].name}`);
    expect(stopIntro(b, stops, stops.length - 1)).toMatch(/voltam/);
  });
});

describe('ticketParse · leitura de passagem', () => {
  it('lê e-mail de companhia em português', () => {
    const p = parseTicket(`Sua reserva está confirmada!
Localizador: QX7P2M
Voo AZ 675 · ITA Airways
São Paulo (GRU) → Roma (FCO)
Partida 31/05/2028 23:10 · Chegada 01/06/2028 15:05
Assentos: 23A, 23B`);
    expect(p).toMatchObject({
      booking_ref: 'QX7P2M', flight: 'AZ 675', origin_code: 'GRU', dest_code: 'FCO',
      depart_date: '2028-05-31', arrive_date: '2028-06-01', depart_time: '23:10', arrive_time: '15:05', seat: '23A · 23B',
    });
    expect(parsedCount(p)).toBe(9);
  });

  it('formato em inglês com mês por extenso e ano de referência', () => {
    const p = parseTicket('Booking reference ABC123. Flight LA 2047 LIM - CUZ 17 JAN 06:40 08:05', 2027);
    expect(p).toMatchObject({ booking_ref: 'ABC123', flight: 'LA 2047', origin_code: 'LIM', dest_code: 'CUZ', depart_date: '2027-01-17', depart_time: '06:40', arrive_time: '08:05' });
  });

  it('não confunde "reserva confirmada" com localizador e não inventa nada de texto vazio', () => {
    expect(parseTicket('Sua reserva confirmada para o hotel').booking_ref).toBeUndefined();
    expect(parsedCount(parseTicket('Olá! Obrigado por viajar conosco.'))).toBe(0);
  });

  it('aeroportos conhecidos dão cidade e fuso', () => {
    expect(airport('fco')).toEqual({ city: 'Roma', tz: 'Europe/Rome' });
    expect(airport('XYZ')).toBeNull();
  });
});
