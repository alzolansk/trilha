import { expect, test } from '@playwright/test';

const KEYS = ['andes', 'japao', 'marrocos', 'islandia'] as const;
// Trilha 2.0: identidade por destino virou uma cor só (lib/identity/accent.ts DICTIONARY_ACCENT).
const ACCENT: Record<string, string> = { andes: '#C8452C', japao: '#C2272D', marrocos: '#1F5FA8', islandia: '#1F6F8B' };
// Rotas da Trilha 2.0 (planning §4.3). A Fase 9 reescreve esta suíte com as telas novas.
const ROUTES = ['', '/roteiro', '/roteiro?vista=mapa', '/dinheiro', '/turma', '/turma/documentos', '/turma/mala', '/turma/diario', '/ajustes'];
const WIDTHS = [360, 390, 768, 1280, 1440];
// Mesmo gerador de ids da demo (lib/demo/build.ts), para abrir a página de uma parada direto.
const demoId = (k: string, kind: string, i: number) => {
  const h = Array.from(`${k}:${kind}:${i}`).reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  return `d${h.toString(16).padStart(7, '0').slice(0, 7)}-0000-4000-8000-${String(i).padStart(12, '0').slice(-12)}`;
};
const CUSCO = demoId('andes', 'stop', 1);

test.describe('visual fixo e accent por trilha', () => {
  for (const k of KEYS) {
    test(`accent de ${k} aplicado no <html>, tokens fixos`, async ({ page }) => {
      await page.goto(`/demo/${k}`);
      await page.waitForSelector('main h1, main h2');
      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { bg: cs.getPropertyValue('--bg').trim(), brand: cs.getPropertyValue('--brand').trim(), accent: cs.getPropertyValue('--trip-accent').trim(), body: getComputedStyle(document.body).backgroundColor };
      });
      expect(v.bg.toUpperCase()).toBe('#F5F6F8');
      expect(v.brand.toUpperCase()).toBe('#2B3FF5');
      expect(v.accent.toUpperCase()).toBe(ACCENT[k]);
      expect(v.body).toBe('rgb(245, 246, 248)');
    });
  }

  test('trocar de trilha pelo seletor troca o accent', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('button', { name: /Trilha atual/ }).click();
    await page.getByRole('dialog').getByRole('link', { name: /Islândia/ }).click();
    await page.waitForURL('**/demo/islandia');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--trip-accent').trim().toUpperCase())).toBe(ACCENT.islandia);
  });
});

test.describe('shell e navegação (Fase 2)', () => {
  test('4 abas no celular, aba ativa marcada', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes');
    const tabs = page.getByRole('navigation', { name: 'Abas' });
    await expect(tabs.getByRole('link')).toHaveCount(4);
    for (const [name, path] of [['Roteiro', '/roteiro'], ['Dinheiro', '/dinheiro'], ['Turma', '/turma'], ['Início', '']] as const) {
      await tabs.getByRole('link', { name }).click();
      await page.waitForURL(`**/demo/andes${path}`);
      await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    }
  });
  test('links antigos redirecionam', async ({ page }) => {
    for (const [from, to] of [['/mala', '/turma/mala'], ['/documentos?tipo=Identidade', '/turma/documentos?tipo=Identidade'], ['/diario', '/turma/diario'], ['/editar', '/ajustes'], ['/explorar', '/descobrir']]) {
      await page.goto(`/demo/andes${from}`);
      await expect(page).toHaveURL(new RegExp(`/demo/andes${to.replace('?', '\\?')}$`));
    }
  });
  test('Voltar fecha o Sheet sem sair da tela', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes/turma');
    await page.goto('/demo/andes');
    await page.getByRole('button', { name: 'Demonstrações' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/demo\/andes$/);
  });
});

test.describe('Início (Fase 4)', () => {
  test('hero com contagem para a primeira parada e cartão do dinheiro com os números da demo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes');
    await expect(page.locator('[aria-label$="dias para Lima"]')).toBeVisible();
    await expect(page.getByText('Peru + Bolívia · 15 → 31 jan')).toBeVisible();
    const money = page.getByRole('region', { name: 'Dinheiro da turma' });
    await expect(money.getByText('R$ 9.360')).toBeVisible();
    await expect(money.getByText('juntados, de R$ 19.410 planejados')).toBeVisible();
    await expect(money.getByText('48%')).toBeVisible();
  });

  test('sugestões: 3 visíveis, a grande primeiro, "ver todas" abre a lista no Sheet', async ({ page }) => {
    await page.goto('/demo/andes');
    const sec = page.getByRole('region', { name: 'Hoje a Trilha sugere' });
    await expect(sec.locator('article h3').first()).toHaveText('Montanha Colorida, saindo de Cusco');
    await expect(sec.getByText('Passeio · cabe no dia 6')).toBeVisible();
    await expect(sec.getByText('ESTIMATIVA')).toBeVisible();
    await sec.getByRole('button', { name: /ver todas/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Tudo que a Trilha sugere' });
    await expect(dlg.getByRole('link')).toHaveCount(9);
  });

  test('"Pôr no dia 6" cria a atividade e o cartão some', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes');
    const sec = page.getByRole('region', { name: 'Hoje a Trilha sugere' });
    await sec.getByRole('button', { name: 'Pôr no dia 6' }).click();
    await expect(page.getByText('Montanha Colorida, saindo de Cusco entrou no dia 6.')).toBeVisible();
    await expect(sec.getByRole('heading', { name: 'Montanha Colorida, saindo de Cusco' })).toHaveCount(0);
    // o próximo passeio que cabe vira o cartão grande
    await expect(sec.locator('article h3').first()).toHaveText('Circuito Mágico del Agua');
    await page.getByRole('navigation', { name: 'Abas' }).getByRole('link', { name: 'Roteiro' }).click();
    await page.waitForURL('**/demo/andes/roteiro');
    await page.getByRole('navigation', { name: 'Paradas' }).getByRole('button', { name: 'Cusco' }).click();
    await expect(page.getByRole('article', { name: 'Parada Cusco' }).getByText('Montanha Colorida, saindo de Cusco')).toBeVisible();
  });

  test('dispensar tira a sugestão', async ({ page }) => {
    await page.goto('/demo/andes');
    const sec = page.getByRole('region', { name: 'Hoje a Trilha sugere' });
    await sec.getByRole('button', { name: 'Dispensar sugestão' }).click();
    await expect(page.getByText('Sugestão dispensada.')).toBeVisible();
    await expect(sec.getByRole('heading', { name: 'Montanha Colorida, saindo de Cusco' })).toHaveCount(0);
  });

  test('reduced motion: Início sem scroll vazio e com a contagem', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('/demo/islandia');
    await expect(page.locator('[aria-label*="dias para"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(844 * 4);
    await ctx.close();
  });
});

test.describe('acessibilidade e teclado', () => {
  test('checkbox funciona com teclado', async ({ page }) => {
    await page.goto('/demo/japao/turma/mala');
    const box = page.getByRole('checkbox').first();
    const before = await box.isChecked();
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked({ checked: !before });
  });
  test('filtros com aria-pressed e parâmetro de URL', async ({ page }) => {
    await page.goto('/demo/andes/turma/documentos?tipo=Identidade');
    await expect(page.getByRole('group', { name: 'Filtrar por tipo' }).getByRole('button', { name: /Identidade/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('article.ticket')).toHaveCount(3);
  });
  test('roteiro: link antigo ?parada= abre a página da parada', async ({ page }) => {
    await page.goto(`/demo/andes/roteiro?parada=${CUSCO}`);
    await expect(page).toHaveURL(new RegExp(`/demo/andes/roteiro/${CUSCO}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Cusco' })).toBeVisible();
  });
});

test.describe('sem rolagem horizontal', () => {
  for (const w of WIDTHS) {
    test(`${w}px em todas as telas`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const k of ['andes', 'islandia']) {
        for (const r of ROUTES) {
          await page.goto(`/demo/${k}${r}`);
          await page.waitForSelector('main h1, main h2');
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(over, `${k}${r} @${w}`).toBeLessThanOrEqual(0);
        }
      }
    });
  }
});

test.describe('votação da turma', () => {
  test('reagir a uma inspiração muda a contagem', async ({ page }) => {
    await page.goto('/demo/andes/turma/diario?momento=antes');
    await page.getByRole('button', { name: 'Abrir inspirações de Cusco' }).click();
    const muito = page.getByRole('dialog').getByRole('button', { name: /^Quero muito, 1 pessoa$/ });
    await expect(muito).toHaveAttribute('aria-pressed', 'false');
    await muito.click();
    const after = page.getByRole('dialog').getByRole('button', { name: /^Quero muito, 2 pessoas$/ });
    await expect(after).toHaveAttribute('aria-pressed', 'true');
    await after.click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Quero muito, 1 pessoa$/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('levar inspiração ao roteiro cria a atividade na parada', async ({ page }) => {
    await page.goto('/demo/andes/turma/diario?momento=antes');
    await page.getByRole('button', { name: 'Abrir inspirações de Cusco' }).click();
    await page.getByRole('button', { name: 'Levar pro roteiro' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Levar pro roteiro' });
    await dlg.getByLabel('Dia').selectOption('2027-01-21');
    await dlg.getByRole('button', { name: 'Levar pro roteiro' }).click();
    await expect(page.getByText('Foi pro roteiro de Cusco.')).toBeVisible();
    await page.getByRole('link', { name: 'NO ROTEIRO · 21 JAN' }).click();
    await expect(page).toHaveURL(new RegExp(`/roteiro/${CUSCO}$`));
    const tour = page.getByRole('region', { name: 'Passeios' }).locator('article', { hasText: 'Mercado de San Pedro' });
    await expect(tour.getByText('No roteiro · dia 7')).toBeVisible();
  });

  test('votar na enquete da demo só com teclado', async ({ page }) => {
    await page.goto('/demo/andes/turma');
    const card = page.locator('article', { has: page.getByRole('heading', { name: 'Onde dormir em Aguas Calientes?' }) });
    await expect(card.getByText('2 de 3 votaram')).toBeVisible();
    await card.getByRole('radio', { name: 'Hostel Pirwa' }).focus();
    await page.keyboard.press('Space');
    await expect(card.getByRole('radio', { name: 'Hostel Pirwa' })).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(card.getByRole('radio', { name: 'Pousada Inti Wasi' })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Votar' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Voto registrado.')).toBeVisible();
    await expect(card.getByText('3 de 3 votaram')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Retirar voto' })).toBeVisible();
  });

  test('decidir a hospedagem vira "ESCOLHIDA NA VOTAÇÃO" no roteiro', async ({ page }) => {
    await page.goto('/demo/andes/turma');
    const card = page.locator('article', { has: page.getByRole('heading', { name: 'Onde dormir em Aguas Calientes?' }) });
    await card.getByRole('button', { name: 'Decidir' }).click();
    const dlg = page.getByRole('dialog', { name: 'Decidir' });
    await expect(dlg.getByText('Empate entre Hostel Pirwa e Pousada Inti Wasi. Você desempata.')).toBeVisible();
    await dlg.locator('label', { hasText: 'Casa de família' }).click();
    await expect(dlg.getByRole('radio', { name: 'Casa de família' })).toBeChecked();
    await expect(dlg.getByText('Essa não foi a mais votada.')).toBeVisible();
    await dlg.locator('label', { hasText: 'Hostel Pirwa' }).click();
    await dlg.getByRole('button', { name: 'Confirmar decisão' }).click();
    await expect(page.getByText('Decidido. Hostel Pirwa virou a hospedagem de Machu Picchu.')).toBeVisible();
    await page.getByText(/^Encerradas \(2\)$/).click();
    await page.getByRole('link', { name: 'Ver hospedagem no roteiro' }).click();
    await expect(page).toHaveURL(new RegExp(`/roteiro/${demoId('andes', 'stop', 2)}$`));
    const stay = page.getByRole('region', { name: 'Hospedagem em Machu Picchu' });
    await expect(stay.getByText('Escolhida na votação')).toBeVisible();
    await expect(stay.getByText('Hostel Pirwa', { exact: true })).toBeVisible();
  });

  test('Turma sem rolagem horizontal com encerradas abertas', async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/demo/andes/turma');
      await page.getByText(/^Encerradas \(1\)$/).click();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `turma @${w}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('lembretes de votação', () => {
  test('Início mostra "Falta você votar" só enquanto não votei', async ({ page }) => {
    await page.goto('/demo/andes');
    const sec = page.getByRole('region', { name: 'Hoje a Trilha sugere' });
    await expect(sec.getByText('Falta você votar')).toBeVisible();
    await sec.getByRole('link', { name: /Onde dormir em Aguas Calientes\?/ }).click();
    await expect(page).toHaveURL(/turma\/votos$/);
    const card = page.locator('article', { has: page.getByRole('heading', { name: 'Onde dormir em Aguas Calientes?' }) });
    await card.locator('label', { hasText: 'Pousada Inti Wasi' }).click();
    await card.getByRole('button', { name: 'Votar' }).click();
    await expect(page.getByText('Voto registrado.')).toBeVisible();
    await page.getByRole('link', { name: 'Início' }).first().click();
    await expect(sec.getByText('Pousada em Aguas Calientes sem reserva')).toBeVisible();
    await expect(sec.getByText('Falta você votar')).toHaveCount(0);
  });
});

test.describe('Roteiro e Parada (Fase 5)', () => {
  test('roteiro: faixa de paradas, parada em foco com capa, trecho com preço e selos', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes/roteiro');
    await expect(page.getByRole('heading', { level: 1, name: 'Roteiro' })).toBeVisible();
    await expect(page.getByRole('main').getByText('17 dias · 6 paradas · 9 sugestões esperando').first()).toBeVisible();
    const strip = page.getByRole('navigation', { name: 'Paradas' });
    await expect(strip.getByRole('button', { name: 'Lima' })).toHaveAttribute('aria-current', 'true');
    await strip.getByRole('button', { name: 'Cusco' }).click();
    const cusco = page.getByRole('article', { name: 'Parada Cusco' });
    await expect(cusco.getByRole('link', { name: 'Ver a cidade: Cusco, fiquem em San Blas' })).toHaveAttribute('href', `/demo/andes/roteiro/${CUSCO}`);
    await expect(page.getByRole('button', { name: /Trecho: Voo Lima → Cusco/ })).toContainText('R$ 1.450 / pessoa');
    await expect(page.getByRole('button', { name: /Trecho: Voo Lima → Cusco/ })).toContainText('não reservado');
    await expect(page.getByRole('article', { name: 'Parada Lima' })).toContainText('pronto');
    await expect(page.getByRole('article', { name: 'Parada Machu Picchu' })).toContainText('em votação');
    // dia com folga: sugestão tracejada com +; dia 6 vazio: 3 opções
    await expect(cusco.getByRole('button', { name: 'Adicionar Sacsayhuamán ao dia 4' })).toBeVisible();
    await expect(cusco.getByText('A Trilha separou 3 opções para esse dia:')).toBeVisible();
    await expect(cusco.getByText('Trem para Machu Picchu ainda não reservado')).toBeVisible();
  });

  test('"+" no dia com folga põe a sugestão no dia', async ({ page }) => {
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('navigation', { name: 'Paradas' }).getByRole('button', { name: 'Cusco' }).click();
    const cusco = page.getByRole('article', { name: 'Parada Cusco' });
    await cusco.getByRole('button', { name: 'Adicionar Sacsayhuamán ao dia 4' }).click();
    await expect(page.getByText('Sacsayhuamán entrou no dia 4.')).toBeVisible();
    await expect(cusco.getByRole('button', { name: 'Sacsayhuamán. Editar atividade' })).toBeVisible();
  });

  test('"Mandar as 3 para votação" cria a enquete de passeio com preço', async ({ page }) => {
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('navigation', { name: 'Paradas' }).getByRole('button', { name: 'Cusco' }).click();
    await page.getByRole('button', { name: 'Mandar as 3 para votação' }).click();
    await expect(page.getByText('Votação criada com os preços. A turma vota em Turma › Votos.')).toBeVisible();
    await page.getByRole('navigation', { name: /Abas|Principal/ }).getByRole('link', { name: 'Turma' }).first().click();
    await page.getByRole('main').getByRole('link', { name: /^Votos/ }).first().click();
    await page.waitForURL('**/turma/votos');
    const card = page.locator('article', { has: page.getByRole('heading', { name: 'Qual passeio em Cusco?' }) });
    await expect(card).toBeVisible();
    for (const o of ['Montanha Colorida, saindo de Cusco', 'Laguna Humantay', 'Aula de cozinha peruana']) await expect(card.getByText(o, { exact: true })).toBeVisible();
    await expect(card.getByText(/R\$\s?150/)).toBeVisible();
  });

  test('mapa: ?vista=mapa mostra o mapa no celular', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('radio', { name: 'Mapa' }).click();
    await expect(page).toHaveURL(/vista=mapa/);
    await expect(page.getByRole('region', { name: 'Mapa interativo das paradas' })).toBeVisible();
  });

  test('parada: capa, fatos, bairro escolhido com Bom/Atenção e passeios', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/demo/andes/roteiro/${CUSCO}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Cusco' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Capa de Cusco' }).getByText('Parada 2 de 6 · 17 → 21 jan · 4 noites')).toBeVisible();
    await expect(page.getByRole('main').getByText('3.400 m', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('main').getByText('sol (PEN)', { exact: true }).first()).toBeVisible();
    const chosen = page.getByRole('article', { name: 'Bairro escolhido: San Blas' });
    await expect(chosen.getByText('Fiquem aqui')).toBeVisible();
    await expect(chosen.getByText('ladeira com mala')).toBeVisible();
    await expect(page.getByRole('button', { name: /Centro histórico/ })).toBeVisible();
    const tours = page.getByRole('region', { name: 'Passeios' });
    await expect(tours.locator('article h3').first()).toHaveText('Montanha Colorida, saindo de Cusco');
    await expect(tours.getByText('Bia salvou no Diário')).toBeVisible();
    await expect(tours.getByRole('button', { name: 'Pôr no dia 6' })).toBeVisible();
    await expect(tours.locator('article', { hasText: 'Vale Sagrado' }).getByText('No roteiro · dia 5')).toBeVisible();
  });

  test('parada: links de hospedagem abrem a busca já filtrada (bairro, datas, pessoas, teto)', async ({ page }) => {
    await page.goto(`/demo/andes/roteiro/${CUSCO}`);
    const stay = page.getByRole('region', { name: 'Hospedagem em San Blas' });
    const booking = new URL((await stay.getByRole('link', { name: /Abrir no Booking/ }).getAttribute('href'))!);
    expect(booking.hostname).toBe('www.booking.com');
    expect(booking.searchParams.get('ss')).toBe('San Blas, Cusco, Peru');
    expect(booking.searchParams.get('checkin')).toBe('2027-01-17');
    expect(booking.searchParams.get('checkout')).toBe('2027-01-21');
    expect(booking.searchParams.get('group_adults')).toBe('3');
    expect(booking.searchParams.get('nflt')).toMatch(/^price=BRL-0-\d+-1$/);
    const airbnb = new URL((await stay.getByRole('link', { name: /Abrir no Airbnb/ }).getAttribute('href'))!);
    expect(decodeURIComponent(airbnb.pathname)).toContain('San Blas, Cusco, Peru');
    expect(airbnb.searchParams.get('adults')).toBe('3');
    expect(Number(airbnb.searchParams.get('price_max'))).toBeGreaterThan(0);
    await expect(stay.getByRole('link', { name: /Abrir no Airbnb/ })).toHaveAttribute('target', '_blank');
    // ajustar os filtros muda o link
    await stay.getByRole('button', { name: /3 adultos/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Filtros da busca' });
    await dlg.getByLabel('Pessoas (adultos)').fill('2');
    await dlg.getByRole('button', { name: 'Aplicar' }).click();
    await expect(stay.getByRole('button', { name: /2 adultos/ })).toBeVisible();
    expect(new URL((await stay.getByRole('link', { name: /Abrir no Booking/ }).getAttribute('href'))!).searchParams.get('group_adults')).toBe('2');
  });

  test('parada: colar um link manda a hospedagem para a votação', async ({ page }) => {
    await page.goto(`/demo/andes/roteiro/${CUSCO}`);
    await page.getByLabel(/Achou um\? Cole o link aqui/).fill('https://www.airbnb.com.br/rooms/123');
    await page.getByRole('button', { name: 'Mandar', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Mandar pra votação' });
    await dlg.getByLabel('Nome').fill('Casa azul em San Blas');
    await dlg.getByLabel('Preço por noite').fill('210');
    await dlg.getByRole('button', { name: 'Mandar pra votação' }).click();
    await expect(page.getByText('Foi pra votação de hospedagem. A turma vota em Turma › Votos.')).toBeVisible();
    await page.getByRole('navigation', { name: /Abas|Principal/ }).getByRole('link', { name: 'Turma' }).first().click();
    await page.getByRole('main').getByRole('link', { name: /^Votos/ }).first().click();
    await page.waitForURL('**/turma/votos');
    await expect(page.locator('article', { has: page.getByRole('heading', { name: 'Onde dormir em Cusco?' }) }).getByText('Casa azul em San Blas', { exact: true })).toBeVisible();
  });

  test('parada: escolher um bairro troca o "Fiquem aqui"', async ({ page }) => {
    await page.goto(`/demo/andes/roteiro/${CUSCO}`);
    await page.getByRole('button', { name: /San Pedro/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'San Pedro' });
    await dlg.getByRole('button', { name: 'Escolher este bairro' }).click();
    await expect(page.getByText('Fiquem em San Pedro. A busca de hospedagem já usa o bairro.')).toBeVisible();
    await expect(page.getByRole('article', { name: 'Bairro escolhido: San Pedro' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Hospedagem em San Pedro' })).toBeVisible();
  });

  test('parada sem rolagem horizontal de 360 a 1440 px', async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`/demo/andes/roteiro/${CUSCO}`);
      await page.waitForSelector('main h1');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `parada @${w}`).toBeLessThanOrEqual(0);
    }
  });
});
