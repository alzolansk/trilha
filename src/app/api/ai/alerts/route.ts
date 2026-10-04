import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { alertsSchema, BASE_RULES, claimsAction } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser, tripBrief } from '@/lib/ai/server';
import { ruleAlerts } from '@/lib/rules';
import type { TripBundle } from '@/data/types';

const input = z.object({ tripId: z.string().uuid(), useAi: z.boolean().default(true) });

/**
 * Alertas da trilha: regras verificáveis sempre; IA opcional para o que regras não pegam.
 * Alertas da IA viram pendências (source='ai', editáveis e removíveis) quando quem pede pode editar.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const { bundle, role } = await loadTripForUser(sb, user.id, p.data.tripId);
    const rules = ruleAlerts(bundle as TripBundle);
    let ai: { key: string; title: string; detail: string; link: string; source?: string | null }[] = [];
    let model: string | undefined;
    if (p.data.useAi && aiConfigured().length) {
      await consumeQuota(sb);
      const res = await runWithFallback(
        'alerts',
        BASE_RULES,
        `Dados da trilha: ${JSON.stringify(tripBrief(bundle))}
Alertas já detectados por regras (não repita): ${JSON.stringify(rules.map((r) => r.title))}
Aponte até 4 riscos de logística concretos visíveis nesses dados (ex.: conexão apertada, chegada de madrugada sem hospedagem, trecho longo seguido de atividade cedo). Se não houver, devolva lista vazia.
JSON: {"alerts":[{"key":"slug-curto","title":"...","detail":"...","link":"documentos|mala|roteiro|turma","source":null}]}`,
        (raw) => {
          const v = alertsSchema.safeParse(raw);
          return v.success ? v.data.alerts.filter((a) => !claimsAction(a.title + a.detail)) : null;
        },
        { maxTokens: 700, temperature: 0.3 },
      );
      if (res) {
        ai = res.data;
        model = `${res.provider}:${res.model}`;
      }
    }
    let saved = 0;
    if (ai.length && role !== 'viewer') {
      const rows = ai.map((a) => ({ trip_id: p.data.tripId, title: a.title, detail: a.detail, link: a.link, source: 'ai', alert_key: `ai-${a.key}`, created_by: user.id }));
      const { data } = await sb.from('tasks').upsert(rows, { onConflict: 'trip_id,alert_key', ignoreDuplicates: true }).select('id');
      saved = data?.length ?? 0;
    }
    return NextResponse.json({ data: { rules, ai }, by: ai.length ? 'ai' : 'rules', model, saved });
  });
}
