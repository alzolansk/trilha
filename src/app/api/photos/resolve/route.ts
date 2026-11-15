import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { resolveUnsplash, unsplashConfigured } from '@/lib/unsplash.server';

// Foto conferida de um lugar ou passeio pelo Unsplash (ajuste de 14/11/2026). Exige login para não virar proxy aberto.
// Resposta: { configured, photo } — photo undefined/ausente = o servidor não pôde ajudar; null = sem foto conferida.
const num = z.number().finite().nullable().optional();
const Ask = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('place'), name: z.string().trim().min(2).max(120), context: z.string().trim().max(120).nullable().optional(), lat: num, lng: num, radiusKm: z.number().positive().max(500).optional() }),
  z.object({ kind: z.literal('activity'), names: z.array(z.string().trim().min(2).max(160)).min(1).max(4), city: z.string().trim().max(120) }),
]);

export async function POST(req: NextRequest) {
  const parsed = Ask.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'Entre na sua conta.' }, { status: 401 });
  if (!unsplashConfigured()) return NextResponse.json({ configured: false });
  const photo = await resolveUnsplash(parsed.data);
  if (photo === undefined) return NextResponse.json({ configured: true, unavailable: true });
  return NextResponse.json({ configured: true, photo });
}
