// Fase 10 (planning §10.16): onboarding roteirizado com a IA simulada (page.route), na demo em memória.
import { expect, test, type Page } from '@playwright/test';

const places = {
  items: [
    { name: 'Reykjavík', region: 'Capital', country: 'Islândia', lat: 64.15, lng: -21.94, why: 'Base perfeita para começar e terminar.', nights_min: 2, nights_max: 3, highlights: ['Hallgrímskirkja'], photo_query: null, tags: ['cidade'], attractions: [{ name: 'Hallgrímskirkja', why: 'Igreja com mirante sobre a cidade.' }, { name: 'Harpa', why: 'Centro de concertos à beira-mar.' }], tip: 'Compre o passe da cidade.' },
    { name: 'Vík', region: 'Sul', country: 'Islândia', lat: 63.42, lng: -19.01, why: 'Praia de areia preta e falésias.', nights_min: 1, nights_max: 2, highlights: [], photo_query: null, tags: ['natureza'] },
    { name: 'Höfn', region: 'Sudeste', country: 'Islândia', lat: 64.25, lng: -15.2, why: 'Perto da lagoa glacial.', nights_min: 1, nights_max: 2, highlights: [], photo_query: null, tags: ['natureza'] },
  ],
  nearby: [
    { name: 'Selfoss', country: 'Islândia', lat: 63.93, lng: -21.0, why: 'Cidade pequena no caminho do sul.', from: 'Reykjavík', mode: 'car', hours: 1, kind: 'bate_volta', cost_low: 2000, cost_high: 4000, photo_query: null },
  ],
  currency: 'BRL',
};
const leg = (from: string, to: string, mode = 'car') => ({ from, to, mode, hours: 2.5, cost_low: 15000, cost_high: 25000 });
const route = {
  outbound: { from: 'GRU', to: 'Reykjavík', mode: 'plane', hours: 16, cost_low: 500000, cost_high: 700000 },
  stops: [
    { name: 'Reykjavík', country: 'Islândia', lat: 64.15, lng: -21.94, nights: 3, why: null, day_trips: [{ name: 'Círculo Dourado', day_offset: 1, cost_low: 30000, cost_high: 40000 }], stay_pp_night: { equilibrado: { low: 40000, high: 60000 } } },
    { name: 'Vík', country: 'Islândia', lat: 63.42, lng: -19.01, nights: 2, why: null, day_trips: [], stay_pp_night: { equilibrado: { low: 35000, high: 50000 } } },
    { name: 'Höfn', country: 'Islândia', lat: 64.25, lng: -15.2, nights: 3, why: null, day_trips: [], stay_pp_night: { equilibrado: { low: 30000, high: 45000 } } },
  ],
  legs: [leg('Reykjavík', 'Vík'), leg('Vík', 'Höfn')],
  return: { from: 'Höfn', to: 'GRU', mode: 'plane', hours: 18, cost_low: 500000, cost_high: 700000 },
  food_pp_day: [{ country: 'Islândia', low: 20000, high: 35000 }],
  left_out: [{ name: 'Akureyri', reason: 'Precisaria de 2 noites a mais.' }],
  wishes: [],
  generated_at: '2026-11-08T00:00:00Z',
};
const activities = { items: [
  { title: 'Lagoa glacial de barco', why: 'Icebergs de perto.', duration: '2h', cost_low: 300, cost_high: 400, tags: ['natureza'], day_fit: 'manha', photo_query: null, wish: null },
  { title: 'Museu local', why: 'História da região.', duration: '1h', cost_low: 80, cost_high: 120, tags: ['cultura'], day_fit: 'tarde', photo_query: null, wish: null },
], currency: 'BRL' };

const profile = {
  summary: 'Vocês querem uma Islândia de paisagens marcantes, sem correria e comendo bem.',
  traits: [{ label: 'Paisagens de foto', detail: 'Lugares que impressionam', evidence: 'tirar foto de tudo' }, { label: 'Sem correria', detail: null, evidence: 'sem correria' }],
  avoid: ['Balada'], group: 'casal', vibes: ['natureza', 'comida'], pace: 'leve', stay: null, generated_at: '2026-11-09T00:00:00Z',
};
/** Detalhe da janela do lugar (recomendações pessoais, 09/11/2026). */
const detailOf = (name: string) => ({
  name, type: 'cidade', parent: null, country: 'Islândia', region: null, lat: 64.15, lng: -21.94,
  summary: `${name} é uma cidade pequena à beira-mar.`,
  why_go: [`${name} tem casas coloridas, piscinas termais de bairro e é a base para o sul da ilha.`],
  fit: [{ trait: 'Sem correria', text: 'Como base fixa, evita trocar de hotel.' }],
  for_whom: 'Quem quer uma base confortável.', caveats: ['Se vocês querem só natureza.'],
  time: { label: '2 a 3 noites', options: [{ label: '1 noite', text: 'Só o centro.' }, { label: '2 noites', text: 'Com um bate-volta.', suggested: true }], why: 'A cidade se vê em um dia.', stay_base: null },
  best_moment: 'Verão', getting_around: 'A pé no centro',
  highlights: [
    { name: 'Hallgrímskirkja', scope: 'especifico', what: 'Subir a torre para ver a cidade.', why: null, duration: '45 min', cost: 'pago', booking: null, lat: 64.1417, lng: -21.9266 },
    { name: 'Piscinas de bairro', scope: 'amplo', what: 'Ir a uma piscina pública.', why: null, duration: '1 a 2 h', cost: 'pago', booking: null, lat: null, lng: null },
  ],
  visit: [{ when: 'Manhã', text: 'Subir a torre', refs: [1] }, { when: 'Fim do dia', text: 'Piscina termal', refs: [2] }],
  practical: { getting_there: 'Ônibus do aeroporto.', best_time: 'Verão.', costs: [{ item: 'Refeição', low: 15000, high: 25000, unit: 'por pessoa' }], cost_note: null, limits: ['Clima muda rápido.'], check_at: null },
  currency: 'BRL', generated_at: '2026-11-09T00:00:00Z',
});

async function mockAi(page: Page, opts: { placesStatus?: number; route?: unknown; detailStatus?: number } = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/ai/explore', async (r) => {
    const body = r.request().postDataJSON() as { kind: string };
    calls.push(body.kind);
    bodies.push(body);
    if (body.kind === 'places') {
      if (opts.placesStatus) return r.fulfill({ status: opts.placesStatus, contentType: 'application/json', body: JSON.stringify({ error: 'As sugestões precisam da IA, que não está configurada neste app.' }) });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: places, by: 'ai' }) });
    }
    if (body.kind === 'route') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { route: opts.route ?? route, currency: 'BRL' }, by: 'ai' }) });
    if (body.kind === 'place_info') {
      const items = (body as unknown as { items: { name: string }[] }).items.map(({ name }) => ({
        asked: name, name: name === 'Westfjords' ? 'Fiordes do Oeste' : name, kind: 'lugar', base: null, region: null, country: 'Islândia', lat: 65.6, lng: -22.5,
        why: `Resumo de ${name === 'Westfjords' ? 'Fiordes do Oeste' : name} feito pela IA.`, nights_min: 2, nights_max: 3, highlights: [], photo_query: null, tags: ['natureza'],
        attractions: [{ name: `Mirante de ${name}`, why: 'Vista bonita.' }], tip: null,
      }));
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items }, by: 'ai' }) });
    }
    if (body.kind === 'profile') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { profile }, by: 'ai' }) });
    if (body.kind === 'place_detail') {
      if (opts.detailStatus) return r.fulfill({ status: opts.detailStatus, contentType: 'application/json', body: '{"error":"cota"}' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { detail: detailOf((body as unknown as { name: string }).name) }, by: 'ai' }) });
    }
    if (body.kind === 'activities') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: activities, by: 'ai' }) });
    return r.fulfill({ status: 404, body: '{}' });
  });
  await page.route('**/api/photos*', (r) => r.fulfill({ contentType: 'application/json', body: 'null' }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  return Object.assign(calls, { bodies });
}

test.describe('Onboarding roteirizado', () => {
  test('monta lugares, rota, passeios e orçamento de ponta a ponta', async ({ page }) => {
    const calls = await mockAi(page);
    await page.goto('/demo/islandia/montar?passo=2');
    await expect(page.getByText('Passo 2 de 6')).toBeVisible();
    // Passo 2: a turma conta a viagem do jeito dela e confere o que a Trilha entendeu
    await page.getByLabel('Como vocês imaginam essa viagem?').fill('Quero ver coisas lindas e tirar foto de tudo, comer bem e sem correria. Nada de balada.');
    await page.getByRole('button', { name: /Entender a nossa viagem/ }).click();
    const profileCard = page.getByTestId('profile-card');
    await expect(profileCard).toContainText('Paisagens de foto');
    await expect(profileCard).toContainText('tirar foto de tudo');
    await profileCard.getByRole('button', { name: /Tirar “Paisagens de foto”/ }).click();
    await expect(profileCard).not.toContainText('Paisagens de foto');
    await page.getByRole('button', { name: 'Continuar' }).click();
    const prof = calls.bodies.find((x) => x.kind === 'profile') as { story: string } | undefined;
    expect(prof?.story).toContain('sem correria');

    // Passo 3: lugares e "perto daqui"
    await expect(page.getByText('Passo 3 de 6')).toBeVisible();
    const rk = page.locator('[data-place="Reykjavík"]');
    await rk.getByRole('radio', { name: 'Indispensável' }).click();
    await expect(page.getByRole('heading', { name: 'Perto daqui' })).toBeVisible();
    await expect(page.locator('[data-nearby="Selfoss"]')).toContainText('de Reykjavík');
    // "Perto daqui" começa como Talvez (não como Pular)
    await expect(page.locator('[data-nearby="Selfoss"]').getByRole('radio', { name: 'Talvez' })).toHaveAttribute('aria-checked', 'true');
    // Janela de detalhes do lugar
    await rk.getByRole('button', { name: 'Mais sobre Reykjavík' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reykjavík' });
    // Janela nova: por que vale, por que combina (só com o que a turma contou), tempo, destaques e antes de escolher
    await expect(sheet.getByRole('heading', { name: 'Por que vale conhecer' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Por que combina com vocês' })).toBeVisible();
    await expect(sheet).toContainText('Como base fixa, evita trocar de hotel.');
    await expect(sheet).toContainText('Pode não valer a pena se');
    await expect(sheet).toContainText('Sugerido');
    await expect(sheet).toContainText('Hallgrímskirkja');
    await expect(sheet).toContainText('Sugestão ampla');
    await expect(sheet.getByRole('button', { name: /Custos estimados/ })).toBeVisible();
    expect(calls.filter((k) => k === 'place_detail')).toHaveLength(1);
    await sheet.getByRole('button', { name: /Fechar/ }).first().click();
    await page.getByRole('button', { name: 'Montar o roteiro' }).click();

    // Passo 4: rota com ida, paradas e volta; + e − mantêm a soma
    const tl = page.getByTestId('route-timeline');
    await expect(tl).toContainText('GRU → Reykjavík');
    await expect(tl).toContainText('Höfn → GRU');
    await expect(page.getByText('Akureyri')).toBeVisible();
    await page.getByRole('button', { name: 'Uma noite a mais em Vík' }).click();
    await expect(page.getByLabel('3 noites em Vík')).toBeVisible();
    const nights = await page.locator('[aria-label$="noites em Reykjavík"], [aria-label$="noites em Vík"], [aria-label$="noites em Höfn"]').allInnerTexts();
    expect(nights.reduce((a, t) => a + parseInt(t, 10), 0)).toBe(8);
    // Custo por parada e de onde veio cada lugar
    await expect(page.locator('[data-stop="Reykjavík"]')).toContainText('por pessoa aqui');
    await expect(page.locator('[data-stop="Reykjavík"]')).toContainText('Indispensável');
    // Pedido de ajuste em texto: vai para a IA com o roteiro atual (já com a edição de Vík)
    await page.getByLabel('Ajuste que você quer no roteiro').fill('Höfn ficou com muitos dias');
    await page.getByRole('button', { name: 'Refazer com esse ajuste' }).click();
    await expect(page.getByTestId('route-timeline')).toBeVisible();
    const ask = calls.bodies.filter((x) => x.kind === 'route').at(-1) as { feedback?: string; current?: { name: string; nights: number }[] };
    expect(ask.feedback).toBe('Höfn ficou com muitos dias');
    expect(ask.current).toContainEqual({ name: 'Vík', nights: 3 });
    await page.getByRole('button', { name: 'Gostei, ver passeios' }).click();
    // A demo já tem roteiro: pede para substituir
    await page.getByRole('button', { name: 'Substituir' }).click();

    // Passo 5: baralho, um passeio por vez
    await expect(page.getByText('Passo 5 de 6')).toBeVisible();
    await page.getByRole('button', { name: 'Quero Bate-volta: Círculo Dourado' }).click();
    await page.getByRole('button', { name: 'Pular Lagoa glacial de barco' }).click();
    await page.getByRole('button', { name: 'Aceitar as recomendações da Trilha para o resto' }).click();
    await expect(page.getByText('Esses são os passeios que entram')).toBeVisible();
    await expect(page.getByRole('button', { name: /Bate-volta: Círculo Dourado/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Ver quanto custa' }).click();

    // Passo 6: orçamento completo
    await expect(page.getByText('Passo 6 de 6')).toBeVisible();
    const card = page.getByRole('region', { name: 'Quanto custa' });
    await expect(card).toContainText('Hospedagem · 8 noites');
    await expect(card).toContainText('Voos (2)');
    await expect(card).toContainText('Trechos entre cidades · 2');
    await expect(card).toContainText('Comida · 9 dias');
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page).toHaveURL(/\/demo\/islandia$/);

    // Roteiro: paradas novas e a volta para casa
    await page.getByRole('link', { name: 'Roteiro', exact: true }).first().click();
    await expect(page.getByRole('navigation', { name: 'Paradas' })).toContainText('Höfn');
    await expect(page.getByText(/Voo Höfn → GRU/)).toBeVisible();
    expect(calls.filter((c) => c === 'places')).toHaveLength(1);
    expect(calls.filter((c) => c === 'route')).toHaveLength(2);
  });

  test('lugar adicionado ganha resumo, desejos entram no roteiro, mapa e volta aos passos', async ({ page }) => {
    const wishRoute = {
      ...route,
      stops: route.stops.map((x) => (x.name === 'Vík'
        ? { ...x, wish: 'Geleira de crampon', why: 'Vila da praia de areia preta.' }
        : x.name === 'Reykjavík' ? { ...x, why: 'A capital, base de tudo.', day_trips: [{ ...x.day_trips[0], why: 'Gêiser, cachoeira e falha tectônica.', lat: 64.3, lng: -20.3 }] } : x)),
      left_out: [{ name: 'Akureyri', reason: 'Precisaria de 2 noites a mais.', sacrifice: 'Tirar Höfn', lat: 65.68, lng: -18.09 }],
      wishes: [
        { wish: 'Geleira de crampon', stop: 'Vík', how: 'Caminhada guiada na geleira, saindo de Vík.' },
        { wish: 'Ver baleias', stop: null, reason: 'Os passeios ficam no norte.', sacrifice: 'Tirar Höfn e ir até Húsavík' },
      ],
    };
    const calls = await mockAi(page, { route: wishRoute, detailStatus: 429 });
    await page.goto('/demo/islandia/montar?passo=3');
    await expect(page.locator('[data-place="Reykjavík"]')).toBeVisible();

    // 1) Lugar adicionado à mão: a IA corrige o nome e traz resumo e o que ver
    await page.getByLabel('Adicionar um lugar').fill('Westfjords');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    const added = page.locator('[data-place="Fiordes do Oeste"]');
    await expect(added).toContainText('Resumo de Fiordes do Oeste feito pela IA.');
    await expect(added.getByRole('radio', { name: 'Indispensável' })).toHaveAttribute('aria-checked', 'true');
    await added.getByRole('button', { name: 'Mais sobre Fiordes do Oeste' }).click();
    // Sem o detalhe (cota da IA), a janela mostra o que já sabe: resumo e o que ver da lista
    await expect(page.getByRole('dialog', { name: 'Fiordes do Oeste' })).toContainText('Mirante de Westfjords');
    await expect(page.getByRole('dialog', { name: 'Fiordes do Oeste' })).toContainText('Não deu pra carregar os detalhes agora.');
    await page.getByRole('dialog', { name: 'Fiordes do Oeste' }).getByRole('button', { name: /Fechar/ }).first().click();

    for (const w of ['Geleira de crampon', 'Ver baleias']) {
      await page.getByRole('textbox', { name: 'Desejo' }).fill(w);
      await page.getByRole('button', { name: 'Incluir', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Montar o roteiro' }).click();

    // 7) Desejos: o que entrou aparece na parada; o que não coube é dito e vem com o que sacrificar
    await expect(page.getByText('Passo 4 de 6')).toBeVisible();
    await expect(page.getByText('1 pedido seu não coube')).toBeVisible();
    await expect(page.locator('[data-stop="Vík"]')).toContainText('Geleira de crampon · você escolheu');
    await expect(page.locator('[data-stop="Vík"]')).toContainText('Caminhada guiada na geleira');
    const wishes = page.getByRole('region', { name: 'Seus pedidos' });
    await expect(wishes).toContainText('Não coube.');
    await expect(wishes).toContainText('Pra caber: Tirar Höfn e ir até Húsavík');

    // 5) Resumo da cidade no cartão e janela expandida
    await expect(page.locator('[data-stop="Reykjavík"]')).toContainText('Base perfeita para começar e terminar.');
    await page.locator('[data-stop="Reykjavík"]').getByRole('button', { name: 'Ver mais sobre Reykjavík' }).click();
    const rk = page.getByRole('dialog', { name: 'Reykjavík' });
    await expect(rk).toContainText('Hallgrímskirkja');
    await expect(rk).toContainText('Bate-voltas daqui');
    await rk.getByRole('button', { name: /Fechar/ }).first().click();

    // 2) Bate-volta abre a janela do lugar
    await page.getByRole('button', { name: 'O que é Círculo Dourado (bate-volta, dia 2)' }).click();
    const bv = page.getByRole('dialog', { name: 'Círculo Dourado' });
    await expect(bv).toContainText('Gêiser, cachoeira e falha tectônica.');
    await expect(bv).toContainText('Mirante de Círculo Dourado');
    await bv.getByRole('button', { name: /Fechar/ }).first().click();

    // 4 e 6) Mapa com a rota, o bate-volta e o que ficou de fora em destaque
    await expect(page.getByRole('region', { name: 'Mapa da rota sugerida' })).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon[title="Höfn"]')).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon[title="Círculo Dourado"]')).toBeVisible();
    const out = page.locator('[data-left-out="Akureyri"]');
    await expect(out).toContainText('Pra caber: Tirar Höfn');
    await out.getByRole('button', { name: 'Ver no mapa' }).click();
    await expect(out).toHaveAttribute('data-focus', 'true');
    await expect(page.locator('.leaflet-tooltip')).toContainText('Ficou de fora: Precisaria de 2 noites a mais.');
    await page.locator('.leaflet-marker-icon[title="Akureyri"]').click();
    await expect(page.getByRole('dialog', { name: 'Akureyri' })).toContainText('Por que ficou de fora');
    await page.getByRole('dialog', { name: 'Akureyri' }).getByRole('button', { name: /Fechar/ }).first().click();

    // Encaixar o desejo que não coube: vai como pedido de ajuste com o sacrifício
    await wishes.getByRole('button', { name: 'Trocar e encaixar' }).click();
    await expect(page.getByTestId('route-timeline')).toBeVisible();
    const ask = calls.bodies.filter((x) => x.kind === 'route').at(-1) as { feedback?: string; wishes?: string[] };
    expect(ask.feedback).toContain('"Ver baleias"');
    expect(ask.feedback).toContain('Tirar Höfn e ir até Húsavík');
    expect(ask.wishes).toEqual(['Geleira de crampon', 'Ver baleias']);

    // Navegação livre entre os passos já feitos
    await page.getByRole('button', { name: 'Passo 2: Vocês' }).click();
    await expect(page.getByText('Passo 2 de 6')).toBeVisible();
    await page.getByRole('button', { name: 'Passo 3: Lugares' }).click();
    await expect(page.locator('[data-place="Fiordes do Oeste"]')).toBeVisible();
    await page.getByRole('button', { name: 'Passo 4: Roteiro' }).click();
    await expect(page.getByTestId('route-timeline')).toBeVisible();
    expect(calls.filter((c) => c === 'route')).toHaveLength(2);
  });

  test('dormir numa cidade vizinha mais barata é opcional e vai para a parada', async ({ page }) => {
    const base = { name: 'Djúpivogur', country: 'Islândia', lat: 64.66, lng: -14.28, why: 'Vila de pescadores com pousadas mais baratas.', mode: 'car', minutes: 40, commute_pp_day: 8000, stay_pp_night: { equilibrado: { low: 15000, high: 20000 } } };
    const r = { ...route, stops: route.stops.map((x) => (x.name === 'Höfn' ? { ...x, stay_alt: base } : x)) };
    await mockAi(page, { route: r });
    await page.goto('/demo/islandia/montar?passo=4');
    const card = page.locator('[data-stop="Höfn"]');
    // (375 − 175) × 3 − 80 × 3 = R$ 360 de economia, já com o trajeto
    await expect(card.getByRole('group', { name: 'Onde dormir em Höfn' })).toContainText('Dormir em Djúpivogur economiza ≈ R$ 360 por pessoa');
    await expect(card.getByRole('radio', { name: 'Dormir em Höfn' })).toHaveAttribute('aria-checked', 'true');
    // Outras cidades não ganham sugestão
    await expect(page.locator('[data-stop="Vík"]').getByRole('group', { name: /Onde dormir/ })).toHaveCount(0);
    const before = await page.getByTestId('route-total').innerText();
    await card.getByRole('radio', { name: 'Dormir em Djúpivogur' }).click();
    await expect(card).toContainText('dormindo em Djúpivogur');
    await expect(card).toContainText('trajeto R$ 240');
    await expect(page.getByTestId('route-total')).not.toHaveText(before);
    await expect(page.locator('.leaflet-marker-icon[title="Djúpivogur"]')).toBeVisible();

    await page.getByRole('button', { name: 'Gostei, ver passeios' }).click();
    await page.getByRole('button', { name: 'Substituir' }).click();
    await expect(page.getByText('Passo 5 de 6')).toBeVisible();
    // Custo: o trajeto diário vira uma linha própria
    await page.getByRole('button', { name: 'Passo 6: Custo' }).click();
    await expect(page.getByRole('region', { name: 'Quanto custa' })).toContainText('Trajeto diário da cidade onde dormem · 1');
    // Roteiro e página da parada: a busca de hospedagem vai para a cidade vizinha
    await page.getByRole('link', { name: 'Roteiro', exact: true }).first().click();
    await expect(page.getByText(/dorme em Djúpivogur/).first()).toBeVisible();
    await page.getByRole('button', { name: /^Höfn .*dorme em Djúpivogur/ }).click();
    await expect(page.getByText('Dormem em Djúpivogur').first()).toBeVisible();
    await page.getByRole('link', { name: /Ver a cidade: Höfn/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Hospedagem em Djúpivogur' })).toBeVisible();
    await expect(page.getByText('Vocês escolheram dormir em')).toBeVisible();
  });

  test('sem IA, vai direto para o roteiro manual', async ({ page }) => {
    await mockAi(page, { placesStatus: 503 });
    await page.goto('/demo/marrocos/montar?passo=3');
    await expect(page.getByText('As sugestões estão indisponíveis agora.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Montar o roteiro eu mesmo' }).click();
    await expect(page).toHaveURL(/\/demo\/marrocos\/roteiro$/);
  });

  test('Orçamento mostra o voo de volta que falta e a faixa do total', async ({ page }) => {
    await page.goto('/demo/andes/dinheiro/orcamento');
    await expect(page.getByText(/Voo .+ → GRU/).first()).toBeVisible();
    await expect(page.getByTestId('budget-range')).toContainText('entre');
    await expect(page.getByText(/O voo de volta ainda não entra no total/)).toBeVisible();
  });

  test('sem rolagem horizontal no onboarding', async ({ page }) => {
    await mockAi(page);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/demo/japao/montar?passo=3');
      await expect(page.locator('[data-place="Reykjavík"]')).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
    }
  });
});
