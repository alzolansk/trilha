import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { unsplashConfigured, unsplashOptions } from '@/lib/unsplash.server';

// Opções de foto para "Trocar foto" (até 9, em paisagem). Quem escolhe é a pessoa, por isso sem conferência.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const name = p.get('name')?.trim() ?? '';
  const context = p.get('context')?.trim() || null;
  if (name.length < 2 || name.length > 120 || (context?.length ?? 0) > 120) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });
  if (!unsplashConfigured()) return NextResponse.json({ configured: false, photos: [] });
  const photos = await unsplashOptions(name, context);
  if (!photos) return NextResponse.json({ configured: true, photos: [], error: 'Fotos indisponíveis agora. Tente daqui a pouco.' }, { status: 503 });
  return NextResponse.json({ configured: true, photos });
}
