// Ajustes de 09/11/2026: janela do lugar tolerante, foto de passeio pelo Commons, link do Google e
// "cada um no seu quarto" no orçamento.
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { placeDetailSchema } from '@/lib/ai/prompts';
import { normalizeDetail } from '@/lib/placeDetail';
import { googleSearchUrl, keyWords, pickCommonsImage } from '@/lib/photos';
import { buildDemoBundle } from '@/lib/demo/build';
import { budgetFromPlan, initialPlan, PRIVATE_ROOM_FACTOR, roomFactor } from '@/lib/budgetPlan';
import type { TripBundle } from '@/data/types';

describe('janela do lugar: schema tolerante', () => {
  const long = 'x'.repeat(400);
  const answer = {
    name: 'Trastevere', type: 'bairro', parent: 'Roma', country: 'Itália', lat: '41.88', lng: 12.47,
    summary: 'Bairro boêmio de ruas de pedra do outro lado do Tibre.',
    why_go: 'Um parágrafo só, em texto, em vez de lista: o bairro tem vida de dia e de noite.',
    fit: [{ trait: 'Comer muito bem', text: 'Trattorias por toda parte.' }, { trait: '', text: 'inválido' }],
    for_whom: null, caveats: ['Se vocês buscam silêncio à noite.'],
    time: { label: 'Uma tarde + jantar, sem pressa nenhuma pelo bairro todo', options: [{ label: '2-3 h', text: 'O básico.', suggested: 'sim' }], why: null },
    best_moment: long, getting_around: 'A pé',
    highlights: [
      { name: 'Santa Maria in Trastevere', scope: 'especifico', what: 'Igreja com mosaicos.', cost: 'grátis', lat: 41.889, lng: 12.47 },
      { name: 'Sem o que fazer' },
    ],
    visit: [{ when: '16h', text: 'Caminhar.', refs: ['1'] }, { when: 'Noite', text: 'Jantar.', refs: [1] }],
    practical: { costs: [{ item: 'Jantar', low: 25.5, high: 40, unit: 'por pessoa' }], limits: 'Ladeiras.', check_at: null },
  };

  it('aceita texto longo, número em string, lista como texto e descarta só os itens ruins', () => {
    const v = placeDetailSchema.safeParse(answer);
    expect(v.success).toBe(true);
    if (!v.success) return;
    expect(v.data.why_go).toHaveLength(1);
    expect(v.data.highlights).toHaveLength(1);
    expect(v.data.lat).toBeCloseTo(41.88);
    const d = normalizeDetail({ ...v.data, type: 'bairro' }, { labels: ['Comer muito bem'], currency: 'BRL' });
    expect(d.best_moment?.length).toBeLessThanOrEqual(60);
    expect(d.fit).toHaveLength(1);
    expect(d.practical.costs[0]).toMatchObject({ low: 2550, high: 4000 });
    expect(d.practical.limits).toEqual(['Ladeiras.']);
  });

  it('desembrulha {"detail": {...}} e ainda exige o essencial', () => {
    expect(placeDetailSchema.safeParse({ detail: answer }).success).toBe(true);
    expect(placeDetailSchema.safeParse({ ...answer, summary: '' }).success).toBe(false);
  });
});

describe('foto de passeio pelo Commons', () => {
  const file = (title: string, w = 1600, h = 1000, mime = 'image/jpeg', index = 1) => ({
    title: `File:${title}`, index,
    imageinfo: [{ thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${title}/1280px-${title}`, thumbwidth: 1280, thumbheight: 800, width: w, height: h, mime, descriptionurl: 'https://commons.wikimedia.org/x', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' } } }],
  });

  it('palavras próprias: sem genéricas e sem a cidade', () => {
    expect(keyWords(['Travessia para a Ilha de Murano', 'Murano'], 'Veneza')).toEqual(['ilha', 'murano']);
    expect(keyWords(['Passeio pelo centro histórico de Veneza'], 'Veneza')).toEqual([]);
  });

  it('escolhe o arquivo que cita o passeio, larga o bastante e com licença', () => {
    const words = keyWords(['Murano'], 'Veneza');
    const json = { query: { pages: [file('Venice_skyline.jpg', 2000, 1200, 'image/jpeg', 1), file('Murano_map.png', 2000, 1200, 'image/png', 2), file('Murano_glass_tiny.jpg', 400, 300, 'image/jpeg', 3), file('Murano_glass_furnace.jpg', 1600, 1000, 'image/jpeg', 4)] } };
    expect(pickCommonsImage(json, words)?.url).toContain('Murano_glass_furnace.jpg');
    expect(pickCommonsImage(json, [])).toBeNull();
  });

  it('busca no Google com o passeio e a cidade', () => {
    expect(googleSearchUrl('Travessia para Murano', 'Veneza')).toBe('https://www.google.com/search?q=Travessia+para+Murano+Veneza');
  });
});

describe('cada um no seu quarto', () => {
  const demo = () => structuredClone(buildDemoBundle('andes')) as TripBundle;
  it('só a hospedagem estimada sobe; sozinho não muda', () => {
    expect(roomFactor('private', 1)).toBe(1);
    expect(roomFactor('private', 2)).toBe(PRIVATE_ROOM_FACTOR);
    expect(roomFactor('shared', 4)).toBe(1);
    const b = demo();
    b.stays = []; // tudo pela referência: todas as noites acompanham a escolha
    const p = initialPlan(b);
    expect(p.room).toBe('shared');
    const stay = (room: 'shared' | 'private') => budgetFromPlan(b, { ...p, room }).lines.find((l) => l.kind === 'hospedagem')!.perPersonCents;
    const people = budgetFromPlan(b, p).people;
    if (people > 1) expect(stay('private')).toBeGreaterThan(stay('shared'));
    else expect(stay('private')).toBe(stay('shared'));
    expect(budgetFromPlan(b, { ...p, room: 'private' }).lines.find((l) => l.kind === 'comida')).toEqual(budgetFromPlan(b, p).lines.find((l) => l.kind === 'comida'));
  });
});
