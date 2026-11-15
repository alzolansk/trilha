import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`exportação completa fica recolhida nos ajustes e baixa JSON atualizado (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo/andes/ajustes');
    const advanced = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Opções avançadas' }) });
    const button = page.getByRole('button', { name: 'Exportar viagem completa (JSON)' });
    await expect(button).toBeHidden();

    await page.getByLabel('Nome da trilha', { exact: true }).fill('Férias nos Andes');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Trilha atualizada.', { exact: true })).toBeVisible();
    await advanced.locator('summary').click();
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('exportacao.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const waiting = page.waitForEvent('download');
    await button.click();
    const download = await waiting;
    expect(download.suggestedFilename()).toMatch(/^trilha-ferias-nos-andes-.+\.json$/);
    const file = await download.path();
    expect(file).toBeTruthy();
    const context = JSON.parse(await readFile(file!, 'utf8'));
    expect(context.data.trip.title).toBe('Férias nos Andes');
    expect(context.data.stops.length).toBeGreaterThan(0);
    expect(context.data.expenses.length).toBeGreaterThan(0);
    expect(context.data.journalEntries.length).toBeGreaterThan(0);
    expect(context.data).not.toHaveProperty('documentKeys');
    expect(context.source).toBe('demo');
  });
}
