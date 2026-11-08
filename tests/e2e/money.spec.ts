import { expect, test } from '@playwright/test';

test.describe('Dinheiro · Fase 6', () => {
  test('gasto ligado baixa caixa, sobe categoria e marca atividade; edição mantém vínculo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/andes/dinheiro');
    await expect(page.getByTestId('pool-balance')).toHaveText('R$ 3.850');
    await page.getByRole('button', { name: 'Lançar gasto ou aporte' }).click();
    await page.getByRole('button', { name: 'Gasto', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Lançar gasto', exact: true });
    await sheet.getByLabel('Descrição', { exact: true }).fill('Vale Sagrado');
    await sheet.getByRole('button', { name: /Vale Sagrado.*ligar ao roteiro/ }).click();
    await sheet.getByLabel('Valor do gasto').fill('300');
    await expect(sheet.getByText(/Caixa fica com R\$ 3.550/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Salvar e marcar como pago' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('pool-balance')).toHaveText('R$ 3.550');
    await expect(page.getByRole('button', { name: /Categoria Passeios/ })).toContainText('Acabou de baixar: Vale Sagrado');
    await page.getByRole('link', { name: 'Ver extrato', exact: true }).click();
    await page.getByRole('button', { name: /^Abrir Vale Sagrado/ }).click();
    const edit = page.getByRole('dialog', { name: 'Editar gasto' });
    await expect(edit.getByText(/Ligado ao roteiro/)).toBeVisible();
    await expect(edit.getByLabel('Valor do gasto')).toHaveValue('300');
    await edit.getByLabel('Valor do gasto').fill('400');
    await edit.getByRole('button', { name: 'Salvar e marcar como pago' }).click();
    await page.getByRole('navigation', { name: 'Abas' }).getByRole('link', { name: 'Dinheiro' }).click();
    await expect(page.getByTestId('pool-balance')).toHaveText('R$ 3.450');
    await page.getByRole('navigation', { name: 'Abas' }).getByRole('link', { name: 'Roteiro' }).click();
    await page.getByRole('navigation', { name: 'Paradas' }).getByRole('button', { name: 'Cusco', exact: true }).click();
    await page.getByRole('button', { name: /Vale Sagrado.*Editar atividade/ }).click();
    await expect(page.getByRole('dialog', { name: 'Atividade', exact: true }).getByText('Pago ✓', { exact: true })).toBeVisible();
  });

  test('aporte altera juntado e a situação pessoal; cota zero é válida', async ({ page }) => {
    await page.goto('/demo/andes/dinheiro');
    await page.getByRole('button', { name: 'Aporte no caixa', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Aporte no caixa' });
    await sheet.getByRole('button', { name: /O que falta/ }).click();
    await expect(sheet.getByText(/em dia ✓/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Salvar aporte' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('region', { name: 'Resumo do dinheiro' })).toContainText('R$ 11.930');
    await expect(page.getByRole('region', { name: 'Cada um no caixa' })).toContainText('R$ 6.470');
    await page.getByRole('button', { name: 'Definir cotas' }).click();
    const quotas = page.getByRole('dialog', { name: 'Definir cotas' });
    await quotas.locator('input').first().fill('0');
    await quotas.getByRole('button', { name: 'Salvar cotas' }).click();
    await expect(page.getByRole('region', { name: 'Cada um no caixa' })).toContainText('sem meta');
  });

  test('orçamento troca estilo e comida, fecha, reabre e cria votação', async ({ page }) => {
    await page.goto('/demo/andes/dinheiro/orcamento');
    const total = page.getByTestId('budget-total');
    await page.getByRole('button', { name: /^Hostel/ }).click();
    const hostel = await total.innerText();
    await page.getByRole('button', { name: /^Hotel/ }).click();
    await expect(total).not.toHaveText(hostel);
    const hotel = await total.innerText();
    await page.getByRole('button', { name: /^Solto/ }).click();
    await expect(total).not.toHaveText(hotel);
    await page.getByRole('button', { name: 'Fechar orçamento e abrir o caixa' }).click();
    await expect(page).toHaveURL(/\/dinheiro$/);
    await page.getByRole('link', { name: 'Rever orçamento' }).click();
    await expect(page.getByRole('button', { name: /^Hotel/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Solto/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('link', { name: 'Turma', exact: true }).click();
    await page.getByRole('link', { name: /^Ver todas/ }).click();
    await expect(page.getByText(/Aprovar orçamento de/).first()).toBeVisible();
  });

  test('moeda sem cotação exige taxa manual; rateio diferente valida soma', async ({ page }) => {
    await page.route('**/api/fx?*', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"Sem cotação"}' }));
    await page.goto('/demo/andes/dinheiro');
    await page.getByRole('button', { name: 'Lançar gasto', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Lançar gasto', exact: true });
    await sheet.getByRole('button', { name: 'PEN', exact: true }).click();
    await sheet.getByLabel('Valor do gasto').fill('100');
    await sheet.getByLabel('Descrição', { exact: true }).fill('Jantar de teste');
    await expect(sheet.getByRole('button', { name: 'Salvar gasto' })).toBeDisabled();
    await sheet.getByLabel('Usar taxa manual').check();
    await sheet.getByLabel('1 PEN vale quantos BRL?').fill('1,5');
    await expect(sheet.getByText(/≈ R\$ 150,00/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Você', exact: true }).click();
    await sheet.getByRole('button', { name: 'Valores diferentes', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Salvar gasto' })).toBeDisabled();
    await sheet.getByLabel('Você (BRL)', { exact: true }).fill('150');
    await expect(sheet.getByRole('button', { name: 'Salvar gasto' })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Salvar gasto' }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('link', { name: 'Ver extrato', exact: true }).click();
    await expect(page.getByText(/S\/.*100/).first()).toBeVisible();
  });

  test('telas financeiras não transbordam; capturas mobile e desktop', async ({ page }) => {
    for (const width of [360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['', '/orcamento', '/extrato', '/acerto']) {
        await page.goto(`/demo/andes/dinheiro${route}`);
        await expect(page.locator('main h1')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if ([390, 1280].includes(width) && ['', '/orcamento'].includes(route)) await page.screenshot({ path: `tmp/phase6-${route ? 'orcamento' : 'dinheiro'}-${width}.png`, fullPage: true });
      }
    }
  });

  test('lembretes não duplicam e o CSV respeita os filtros', async ({ page }) => {
    await page.goto('/demo/andes/dinheiro');
    await page.getByRole('button', { name: 'Lembrar quem está atrasado' }).click();
    await expect(page.getByText('Lembretes criados para quem está atrasado.')).toBeVisible();
    await page.getByRole('button', { name: 'Lembrar quem está atrasado' }).click();
    await page.getByRole('link', { name: 'Turma', exact: true }).click();
    await page.getByRole('link', { name: 'Abrir a mala' }).click();
    await expect(page.getByText('Aporte de R$ 3.230 no caixa', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Aporte de R$ 4.250 no caixa', { exact: true })).toHaveCount(1);
    await page.getByRole('link', { name: 'Dinheiro', exact: true }).click();
    await page.getByRole('link', { name: 'Ver extrato', exact: true }).click();
    await page.getByRole('button', { name: 'Aportes e devoluções' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('trilha-extrato.csv');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain('Aporte');
    expect(csv).not.toContain(';Gasto;');
  });
});
