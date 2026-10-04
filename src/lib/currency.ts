// Moeda por país (nomes em pt-BR, sem acento) para sugerir moedas locais no conversor.
import { normalize } from './format';

const BY_COUNTRY: Record<string, string> = {
  brasil: 'BRL', peru: 'PEN', bolivia: 'BOB', chile: 'CLP', argentina: 'ARS', uruguai: 'UYU', paraguai: 'PYG', colombia: 'COP',
  equador: 'USD', venezuela: 'VES', mexico: 'MXN', 'estados unidos': 'USD', eua: 'USD', canada: 'CAD', cuba: 'CUP', 'costa rica': 'CRC',
  panama: 'PAB', guatemala: 'GTQ', japao: 'JPY', china: 'CNY', 'coreia do sul': 'KRW', tailandia: 'THB', vietna: 'VND', indonesia: 'IDR',
  india: 'INR', nepal: 'NPR', 'sri lanka': 'LKR', filipinas: 'PHP', malasia: 'MYR', singapura: 'SGD', camboja: 'KHR', marrocos: 'MAD',
  egito: 'EGP', 'africa do sul': 'ZAR', quenia: 'KES', tanzania: 'TZS', turquia: 'TRY', israel: 'ILS', jordania: 'JOD', 'emirados arabes': 'AED',
  islandia: 'ISK', noruega: 'NOK', suecia: 'SEK', dinamarca: 'DKK', finlandia: 'EUR', 'reino unido': 'GBP', inglaterra: 'GBP', escocia: 'GBP',
  irlanda: 'EUR', portugal: 'EUR', espanha: 'EUR', franca: 'EUR', italia: 'EUR', alemanha: 'EUR', holanda: 'EUR', 'paises baixos': 'EUR',
  belgica: 'EUR', austria: 'EUR', grecia: 'EUR', croacia: 'EUR', suica: 'CHF', polonia: 'PLN', 'republica tcheca': 'CZK', hungria: 'HUF',
  australia: 'AUD', 'nova zelandia': 'NZD',
};

const SYMBOLS: Record<string, string> = { BRL: 'R$', PEN: 'S/', BOB: 'Bs', JPY: '¥', MAD: 'DH', ISK: 'kr', USD: 'US$', EUR: '€', GBP: '£', CLP: 'CLP$', ARS: 'AR$' };

export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const n = normalize(country.split('·')[0].trim());
  return BY_COUNTRY[n] ?? null;
}
export const currencySymbol = (code: string) => SYMBOLS[code] ?? code;
