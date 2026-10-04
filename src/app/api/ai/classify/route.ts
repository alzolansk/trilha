import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { BASE_RULES, classifySchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser } from '@/lib/ai/server';

const input = z.object({ tripId: z.string().uuid(), fileName: z.string().max(200), text: z.string().max(6000) });

// Recebe só o nome e um trecho do texto extraído no navegador (o arquivo não passa por aqui).
export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    if (!aiConfigured().length) return NextResponse.json({ error: 'IA não configurada.' }, { status: 503 });
    const { bundle } = await loadTripForUser(sb, user.id, p.data.tripId);
    await consumeQuota(sb);
    const stops = (bundle.stops ?? []).map((s) => ({ id: s.id, cidade: s.name, pais: s.country, codigo: s.code, chegada: s.arrival_date }));
    const text = p.data.text;
    const res = await runWithFallback(
      'classify',
      `${BASE_RULES}
Você classifica documentos de viagem. Use apenas o que está no texto; sem evidência, use confidence baixa e campos null. Nunca invente datas, nomes, números de reserva ou dados pessoais.`,
      `Arquivo: ${p.data.fileName}
Paradas: ${JSON.stringify(stops)}
Texto extraído (pode ter erros de OCR):
"""${text.slice(0, 5000)}"""
JSON: {"category":"passagem|identidade|reserva|ingresso|seguro|outro","stop_id":"id de uma parada ou null","title":"título curto","subtitle":"linha curta ou null","confidence":0.0,"valid_until":"AAAA-MM-DD só se estiver escrito, senão null"}`,
      (raw) => {
        const v = classifySchema.safeParse(raw);
        if (!v.success) return null;
        const out = { ...v.data };
        if (out.stop_id && !stops.some((s) => s.id === out.stop_id)) out.stop_id = null;
        // Datas só valem se aparecerem literalmente no texto
        if (out.valid_until) {
          const [y, m, d] = out.valid_until.split('-');
          if (!text.includes(out.valid_until) && !text.includes(`${d}/${m}/${y}`) && !text.includes(`${d}.${m}.${y}`)) out.valid_until = null;
        }
        return out;
      },
      { maxTokens: 300, temperature: 0.1 },
    );
    if (!res) return NextResponse.json({ error: 'IA indisponível.' }, { status: 503 });
    return NextResponse.json({ data: res.data, by: 'ai', model: `${res.provider}:${res.model}` });
  });
}
