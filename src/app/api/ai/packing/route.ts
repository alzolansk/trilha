import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { BASE_RULES, claimsAction, packingSchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser, tripBrief } from '@/lib/ai/server';
import { normalize } from '@/lib/format';
import { rulePacking } from '@/lib/rules';
import type { TripBundle } from '@/data/types';

const input = z.object({ tripId: z.string().uuid() });

// Só devolve sugestões: nada entra na mala sem o clique da pessoa.
export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const { bundle } = await loadTripForUser(sb, user.id, p.data.tripId);
    const existing = (bundle.packingItems ?? []).map((i) => normalize(i.label));
    const fresh = <T extends { label: string }>(list: T[]) =>
      list.filter((i) => !existing.some((e) => e.includes(normalize(i.label)) || normalize(i.label).includes(e)));
    if (aiConfigured().length) {
      await consumeQuota(sb);
      const res = await runWithFallback(
        'packing',
        BASE_RULES,
        `Dados da trilha: ${JSON.stringify(tripBrief(bundle))}
Itens que já estão na mala: ${JSON.stringify((bundle.packingItems ?? []).map((i) => i.label))}
Sugira até 8 itens que FALTAM, cada um com motivo ligado aos dados (altitude, estilo, transporte, atividades, época). Não invente previsão do tempo; se citar clima, fale de forma geral para a época.
JSON: {"items":[{"label":"...","group":"Documentos|Roupas|Equipamento|Farmácia|Outros","reason":"..."}]}`,
        (raw) => {
          const v = packingSchema.safeParse(raw);
          if (!v.success) return null;
          return v.data.items.filter((i) => !claimsAction(i.reason));
        },
        { maxTokens: 900, temperature: 0.5 },
      );
      if (res) return NextResponse.json({ data: fresh(res.data), by: 'ai', model: `${res.provider}:${res.model}` });
    }
    return NextResponse.json({ data: fresh(rulePacking(bundle as TripBundle)), by: 'rules' });
  });
}
