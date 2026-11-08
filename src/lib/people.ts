// Quantas pessoas dividem a viagem (planning §10.9). Fonte única para todo cálculo "por pessoa".
import type { Trip, TripBundle } from '../data/types';

/**
 * O maior entre os membros no app e `trips.party_size` (quem vai, mesmo sem convite). Mínimo 1.
 * Rateio de gastos e votações continuam contando só os membros.
 */
export function headcount(b: Pick<TripBundle, 'members'> & { trip?: Pick<Trip, 'party_size'> | null }): number {
  const party = b.trip?.party_size;
  return Math.max(1, b.members.length, typeof party === 'number' && party > 0 ? Math.min(50, Math.round(party)) : 1);
}
