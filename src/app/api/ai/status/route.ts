import { NextResponse } from 'next/server';
import { aiConfigured } from '@/lib/ai/providers';

// Só informa se há algum provedor configurado (nunca expõe chaves).
export async function GET() {
  const providers = aiConfigured();
  return NextResponse.json({ configured: providers.length > 0, providers });
}
