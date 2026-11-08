import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { EXPLORE_RULES, estimateDailySchema, estimateTransportSchema } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, loadTripForUser, readJson, requireUser } from '@/lib/ai/server';

// Estimativas para o Orçamento (planning §8.3). Só devolve FAIXAS; nada é gravado aqui:
// a turma confirma no Orçamento e só então o valor vai para o item.
const input = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transport'), tripId: z.string().uuid(),
    // Voo que ainda não está no roteiro (planning §10.10.3): "ida" e "volta".
    virtual: z.array(z.object({ key: z.enum(['ida', 'volta']), title: z.string().max(120) })).max(2).optional(),
  }),
  z.object({ kind: z.literal('daily'), tripId: z.string().uuid(), country: z.string().min(2).max(60), pace: z.enum(['leve', 'moderado', 'intenso']) }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    const { sb, user } = await requireUser();
    const p = input.safeParse(await readJson(req));
    if (!p.success) throw new HttpError(400, 'Dados inválidos.');
    const q = p.data;
    if (!aiConfigured().length) return NextResponse.json({ error: 'As estimativas precisam da IA, que não está configurada neste app.' }, { status: 503 });
    const { bundle } = await loadTripForUser(sb, user.id, q.tripId);
    const cur = bundle.trip.base_currency;

    if (q.kind === 'daily') {
      await consumeQuota(sb);
      const res = await runWithFallback(
        'explore',
        EXPLORE_RULES,
        `Moeda: ${cur}. País: ${q.country}. Estilo da turma: ${bundle.trip.style}. Ritmo: ${q.pace}.
Faixa de gasto DIÁRIO com comida por pessoa (café, almoço, jantar, água/lanches), em ${cur}.
JSON: {"cost_low":0,"cost_high":0}`,
        (raw) => {
          const v = estimateDailySchema.safeParse(raw);
          return v.success && v.data.cost_high > 0 ? v.data : null;
        },
        { maxTokens: 200, temperature: 0.3 },
      );
      if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
      const lo = Math.min(res.data.cost_low, res.data.cost_high) * 100;
      const hi = Math.max(res.data.cost_low, res.data.cost_high) * 100;
      return NextResponse.json({ data: { low: lo, high: hi, currency: cur }, by: 'ai', estimate: true, model: `${res.provider}:${res.model}` });
    }

    const stops = [...(bundle.stops ?? [])].sort((a, b) => a.position - b.position);
    const legs = (bundle.transports ?? [])
      .filter((t) => t.price_cents == null)
      .map((t) => {
        const i = stops.findIndex((s) => s.id === t.stop_id);
        const from = t.origin_name ?? t.origin_code ?? (i > 0 ? stops[i - 1].name : bundle.trip.origin) ?? 'origem';
        return { id: t.id, from, to: t.dest_name ?? stops[i]?.name ?? 'destino', mode: t.mode, date: t.depart_date };
      });
    const origin = bundle.trip.origin?.trim();
    if (origin && stops.length) {
      for (const v of q.virtual ?? []) {
        legs.push(v.key === 'ida'
          ? { id: 'ida', from: origin, to: stops[0].name, mode: 'plane', date: bundle.trip.start_date }
          : { id: 'volta', from: stops[stops.length - 1].name, to: origin, mode: 'plane', date: bundle.trip.end_date });
      }
    }
    if (!legs.length) return NextResponse.json({ data: { items: [], currency: cur }, by: 'rules' });
    await consumeQuota(sb);
    const res = await runWithFallback(
      'explore',
      EXPLORE_RULES,
      `Moeda: ${cur}. Estilo: ${bundle.trip.style}.
Para cada trecho, dê a faixa de preço POR PESSOA (só ida) e o modo mais provável, se o informado for "other".
Trechos: ${JSON.stringify(legs)}.
JSON: {"items":[{"id":"<id do trecho>","mode":"plane|bus|train|car|boat|other","cost_low":0,"cost_high":0}]}`,
      (raw) => {
        const v = estimateTransportSchema.safeParse(raw);
        if (!v.success) return null;
        const items = v.data.items.filter((x) => legs.some((l) => l.id === x.id));
        return items.length ? items : null;
      },
      { maxTokens: 900, temperature: 0.3 },
    );
    if (!res) throw new HttpError(502, 'A IA não respondeu agora. Tenta de novo daqui a pouco.');
    const items = res.data.map((x) => ({ transport_id: x.id, mode: x.mode, low: Math.min(x.cost_low, x.cost_high) * 100, high: Math.max(x.cost_low, x.cost_high) * 100 }));
    return NextResponse.json({ data: { items, currency: cur }, by: 'ai', estimate: true, model: `${res.provider}:${res.model}` });
  });
}
