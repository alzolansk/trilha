import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Busca de lugares (OpenStreetMap Nominatim). Política de uso: até 1 req/s, User-Agent
// identificável e atribuição. Exige login para não virar proxy aberto.
let last = 0;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2 || q.length > 120) return NextResponse.json({ results: [] });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });

  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=6&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': `Trilha/1.0 (${process.env.NEXT_PUBLIC_SITE_URL ?? 'app pessoal'})` },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!r.ok) return NextResponse.json({ error: 'Busca de lugares indisponível agora.' }, { status: 502 });
    const raw = (await r.json()) as {
      display_name: string; lat: string; lon: string; name?: string; type?: string;
      address?: Record<string, string>; extratags?: Record<string, string>;
    }[];
    const results = raw.map((x) => ({
      name: x.name || x.display_name.split(',')[0],
      label: x.display_name,
      country: x.address?.country ?? null,
      countryCode: x.address?.country_code?.toUpperCase() ?? null,
      lat: Number(x.lat),
      lng: Number(x.lon),
      // altitude só quando o OSM tem o dado (tag "ele"); nunca estimada
      altitude: x.extratags?.ele && /^-?\d+(\.\d+)?$/.test(x.extratags.ele) ? Math.round(Number(x.extratags.ele)) : null,
    }));
    return NextResponse.json({ results, attribution: '© OpenStreetMap contributors (ODbL), via Nominatim' });
  } catch {
    return NextResponse.json({ error: 'Busca de lugares indisponível agora.' }, { status: 502 });
  }
}
