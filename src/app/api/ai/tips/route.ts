import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { BASE_RULES, claimsAction, sensitiveWithoutSource, tipSchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser, tripBrief } from '@/lib/ai/server';
import { ruleTip } from '@/lib/rules';
import type { TripBundle } from '@/data/types';

const input = z.object({ tripId: z.string().uuid(), stopId: z.string().uuid() });

export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const { bundle, role } = await loadTripForUser(sb, user.id, p.data.tripId);
    const stop = bundle.stops?.find((s) => s.id === p.data.stopId);
    if (!stop) throw new HttpError(404, 'Parada não encontrada.');
    const now = new Date().toISOString();

    let tip: Record<string, unknown> | null = null;
    if (aiConfigured().length) {
      await consumeQuota(sb);
      const res = await runWithFallback(
        'tips',
        BASE_RULES,
        `Dados da trilha: ${JSON.stringify(tripBrief(bundle))}
Escreva UMA dica útil e específica para a parada "${stop.name}" (id ${stop.id}), considerando datas, altitude, transporte e plano informados. Não repita o óbvio.
JSON: {"text": "...", "kind": "clima|altitude|fronteira|reserva|logistica|cultura|outro", "source": "site oficial onde conferir, ou null"}`,
        (raw) => {
          const v = tipSchema.safeParse(raw);
          if (!v.success || claimsAction(v.data.text) || sensitiveWithoutSource(v.data)) return null;
          return v.data;
        },
        { maxTokens: 400, temperature: 0.6 },
      );
      if (res) {
        // A IA não verifica nada: a fonte é só onde conferir, e a data de verificação dela é descartada.
        const src = res.data.source ?? undefined;
        tip = { text: res.data.text, kind: res.data.kind, source: src, by: 'ai', model: `${res.provider}:${res.model}`, generated_at: now };
      }
    }
    if (!tip) {
      const r = ruleTip(bundle as TripBundle, stop);
      return NextResponse.json({ data: r ? { ...r, by: 'rules', generated_at: now } : null, by: 'rules', saved: false });
    }
    const canEdit = role !== 'viewer';
    if (canEdit) await sb.from('stops').update({ tip }).eq('id', stop.id);
    return NextResponse.json({ data: tip, by: 'ai', saved: canEdit });
  });
}
