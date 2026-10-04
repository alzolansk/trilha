import { defineConfig } from '@playwright/test';

// Usa o Chrome instalado (channel) para não baixar navegadores.
// BASE_URL aponta para um servidor já rodando; sem ele, sobe "next start" (rode "npm run build" antes).
const base = process.env.BASE_URL ?? 'http://localhost:3200';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: base, channel: 'chrome', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  webServer: process.env.BASE_URL ? undefined : { command: 'npx next start -p 3200', url: base, reuseExistingServer: true, timeout: 120_000 },
});
