import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { BASE_RULES, claimsAction, retroSchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser } from '@/lib/ai/server';
import { ruleRetro } from '@/lib/rules';
import type { TripBundle } from '@/data/types';

const input = z.object({ tripId: z.string().uuid() });

export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const { bundle, role } = await loadTripForUser(sb, user.id, p.data.tripId);
    if (role === 'viewer') throw new HttpError(403, 'Só quem edita pode gerar a retrospectiva.');
    const base = ruleRetro(bundle as TripBundle);
    let content: Record<string, unknown> = base;
    let by: 'ai' | 'rules' = 'rules';
    if (aiConfigured().length) {
      await consumeQuota(sb);
      const diary = (bundle.journalEntries ?? [])
        .filter((e) => e.body)
        .map((e) => ({ parada: e.stop_id, data: e.entry_date, favorito: e.favorite, texto: (e.body ?? '').slice(0, 500) }));
      const res = await runWithFallback(
        'retro',
        `${BASE_RULES}
Aqui você pode usar até 3 frases por capítulo.`,
        `Monte o roteiro de uma retrospectiva da viagem usando SÓ estes dados (não invente acontecimentos):
Trilha: ${JSON.stringify({ titulo: bundle.trip.title, ida: bundle.trip.start_date, volta: bundle.trip.end_date })}
Paradas: ${JSON.stringify((bundle.stops ?? []).map((s) => ({ id: s.id, cidade: s.name, chegada: s.arrival_date, saida: s.departure_date })))}
Diário: ${JSON.stringify(diary).slice(0, 7000)}
Números: ${JSON.stringify(base.closing)}
JSON: {"title":"...","intro":"...","chapters":[{"stop_id":"id ou null","heading":"cidade","text":"..."}],"closing":"..."}`,
        (raw) => {
          const v = retroSchema.safeParse(raw);
          if (!v.success || claimsAction(JSON.stringify(v.data))) return null;
          return v.data;
        },
        { maxTokens: 1800, temperature: 0.7 },
      );
      if (res) {
        content = { ...res.data, model: `${res.provider}:${res.model}` };
        by = 'ai';
      }
    }
    const { error } = await sb
      .from('trip_retros')
      .upsert({ trip_id: p.data.tripId, content, generated_by: by, created_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'trip_id' });
    if (error) throw new HttpError(500, 'Não deu pra salvar a retrospectiva.');
    return NextResponse.json({ data: content, by });
  });
}
