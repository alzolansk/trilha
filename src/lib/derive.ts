// Dados derivados da viagem (nada fixo do protótipo: tudo calculado do que foi salvo).
import type { DocumentRow, Stay, Stop, Transport, Trip, TripBundle } from '../data/types';
import { dateSpan, dayMonthYearU, hhmm, MODE_LABEL, nightsLabel } from './format';
import { toCents } from './money';
import { daysBetween, todayIn, wallToInstant } from './time';

/** Instante do embarque: departure_at, ou 00:00 do primeiro dia no fuso da partida. */
export function tripTarget(trip: Trip): number {
  if (trip.departure_at) return Date.parse(trip.departure_at);
  const [y, mo, d] = trip.start_date.split('-').map(Number);
  return wallToInstant(trip.departure_tz || 'America/Sao_Paulo', { y, mo, d, h: 0, mi: 0, s: 0 });
}

export type Phase =
  | { kind: 'before' }
  | { kind: 'today' } // dia do embarque, antes ou depois do horário
  | { kind: 'during'; day: number; total: number }
  | { kind: 'after'; daysAgo: number };

export function tripPhase(trip: Trip, now = Date.now()): Phase {
  const tz = trip.departure_tz || 'America/Sao_Paulo';
  const today = todayIn(tz, now);
  const total = daysBetween(trip.start_date, trip.end_date) + 1;
  if (today > trip.end_date) return { kind: 'after', daysAgo: daysBetween(trip.end_date, today) };
  if (today === trip.start_date) return { kind: 'today' };
  if (today > trip.start_date) return { kind: 'during', day: daysBetween(trip.start_date, today) + 1, total };
  return { kind: 'before' };
}

export function sortedStops(b: TripBundle): Stop[] {
  return [...b.stops].sort((a, c) => a.position - c.position || a.arrival_date.localeCompare(c.arrival_date));
}

/** Código curto da parada: o informado, ou 3 primeiras letras (marcado como derivado). */
export function stopCode(s: Stop): string {
  if (s.code) return s.code;
  return s.name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
}

export function arrivalOf(b: TripBundle, stopId: string): Transport | null {
  return b.transports.find((t) => t.stop_id === stopId) ?? null;
}
export function stayOf(b: TripBundle, stopId: string): Stay | null {
  return b.stays.find((s) => s.stop_id === stopId) ?? null;
}

export function durationLabel(min: number | null | undefined): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}

/** Duração do trecho: informada, ou calculada se horários e fusos das duas pontas existem. */
export function transportMinutes(t: Transport): number | null {
  if (t.duration_min) return t.duration_min;
  if (!t.depart_date || !t.depart_time || !t.arrive_date || !t.arrive_time || !t.depart_tz || !t.arrive_tz) return null;
  const [dy, dm, dd] = t.depart_date.split('-').map(Number);
  const [ay, am, ad] = t.arrive_date.split('-').map(Number);
  const [dh, dmi] = t.depart_time.split(':').map(Number);
  const [ah, ami] = t.arrive_time.split(':').map(Number);
  const a = wallToInstant(t.depart_tz, { y: dy, mo: dm, d: dd, h: dh, mi: dmi, s: 0 });
  const b = wallToInstant(t.arrive_tz, { y: ay, mo: am, d: ad, h: ah, mi: ami, s: 0 });
  const min = Math.round((b - a) / 60000);
  return min > 0 ? min : null;
}

/** "Ônibus · 7h" para o trecho que sai desta parada e chega na próxima. */
export function legToNext(b: TripBundle, stops: Stop[], i: number): string {
  const next = stops[i + 1];
  if (!next) return '';
  const t = arrivalOf(b, next.id);
  const mode = t?.mode ?? next.arrival_mode;
  if (!mode) return '';
  const dur = t ? durationLabel(transportMinutes(t)) : '';
  return `${MODE_LABEL[mode]}${dur ? ` · ${dur}` : ''}`;
}

export function stopDates(s: Stop, upper = false) {
  return dateSpan(s.arrival_date, s.departure_date, upper);
}
export function stopNights(s: Stop) {
  return nightsLabel(s.arrival_date, s.departure_date);
}
export function stopMeta(s: Stop): string {
  if (s.meta) return s.meta;
  return s.altitude_m != null ? `altitude ${s.altitude_m.toLocaleString('pt-BR')} m` : '';
}

/** Parada em andamento numa data (YYYY-MM-DD), ou a próxima. */
export function stopIndexOn(stops: Stop[], date: string): number {
  const i = stops.findIndex((s) => date >= s.arrival_date && date < s.departure_date);
  if (i >= 0) return i;
  const next = stops.findIndex((s) => s.arrival_date >= date);
  return next >= 0 ? next : Math.max(0, stops.length - 1);
}

/** Rótulo do embarque: "15 JAN 2027 · 06:40 · GRU → LIM" (só o que existe). */
export function departureLabel(b: TripBundle): string {
  const trip = b.trip;
  const parts = [dayMonthYearU(trip.start_date)];
  if (trip.departure_at) {
    const t = new Intl.DateTimeFormat('pt-BR', { timeZone: trip.departure_tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(trip.departure_at));
    parts.push(t);
  }
  const stops = sortedStops(b);
  const first = stops[0] ? arrivalOf(b, stops[0].id) : null;
  const from = first?.origin_code || trip.origin;
  const to = first?.dest_code || (stops[0] ? stopCode(stops[0]) : null);
  if (from && to) parts.push(`${from} → ${to}`);
  return parts.join(' · ');
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]);
  const dLng = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distância em linha reta entre paradas consecutivas com coordenadas (não é trajeto real). */
export function straightKm(stops: Stop[]): { km: number; complete: boolean } {
  let km = 0;
  let complete = stops.length > 1;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
      complete = false;
      continue;
    }
    km += haversineKm([a.lat, a.lng], [b.lat, b.lng]);
  }
  return { km: Math.round(km), complete };
}

export function totalSpentCents(b: TripBundle): number {
  return b.expenses.reduce((a, e) => a + toCents(String(e.base_amount)), 0);
}

export function packingProgress(b: TripBundle) {
  const total = b.packingItems.length;
  const done = b.packingItems.filter((i) => i.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function docsOfStop(b: TripBundle, stopId: string): DocumentRow[] {
  return b.documents.filter((d) => d.stop_id === stopId && d.status === 'ready');
}

export function stayStatusLabel(b: TripBundle, s: Stay | null): { label: string; tone: 'acc' | 'acc2' } {
  if (!s || s.status === 'pending') return { label: 'Sem reserva', tone: 'acc' };
  const hasDoc = s.document_id ? b.documents.some((d) => d.id === s.document_id) : b.documents.some((d) => d.category === 'reserva' && d.stop_id === s.stop_id);
  return hasDoc ? { label: 'Reserva anexada', tone: 'acc2' } : { label: 'Reservado · falta anexar', tone: 'acc' };
}

export function ticketTimes(t: Transport | null) {
  return { dep: hhmm(t?.depart_time) || '[HORÁRIO]', arr: hhmm(t?.arrive_time) || '[HORÁRIO]' };
}
