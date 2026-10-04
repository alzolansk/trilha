'use client';
import { getSupabase } from './supabase/client';

let optIn = false;
export function setAnalyticsOptIn(v: boolean) {
  optIn = v;
}

/** Registra um evento de uso SÓ se a pessoa aceitou (o RLS também exige o opt-in). */
export function track(name: string, props: Record<string, string | number | boolean> = {}, tripId?: string) {
  const sb = getSupabase();
  if (!optIn || !sb || typeof navigator === 'undefined' || !navigator.onLine) return;
  void sb.from('analytics_events').insert({ name, props, trip_id: tripId ?? null }).then(() => undefined);
}
