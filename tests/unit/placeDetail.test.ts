// Recomendações pessoais (09/11/2026): perfil a partir do texto livre, janela do lugar por tipo,
// rota com bairros e atrações, e fotos conferidas que não se repetem entre lugares.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanDomain, fitLabels, keepRealEvidence, miniMap, normalizeDetail, parseProfile, placeLocation, profilePrompt, spanLabel, takesNights, type RawDetail,
} from '@/lib/placeDetail';
import { minNightsOfMust, mustForRoute } from '@/lib/onboarding';
import { claimPhoto, fetchPlacePhoto, nameMatches, pickPlaceImage, resetPhotoClaims } from '@/lib/photos';
import type { PlaceIdea } from '@/data/types';

describe('tipo do lugar', () => {
  it('bairro e atração mostram a cidade, nunca só o país; cidade mostra estado e país', () => {
    expect(placeLocation({ type: 'bairro', parent: 'Campinas', region: 'SP', country: 'Brasil' })).toBe('em Campinas, SP');
    expect(placeLocation({ type: 'atracao', parent: 'Cambuí, Campinas', country: 'Brasil' })).toBe('em Cambuí, Campinas');
    expect(placeLocation({ type: 'cidade', region: 'São Paulo', country: 'Brasil' })).toBe('São Paulo, Brasil');
    expect(placeLocation({ type: 'experiencia', parent: 'Tirano', country: 'Itália' })).toBe('sai de Tirano');
  });

  it('só cidade e região pedem noites (respostas antigas sem tipo contam como cidade)', () => {
    expect(takesNights('cidade')).toBe(true);
    expect(takesNights(undefined)).toBe(true);
    expect(takesNights('bairro')).toBe(false);
    expect(takesNights('atracao')).toBe(false);
  });

  it('bairro indispensável não soma noites e, na rota, conta pela cidade onde fica', () => {
    const items: PlaceIdea[] = [
      { name: 'Campinas', country: 'Brasil', why: 'x', nights_min: 2, nights_max: 3, type: 'cidade' },
      { name: 'Cambuí', country: 'Brasil', why: 'x', nights_min: 0, nights_max: 1, type: 'bairro', parent: 'Campinas' },
      { name: 'Holambra', country: 'Brasil', why: 'x', nights_min: 1, nights_max: 2 },
    ];
    const marks = { campinas: 'must', cambui: 'must', holambra: 'must' } as const;
    expect(minNightsOfMust(items, [], { ...marks })).toBe(3);
    expect(mustForRoute(items, ['Cambuí', 'Campinas', 'Holambra'])).toEqual(['Campinas', 'Holambra']);
    expect(mustForRoute(items, ['Cambuí'])).toEqual(['Campinas']);
  });
});

describe('perfil da viagem', () => {
  const story = 'Quero uma viagem babadeira pra Itália: comer muito bem e sem correria. Nada de balada.';

  it('lê com segurança e descarta gostos que não existem', () => {
    const p = parseProfile({
      summary: 'Vocês querem uma Itália marcante e gostosa, sem pressa.',
      traits: [{ label: 'Comer muito bem', evidence: 'comer muito bem' }, { label: 'comer muito bem' }, { label: '' }],
      avoid: ['Balada'], vibes: ['comida', 'inexistente'], pace: 'leve', stay: 'luxo',
    });
    expect(p?.traits).toHaveLength(1);
    expect(p?.vibes).toEqual(['comida']);
    expect(p?.pace).toBe('leve');
    expect(p?.stay).toBeNull();
    expect(parseProfile({ traits: [] })).toBeNull();
  });

  it('citação que não está no texto da pessoa sai (o traço fica)', () => {
    const p = parseProfile({ summary: 'Vocês querem calma.', traits: [{ label: 'Sem correria', evidence: 'sem correria' }, { label: 'Vinho', evidence: 'amamos vinho' }] })!;
    const kept = keepRealEvidence(p, story);
    expect(kept.traits[0].evidence).toBe('sem correria');
    expect(kept.traits[1].evidence).toBeNull();
    expect(kept.traits[1].label).toBe('Vinho');
  });

  it('o texto e o perfil entram no prompt; sem nada, nada entra', () => {
    const p = parseProfile({ summary: 'Vocês querem calma.', traits: [{ label: 'Sem correria' }], avoid: ['balada'] })!;
    const txt = profilePrompt(p, story);
    expect(txt).toContain('babadeira');
    expect(txt).toContain('"Sem correria"');
    expect(txt).toContain('balada');
    expect(profilePrompt(null, '')).toBe('');
    expect(fitLabels(p, ['comida', 'cultura'])).toEqual(['Sem correria', 'Comida', 'Cultura e história']);
  });
});

const raw = (over: Partial<RawDetail> = {}): RawDetail => ({
  name: 'Cambuí', type: 'bairro', parent: 'Campinas', country: 'Brasil', region: 'SP', lat: -22.89, lng: -47.05,
  summary: 'Bairro arborizado ao lado do centro de Campinas.',
  why_go: ['O Cambuí é onde Campinas sai para comer e conversar, em ruas planas e sombreadas.'],
  fit: [{ trait: 'comida', text: 'Restaurantes de vários estilos a poucos quarteirões.' }, { trait: 'Praia', text: 'Inventado.' }],
  for_whom: 'Quem gosta de comer bem e caminhar sem pressa.',
  caveats: ['Se vocês buscam natureza.'],
  time: { label: 'Uma tarde + jantar', options: [{ label: '2 a 3 h', text: 'Café e praça.', suggested: true }, { label: 'Tarde + noite', text: 'Com jantar.', suggested: true }], why: 'O bairro é pequeno.', stay_base: true },
  highlights: [
    { name: 'Centro de Convivência Cultural', scope: 'especifico', what: 'Passear pela praça e ver o teatro.', cost: 'gratis', lat: -22.893, lng: -47.052 },
    { name: 'Cafés do bairro', scope: 'amplo', what: 'Pausa num dos cafés.', cost: 'caro', lat: 10, lng: 10 },
  ],
  visit: [{ when: '16h', text: 'Café e caminhada.', refs: [2, 9] }, { when: '17h', text: 'Centro de Convivência.', refs: [1] }],
  practical: { costs: [{ item: 'Jantar', low: 120, high: 60, unit: 'por pessoa' }, { item: 'Feira', low: 0, high: 0, unit: '' }], limits: ['Estacionamento escasso à noite.'], check_at: 'https://www.campinas.sp.gov.br/cultura' },
  ...over,
});

describe('detalhe do lugar', () => {
  it('"por que combina" só cita o que a turma contou', () => {
    const d = normalizeDetail(raw(), { labels: ['Comida'], currency: 'BRL', now: 'x' });
    expect(d.fit).toEqual([{ trait: 'Comida', text: 'Restaurantes de vários estilos a poucos quarteirões.' }]);
    expect(normalizeDetail(raw(), { labels: [], currency: 'BRL' }).fit).toEqual([]);
  });

  it('uma opção de tempo sugerida, custos em centavos e em ordem, refs válidas, coordenada longe descartada', () => {
    const d = normalizeDetail(raw(), { labels: [], currency: 'BRL' });
    expect(d.time.options.filter((o) => o.suggested)).toHaveLength(1);
    expect(d.time.options[0].suggested).toBe(true);
    expect(d.time.stay_base).toBe(true);
    expect(d.practical.costs[0]).toEqual({ item: 'Jantar', low: 6000, high: 12000, unit: 'por pessoa' });
    expect(d.practical.costs[1]).toMatchObject({ low: 0, high: 0, unit: 'por pessoa' });
    expect(d.visit[0].refs).toEqual([2]);
    expect(d.highlights[1].lat).toBeNull();
    expect(d.highlights[1].cost).toBeNull();
    expect(d.practical.check_at).toBe('campinas.sp.gov.br');
  });

  it('"boa base para se hospedar" só vale para bairro; visita com um passo só não aparece', () => {
    const d = normalizeDetail(raw({ type: 'cidade', visit: [{ when: '16h', text: 'Só isso.', refs: [] }] }), { labels: [], currency: 'BRL' });
    expect(d.time.stay_base).toBeNull();
    expect(d.visit).toEqual([]);
  });

  it('textos que dizem que a IA fez algo saem', () => {
    const d = normalizeDetail(raw({ caveats: ['Reservei uma mesa pra vocês.', 'Se vocês buscam natureza.'] }), { labels: [], currency: 'BRL', fair: (s) => !/reservei/i.test(s) });
    expect(d.caveats).toEqual(['Se vocês buscam natureza.']);
  });

  it('domínio só quando parece domínio', () => {
    expect(cleanDomain('http://www.turismo.gov.br/agenda?x=1')).toBe('turismo.gov.br');
    expect(cleanDomain('site da prefeitura')).toBeNull();
  });
});

describe('minimapa dos destaques', () => {
  it('posiciona dentro da caixa, norte para cima, e mede a distância', () => {
    const m = miniMap([{ lat: -22.89, lng: -47.06, scope: 'especifico' }, { lat: -22.88, lng: -47.05, scope: 'amplo' }, { lat: null, lng: null, scope: 'amplo' }], 260, 200)!;
    expect(m.pins.map((p) => p.n)).toEqual([1, 2]);
    for (const p of m.pins) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(260); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(200); }
    expect(m.pins[1].y).toBeLessThan(m.pins[0].y);
    expect(m.spanKm).toBeGreaterThan(1);
    expect(m.spanKm).toBeLessThan(2);
    expect(miniMap([{ lat: 1, lng: 1, scope: 'amplo' }], 260, 200)).toBeNull();
    expect(spanLabel(1.4)).toBe('Tudo a até ~1,4 km, dá pra fazer a pé');
    expect(spanLabel(25)).toBe('Até ~25 km entre os pontos');
  });
});

describe('foto conferida do lugar', () => {
  beforeEach(() => resetPhotoClaims());

  it('o título precisa ser o nome do lugar: a cidade não serve para o bairro', () => {
    expect(nameMatches('Cambuí', 'Cambuí (Campinas)')).toBe(true);
    expect(nameMatches('Cambuí', 'Cambuí, Campinas')).toBe(true);
    expect(nameMatches('Cambuí', 'Campinas')).toBe(false);
    expect(nameMatches('Rua Coronel Quirino e arredores', 'Rua Coronel Quirino')).toBe(true);
    expect(nameMatches('Nara', 'Nara Leão')).toBe(false);
  });

  it('homônimo longe é recusado; o mais perto dentro do raio ganha', () => {
    const json = { query: { pages: [
      { title: 'Cambuí', index: 1, pageimage: 'Cambui_MG.jpg', coordinates: [{ lat: -22.61, lon: -46.06 }] },
      { title: 'Campinas', index: 2, pageimage: 'Campinas.jpg', coordinates: [{ lat: -22.9, lon: -47.06 }] },
      { title: 'Cambuí (Campinas)', index: 3, pageimage: 'Cambui_Campinas.jpg', coordinates: [{ lat: -22.893, lon: -47.05 }] },
    ] } };
    expect(pickPlaceImage(json, { name: 'Cambuí', lat: -22.89, lng: -47.05, radiusKm: 6 })?.file).toBe('Cambui_Campinas.jpg');
    expect(pickPlaceImage({ query: { pages: [json.query.pages[0], json.query.pages[1]] } }, { name: 'Cambuí', lat: -22.89, lng: -47.05, radiusKm: 6 })).toBeNull();
  });

  it('página sem coordenadas só vale quando é a única com o nome', () => {
    const one = { query: { pages: [{ title: 'Holambra', index: 1, pageimage: 'Holambra.jpg' }] } };
    expect(pickPlaceImage(one, { name: 'Holambra', lat: -22.63, lng: -47.05 })?.file).toBe('Holambra.jpg');
    const two = { query: { pages: [{ title: 'Cambuí', index: 1, pageimage: 'a.jpg' }, { title: 'Cambuí (Campinas)', index: 2, pageimage: 'b.jpg' }] } };
    expect(pickPlaceImage(two, { name: 'Cambuí', lat: -22.89, lng: -47.05 })).toBeNull();
  });

  it('uma foto, um lugar: outro lugar não repete a mesma foto (nem em outro tamanho)', () => {
    const url = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg';
    expect(claimPhoto(url, 'cambui')).toBe(true);
    expect(claimPhoto(url, 'cambui')).toBe(true);
    expect(claimPhoto(url.replace('1280px', '500px'), 'campinas')).toBe(false);
  });

  it('busca no máximo nome+contexto e nome, em pt e en, e para quando acha', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.includes('imageinfo')
        ? { query: { pages: [{ imageinfo: [{ thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/C.jpg/1280px-C.jpg', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] }] } }
        : url.startsWith('https://en.') ? { query: { pages: [{ title: 'Cambuí (Campinas)', index: 1, pageimage: 'C.jpg', coordinates: [{ lat: -22.893, lon: -47.05 }] }] } } : { query: { pages: [] } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const p = await fetchPlacePhoto({ name: 'Cambuí', context: 'Campinas', lat: -22.89, lng: -47.05, radiusKm: 6 }, fetcher);
    expect(p?.license).toBe('CC BY 4.0');
    expect(urls.filter((u) => !u.includes('imageinfo'))).toHaveLength(3);
    expect(decodeURIComponent(urls[0].replace(/\+/g, ' '))).toContain('Cambuí Campinas');
  });
});
