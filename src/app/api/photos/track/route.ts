import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { trackUnsplashDownload } from '@/lib/unsplash.server';
import { isUnsplashId } from '@/lib/unsplash';

// Aviso de uso ao Unsplash quando uma foto é escolhida para a trilha (diretriz da API).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!isUnsplashId(id)) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });
  return NextResponse.json({ ok: await trackUnsplashDownload(id) });
}
