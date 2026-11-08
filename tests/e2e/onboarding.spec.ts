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

async function mockAi(page: Page, opts: { placesStatus?: number } = {}) {
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
    if (body.kind === 'route') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { route, currency: 'BRL' }, by: 'ai' }) });
    if (body.kind === 'activities') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: activities, by: 'ai' }) });
    return r.fulfill({ status: 404, body: '{}' });
  });
  await page.route('**/api/photos*', (r) => r.fulfill({ contentType: 'application/json', body: 'null' }));
  return Object.assign(calls, { bodies });
}

test.describe('Onboarding roteirizado', () => {
  test('monta lugares, rota, passeios e orçamento de ponta a ponta', async ({ page }) => {
    const calls = await mockAi(page);
    await page.goto('/demo/islandia/montar?passo=2');
    await expect(page.getByText('Passo 2 de 6')).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();

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
    await expect(sheet.getByText('O que ver')).toBeVisible();
    await expect(sheet).toContainText('Hallgrímskirkja');
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
