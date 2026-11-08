import { expect, test } from '@playwright/test';

const KEYS = ['andes', 'japao', 'marrocos', 'islandia'] as const;
// Trilha 2.0: identidade por destino virou uma cor só (lib/identity/accent.ts DICTIONARY_ACCENT).
const ACCENT: Record<string, string> = { andes: '#C8452C', japao: '#C2272D', marrocos: '#1F5FA8', islandia: '#1F6F8B' };
// Rotas da Trilha 2.0 (planning §4.3). A Fase 9 reescreve esta suíte com as telas novas.
const ROUTES = ['', '/roteiro', '/dinheiro', '/turma', '/turma/documentos', '/turma/mala', '/turma/diario', '/ajustes'];
const WIDTHS = [360, 390, 768, 1280, 1440];

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
    await expect(dlg.getByRole('link')).toHaveCount(6);
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
    await page.getByRole('button', { name: /^CUZ/ }).click();
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
  test('roteiro: ?parada= seleciona a parada', async ({ page }) => {
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('button', { name: /^CUZ/ }).click();
    await expect(page).toHaveURL(/parada=/);
    await expect(page.getByRole('heading', { level: 2, name: 'Cusco' })).toBeVisible();
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
    await expect(page).toHaveURL(/roteiro\?parada=/);
    const item = page.locator('li', { hasText: 'Mercado de San Pedro' }).filter({ hasText: 'DA INSPIRAÇÃO' });
    await expect(item).toBeVisible();
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
    await expect(page).toHaveURL(/roteiro\?parada=/);
    await expect(page.getByText('ESCOLHIDA NA VOTAÇÃO')).toBeVisible();
    await expect(page.getByText('Hostel Pirwa', { exact: true })).toBeVisible();
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
