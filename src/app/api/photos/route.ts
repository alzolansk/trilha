import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { imageInfoUrl, parseImageInfo, pickPageImage, searchUrl, WIKI_LANGS, WIKI_USER_AGENT, type WikiLang } from '@/lib/photos';
import type { PhotoRef } from '@/data/types';

// Foto de um lugar pela Wikipedia/Commons, com autor e licença (planning §8.1).
// Exige login (como /api/geo) para não virar proxy aberto. Respostas ficam 30 dias em cache.
const MONTH = 60 * 60 * 24 * 30;

async function wiki<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT, 'Api-User-Agent': WIKI_USER_AGENT }, next: { revalidate: MONTH } });
  if (!r.ok) return null;
  const type = r.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null; // página de erro/limite da Wikimedia
  return (await r.json()) as T;
}

async function find(q: { q?: string; title?: string }, lang: WikiLang): Promise<PhotoRef | null> {
  const query = q.title ?? q.q ?? '';
  const res = await wiki<Parameters<typeof pickPageImage>[0]>(searchUrl(lang, q));
  const hit = res ? pickPageImage(res, query) : null;
  if (!hit) return null;
  const info = await wiki<Parameters<typeof parseImageInfo>[0]>(imageInfoUrl(lang, hit.file));
  return info ? parseImageInfo(info) : null;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = p.get('q')?.trim() ?? '';
  const title = p.get('title')?.trim() ?? '';
  if ((q.length < 2 && title.length < 2) || q.length > 120 || title.length > 120) return NextResponse.json({ photo: null });
  const lang = (WIKI_LANGS as readonly string[]).includes(p.get('lang') ?? '') ? (p.get('lang') as WikiLang) : 'pt';

  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });

  try {
    const ask = title ? { title } : { q };
    let photo = await find(ask, lang);
    // pt sem foto → tenta en; "Bairro, Cidade" sem página própria → sem foto (nunca de outro lugar)
    if (!photo) photo = await find(ask, lang === 'pt' ? 'en' : 'pt');
    return NextResponse.json(
      { photo },
      { headers: { 'Cache-Control': `private, max-age=${photo ? MONTH : 60 * 60 * 24}` } },
    );
  } catch {
    return NextResponse.json({ error: 'Fotos indisponíveis agora.' }, { status: 502 });
  }
}
