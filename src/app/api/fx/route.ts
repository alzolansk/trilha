import { NextResponse, type NextRequest } from 'next/server';

// Cotações gratuitas com cache de 6h no servidor.
// 1º ExchangeRate-API "open access" (sem chave, exige atribuição); 2º fawazahmed0/currency-api (jsDelivr).
export async function GET(req: NextRequest) {
  const base = (req.nextUrl.searchParams.get('base') ?? 'BRL').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) return NextResponse.json({ error: 'Moeda inválida.' }, { status: 400 });
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, { next: { revalidate: 21600 } });
    const j = await r.json();
    if (r.ok && j.result === 'success') {
      return NextResponse.json({
        base, rates: j.rates as Record<string, number>,
        date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10),
        source: 'ExchangeRate-API (open access)', sourceUrl: 'https://www.exchangerate-api.com',
      });
    }
  } catch {
    /* tenta a próxima fonte */
  }
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`, { next: { revalidate: 21600 } });
    const j = await r.json();
    const raw = j[base.toLowerCase()] as Record<string, number> | undefined;
    if (r.ok && raw) {
      const rates: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) if (/^[a-z]{3}$/.test(k)) rates[k.toUpperCase()] = v;
      return NextResponse.json({ base, rates, date: j.date, source: 'fawazahmed0/currency-api', sourceUrl: 'https://github.com/fawazahmed0/exchange-api' });
    }
  } catch {
    /* sem fonte */
  }
  return NextResponse.json({ error: 'Cotação indisponível agora. Use uma taxa manual.' }, { status: 502 });
}
