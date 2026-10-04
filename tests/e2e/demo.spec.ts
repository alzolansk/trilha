import { expect, test } from '@playwright/test';

const KEYS = ['andes', 'japao', 'marrocos', 'islandia'] as const;
const TOKENS: Record<string, { bg: string; acc: string; deep: string; font: RegExp; dark: boolean }> = {
  andes: { bg: '#F3E6D3', acc: '#C8452C', deep: '#17403C', font: /Bricolage/, dark: false },
  japao: { bg: '#F5F0E6', acc: '#D7262E', deep: '#1E3A5F', font: /Shippori/, dark: false },
  marrocos: { bg: '#F6E9DA', acc: '#2A4BD7', deep: '#2A4BD7', font: /Gloock/, dark: false },
  islandia: { bg: '#0D1B21', acc: '#53F0A6', deep: '#132A31', font: /Big Shoulders/, dark: true },
};
const ROUTES = ['', '/roteiro', '/documentos', '/mala', '/diario', '/turma'];
const WIDTHS = [360, 390, 768, 1280, 1440];

test.describe('identidades e tokens', () => {
  for (const k of KEYS) {
    test(`tokens de ${k} aplicados no <html>`, async ({ page }) => {
      await page.goto(`/demo/${k}`);
      await page.waitForSelector('h1');
      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { bg: cs.getPropertyValue('--bg').trim(), acc: cs.getPropertyValue('--acc').trim(), deep: cs.getPropertyValue('--deep').trim(), font: cs.getPropertyValue('--font-display'), dark: document.documentElement.hasAttribute('data-dark'), body: getComputedStyle(document.body).backgroundColor };
      });
      expect(v.bg.toUpperCase()).toBe(TOKENS[k].bg);
      expect(v.acc.toUpperCase()).toBe(TOKENS[k].acc);
      expect(v.deep.toUpperCase()).toBe(TOKENS[k].deep);
      expect(v.font).toMatch(TOKENS[k].font);
      expect(v.dark).toBe(TOKENS[k].dark);
    });
  }

  test('trocar de trilha troca o tema sem sobrar cor anterior', async ({ page }) => {
    await page.goto('/demo/andes/roteiro');
    await page.waitForSelector('h1');
    await page.getByRole('button', { name: /Identidade/ }).click();
    await page.getByRole('menuitem', { name: /Islândia/ }).click();
    await page.waitForURL('**/demo/islandia');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase())).toBe('#0D1B21');
    const leftovers = await page.evaluate(() => {
      const bad = ['rgb(243, 230, 211)', 'rgb(200, 69, 44)', 'rgb(23, 64, 60)'];
      return Array.from(document.querySelectorAll('body *')).filter((el) => {
        const cs = getComputedStyle(el);
        return bad.includes(cs.backgroundColor) || bad.includes(cs.color);
      }).length;
    });
    expect(leftovers).toBe(0);
  });
});

test.describe('história de scroll do Início', () => {
  test('fenda abre conforme o scroll e rota acende em ordem', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo/andes');
    await page.waitForSelector('h1');
    const clip = () => page.evaluate(() => (document.querySelector('[class*=photo]') as HTMLElement).style.clipPath);
    expect(await clip()).toContain('polygon(50% 26%');
    await page.evaluate(() => window.scrollTo(0, innerHeight * 0.8));
    await page.waitForTimeout(400);
    const mid = await clip();
    expect(mid).not.toContain('50% 26%');
    const route = await page.evaluate(() => (document.querySelector('[aria-label="A rota"]') as HTMLElement).offsetTop);
    await page.evaluate((y) => window.scrollTo(0, y + innerHeight * 0.9), route);
    await page.waitForTimeout(500);
    const lit = await page.evaluate(() => Array.from(document.querySelectorAll('[data-rs]')).map((g) => (g as HTMLElement).style.opacity));
    expect(lit[0]).toBe('1');
    expect(lit.at(-1)).toBe('0.35');
    expect(lit.indexOf('0.35')).toBeGreaterThan(0);
  });

  test('reduced motion: foto aberta, contagem e conteúdo sem scroll vazio', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('/demo/islandia');
    await page.waitForSelector('h1');
    const r = await page.evaluate(() => ({ clip: (document.querySelector('[class*=photo]') as HTMLElement).style.clipPath, h: document.documentElement.scrollHeight, stats: document.querySelector('[data-stat] b')?.textContent }));
    expect(r.clip).toBe('none');
    expect(r.stats).not.toBe('0');
    expect(r.h).toBeLessThan(844 * 9);
    await expect(page.getByText(/Faltam \d+ dias para Islândia/)).toHaveCount(1);
    await ctx.close();
  });
});

test.describe('acessibilidade e teclado', () => {
  test('checkbox em motif funciona com teclado', async ({ page }) => {
    await page.goto('/demo/japao/mala');
    const box = page.getByRole('checkbox').first();
    const before = await box.isChecked();
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked({ checked: !before });
  });
  test('filtros com aria-pressed e parâmetro de URL', async ({ page }) => {
    await page.goto('/demo/andes/documentos?tipo=Identidade');
    await expect(page.getByRole('group', { name: 'Filtrar por tipo' }).getByRole('button', { name: /Identidade/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('article.ticket')).toHaveCount(3);
  });
  test('roteiro: ?parada= seleciona a parada', async ({ page }) => {
    await page.goto('/demo/andes/roteiro');
    await page.getByRole('button', { name: /Cusco/ }).first().click();
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
