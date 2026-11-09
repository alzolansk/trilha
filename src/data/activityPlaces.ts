'use client';
// Passeios no mapa (ajuste de 09/11): pede à IA onde cada atividade acontece e grava em activities.place.
// Tudo passa pelo TripSource, como o resto do app.
import { callAiOrError } from '../lib/ai/client';
import type { TripSource } from './source';
import type { ActivityPlace } from './types';

interface LocateResult { items: { id: string; place: ActivityPlace }[]; left: number }

/** Coluna `place` ausente: a migration 20261109000012 ainda não foi aplicada no Supabase. */
export function isMissingPlaceColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === 'PGRST204' || x?.code === '42703' || /\bplace\b.*column|column.*\bplace\b/i.test(x?.message ?? '');
}

const MISSING = 'Falta aplicar no Supabase a migration 20261109000012 (lugar dos passeios no mapa).';

/**
 * Localiza os passeios que ainda não estão no mapa (até 4 rodadas de 25). Devolve quantos ganharam
 * lugar, quantos não são um lugar e quantos sobraram. `activityIds` restringe a algumas atividades.
 */
export async function locateActivities(source: TripSource, tripId: string, activityIds?: string[]): Promise<{ placed: number; none: number; left: number }> {
  let placed = 0;
  let none = 0;
  let left = 0;
  for (let round = 0; round < 4; round++) {
    const r = await callAiOrError<LocateResult>('explore', { kind: 'locate', tripId, activityIds });
    if (!r.ok) throw new Error(r.error);
    const { items } = r.res.data;
    left = r.res.data.left;
    for (const it of items) {
      try {
        await source.update('activities', it.id, { place: it.place });
      } catch (e) {
        if (isMissingPlaceColumn(e)) throw new Error(MISSING);
        throw e;
      }
      if (it.place.none) none++;
      else placed++;
    }
    if (!left || !items.length || activityIds) break;
  }
  return { placed, none, left };
}

/** Grava o lugar escolhido à mão (ou null para tirar do mapa), com a mensagem certa se a migration faltar. */
export async function saveActivityPlace(source: TripSource, id: string, place: ActivityPlace | null, version?: number): Promise<void> {
  try {
    await source.update('activities', id, { place }, version);
  } catch (e) {
    if (isMissingPlaceColumn(e)) throw new Error(MISSING);
    throw e;
  }
}
